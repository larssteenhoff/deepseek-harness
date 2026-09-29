/** Read the signed-in Codex subscription's weekly limit through the official app-server. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { CodexWeeklyQuota } from './types.ts'

interface AppServerFrame {
  readonly id?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

interface RateLimitResponse {
  readonly rateLimitsByLimitId?: Record<string, {
    readonly primary?: { readonly usedPercent?: unknown; readonly windowDurationMins?: unknown; readonly resetsAt?: unknown } | null
    readonly secondary?: { readonly usedPercent?: unknown; readonly windowDurationMins?: unknown; readonly resetsAt?: unknown } | null
  }>
}

const require = createRequire(import.meta.url)
const manifestPath = require.resolve('@openai/codex/package.json')
const manifest = require(manifestPath) as { bin: { codex: string } }
const codexEntrypoint = resolve(dirname(manifestPath), manifest.bin.codex)

/**
 * Read weekly Codex subscription usage without reading or returning local credentials.
 * @returns remaining percentage and reset time, or null when no weekly Codex quota exists.
 */
export function readCodexWeeklyQuota(): Promise<CodexWeeklyQuota | null> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [codexEntrypoint, 'app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let output = ''
    let settled = false
    const finish = (error?: Error, value?: CodexWeeklyQuota | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      if (error !== undefined) rejectPromise(error)
      else resolvePromise(value ?? null)
    }
    const timer = setTimeout(() => { finish(new Error('Codex quota request timed out')) }, 12_000)
    child.once('error', () => { finish(new Error('Codex quota service is unavailable')) })
    child.once('exit', (code) => {
      if (!settled) finish(new Error(code === 0 ? 'Codex quota response was missing' : 'Codex quota service stopped'))
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      for (;;) {
        const newline = output.indexOf('\n')
        if (newline < 0) break
        const line = output.slice(0, newline)
        output = output.slice(newline + 1)
        let frame: AppServerFrame
        try { frame = JSON.parse(line) as AppServerFrame }
        catch { continue }
        if (frame.id !== 2) continue
        if (frame.error !== undefined) {
          finish(new Error('Codex quota is unavailable'))
          return
        }
        const limits = (frame.result as RateLimitResponse | undefined)?.rateLimitsByLimitId
        const limit = limits?.codex
        const weekly = [limit?.primary, limit?.secondary].find(window => window?.windowDurationMins === 10080)
        const used = weekly?.usedPercent
        if (typeof used !== 'number' || !Number.isFinite(used)) {
          finish(undefined, null)
          return
        }
        const reset = weekly?.resetsAt
        finish(undefined, {
          remainingPercent: Math.max(0, Math.min(100, Math.round(100 - used))),
          resetsAt: typeof reset === 'number' && Number.isFinite(reset) ? reset : null,
        })
        return
      }
    })
    child.stdin.on('error', () => { finish(new Error('Codex quota request could not be sent')) })
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', method: 'initialize', id: 1,
      params: { clientInfo: { name: 'deepseek-harness', title: 'DeepSeek Harness', version: '1.0' } },
    })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'account/rateLimits/read', id: 2, params: {} })}\n`)
  })
}
