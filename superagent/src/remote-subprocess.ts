import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessTerminalActivity, SubprocessTerminalForeground, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { CoreError } from './model.js'
import { BoundedOutput, type RemoteOutputWindow } from './remote-output.js'
import { remoteJobIdPrefix, validateRemoteJobId, type RemoteCommandSpec, type RemoteOperation } from './remote-protocol.js'

export type RemoteJobState = 'running' | 'stopping' | 'exited' | 'cancelled' | 'unknown'

export interface RemoteCommandTransport {
  readonly instanceId: string
  readonly environmentId: string
  readonly actorId: string
  readonly incarnation: string
  call(operation: RemoteOperation, args: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>>
  sanitize(text: string): string
}

export interface RemoteSpawnSpec {
  name: string
  mode?: 'foreground' | 'background'
}

export interface RemoteTerminalSpawnSpec {
  name: string
  rows: number
  cols: number
  terminalType?: string
}

interface RemoteSnapshot {
  jobId: string
  state: RemoteJobState
  settled: boolean
  exited: boolean
  pid: number
  exitCode: number | null
  signal: string | null
  cancelled: boolean
  stdoutFrom: number
  stderrFrom: number
  stdout: RemoteOutputWindow
  stderr: RemoteOutputWindow
}

const jobStates = new Set<RemoteJobState>(['running', 'stopping', 'exited', 'cancelled', 'unknown'])

class RemoteOutputCache {
  private output = new BoundedOutput()
  constructor(private readonly sanitize: (text: string) => string) {}

  apply(read: RemoteOutputWindow, from: number) {
    if (!Number.isInteger(read.nextOffset) || read.nextOffset < 0 || typeof read.text !== 'string' || typeof read.lossy !== 'boolean') {
      throw new CoreError('DEVICE_FAILED', 'The device returned an invalid output window.')
    }
    if (!Number.isInteger(from) || from < 0) throw new CoreError('DEVICE_FAILED', 'The device returned an invalid output origin.')
    if (read.nextOffset <= this.output.nextOffset) return
    if (from !== this.output.nextOffset) {
      this.output.reset(Buffer.from(read.text, 'utf8'), from, read.nextOffset, read.lossy)
      return
    }
    const bytes = Buffer.from(read.text, 'utf8')
    if (read.lossy) {
      this.output.reset(bytes, read.nextOffset - bytes.length, read.nextOffset, true)
      return
    }
    this.output.append(bytes)
  }

  get nextOffset() { return this.output.nextOffset }
  get truncated() { return this.output.truncated }

  readFrom(offset: number): SubprocessOutputRead {
    const read = this.output.read(offset)
    return { text: this.sanitize(read.text), nextOffset: read.nextOffset, lossy: read.lossy }
  }
}

function plainObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key))
}

function streamValue(value: unknown): RemoteOutputWindow {
  if (!plainObject(value, ['text', 'nextOffset', 'lossy']) || typeof value.text !== 'string'
    || !Number.isInteger(value.nextOffset) || typeof value.lossy !== 'boolean') {
    throw new CoreError('DEVICE_FAILED', 'The device returned an invalid output window.')
  }
  return value as unknown as RemoteOutputWindow
}

function snapshotValue(value: unknown): RemoteSnapshot {
  if (!plainObject(value, ['jobId', 'state', 'settled', 'exited', 'pid', 'exitCode', 'signal', 'cancelled', 'stdoutFrom', 'stderrFrom', 'stdout', 'stderr'])
    || typeof value.jobId !== 'string' || typeof value.state !== 'string' || !jobStates.has(value.state as RemoteJobState)
    || typeof value.settled !== 'boolean' || typeof value.exited !== 'boolean' || !Number.isInteger(value.pid)
    || typeof value.cancelled !== 'boolean' || !Number.isInteger(value.stdoutFrom) || !Number.isInteger(value.stderrFrom)
    || value.exitCode !== null && typeof value.exitCode !== 'number' || value.signal !== null && typeof value.signal !== 'string') {
    throw new CoreError('DEVICE_FAILED', 'The device returned an invalid job snapshot.')
  }
  return { jobId: value.jobId, state: value.state as RemoteJobState, settled: value.settled,
    exited: value.exited, pid: value.pid as number,
    exitCode: value.exitCode as number | null, signal: value.signal as string | null, cancelled: value.cancelled,
    stdoutFrom: value.stdoutFrom as number, stderrFrom: value.stderrFrom as number,
    stdout: streamValue(value.stdout), stderr: streamValue(value.stderr) }
}

function unavailable(error: unknown) {
  return error instanceof CoreError && error.code === 'DEVICE_UNAVAILABLE'
}

function jobUnknown(message = 'The job could not be observed by its original identity; do not start it again.') {
  return new CoreError('COMMAND_UNKNOWN', message)
}

/**
 * A Host-side proxy for one device job. The public handle is returned synchronously, while its
 * provider-side start is reconciled by the stable job ID if the start response is lost. Collected
 * readers are offset-based and non-consuming, so independent reads never drain the device output.
 */
export class RemoteJobHandle implements SubprocessHandle {
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly control = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  private readonly stdoutCache: RemoteOutputCache
  private readonly stderrCache: RemoteOutputCache
  private readonly deadlineAt: number
  private resolveDone!: (outcome: SubprocessOutcome) => void
  private rejectDone!: (error: unknown) => void
  private timer: ReturnType<typeof setTimeout> | undefined
  private finished = false
  private doneResolved = false
  private rootExited = false
  private settledValue = false
  private pidValue = 0
  private started = false
  private cancelRequested = false
  private cancelAcknowledged = false
  private cancelledState = false
  private stateValue: RemoteJobState = 'running'
  private delay = 100

  constructor(private readonly transport: RemoteCommandTransport, readonly jobId: string, private readonly name: string,
    private readonly mode: 'foreground' | 'background' | 'terminal', spec: RemoteCommandSpec,
    private readonly terminal?: { rows: number; cols: number; terminalType: string }) {
    this.stdoutCache = new RemoteOutputCache(transport.sanitize)
    this.stderrCache = new RemoteOutputCache(transport.sanitize)
    this.collected = {
      stdout: { readFrom: offset => this.stdoutCache.readFrom(offset) },
      stderr: { readFrom: offset => this.stderrCache.readFrom(offset) },
    }
    this.done = new Promise<SubprocessOutcome>((resolve, reject) => { this.resolveDone = resolve; this.rejectDone = reject })
    void this.done.catch(() => {})
    this.deadlineAt = Date.now() + (mode === 'foreground' ? spec.timeoutMs : spec.backgroundTimeoutMs ?? spec.timeoutMs)
  }

  get state(): RemoteJobState { return this.stateValue }
  get cancelled(): boolean { return this.cancelledState }
  get pid(): number { return this.pidValue }
  get exited(): boolean { return this.rootExited }
  get settled(): boolean { return this.settledValue }
  get truncated(): boolean { return this.stdoutCache.truncated || this.stderrCache.truncated }
  onOutput: ((text: string) => void) | undefined

  async begin() {
    if (this.finished) return
    try {
      const args = { jobId: this.jobId, name: this.name, mode: this.mode,
        ...(this.terminal ? { rows: String(this.terminal.rows), cols: String(this.terminal.cols),
          terminalType: this.terminal.terminalType } : {}) }
      this.apply(await this.call('command.start', args))
    } catch (error) {
      if (!unavailable(error)) throw error
      // The device may have started the job and lost only the response. Inspect the same ID
      // before deciding anything; never issue a second start for this identity.
      this.apply(await this.call('command.inspect', this.inspection()))
    }
    this.afterObserved()
  }

  start() {
    void this.begin().catch(error => this.fail(error))
  }

  async attach() {
    if (!validateRemoteJobId(this.jobId, this.prefix())) {
      throw new CoreError('JOB_IDENTITY_MISMATCH', 'The job ID does not belong to this Instance, Environment and device incarnation.')
    }
    this.apply(await this.call('command.inspect', this.inspection()))
    this.afterObserved('The device no longer knows this job; its result is unknown.')
  }

  terminate() {
    if (this.finished || this.cancelRequested) return
    this.cancelRequested = true
    if (this.started) void this.sendCancel()
  }

  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    const deadline = Math.max(Date.now() + 60000, this.deadlineAt + 60000)
    while (true) {
      if (this.finished) {
        if (this.settledValue && (this.stateValue === 'exited' || this.stateValue === 'cancelled')) return true
        throw jobUnknown()
      }
      try {
        if (this.cancelRequested && !this.cancelAcknowledged) await this.sendCancel(signal)
        this.apply(await this.call('command.inspect', this.inspection(), signal))
      } catch (error) {
        if (!unavailable(error)) throw error
      }
      if (this.finished) {
        if (this.settledValue && (this.stateValue === 'exited' || this.stateValue === 'cancelled')) return true
        throw jobUnknown()
      }
      if (signal?.aborted || Date.now() > deadline) return false
      try {
        await sleep(signal ? 50 : 250, signal)
      } catch { return false }
    }
  }

  async terminalWrite(data: string) {
    await this.call('terminal.write', { jobId: this.jobId, data })
  }

  async terminalResize(cols: number, rows: number) {
    await this.call('terminal.resize', { jobId: this.jobId, cols: String(cols), rows: String(rows) })
  }


  private prefix() {
    return remoteJobIdPrefix(this.transport.instanceId, this.transport.environmentId, this.transport.incarnation)
  }

  private inspection(): Record<string, string> {
    const result = { jobId: this.jobId, stdoutOffset: String(this.stdoutCache.nextOffset), stderrOffset: String(this.stderrCache.nextOffset) }
    return result
  }

  private call(operation: RemoteOperation, args: Record<string, string>, signal?: AbortSignal) {
    return this.transport.call(operation, args, signal)
  }

  private afterObserved(unknownMessage?: string) {
    if (this.stateValue === 'unknown') throw jobUnknown(unknownMessage)
    this.started = true
    if (this.cancelRequested && !this.finished) void this.sendCancel()
    if (!this.finished) this.schedule()
  }

  private async sendCancel(signal?: AbortSignal) {
    try {
      const snapshot = snapshotValue(await this.call('command.cancel', { jobId: this.jobId }, signal))
      if (snapshot.state === 'stopping' || snapshot.state === 'cancelled') this.cancelAcknowledged = true
      this.applySnapshot(snapshot)
    } catch {
      // The stop intent stays in memory and is retried by polling until the device confirms it.
    }
  }

  private apply(raw: Record<string, unknown>) {
    if (this.finished) return
    this.applySnapshot(snapshotValue(raw))
  }

  private applySnapshot(snapshot: RemoteSnapshot) {
    if (this.finished) return
    if (snapshot.jobId !== this.jobId) throw new CoreError('JOB_IDENTITY_MISMATCH', 'The device answered for a different job.')
    const before = this.stdoutCache.nextOffset
    this.stdoutCache.apply(snapshot.stdout, snapshot.stdoutFrom)
    if (snapshot.stdoutFrom === before && this.onOutput && this.stdoutCache.nextOffset > before) {
      this.onOutput(this.transport.sanitize(snapshot.stdout.text))
    }
    this.stderrCache.apply(snapshot.stderr, snapshot.stderrFrom)
    this.stateValue = snapshot.state
    this.cancelledState = this.cancelledState || snapshot.cancelled
    this.rootExited = snapshot.exited
    this.settledValue = snapshot.settled
    this.pidValue = snapshot.pid
    if (snapshot.state === 'stopping' || snapshot.state === 'cancelled' || snapshot.cancelled) this.cancelAcknowledged = true
    if (snapshot.state === 'unknown') {
      this.finished = true
      this.clearTimer()
      if (!this.doneResolved) this.rejectDone(jobUnknown())
      return
    }
    if (snapshot.exited && !this.doneResolved) {
      this.doneResolved = true
      this.resolveDone({ exitCode: snapshot.exitCode, signal: snapshot.signal as NodeJS.Signals | null })
    }
    if (!snapshot.settled) {
      this.delay = 100
      return
    }
    this.finished = true
    this.clearTimer()
    if (!this.doneResolved) {
      this.doneResolved = true
      this.resolveDone({ exitCode: snapshot.exitCode, signal: snapshot.signal as NodeJS.Signals | null })
    }
  }

  private fail(error: unknown) {
    if (this.finished) return
    this.finished = true
    this.stateValue = 'unknown'
    this.clearTimer()
    if (!this.doneResolved) this.rejectDone(error)
  }

  private schedule() {
    this.clearTimer()
    this.timer = setTimeout(() => { void this.poll() }, this.delay)
    this.timer.unref()
  }

  private async poll() {
    if (this.finished) return
    try {
      if (this.cancelRequested && !this.cancelAcknowledged) await this.sendCancel()
      this.apply(await this.call('command.inspect', this.inspection()))
    } catch (error) {
      if (!unavailable(error)) { this.fail(error); return }
      if (Date.now() > this.deadlineAt + 60000) { this.fail(jobUnknown()); return }
      this.delay = Math.min(this.delay * 2, 1000)
    }
    if (!this.finished) this.schedule()
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

export class RemoteSubprocess {
  constructor(private readonly transport: RemoteCommandTransport,
    private readonly commands: Readonly<Record<string, RemoteCommandSpec>>) {}

  private prefix() {
    return remoteJobIdPrefix(this.transport.instanceId, this.transport.environmentId, this.transport.incarnation)
  }

  async resolveExecutable(name: string, signal?: AbortSignal): Promise<string> {
    if (!Object.hasOwn(this.commands, name)) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured device commands can be resolved.')
    const answer = await this.transport.call('command.resolve', { name }, signal)
    if (!plainObject(answer, ['name', 'path']) || answer.name !== name || typeof answer.path !== 'string' || !answer.path) {
      throw new CoreError('DEVICE_FAILED', 'The device returned an invalid executable identity.')
    }
    return answer.path
  }

  spawn(input: RemoteSpawnSpec): RemoteJobHandle {
    const name = input.name
    const mode = input.mode ?? 'background'
    const spec = Object.hasOwn(this.commands, name) ? this.commands[name] : undefined
    if (!spec) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured device command names can run.')
    const jobId = `${this.prefix()}${randomUUID()}`
    if (!validateRemoteJobId(jobId, this.prefix())) throw new CoreError('INVALID_INPUT', 'The generated remote job ID exceeds its identity budget.')
    const handle = new RemoteJobHandle(this.transport, jobId, name, mode, spec)
    handle.start()
    return handle
  }

  async attach(jobId: string): Promise<RemoteJobHandle> {
    if (!validateRemoteJobId(jobId, this.prefix())) {
      throw new CoreError('JOB_IDENTITY_MISMATCH', 'The job ID does not belong to this Instance, Environment and device incarnation.')
    }
    const handle = new RemoteJobHandle(this.transport, jobId, '', 'background', { timeoutMs: 3_600_000 })
    await handle.attach()
    return handle
  }

  async spawnTerminal(input: RemoteTerminalSpawnSpec): Promise<RemoteTerminalHandle> {
    const spec = Object.hasOwn(this.commands, input.name) ? this.commands[input.name] : undefined
    if (!spec?.pty) throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device command is not configured for a terminal.')
    if (!Number.isInteger(input.rows) || !Number.isInteger(input.cols) || input.rows < 1 || input.cols < 1
      || input.rows > 500 || input.cols > 500) throw new CoreError('INVALID_INPUT', 'Terminal dimensions must be between 1 and 500.')
    const terminalType = input.terminalType ?? 'xterm-256color'
    if (!terminalType.trim() || Buffer.byteLength(terminalType) > 64 || /\s/u.test(terminalType) || terminalType.includes('\0')) {
      throw new CoreError('INVALID_INPUT', 'The terminal type is malformed.')
    }
    const jobId = `${this.prefix()}${randomUUID()}`
    if (!validateRemoteJobId(jobId, this.prefix())) throw new CoreError('INVALID_INPUT', 'The generated remote job ID exceeds its identity budget.')
    const handle = new RemoteJobHandle(this.transport, jobId, input.name, 'terminal', spec,
      { rows: input.rows, cols: input.cols, terminalType })
    await handle.begin()
    return new RemoteTerminalHandle(handle)
  }
}

export class RemoteTerminalHandle implements SubprocessTerminalHandle {
  readonly pid: number
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>
  constructor(private readonly job: RemoteJobHandle) {
    this.pid = job.pid
    this.done = job.done
    const initial = job.collected.stdout!.readFrom(0)
    if (initial.text) this.output.write(initial.text)
    job.onOutput = text => this.output.write(text)
    void this.done.finally(() => this.output.end()).catch(() => {})
  }

  get jobId() { return this.job.jobId }

  async write(data: string): Promise<void> {
    if (typeof data !== 'string' || Buffer.byteLength(data) > 65536) throw new CoreError('INVALID_INPUT', 'Terminal writes are limited to 65536 bytes.')
    await this.job.terminalWrite(data)
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 500 || rows > 500) {
      throw new CoreError('INVALID_INPUT', 'Terminal dimensions must be between 1 and 500.')
    }
    await this.job.terminalResize(cols, rows)
  }

  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    return undefined
  }

  async inspectActivity(): Promise<SubprocessTerminalActivity> {
    return { state: 'unknown', revision: 0 }
  }

  async signalForeground(): Promise<number> {
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'Foreground process-group signalling is not verified on this device.')
  }

  async terminate(): Promise<void> {
    this.job.terminate()
    const settled = await this.job.waitForExit(AbortSignal.timeout(5000)).catch(() => false)
    if (!settled) throw new CoreError('COMMAND_UNKNOWN', 'The terminal session did not confirm quiescence.')
    this.output.end()
  }
}

function sleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(resolve, milliseconds)
    const stop = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', stop, { once: true })
  }).finally(() => {})
}
