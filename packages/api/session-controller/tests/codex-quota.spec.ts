import { describe, expect, it, vi } from 'vitest'

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  return {
    ...actual,
    createRequire: (url: string | URL) => {
      const real = actual.createRequire(url)
      const resolve = Object.assign((id: string) => {
        if (id === '@openai/codex/package.json') throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' })
        return real.resolve(id)
      }, { paths: real.resolve.paths })
      return Object.assign((id: string) => real(id), real, { resolve })
    },
  }
})

describe('Codex weekly quota without @openai/codex', () => {
  it('loads the module and reports the quota service as unavailable', async () => {
    const { readCodexWeeklyQuota } = await import('../src/codex-quota.ts')
    await expect(readCodexWeeklyQuota()).rejects.toThrow('Codex quota service is unavailable')
  })
})
