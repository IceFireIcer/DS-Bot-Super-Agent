import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { CoreError } from './model.js'
import type { WatchdogHost, WatchdogProbe } from './watchdog.js'

export interface ProcessWatchdogStatus extends WatchdogProbe {
  pid: number
  at: number
}

export interface ProcessWatchdogHostOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** The Host writes this file atomically; it must include `pid`, `at` and the probe fields. */
  statusPath: string
  startTimeoutMs?: number
  /** A status older than this is a service failure, not a healthy Host. */
  staleMs?: number
  now?: () => number
}

const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

const readStatus = (path: string): ProcessWatchdogStatus | undefined => {
  try {
    const status = JSON.parse(readFileSync(path, 'utf8')) as ProcessWatchdogStatus
    return Number.isInteger(status?.pid) && Number.isFinite(status?.at) && typeof status?.service === 'string' ? status : undefined
  } catch { return undefined }
}

/**
 * A Host process started by the Watchdog. The child owns the status file and listens for one IPC
 * `shutdown` message; the Watchdog never force-kills it. A Host it did not start cannot be stopped
 * through this adapter: `stop` reports a timeout instead of pretending.
 */
export class ProcessWatchdogHost implements WatchdogHost {
  private readonly options: ProcessWatchdogHostOptions
  private readonly startTimeoutMs: number
  private readonly staleMs: number
  private readonly now: () => number
  private child: ChildProcess | undefined
  private stderr = ''

  constructor(options: ProcessWatchdogHostOptions) {
    if (options.command.trim() === '') throw new CoreError('INVALID_CONFIG', 'A Watchdog Host command is required.')
    if (options.statusPath.trim() === '') throw new CoreError('INVALID_CONFIG', 'A Watchdog Host status path is required.')
    this.options = options
    this.startTimeoutMs = options.startTimeoutMs ?? 120_000
    this.staleMs = options.staleMs ?? 120_000
    this.now = options.now ?? Date.now
    if (!Number.isInteger(this.startTimeoutMs) || this.startTimeoutMs < 10 || this.startTimeoutMs > 300_000) throw new CoreError('INVALID_CONFIG', 'The Host start deadline must be 10–300000 ms.')
    if (!Number.isInteger(this.staleMs) || this.staleMs < 10 || this.staleMs > 3_600_000) throw new CoreError('INVALID_CONFIG', 'The Host status staleness must be 10–3600000 ms.')
  }

  pid(): number | undefined { return this.child?.pid }
  isRunning(): boolean { return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null }

  async start({ signal }: { signal: AbortSignal }): Promise<void> {
    if (this.isRunning()) return
    const child = spawn(this.options.command, this.options.args ?? [], {
      ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
      ...(this.options.env === undefined ? {} : { env: this.options.env }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    })
    this.child = child
    this.stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-4096) })
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once('exit', (code, signalName) => { resolve({ code, signal: signalName }) })
    })
    const ready = new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        const status = readStatus(this.options.statusPath)
        if (status !== undefined && status.pid === child.pid) {
          clearInterval(poll)
          resolve()
        }
      }, 100)
      const timer = setTimeout(() => {
        clearInterval(poll)
        reject(new CoreError('WATCHDOG_START_FAILED', `The Host did not report within ${String(this.startTimeoutMs)} ms${this.stderr === '' ? '' : `: ${this.stderr.trim()}`}`))
      }, this.startTimeoutMs)
      const abort = () => {
        clearInterval(poll)
        clearTimeout(timer)
        reject(new CoreError('WATCHDOG_STOPPED', 'The Host start was called off.'))
      }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      child.once('error', (error) => {
        clearInterval(poll)
        clearTimeout(timer)
        reject(new CoreError('WATCHDOG_START_FAILED', `The Host could not start: ${error.message}`))
      })
      void exited.then(outcome => {
        clearInterval(poll)
        clearTimeout(timer)
        reject(new CoreError('WATCHDOG_START_FAILED', `The Host exited before it reported (${String(outcome.code ?? outcome.signal)})${this.stderr === '' ? '' : `: ${this.stderr.trim()}`}`))
      })
    })
    await ready
  }

  async probe({ signal }: { signal: AbortSignal }): Promise<WatchdogProbe> {
    if (signal.aborted) throw new CoreError('WATCHDOG_STOPPED', 'The probe was called off.')
    const status = readStatus(this.options.statusPath)
    if (status === undefined) return { service: 'failed', sources: [], setups: [], normalWaits: 0, detail: 'The Host has not written its status.' }
    if (!alive(status.pid)) return { service: 'failed', sources: [], setups: [], normalWaits: 0, detail: 'The Host process is gone.' }
    if (this.now() - status.at > this.staleMs) return { service: 'failed', sources: [], setups: [], normalWaits: 0, detail: 'The Host status is stale.' }
    return {
      service: status.service, sources: status.sources, setups: status.setups, normalWaits: status.normalWaits,
      ...(status.components === undefined ? {} : { components: status.components }),
      ...(status.hostId === undefined ? {} : { hostId: status.hostId }), ...(status.epoch === undefined ? {} : { epoch: status.epoch }),
      ...(status.takeoverPending === undefined ? {} : { takeoverPending: status.takeoverPending }),
      ...(status.paused === undefined ? {} : { paused: status.paused }),
      ...(status.unknownEffects === undefined ? {} : { unknownEffects: status.unknownEffects }),
      ...(status.detail === undefined ? {} : { detail: status.detail }),
    }
  }

  async stop({ graceMs, signal }: { graceMs: number; signal: AbortSignal }): Promise<'stopped' | 'timeout'> {
    const child = this.child
    if (child === undefined) {
      // A live process the Watchdog did not start cannot be asked gracefully. Report a timeout
      // instead of starting a second Router on the same data.
      const status = readStatus(this.options.statusPath)
      return status !== undefined && alive(status.pid) ? 'timeout' : 'stopped'
    }
    if (child.exitCode !== null || child.signalCode !== null) return 'stopped'
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    if (child.exitCode !== null || child.signalCode !== null) return 'stopped'
    // Only the child this Watchdog started has the IPC channel. Do not signal a process we cannot
    // ask gracefully: a timeout leaves it running, so no second Router is created by a kill.
    if (child.connected) {
      try { child.send({ type: 'shutdown' }) } catch { /* wait for an exit that may already be under way */ }
    }
    const timeout = sleep(graceMs).then(() => 'timeout' as const)
    const outcome = await Promise.race([exited.then(() => 'stopped' as const), timeout])
    if (signal.aborted) return 'timeout'
    if (outcome === 'stopped') this.child = undefined
    return outcome
  }

  /** Test and rehearsal cleanup only: the recovery path never force-kills the Host. */
  async dispose(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.kill('SIGKILL')
    await Promise.race([exited, sleep(5000)])
  }
}
