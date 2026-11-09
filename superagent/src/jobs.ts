import { randomUUID } from 'node:crypto'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { Artifact, LocalJob, LocalJobResult } from './local-environment.js'
import { BackgroundWork } from './background.js'
import { Previews, type PreviewRecord } from './previews.js'

export type JobState = 'running' | 'cancelling' | 'exited' | 'cancelled' | 'unknown'
export type JobCancelReason = 'human' | 'worker' | 'deadline' | 'stop' | 'assignment-ended'

export interface JobStream { text: string; lossy: boolean }
export interface JobOutput { stdout: JobStream; stderr: JobStream }

/** One durable background job owned by the Assignment that started it. */
export interface JobRecord {
  id: string
  ticketId: string
  assignmentId: string
  generation: string
  environmentId: string
  command: string
  state: JobState
  startedAt: number
  runtimeToken: string
  finishedAt?: number
  exitCode?: number | null
  cancelled?: boolean
  truncated?: boolean
  cancelReason?: JobCancelReason
  reason?: string
  output?: JobOutput
}

export interface JobStart {
  ticketId: string
  assignmentId: string
  generation: string
  environmentId: string
  command: string
  job: LocalJob
}

export interface JobsOptions {
  /** Background jobs allowed per Ticket at once. Defaults to 4. */
  maxPerTicket?: number
  /** How long background work may keep its Assignment after a turn. Defaults to 30 minutes. */
  waitMs?: number
}

/** The owner of the durable facts is told about completion and deadline, never the running process itself. */
export interface JobHandlers {
  settled(record: JobRecord): void
  deadline(record: JobRecord): void
}

export interface JobView {
  id: string
  ticketId: string
  assignmentId: string
  command: string
  state: JobState
  settled: boolean
  succeeded: boolean
  startedAt: number
  finishedAt?: number
  exitCode?: number | null
  cancelled?: boolean
  truncated?: boolean
  cancelReason?: JobCancelReason
  reason?: string
  output: JobOutput
}

const jobPrefix = (ticketId: string) => JSON.stringify(['job', ticketId])
const jobKey = (ticketId: string, jobId: string) => `${jobPrefix(ticketId)}:${jobId}`
const emptyStream: JobStream = { text: '', lossy: false }
const settledStates: JobState[] = ['exited', 'cancelled']

/**
 * Durable background work. A job record spans start, bounded output/exit queries and settlement, and belongs to
 * the Assignment generation that launched it, so a late completion can be told apart from a newer Assignment's work.
 */
export class Jobs {
  readonly maxPerTicket: number
  readonly waitMs: number
  /** Jobs a single Ticket may report at once; older records stay in the store as evidence. */
  readonly maxRecords = 100
  private readonly handles = new Map<string, { job: LocalJob; record: JobRecord }>()
  private readonly pending = new Map<string, { job: LocalJob; record: JobRecord }>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly claims = new Set<string>()
  private readonly index: BackgroundWork
  readonly previews: Previews
  private handlers: JobHandlers | undefined
  constructor(private readonly storage: Storage, private readonly instanceId: string, readonly runtimeToken: string,
    options: JobsOptions = {}, private readonly now: () => number = Date.now) {
    this.maxPerTicket = options.maxPerTicket ?? 4
    this.waitMs = options.waitMs ?? 1800000
    if (!Number.isInteger(this.maxPerTicket) || this.maxPerTicket < 1 || this.maxPerTicket > 16) throw new CoreError('INVALID_CONFIG', 'Invalid background job budget.')
    if (!Number.isInteger(this.waitMs) || this.waitMs < 100 || this.waitMs > 3600000) throw new CoreError('INVALID_CONFIG', 'Invalid background job wait budget.')
    this.previews = new Previews(runtimeToken, now, jobId => this.hasHandle(jobId), { maxPerTicket: this.maxPerTicket })
    this.index = new BackgroundWork('job', async (tx, request) => {
      const record = await tx.get<JobRecord>('job', jobKey(request.ticketId, request.id))
      if (record === undefined) return undefined
      if (await this.previews.isPreview(tx, request.ticketId, request.id)) return false
      return isActive(record.state)
    })
  }

  setHandlers(handlers: JobHandlers) { this.handlers = handlers }

  /** The budget is checked inside the starting transaction, so two overlapping starts cannot both be admitted. */
  async assertCapacity(tx: AsyncTx, ticketId: string) {
    await this.migrateLegacyIndex(tx, ticketId)
    const active = await this.activeJobs(tx, ticketId)
    if (active.length >= this.maxPerTicket) throw new CoreError('JOB_BUDGET', 'This Ticket already runs its declared number of background jobs.')
  }

  /** Previews are not execution work: they are excluded from admission, slot holding and cleanup by ownership. */
  private async activeJobs(tx: AsyncTx, ticketId: string) {
    const active = await this.index.active(tx, ticketId)
    const entries: { id: string; assignmentId: string }[] = []
    for (const entry of active) {
      if (!await this.previews.isPreview(tx, ticketId, entry.id)) entries.push(entry)
      else await this.index.remove(tx, ticketId, entry.id)
    }
    return entries
  }

  /** Records the start fact. The process is only watched once this transaction commits; see `attach`. */
  async start(tx: AsyncTx, request: JobStart): Promise<JobRecord> {
    identifier(request.ticketId, 'ticketId'); identifier(request.assignmentId, 'assignmentId'); identifier(request.environmentId, 'environmentId')
    await this.assertCapacity(tx, request.ticketId)
    const record: JobRecord = { id: request.job.jobId ?? randomUUID(), ticketId: request.ticketId, assignmentId: request.assignmentId, generation: request.generation,
      environmentId: request.environmentId, command: request.command, state: 'running', startedAt: this.now(), runtimeToken: this.runtimeToken }
    await tx.insert('job', jobKey(record.ticketId, record.id), record)
    await this.index.add(tx, record.ticketId, { id: record.id, assignmentId: record.assignmentId })
    this.pending.set(record.id, { job: request.job, record })
    return record
  }

  /**
   * Starts watching a job whose record committed. Watching only after commit means a rolled-back start leaves no
   * handle or timer behind, and nothing in memory claims a job the store does not know.
   */
  attach(record: JobRecord) {
    const pending = this.pending.get(record.id)
    if (!pending) return
    this.pending.delete(record.id)
    const { job } = pending
    this.handles.set(record.id, { job, record })
    const timer = setTimeout(() => { void this.expire(record.id) }, this.waitMs)
    timer.unref()
    this.timers.set(record.id, timer)
    // Settlement is written once, by whichever path observes it; a stale runtime never writes a newer fact.
    void job.done.then(result => this.settle(record.id, result), () => this.settle(record.id, { exitCode: null, cancelled: false, truncated: false, settled: false }))
  }

  /** A start whose record did not commit: the process range is ended and nothing comes to life in memory. */
  abandon(job: LocalJob) {
    for (const [jobId, pending] of this.pending) if (pending.job === job) this.pending.delete(jobId)
    job.terminate()
  }

  async get(tx: AsyncTx, ticketId: string, jobId: string): Promise<JobRecord | undefined> {
    const record = await tx.get<JobRecord>('job', jobKey(ticketId, jobId))
    return record && this.reconcile(tx, record)
  }

  /**
   * Reads the retained output tail without consuming it. A live job reads the provider's own bounded window, so
   * repeated queries return the same text instead of draining it from the process.
   */
  read(ticketId: string, jobId: string): Promise<JobView> {
    return this.storage.transaction(this.instanceId, async tx => {
      const record = await this.get(tx, ticketId, jobId)
      if (!record) throw new CoreError('NOT_FOUND', 'The background job does not belong to this Ticket.')
      const handle = this.handles.get(record.id)
      if (!handle || record.state === 'exited' || record.state === 'cancelled' || record.state === 'unknown') return this.viewOf(record)
      const read = handle.job.read()
      return { ...this.facts(record), output: { stdout: read.stdout, stderr: read.stderr } }
    })
  }

  listViews(ticketId: string) {
    return this.storage.transaction(this.instanceId, async tx => (await this.listIn(tx, ticketId)).map(record => this.viewOf(record)))
  }

  async hasActive(tx: AsyncTx, request: { ticketId: string; assignmentId?: string }) {
    await this.migrateLegacyIndex(tx, request.ticketId)
    return (await this.activeJobs(tx, request.ticketId))
      .some(entry => request.assignmentId === undefined || entry.assignmentId === request.assignmentId)
  }

  /**
   * Records the cancellation decision without claiming the range is gone. The job reads `cancelling` until
   * quiescence is confirmed; only `confirmCancelled` writes the terminal `cancelled` fact.
   */
  async requestCancel(tx: AsyncTx, request: { ticketId: string; jobId: string; reason: JobCancelReason }) {
    const record = await this.get(tx, request.ticketId, request.jobId)
    if (!record) throw new CoreError('NOT_FOUND', 'The background job does not belong to this Ticket.')
    if (!isActive(record.state)) return record
    const cancelling: JobRecord = { ...record, state: 'cancelling', cancelReason: request.reason }
    await tx.replace('job', jobKey(record.ticketId, record.id), cancelling)
    return cancelling
  }

  /** Records `cancelled` only after the managed range was observed empty; without that evidence it stays pending. */
  async confirmCancelled(tx: AsyncTx, request: { ticketId: string; jobId: string; output?: JobOutput }) {
    const record = await tx.get<JobRecord>('job', jobKey(request.ticketId, request.jobId))
    if (!record || record.state !== 'cancelling') return record
    const output = request.output ?? record.output
    const cancelled: JobRecord = { ...record, state: 'cancelled', cancelled: true, finishedAt: this.now(), ...(output ? { output } : {}),
      ...(record.cancelReason === 'deadline' ? { reason: 'The declared background wait expired; the process range was confirmed stopped and no result was accepted.' } : {}) }
    await tx.replace('job', jobKey(request.ticketId, request.jobId), cancelled)
    await this.index.remove(tx, request.ticketId, request.jobId)
    return cancelled
  }

  /**
   * A cancel whose range this Host could not observe becomes `unknown`: it is neither reported as stopped nor
   * left holding a slot, matching how an unprovable local execution is represented everywhere else.
   */
  async markUnconfirmed(tx: AsyncTx, request: { ticketId: string; jobId: string }) {
    const record = await tx.get<JobRecord>('job', jobKey(request.ticketId, request.jobId))
    if (!record || record.state !== 'cancelling') return record
    const pending: JobRecord = { ...record, state: 'unknown', finishedAt: this.now(),
      reason: 'The cancellation was requested, but this Host could not confirm the process range stopped.' }
    await tx.replace('job', jobKey(request.ticketId, request.jobId), pending)
    await this.index.remove(tx, request.ticketId, request.jobId)
    return pending
  }

  async requestCancelTicket(tx: AsyncTx, request: { ticketId: string; reason: JobCancelReason }) {
    const active = await this.activeJobs(tx, request.ticketId)
    for (const job of active) await this.requestCancel(tx, { ticketId: request.ticketId, jobId: job.id, reason: request.reason })
    return active.map(job => job.id)
  }

  /** An Assignment that ended owns no more background work, so its jobs stop with it and cannot wake a successor. */
  async requestCancelAssignment(tx: AsyncTx, request: { ticketId: string; assignmentId: string; reason: JobCancelReason }) {
    const active = (await this.activeJobs(tx, request.ticketId))
      .filter(job => job.assignmentId === request.assignmentId)
    for (const job of active) await this.requestCancel(tx, { ticketId: request.ticketId, jobId: job.id, reason: request.reason })
    return active.map(job => job.id)
  }

  /** Retains one managed job as an explicit preview and removes it from the execution-work index. */
  async retainAsPreview(tx: AsyncTx, request: { ticketId: string; jobId: string; assignmentId: string; generation: string; purpose: string; artifact: Artifact }): Promise<PreviewRecord> {
    const record = await this.get(tx, request.ticketId, request.jobId)
    if (!record || record.state !== 'running' || record.runtimeToken !== this.runtimeToken
      || record.assignmentId !== request.assignmentId || record.generation !== request.generation) {
      throw new CoreError('NOT_FOUND', 'A preview needs a live managed job of this Assignment.')
    }
    const preview = await this.previews.start(tx, { job: record, purpose: request.purpose, artifact: request.artifact })
    await this.index.remove(tx, request.ticketId, request.jobId)
    return preview
  }

  /** Applies the preview's wait exemption only after its durable record committed. */
  async clearPreviewWait(ticketId: string, jobId: string) {
    if (!await this.storage.transaction(this.instanceId, transaction => this.previews.isPreview(transaction, ticketId, jobId))) return
    this.clearTimer(jobId)
  }

  private clearTimer(jobId: string) {
    const timer = this.timers.get(jobId)
    if (timer) clearTimeout(timer)
    this.timers.delete(jobId)
  }

  private hasHandle(jobId: string) {
    return this.handles.has(jobId) || this.pending.has(jobId) || this.claims.has(jobId)
  }

  /** The preview index also keeps a job out of the active index if it was retained before the first read. */
  async isPreview(tx: AsyncTx, ticketId: string, jobId: string) {
    return this.previews.isPreview(tx, ticketId, jobId)
  }

  /**
   * Terminates the named ranges and returns only the ids whose managed range was observed empty, with the
   * output tail read before the handle is dropped. An id this runtime never held has no evidence, so it is
   * never reported as stopped.
   */
  async stopRanges(jobIds: string[]): Promise<{ jobId: string; output?: JobOutput }[]> {
    const ranges = jobIds.flatMap(jobId => {
      const handle = this.handles.get(jobId)
      return handle ? [{ jobId, job: handle.job }] : []
    })
    // The ids stay claimed while the ranges settle, so a concurrent read cannot mistake a job that is being
    // stopped for one this process no longer holds.
    for (const { jobId } of ranges) this.claim(jobId)
    const outcomes = await Promise.all(ranges.map(async ({ jobId, job }) => {
      job.terminate()
      const quiescent = await job.waitForExit(AbortSignal.timeout(2000)).catch(() => false)
      const output = quiescent ? { stdout: readWindow(job, 'stdout'), stderr: readWindow(job, 'stderr') } : undefined
      return quiescent ? { jobId, ...(output ? { output } : {}) } : undefined
    }))
    for (const { jobId } of ranges) this.release(jobId, true)
    return outcomes.filter(outcome => outcome !== undefined)
  }

  /** Releases the stop claims once the terminal fact is committed; see `stopRanges`. */
  finishStopped(jobIds: string[]) {
    for (const jobId of jobIds) this.claims.delete(jobId)
  }

  /** Terminates every managed range without writing business facts; used when this runtime shuts down. */
  shutdown() {
    this.closing = true
    for (const { job } of this.handles.values()) job.terminate()
    for (const { job } of this.pending.values()) job.terminate()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.handles.clear()
    this.pending.clear()
    this.timers.clear()
    this.claims.clear()
  }

  /** Waits for preview ranges to become quiet without inventing a durable exit fact during shutdown. */
  async shutdownPreviews(jobIds: string[]) {
    this.closing = true
    await Promise.all(jobIds.map(async jobId => {
      const handle = this.handles.get(jobId)?.job
      handle?.terminate()
      if (handle) await handle.waitForExit(AbortSignal.timeout(10000)).catch(() => false)
      this.release(jobId)
    }))
  }

  private closing = false

  private release(jobId: string, keepClaim = false) {
    const handle = this.handles.get(jobId)
    this.handles.delete(jobId)
    if (!keepClaim) this.claims.delete(jobId)
    handle?.job.terminate()
    const timer = this.timers.get(jobId)
    if (timer) clearTimeout(timer)
    this.timers.delete(jobId)
  }

  /** Marks a range as still owned while it is being stopped, so a read does not mistake it for abandoned. */
  private claim(jobId: string) { this.claims.add(jobId) }

  /**
   * Imports the pre-T13 `job-active` index into the shared background index. A database written by the previous
   * release must not lose track of jobs that are still running, so the migration runs before any admission or read.
   */
  private async migrateLegacyIndex(tx: AsyncTx, ticketId: string) {
    const legacyKey = JSON.stringify(['job-active', ticketId])
    const legacy = await tx.get<{ ticketId: string; jobs: { id: string; assignmentId: string }[] }>('job-active', legacyKey)
    if (!legacy) return
    for (const entry of legacy.jobs ?? []) {
      const record = await tx.get<JobRecord>('job', jobKey(ticketId, entry.id))
      if (record && isActive(record.state)) await this.index.add(tx, ticketId, { id: entry.id, assignmentId: entry.assignmentId })
    }
    await tx.remove('job-active', legacyKey)
  }

  /** The declared wait expired: the range is terminated, and only confirmed quiescence becomes `cancelled`. */
  private async expire(jobId: string) {
    const handle = this.handles.get(jobId)
    if (!handle) return
    if (await this.storage.transaction(this.instanceId, transaction => this.previews.isPreview(transaction, handle.record.ticketId, jobId))) {
      this.clearTimer(jobId)
      return
    }
    const { ticketId } = handle.record
    await this.requestCancelInOwnTransaction(ticketId, jobId, 'deadline')
    const [confirmed] = await this.stopRanges([jobId])
    let expired: JobRecord | undefined
    try {
      expired = await this.storage.transaction(this.instanceId, async tx => {
        const current = await tx.get<JobRecord>('job', jobKey(ticketId, jobId))
        if (!current || current.state !== 'cancelling' || current.runtimeToken !== this.runtimeToken) return undefined
        return confirmed
          ? this.confirmCancelled(tx, { ticketId, jobId, ...(confirmed.output ? { output: confirmed.output } : {}) })
          : this.markUnconfirmed(tx, { ticketId, jobId })
      })
    } catch { /* The pending cancel stays visible as `cancelling`; the claim is dropped below either way. */ }
    finally { this.finishStopped([jobId]) }
    if (expired) this.handlers?.deadline(expired)
  }

  private async requestCancelInOwnTransaction(ticketId: string, jobId: string, reason: JobCancelReason) {
    try { await this.storage.transaction(this.instanceId, tx => this.requestCancel(tx, { ticketId, jobId, reason })) }
    catch { /* The owning command's own fact stays authoritative. */ }
  }

  private async settle(jobId: string, result: LocalJobResult) {
    const handle = this.handles.get(jobId)
    if (!handle) return
    if (this.closing) { this.release(jobId); return }
    let preview = false
    try {
      preview = await this.storage.transaction(this.instanceId, transaction => this.previews.isPreview(transaction, handle.record.ticketId, jobId))
    } catch {
      this.release(jobId)
      return
    }
    if (preview) {
      await this.settlePreview(handle.record.ticketId, jobId, result)
      return
    }
    let settled: JobRecord | undefined
    try {
      settled = await this.storage.transaction(this.instanceId, async tx => {
        const current = await tx.get<JobRecord>('job', jobKey(handle.record.ticketId, jobId))
        // A cancel, a stop or an older generation already wrote its own fact; keep it.
        if (!current || current.state !== 'running' || current.runtimeToken !== this.runtimeToken) return undefined
        const output = { stdout: readWindow(handle.job, 'stdout'), stderr: readWindow(handle.job, 'stderr') }
        const state: JobState = result.cancelled ? 'cancelled' : result.settled ? 'exited' : 'unknown'
        const next: JobRecord = { ...current, state, ...(output ? { output } : {}), exitCode: result.exitCode, cancelled: result.cancelled,
          truncated: result.truncated, finishedAt: this.now(),
          ...(!result.settled ? { reason: 'The local process range did not confirm exit; its outcome is unknown.' } : {}) }
        await tx.replace('job', jobKey(handle.record.ticketId, jobId), next)
        await this.index.remove(tx, handle.record.ticketId, jobId)
        return next
      })
    } catch { /* A lost settlement stays a live record; the next read reconciles it instead of inventing an outcome. */ }
    // A natural exit that arrives while the range is being stopped must not drop the stop's claim: the
    // confirming transaction has not committed yet, and a read in that gap would otherwise write `unknown`.
    this.release(jobId, this.claims.has(jobId))
    if (settled) this.handlers?.settled(settled)
  }

  private async reconcile(tx: AsyncTx, record: JobRecord) {
    if (!isActive(record.state)) return record
    // A record from an earlier runtime cannot be proven live; it stops counting as work this Host holds.
    // A record from THIS runtime with no handle is equally unprovable — a settlement that failed to commit
    // leaves exactly that, and reporting it `unknown` stops it holding a slot forever.
    if (record.runtimeToken === this.runtimeToken
      && (this.handles.has(record.id) || this.pending.has(record.id) || this.claims.has(record.id))) return record
    const recovered: JobRecord = { ...record, state: 'unknown', finishedAt: this.now(),
      reason: record.runtimeToken === this.runtimeToken
        ? 'This process no longer holds the job; its exit could not be recorded and is unknown.'
        : 'The Host restarted before this background job reported exit; its outcome is unknown.' }
    await tx.replace('job', jobKey(record.ticketId, record.id), recovered)
    await this.index.remove(tx, record.ticketId, record.id)
    return recovered
  }

  /** A preview exit is a durable review fact; it never announces a completion to the Worker. */
  private async settlePreview(ticketId: string, jobId: string, result: LocalJobResult) {
    const handle = this.handles.get(jobId)
    try {
      await this.storage.transaction(this.instanceId, async transaction => {
        const current = await transaction.get<JobRecord>('job', jobKey(ticketId, jobId))
        if (!current || current.state !== 'running' || current.runtimeToken !== this.runtimeToken) return
        const output = handle ? { stdout: readWindow(handle.job, 'stdout'), stderr: readWindow(handle.job, 'stderr') } : current.output
        const next: JobRecord = { ...current, state: result.cancelled ? 'cancelled' : result.settled ? 'exited' : 'unknown',
          ...(output ? { output } : {}), exitCode: result.exitCode, cancelled: result.cancelled, truncated: result.truncated, finishedAt: this.now(),
          ...(!result.settled ? { reason: 'The preview process range did not confirm exit; its outcome is unknown.' } : {}) }
        await transaction.replace('job', jobKey(ticketId, jobId), next)
        await this.previews.get(transaction, ticketId, jobId)
      })
    } finally { this.release(jobId) }
  }

  async listIn(tx: AsyncTx, ticketId: string): Promise<JobRecord[]> {
    identifier(ticketId, 'ticketId')
    const prefix = `${jobPrefix(ticketId)}:`
    const items: { id: string; record: JobRecord }[] = []
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<JobRecord>('job', { limit: 100, after: cursor })
      for (const item of page.items) {
        // The cursor is a lower bound, not a prefix filter; another Ticket's key can sort inside this range.
        if (!item.id.startsWith(prefix)) continue
        const record = await this.reconcile(tx, item.value)
        items.push({ id: item.id, record })
      }
      if (!page.cursor || !page.cursor.startsWith(prefix)) return this.order(items)
      cursor = page.cursor
    }
    // The query is bounded at 1,000 records and keeps the newest: records are evidence and are never deleted
    // automatically, so a long-lived Ticket still answers with its most recent work instead of failing.
    return this.order(items)
  }

  private order(items: { id: string; record: JobRecord }[]) {
    return items.map(item => item.record)
      .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))
      .slice(0, this.maxRecords)
      .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
  }

  private viewOf(record: JobRecord): JobView {
    const window = record.output ?? { stdout: emptyStream, stderr: emptyStream }
    return { ...this.facts(record), output: { stdout: { ...window.stdout }, stderr: { ...window.stderr } } }
  }

  private facts(record: JobRecord): Omit<JobView, 'output'> {
    return { id: record.id, ticketId: record.ticketId, assignmentId: record.assignmentId, command: record.command, state: record.state,
      // Only a confirmed exit or cancellation settles a job; a pending cancel or an unknown exit never reads as done.
      settled: settledStates.includes(record.state),
      succeeded: record.state === 'exited' && record.exitCode === 0 && !record.cancelled && !record.truncated,
      startedAt: record.startedAt, ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }), ...(record.cancelled === undefined ? {} : { cancelled: record.cancelled }),
      ...(record.truncated === undefined ? {} : { truncated: record.truncated }), ...(record.cancelReason ? { cancelReason: record.cancelReason } : {}),
      ...(record.reason ? { reason: record.reason } : {}) }
  }
}

function isActive(state: JobState) {
  return state === 'running' || state === 'cancelling'
}

function readWindow(job: LocalJob, name: 'stdout' | 'stderr'): JobStream {
  const read = job.read()[name]
  return { text: read.text.slice(0, 8192), lossy: read.lossy }
}
