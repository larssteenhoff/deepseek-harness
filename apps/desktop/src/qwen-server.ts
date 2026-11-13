/** Own the local oMLX server and its persisted launch preferences. */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { QwenServerState, QwenServerPreferences } from '@deepseek-ai/dsh-client-ui-settings-general/types'
import type { GpuMemoryLimit } from './gpu-memory-limit.ts'

/** The GPU limit operations the server owner drives. */
export type QwenGpuLimit = Pick<GpuMemoryLimit, 'target' | 'authorize' | 'apply' | 'restore'>

/** Settings and process owner; externally started servers are never terminated. */
export class QwenServer {
  private child: ChildProcess | undefined
  private preferences: QwenServerPreferences = { autoStart: false, stopOnExit: true, raiseGpuLimit: false }
  private phase: QwenServerState['phase'] = 'stopped'
  private failure: QwenServerState['failure']
  private limit: QwenServerState['gpuLimit'] = 'off'
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false

  /**
   * @param file - Preferences file; the server log lives beside it.
   * @param environment - Resolves the child environment, such as the login-shell environment, because a Dock or Finder
   *   launch inherits a `PATH` without the system directories that the oMLX launcher needs.
   * @param gpuLimit - Raises the GPU memory limit before oMLX starts and restores it at close when `raiseGpuLimit` is on.
   */
  constructor(private readonly file: string, private readonly environment: () => Promise<NodeJS.ProcessEnv>,
    private readonly gpuLimit: QwenGpuLimit,
    private readonly executable = join(homedir(), '.omlx', 'bin', 'omlx'),
    private readonly url = 'http://127.0.0.1:8000/v1/models', private readonly args = ['serve', '--headless', '--host', '127.0.0.1', '--port', '8000']) {}

  /** Read preferences before accepting actions. @returns after validated settings load. */
  async initialize(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (typeof value !== 'object' || value === null || !('autoStart' in value) || !('stopOnExit' in value)
        || typeof value.autoStart !== 'boolean' || typeof value.stopOnExit !== 'boolean'
        || ('raiseGpuLimit' in value && typeof value.raiseGpuLimit !== 'boolean')) throw new Error('Invalid Qwen preferences')
      this.preferences = { autoStart: value.autoStart, stopOnExit: value.stopOnExit, raiseGpuLimit: 'raiseGpuLimit' in value && value.raiseGpuLimit === true }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.failure = 'settings'
        return
      }
    }
    // oMLX reads the Metal cap when it starts, so the limit goes up first.
    if (this.preferences.raiseGpuLimit) await this.raise(false)
    if (this.preferences.autoStart) await this.start()
  }

  /**
   * @param authorize - Allow the one-time administrator prompt; startup never prompts.
   * @returns whether the limit is raised or left to another owner.
   */
  private async raise(authorize: boolean): Promise<boolean> {
    try {
      if (authorize) await this.gpuLimit.authorize()
      this.limit = await this.gpuLimit.apply()
      return true
    } catch (error) {
      console.error('Raising the GPU memory limit failed', error)
      this.limit = 'error'
      return false
    }
  }

  private async reachable(): Promise<boolean> {
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(1000) })
      await response.body?.cancel()
      return response.ok
    } catch (_error) { return false /* A stopped local server has no HTTP listener. */ }
  }

  /** Sample current server availability. @returns status and accepted preferences. */
  async status(): Promise<QwenServerState> {
    const available = await this.reachable()
    return { ...this.preferences, phase: this.phase === 'starting' || this.phase === 'stopping' ? this.phase
      : available ? this.child === undefined ? 'external' : 'running' : this.failure === undefined ? 'stopped' : 'error',
    ...(this.failure === undefined ? {} : { failure: this.failure }), gpuLimit: this.limit, gpuLimitMb: this.gpuLimit.target }
  }

  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch((_error: unknown) => { /* The caller owns the error; later actions remain usable. */ })
    return next
  }

  /**
   * Persist the preferences atomically. Turning `raiseGpuLimit` on can show one macOS administrator prompt; when that
   * fails or is cancelled, the old preferences stay and the state reports `gpuLimit: 'error'`.
   * @param value - validated preferences.
   * @returns accepted state.
   */
  configure(value: QwenServerPreferences): Promise<QwenServerState> {
    return this.ordered(async () => {
      if (value.raiseGpuLimit && !this.preferences.raiseGpuLimit && !await this.raise(true)) return this.status()
      if (!value.raiseGpuLimit && this.preferences.raiseGpuLimit) { await this.gpuLimit.restore(); this.limit = 'off' }
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, `${JSON.stringify(value)}\n`, { mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
      this.preferences = { ...value }
      if (this.failure === 'settings') this.failure = undefined
      return this.status()
    })
  }

  /** Start oMLX unless the endpoint is already available. @returns current state after readiness or failure. */
  start(): Promise<QwenServerState> {
    return this.ordered(async () => {
      if (this.closing || this.failure === 'settings') return this.status()
      if (await this.reachable()) return this.status()
      if (this.child !== undefined) await this.stopChild()
      this.phase = 'starting'
      this.failure = undefined
      const env = await this.environment()
      await mkdir(dirname(this.file), { recursive: true })
      const output = openSync(join(dirname(this.file), 'qwen-server.log'), 'a', 0o600)
      let child: ChildProcess
      try { child = spawn(this.executable, this.args, { detached: true, env, stdio: ['ignore', output, output] }) }
      finally { closeSync(output) }
      this.child = child
      child.unref()
      child.once('error', () => { if (this.child === child) { this.failure = 'start'; this.phase = 'error'; this.child = undefined } })
      child.once('exit', () => {
        if (this.child !== child) return
        this.child = undefined
        if (this.phase !== 'stopping') { this.failure = 'start'; this.phase = 'error' }
      })
      // A function reads the fields again after each await; inline checks keep their narrowed values.
      const waiting = (): boolean => this.child === child && !this.closing
      for (let attempt = 0; attempt < 120 && waiting(); attempt++) {
        if (await this.reachable()) { this.phase = 'running'; return this.status() }
        await delay(500)
      }
      await this.stopChild()
      this.failure = 'start'
      this.phase = 'error'
      return this.status()
    })
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.phase = 'stopping'
    const pid = child.pid
    if (pid === undefined) { this.child = undefined; return }
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    const signal = (value: NodeJS.Signals): void => {
      try { process.kill(-pid, value) }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error }
    }
    signal('SIGTERM')
    const controller = new AbortController()
    try {
      const timedOut = await Promise.race([exited.then(() => false), delay(5000, true, { signal: controller.signal })])
      if (timedOut) { signal('SIGKILL'); await exited }
    } finally { controller.abort() }
    if (this.child === child) this.child = undefined
  }

  /** Stop only the process started by this Harness instance. @returns current state. */
  stop(): Promise<QwenServerState> {
    return this.ordered(async () => { await this.stopChild(); this.phase = 'stopped'; this.failure = undefined; return this.status() })
  }

  /**
   * Finish active startup, honor the exit preference, then restore the GPU limit unless an owned server stays running on it.
   * @returns when owned cleanup has finished.
   */
  async close(): Promise<void> {
    this.closing = true
    await this.queue
    if (this.preferences.stopOnExit) { await this.stopChild(); this.phase = 'stopped' }
    if (this.child === undefined) await this.gpuLimit.restore()
  }
}
