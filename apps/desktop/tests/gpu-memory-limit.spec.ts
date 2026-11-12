/** GPU memory limit target, sudoers rule, and default-only ownership. */
import { expect, it, vi } from 'vitest'
import { GPU_LIMIT_RULE_FILE, GpuMemoryLimit, gpuLimitRule, gpuLimitTarget } from '../src/gpu-memory-limit.ts'

const GIB = 1024 ** 3

/** Fake macOS host; `rules` models sudoers: none, only an unrelated NOPASSWD entry, or the Harness entry. */
function machine(initial: number, rules: 'none' | 'other' | 'harness' = 'harness') {
  let limit = initial
  let installed = rules
  const calls: string[] = []
  const exec = vi.fn(async (file: string, args: readonly string[]) => {
    calls.push([file, ...args].join(' '))
    if (file === '/usr/sbin/sysctl') return `${limit}\n`
    if (file === '/usr/bin/osascript') { installed = 'harness'; return '' }
    if (installed === 'none') throw new Error('sudo: a password is required')
    if (args[1] === '-l') {
      const nopasswd = installed === 'harness'
        ? '/usr/sbin/sysctl iogpu.wired_limit_mb\\=27852, /usr/sbin/sysctl iogpu.wired_limit_mb\\=0'
        : '/usr/bin/true'
      return `User lars may run the following commands on host:\n    (ALL) ALL\n    (root) NOPASSWD: ${nopasswd}\n`
    }
    if (installed !== 'harness') throw new Error('sudo: a password is required')
    limit = Number(args[2]?.split('=')[1])
    return ''
  })
  return { exec, calls, limit: () => limit, setLimit: (value: number) => { limit = value } }
}

it('reserves 15% of memory and at least 4 GiB for macOS', () => {
  expect(gpuLimitTarget(32 * GIB)).toBe(32768 - 4916)
  expect(gpuLimitTarget(16 * GIB)).toBe(16384 - 4096)
})

it('permits only the target and the default value, with sudoers escaping', () => {
  expect(gpuLimitRule('lars', 27852)).toBe(
    'lars ALL=(root) NOPASSWD: /usr/sbin/sysctl iogpu.wired_limit_mb\\=27852, /usr/sbin/sysctl iogpu.wired_limit_mb\\=0\n')
  expect(() => gpuLimitRule('a b', 1)).toThrow('Unsupported account name')
  expect(() => gpuLimitRule('lars', 0)).toThrow('Invalid GPU limit target')
})

it('raises the default limit and restores the default at release', async () => {
  const host = machine(0)
  const limit = new GpuMemoryLimit(27852, 'lars', host.exec)
  expect(await limit.apply()).toBe('raised')
  expect(host.limit()).toBe(27852)
  await limit.restore()
  expect(host.limit()).toBe(0)
  expect(host.calls).toContain('/usr/bin/sudo -n /usr/sbin/sysctl iogpu.wired_limit_mb=0')
})

it('leaves a limit set by someone else unchanged', async () => {
  const host = machine(27795)
  const limit = new GpuMemoryLimit(27852, 'lars', host.exec)
  expect(await limit.apply()).toBe('unchanged')
  await limit.restore()
  expect(host.limit()).toBe(27795)
})

it('does not restore when the limit changed after Harness raised it', async () => {
  const host = machine(0)
  const limit = new GpuMemoryLimit(27852, 'lars', host.exec)
  await limit.apply()
  host.setLimit(30000)
  await limit.restore()
  expect(host.limit()).toBe(30000)
})

it('shows the administrator prompt only when the rule is missing', async () => {
  const missing = machine(0, 'none')
  await new GpuMemoryLimit(27852, 'lars', missing.exec).authorize()
  const prompts = missing.calls.filter(call => call.startsWith('/usr/bin/osascript'))
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('/usr/bin/install -m 0440 -o root -g wheel')
  expect(prompts[0]).toContain(`'${GPU_LIMIT_RULE_FILE}'" with administrator privileges`)
  const present = machine(0, 'harness')
  await new GpuMemoryLimit(27852, 'lars', present.exec).authorize()
  expect(present.calls.some(call => call.startsWith('/usr/bin/osascript'))).toBe(false)
})

it('fails when sudo cannot run the limit command', async () => {
  const host = machine(0, 'none')
  await expect(new GpuMemoryLimit(27852, 'lars', host.exec).apply()).rejects.toThrow('password is required')
  expect(host.limit()).toBe(0)
})

it('asks for the administrator password when only an unrelated NOPASSWD rule exists', async () => {
  const host = machine(0, 'other')
  const limit = new GpuMemoryLimit(27852, 'lars', host.exec)
  await limit.authorize()
  expect(host.calls.filter(call => call.startsWith('/usr/bin/osascript'))).toHaveLength(1)
  expect(await limit.apply()).toBe('raised')
})
