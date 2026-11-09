import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess'
import { randomUUID } from 'node:crypto'
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

interface RemoteSnapshot {
  jobId: string
  state: RemoteJobState
  settled: boolean
  exitCode: number | null
  signal: string | null
  cancelled: boolean
  stdout: RemoteOutputWindow
  stderr: RemoteOutputWindow
}

const jobStates = new Set<RemoteJobState>(['running', 'stopping', 'exited', 'cancelled', 'unknown'])

class RemoteOutputCache {
  private output = new BoundedOutput()
  constructor(private readonly sanitize: (text: string) => string) {}

  apply(read: RemoteOutputWindow) {
    if (!Number.isInteger(read.nextOffset) || read.nextOffset < 0 || typeof read.text !== 'string' || typeof read.lossy !== 'boolean') {
      throw new CoreError('DEVICE_FAILED', 'The device returned an invalid output window.')
    }
    if (read.nextOffset <= this.output.nextOffset) return
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
  if (!plainObject(value, ['jobId', 'state', 'settled', 'exitCode', 'signal', 'cancelled', 'stdout', 'stderr'])
    || typeof value.jobId !== 'string' || typeof value.state !== 'string' || !jobStates.has(value.state as RemoteJobState)
    || typeof value.settled !== 'boolean' || typeof value.cancelled !== 'boolean'
    || value.exitCode !== null && typeof value.exitCode !== 'number' || value.signal !== null && typeof value.signal !== 'string') {
    throw new CoreError('DEVICE_FAILED', 'The device returned an invalid job snapshot.')
  }
  return { jobId: value.jobId, state: value.state as RemoteJobState, settled: value.settled,
    exitCode: value.exitCode as number | null, signal: value.signal as string | null, cancelled: value.cancelled,
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
  private started = false
  private cancelRequested = false
  private cancelAcknowledged = false
  private cancelledState = false
  private stateValue: RemoteJobState = 'running'
  private delay = 100

  constructor(private readonly transport: RemoteCommandTransport, readonly jobId: string, private readonly name: string,
    private readonly mode: 'foreground' | 'background', spec: RemoteCommandSpec) {
    this.stdoutCache = new RemoteOutputCache(transport.sanitize)
    this.stderrCache = new RemoteOutputCache(transport.sanitize)
    this.collected = {
      stdout: { readFrom: offset => this.stdoutCache.readFrom(offset) },
      stderr: { readFrom: offset => this.stderrCache.readFrom(offset) },
    }
    this.done = new Promise<SubprocessOutcome>((resolve, reject) => { this.resolveDone = resolve; this.rejectDone = reject })
    void this.done.catch(() => {})
    this.deadlineAt = Date.now() + (mode === 'background' ? spec.backgroundTimeoutMs ?? spec.timeoutMs : spec.timeoutMs)
  }

  get state(): RemoteJobState { return this.stateValue }
  get cancelled(): boolean { return this.cancelledState }
  get truncated(): boolean { return this.stdoutCache.truncated || this.stderrCache.truncated }

  async begin() {
    if (this.finished) return
    try {
      this.apply(await this.call('command.start', { jobId: this.jobId, name: this.name, mode: this.mode }))
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
        if (this.stateValue === 'exited' || this.stateValue === 'cancelled') return true
        throw jobUnknown()
      }
      try {
        if (this.cancelRequested && !this.cancelAcknowledged) await this.sendCancel()
        this.apply(await this.call('command.inspect', this.inspection()))
      } catch (error) {
        if (!unavailable(error)) throw error
      }
      if (this.finished) {
        if (this.stateValue === 'exited' || this.stateValue === 'cancelled') return true
        throw jobUnknown()
      }
      if (signal?.aborted || Date.now() > deadline) return false
      try {
        await sleep(signal ? 50 : 250, signal)
      } catch { return false }
    }
  }

  private prefix() {
    return remoteJobIdPrefix(this.transport.instanceId, this.transport.environmentId, this.transport.incarnation)
  }

  private inspection(): Record<string, string> {
    return { jobId: this.jobId, stdoutOffset: String(this.stdoutCache.nextOffset), stderrOffset: String(this.stderrCache.nextOffset) }
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

  private async sendCancel() {
    try {
      const snapshot = snapshotValue(await this.call('command.cancel', { jobId: this.jobId }))
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
    this.stdoutCache.apply(snapshot.stdout)
    this.stderrCache.apply(snapshot.stderr)
    this.stateValue = snapshot.state
    this.cancelledState = this.cancelledState || snapshot.cancelled
    if (snapshot.state === 'stopping' || snapshot.state === 'cancelled' || snapshot.cancelled) this.cancelAcknowledged = true
    if (!snapshot.settled) {
      this.delay = 100
      return
    }
    this.finished = true
    this.clearTimer()
    if (snapshot.state === 'unknown') {
      this.rejectDone(jobUnknown())
      return
    }
    this.resolveDone({ exitCode: snapshot.exitCode, signal: snapshot.signal as NodeJS.Signals | null })
  }

  private fail(error: unknown) {
    if (this.finished) return
    this.finished = true
    this.stateValue = 'unknown'
    this.clearTimer()
    this.rejectDone(error)
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
}

function sleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(resolve, milliseconds)
    const stop = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', stop, { once: true })
  }).finally(() => {})
}
