/** Own the macOS Metal wired-memory limit (`iogpu.wired_limit_mb`) while Harness runs. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SYSCTL = '/usr/sbin/sysctl'
const KEY = 'iogpu.wired_limit_mb'
const MIB = 1024 ** 2
/** The only sudoers file this owner writes; it permits exactly two sysctl invocations. */
export const GPU_LIMIT_RULE_FILE = '/etc/sudoers.d/dsh-gpu-memory-limit'

/**
 * Reserve 15% of physical memory, and at least 4 GiB, for macOS and other applications.
 * @param totalBytes - Physical memory in bytes.
 * @returns The wired-memory limit in MiB that Harness sets.
 */
export function gpuLimitTarget(totalBytes: number): number {
  const total = Math.floor(totalBytes / MIB)
  return total - Math.max(4096, Math.ceil(total * 0.15))
}

/**
 * Build the sudoers rule. sudoers requires `=` in command arguments to be escaped.
 * @param user - Account allowed to run the two commands without a password.
 * @param target - Limit in MiB that the rule permits besides the macOS default `0`.
 * @returns The rule text with its trailing newline.
 */
export function gpuLimitRule(user: string, target: number): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(user)) throw new Error(`Unsupported account name for the GPU limit rule: ${user}`)
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error(`Invalid GPU limit target: ${target}`)
  return `${user} ALL=(root) NOPASSWD: ${SYSCTL} ${KEY}\\=${target}, ${SYSCTL} ${KEY}\\=0\n`
}

/** Result of one attempt to raise the limit. `unchanged` means another limit was already set and is left alone. */
export type GpuLimitApplied = 'raised' | 'unchanged'

/** Process runner seam; production runs binaries by absolute path without a shell. */
export type GpuLimitRunner = (file: string, args: readonly string[]) => Promise<string>

/** Raises the limit only from the macOS default and restores the default only when it still holds the value Harness set. */
export class GpuMemoryLimit {
  private raised = false

  /**
   * @param target - Limit in MiB from {@link gpuLimitTarget}.
   * @param user - Account named in the sudoers rule.
   * @param exec - Runs a binary and returns its standard output; rejects on a non-zero exit.
   */
  constructor(readonly target: number, private readonly user: string,
    private readonly exec: GpuLimitRunner = async (file, args) => (await run(file, [...args], { encoding: 'utf8' })).stdout) {}

  private async current(): Promise<number> {
    const value = Number.parseInt((await this.exec(SYSCTL, ['-n', KEY])).trim(), 10)
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Unexpected ${KEY} value`)
    return value
  }

  private async set(value: number): Promise<void> { await this.exec('/usr/bin/sudo', ['-n', SYSCTL, `${KEY}=${value}`]) }

  /** `sudo -l <command>` also succeeds for commands permitted only with a password, so the listing must contain this rule's entry. */
  private async authorized(): Promise<boolean> {
    let listing: string
    try { listing = await this.exec('/usr/bin/sudo', ['-n', '-l']) }
    catch (_error) { return false /* Without any NOPASSWD entry, listing needs a password and sudo -n exits non-zero. */ }
    const entry = gpuLimitRule(this.user, this.target).trim().slice(`${this.user} ALL=`.length)
    return listing.split('\n').some(line => line.trim() === entry)
  }

  /** Install the sudoers rule through one macOS administrator prompt when it is absent. @returns after the rule permits both commands. */
  async authorize(): Promise<void> {
    if (await this.authorized()) return
    const directory = await mkdtemp(join(tmpdir(), 'dsh-gpu-limit-'))
    try {
      const file = join(directory, 'rule')
      if (!/^[A-Za-z0-9_./-]+$/u.test(file)) throw new Error('Temporary rule path contains unsupported characters')
      await writeFile(file, gpuLimitRule(this.user, this.target), { mode: 0o600 })
      const script = `/usr/sbin/visudo -cf '${file}' && /usr/bin/install -m 0440 -o root -g wheel '${file}' '${GPU_LIMIT_RULE_FILE}'`
      await this.exec('/usr/bin/osascript', ['-e', `do shell script "${script}" with administrator privileges`])
    } finally { await rm(directory, { recursive: true, force: true }) }
    if (!await this.authorized()) throw new Error('The installed GPU limit rule does not permit the limit commands')
  }

  /** Raise the limit when macOS uses its default. @returns whether Harness now owns the raised limit. */
  async apply(): Promise<GpuLimitApplied> {
    if (this.raised) return 'raised'
    if (await this.current() !== 0) return 'unchanged'
    await this.set(this.target)
    this.raised = true
    return 'raised'
  }

  /**
   * Return to the macOS default when the limit is still the value this instance set.
   * @returns after the default is active or ownership was lost.
   */
  async restore(): Promise<void> {
    if (!this.raised) return
    this.raised = false
    if (await this.current() === this.target) await this.set(0)
  }
}
