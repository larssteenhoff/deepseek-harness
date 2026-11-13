/** Local server ownership and persisted lifecycle preferences. */
import { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { QwenServer, type QwenGpuLimit } from '../src/qwen-server.ts'

function gpuLimit(order: string[] = []): QwenGpuLimit & { [K in 'authorize' | 'apply' | 'restore']: ReturnType<typeof vi.fn> } {
  return {
    target: 27852,
    authorize: vi.fn(async () => { order.push('authorize') }),
    apply: vi.fn(async () => { order.push('apply'); return 'raised' as const }),
    restore: vi.fn(async () => { order.push('restore') }),
  }
}

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mocks.spawn }))
const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  try { for (const dispose of disposers.splice(0).reverse()) await dispose() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); mocks.spawn.mockReset() }
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'qwen-owner-'))
  const owner = new QwenServer(join(directory, 'qwen.json'), async () => ({ PATH: '/login/bin' }), gpuLimit(), '/test/omlx')
  disposers.push(async () => { await owner.close(); await rm(directory, { recursive: true, force: true }) })
  let available = false
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: available ? 200 : 503 })))
  const child = new ChildProcess()
  Object.defineProperty(child, 'pid', { value: 123456 })
  vi.spyOn(child, 'unref').mockImplementation(() => {})
  mocks.spawn.mockImplementation(() => { available = true; return child })
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    available = false
    queueMicrotask(() => { child.emit('exit', 0, 'SIGTERM') })
    return true
  })
  await owner.initialize()
  return { owner, directory, kill, child, external: () => { available = true } }
}

it('starts once for concurrent requests and waits for owned shutdown', async () => {
  const { owner, kill } = await fixture()
  const states = await Promise.all([owner.start(), owner.start()])
  expect(states.map(state => state.phase)).toEqual(['running', 'running'])
  expect(mocks.spawn).toHaveBeenCalledOnce()
  await owner.close()
  expect(kill).toHaveBeenCalledExactlyOnceWith(-123456, 'SIGTERM')
  expect((await owner.status()).phase).toBe('stopped')
})

it('leaves an externally running server untouched', async () => {
  const { owner, external, kill } = await fixture()
  external()
  expect((await owner.start()).phase).toBe('external')
  expect((await owner.stop()).phase).toBe('external')
  await owner.close()
  expect(mocks.spawn).not.toHaveBeenCalled()
  expect(kill).not.toHaveBeenCalled()
})

it('persists automatic start and leaves the child running when exit cleanup is disabled', async () => {
  const { owner, directory, kill } = await fixture()
  await owner.configure({ autoStart: true, stopOnExit: false, raiseGpuLimit: false })
  expect(JSON.parse(await readFile(join(directory, 'qwen.json'), 'utf8'))).toEqual({ autoStart: true, stopOnExit: false, raiseGpuLimit: false })
  await owner.start()
  await owner.close()
  expect(kill).not.toHaveBeenCalled()
})

it('honors automatic start on the next launch', async () => {
  const { directory } = await fixture()
  const file = join(directory, 'auto.json')
  await writeFile(file, JSON.stringify({ autoStart: true, stopOnExit: true }))
  const next = new QwenServer(file, async () => ({ PATH: '/login/bin' }), gpuLimit(), '/test/omlx')
  disposers.push(() => next.close())
  await next.initialize()
  expect((await next.status()).phase).toBe('running')
})

it('reports invalid preferences and repairs them only on an explicit save', async () => {
  const { directory } = await fixture()
  const file = join(directory, 'invalid.json')
  await writeFile(file, '{invalid')
  const next = new QwenServer(file, async () => ({ PATH: '/login/bin' }), gpuLimit(), '/test/omlx')
  disposers.push(() => next.close())
  await next.initialize()
  expect((await next.start()).failure).toBe('settings')
  expect(mocks.spawn).not.toHaveBeenCalled()
  await next.configure({ autoStart: false, stopOnExit: true, raiseGpuLimit: false })
  expect((await next.start()).phase).toBe('running')
})

it('starts the server with the resolved environment instead of the inherited one', async () => {
  const { owner } = await fixture()
  vi.stubEnv('PATH', '/usr/opt/local/bin')
  await owner.start()
  expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('/test/omlx', expect.any(Array),
    expect.objectContaining({ env: { PATH: '/login/bin' } }))
})

it('raises the GPU limit before automatic start and restores it after owned shutdown', async () => {
  const { directory } = await fixture()
  const file = join(directory, 'limit.json')
  await writeFile(file, JSON.stringify({ autoStart: true, stopOnExit: true, raiseGpuLimit: true }))
  const order: string[] = []
  const limit = gpuLimit(order)
  const spawnChild = mocks.spawn.getMockImplementation() as (...args: unknown[]) => ChildProcess
  mocks.spawn.mockImplementationOnce((...args: unknown[]) => { order.push('spawn'); return spawnChild(...args) })
  const next = new QwenServer(file, async () => ({ PATH: '/login/bin' }), limit, '/test/omlx')
  await next.initialize()
  expect(await next.status()).toMatchObject({ phase: 'running', gpuLimit: 'raised', gpuLimitMb: 27852 })
  await next.close()
  expect(order).toEqual(['apply', 'spawn', 'restore'])
  expect(limit.authorize).not.toHaveBeenCalled()
})

it('reads preference files without the GPU limit field as off', async () => {
  const { directory } = await fixture()
  const file = join(directory, 'legacy.json')
  await writeFile(file, JSON.stringify({ autoStart: false, stopOnExit: true }))
  const limit = gpuLimit()
  const next = new QwenServer(file, async () => ({ PATH: '/login/bin' }), limit, '/test/omlx')
  disposers.push(() => next.close())
  await next.initialize()
  expect(await next.status()).toMatchObject({ raiseGpuLimit: false, gpuLimit: 'off' })
  expect(limit.apply).not.toHaveBeenCalled()
})

it('authorizes once when the option turns on and keeps the old preferences when authorization fails', async () => {
  const { directory } = await fixture()
  const file = join(directory, 'toggle.json')
  const limit = gpuLimit()
  const next = new QwenServer(file, async () => ({ PATH: '/login/bin' }), limit, '/test/omlx')
  disposers.push(() => next.close())
  await next.initialize()
  limit.authorize.mockRejectedValueOnce(new Error('User canceled.'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await next.configure({ autoStart: false, stopOnExit: true, raiseGpuLimit: true })).toMatchObject({ raiseGpuLimit: false, gpuLimit: 'error' })
  await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await next.configure({ autoStart: false, stopOnExit: true, raiseGpuLimit: true })).toMatchObject({ raiseGpuLimit: true, gpuLimit: 'raised' })
  expect(limit.apply).toHaveBeenCalledOnce()
  expect(await next.configure({ autoStart: false, stopOnExit: true, raiseGpuLimit: false })).toMatchObject({ raiseGpuLimit: false, gpuLimit: 'off' })
  expect(limit.restore).toHaveBeenCalledOnce()
})

it('keeps the raised limit when an owned server stays running after exit', async () => {
  const { directory } = await fixture()
  const file = join(directory, 'keep.json')
  await writeFile(file, JSON.stringify({ autoStart: true, stopOnExit: false, raiseGpuLimit: true }))
  const limit = gpuLimit()
  const next = new QwenServer(file, async () => ({ PATH: '/login/bin' }), limit, '/test/omlx')
  await next.initialize()
  await next.close()
  expect(limit.restore).not.toHaveBeenCalled()
})
