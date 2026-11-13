// @vitest-environment jsdom
/** General Settings server actions and lifecycle switches. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { QwenServerRow } from '../src/client/QwenServerRow.tsx'
import { en, type SettingsKey } from '../src/client/locales.ts'
import type { QwenServerBridge, QwenServerPreferences, QwenServerState } from '../src/types.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })
const STOPPED: QwenServerState = { phase: 'stopped', autoStart: false, stopOnExit: true, raiseGpuLimit: false, gpuLimit: 'off', gpuLimitMb: 27852 }

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail })
  return { promise, resolve, reject }
}

function mount(initial: Partial<QwenServerState> = {}, statusFailure?: Error) {
  let state: QwenServerState = { ...STOPPED, ...initial }
  const bridge = {
    status: vi.fn(async (): Promise<QwenServerState> => { if (statusFailure !== undefined) throw statusFailure; return state }),
    start: vi.fn(async (): Promise<QwenServerState> => (state = { ...state, phase: 'running' })),
    stop: vi.fn(async (): Promise<QwenServerState> => (state = { ...state, phase: 'stopped' })),
    configure: vi.fn(async (preferences: QwenServerPreferences): Promise<QwenServerState> =>
      (state = { ...state, ...preferences, gpuLimit: preferences.raiseGpuLimit ? 'raised' : 'off' })),
  } satisfies QwenServerBridge
  const t = (key: string, params?: Record<string, unknown>): string =>
    en[key as SettingsKey].replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name]))
  const view = render(<QwenServerRow {...({} as GlobalStandardProps)} bridge={bridge} t={t} />)
  return { bridge, view }
}

it('starts and stops the server, saves both options, and renders the server row', async () => {
  const { bridge, view } = mount()
  await waitFor(() => { expect(screen.getByRole('button', { name: en['qwen.start'] }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: en['qwen.start'] }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en['qwen.stop'] })).toBeTruthy() })
  expect(bridge.start).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('switch', { name: en['qwen.autoStart'] }))
  await waitFor(() => { expect(bridge.configure).toHaveBeenCalledWith({ autoStart: true, stopOnExit: true, raiseGpuLimit: false }) })
  await waitFor(() => { expect(screen.getByRole('switch', { name: en['qwen.stopOnExit'] }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('switch', { name: en['qwen.stopOnExit'] }))
  await waitFor(() => { expect(bridge.configure).toHaveBeenCalledWith({ autoStart: true, stopOnExit: false, raiseGpuLimit: false }) })
  await waitFor(() => { expect(screen.getByRole('button', { name: en['qwen.stop'] }).hasAttribute('disabled')).toBe(false) })
  await expect(`${view.container.textContent}\n`).toMatchFileSnapshot('./expected/qwen-server-en.txt')
  fireEvent.click(screen.getByRole('button', { name: en['qwen.stop'] }))
  await waitFor(() => { expect(bridge.stop).toHaveBeenCalledOnce() })
})

it('identifies external servers and prevents stopping them', async () => {
  mount({ phase: 'external' })
  await screen.findByText(en['qwen.external'])
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
})

it('turns the GPU limit option on and shows the limit Harness sets', async () => {
  const { bridge } = mount()
  await screen.findByText(en['qwen.gpuLimit.off'].replace('{mb}', '27852'))
  await waitFor(() => { expect(screen.getByRole('switch', { name: en['qwen.raiseGpuLimit'] }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('switch', { name: en['qwen.raiseGpuLimit'] }))
  await waitFor(() => { expect(bridge.configure).toHaveBeenCalledWith({ autoStart: false, stopOnExit: true, raiseGpuLimit: true }) })
  await screen.findByText(en['qwen.gpuLimit.raised'].replace('{mb}', '27852'))
})

it('reports bridge failures and a GPU limit that could not change', async () => {
  const { bridge } = mount()
  bridge.configure.mockResolvedValueOnce({ ...STOPPED, gpuLimit: 'error' })
  await waitFor(() => { expect(screen.getByRole('switch', { name: en['qwen.raiseGpuLimit'] }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('switch', { name: en['qwen.raiseGpuLimit'] }))
  expect((await screen.findByRole('alert')).textContent).toBe(en['qwen.gpuLimit.error'])
  bridge.start.mockRejectedValueOnce(new Error('ipc closed'))
  fireEvent.click(screen.getByRole('button', { name: en['qwen.start'] }))
  await screen.findByText(en['qwen.error'])
})

it('reports a status read failure', async () => {
  mount({}, new Error('ipc closed'))
  await screen.findByText(en['qwen.error'])
})

it('reports preferences that the shell could not read', async () => {
  mount({ phase: 'error', failure: 'settings' })
  expect((await screen.findByRole('alert')).textContent).toBe(en['qwen.settingsError'])
})

it('skips a timer read while one is pending and ignores reads that an action overtakes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { bridge } = mount()
  await screen.findByRole('button', { name: en['qwen.start'] })
  const stale = deferred<QwenServerState>()
  bridge.status.mockReturnValueOnce(stale.promise)
  await vi.advanceTimersByTimeAsync(2000)
  await vi.advanceTimersByTimeAsync(2000)
  expect(bridge.status).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: en['qwen.start'] }))
  await screen.findByRole('button', { name: en['qwen.stop'] })
  stale.resolve(STOPPED)
  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole('status').textContent).toBe(en['qwen.running'])
  const failing = deferred<QwenServerState>()
  bridge.status.mockReturnValueOnce(failing.promise)
  await vi.advanceTimersByTimeAsync(2000)
  fireEvent.click(screen.getByRole('button', { name: en['qwen.stop'] }))
  await screen.findByRole('button', { name: en['qwen.start'] })
  failing.reject(new Error('stale read'))
  await vi.advanceTimersByTimeAsync(0)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('drops reads and actions that settle after the row unmounts', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  for (const outcome of ['resolve', 'reject'] as const) {
    const { bridge, view } = mount()
    await screen.findByRole('button', { name: en['qwen.start'] })
    const read = deferred<QwenServerState>()
    const action = deferred<QwenServerState>()
    bridge.status.mockReturnValueOnce(read.promise)
    bridge.start.mockReturnValueOnce(action.promise)
    await vi.advanceTimersByTimeAsync(2000)
    fireEvent.click(screen.getByRole('button', { name: en['qwen.start'] }))
    view.unmount()
    if (outcome === 'resolve') { read.resolve(STOPPED); action.resolve(STOPPED) }
    else { read.reject(new Error('closed')); action.reject(new Error('closed')) }
    await vi.advanceTimersByTimeAsync(0)
    expect(bridge.status).toHaveBeenCalledTimes(2)
  }
})
