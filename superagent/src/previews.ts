import { CoreError, identifier } from './model.js'
import type { AsyncTx } from './storage.js'
import type { Artifact } from './local-environment.js'
import type { JobRecord } from './jobs.js'
import { BackgroundWork } from './background.js'

export type PreviewState = 'running' | 'cancelling' | 'exited' | 'cancelled' | 'unknown' | 'resolved'

/** An explicitly retained managed job whose only purpose is human acceptance of the current delivery. */
export interface PreviewRecord {
  id: string
  ticketId: string
  assignmentId: string
  generation: string
  environmentId: string
  jobId: string
  command: string
  purpose: string
  artifact: Artifact
  state: PreviewState
  createdAt: number
  runtimeToken: string
  finishedAt?: number
  exitCode?: number | null
  reason?: string
}
export interface PreviewView {
  id: string
  ticketId: string
  assignmentId: string
  generation: string
  environmentId: string
  jobId: string
  command: string
  purpose: string
  artifact: Artifact
  state: PreviewState
  /** A retained preview never counts against the Worker execution slot budget. */
  holdsSlot: false
  /** A requested cleanup that this Host could not confirm is still pending. */
  pendingConfirmation: boolean
  createdAt: number
  finishedAt?: number
  exitCode?: number | null
  reason?: string
}

export interface PreviewsOptions {
  /** Active previews allowed per Ticket. Defaults to 4. */
  maxPerTicket?: number
}

const prefix = (ticketId: string) => JSON.stringify(['preview', ticketId])
const key = (ticketId: string, previewId: string) => `${prefix(ticketId)}:${previewId}`
const historyKey = (ticketId: string) => JSON.stringify(['preview-history', ticketId])
interface PreviewHistory { ticketId: string; ids: string[] }

/** Durable explicit approval for one job to outlive a handoff as an acceptance preview. */
export class Previews {
  readonly maxPerTicket: number
  readonly maxRecords = 100
  private readonly index: BackgroundWork
  constructor(private readonly runtimeToken: string,
    private readonly now: () => number = Date.now,
    private readonly isHeld: (jobId: string) => boolean,
    options: PreviewsOptions = {}) {
    this.maxPerTicket = options.maxPerTicket ?? 4
    if (!Number.isInteger(this.maxPerTicket) || this.maxPerTicket < 1 || this.maxPerTicket > 16) throw new CoreError('INVALID_CONFIG', 'Invalid preview budget.')
    this.index = new BackgroundWork('preview', async (tx, request) => {
      const record = await tx.get<PreviewRecord>('preview', key(request.ticketId, request.id))
      return record === undefined ? undefined : isPending(record.state)
    })
  }

  async start(tx: AsyncTx, request: { job: JobRecord; purpose: string; artifact: Artifact }): Promise<PreviewRecord> {
    identifier(request.job.ticketId, 'ticketId'); identifier(request.job.id, 'jobId')
    if (!request.purpose.trim() || Buffer.byteLength(request.purpose) > 2048) throw new CoreError('INVALID_INPUT', 'A preview needs a bounded nonempty purpose.')
    if (await tx.get<PreviewRecord>('preview', key(request.job.ticketId, request.job.id))) throw new CoreError('PREVIEW_EXISTS', 'This job is already retained as a preview.')
    const active = await this.index.active(tx, request.job.ticketId)
    if (active.length >= this.maxPerTicket) throw new CoreError('PREVIEW_BUDGET', 'This Ticket already retains its declared number of acceptance previews.')
    const history = await tx.get<PreviewHistory>('preview-history', historyKey(request.job.ticketId))
    const existing = history?.ids ?? (await this.list(tx, request.job.ticketId)).map(record => record.id)
    const record: PreviewRecord = { id: request.job.id, ticketId: request.job.ticketId, assignmentId: request.job.assignmentId,
      generation: request.job.generation, environmentId: request.job.environmentId, jobId: request.job.id, command: request.job.command, purpose: request.purpose,
      artifact: structuredClone(request.artifact), state: 'running', createdAt: this.now(), runtimeToken: this.runtimeToken }
    await tx.insert('preview', key(record.ticketId, record.id), record)
    await this.index.add(tx, record.ticketId, { id: record.id, assignmentId: record.assignmentId })
    const next: PreviewHistory = { ticketId: record.ticketId,
      ids: [...existing.filter(id => id !== record.id), record.id].slice(-this.maxRecords) }
    if (!await tx.replace('preview-history', historyKey(record.ticketId), next)) {
      await tx.insert('preview-history', historyKey(record.ticketId), next)
    }
    return record
  }

  async get(tx: AsyncTx, ticketId: string, previewId: string): Promise<PreviewRecord | undefined> {
    const record = await tx.get<PreviewRecord>('preview', key(ticketId, previewId))
    if (!record) return record
    if (!isPending(record.state)) {
      await this.index.remove(tx, ticketId, previewId)
      return record
    }
    const job = await tx.get<JobRecord>('job', `${JSON.stringify(['job', ticketId])}:${record.jobId}`)
    const stale = !job || record.runtimeToken !== this.runtimeToken || job.runtimeToken !== record.runtimeToken
      || (job.state === 'running' || job.state === 'cancelling') && !this.isHeld(record.jobId)
    const state: PreviewState = stale || job.state === 'unknown' ? 'unknown'
      : job.state === 'cancelling' ? 'cancelling' : job.state === 'running' ? 'running'
        : job.state === 'exited' ? 'exited' : 'cancelled'
    const pending = isPending(state)
    const reason = state === 'unknown' && stale
      ? 'The Host no longer holds this preview process; its cleanup is pending confirmation.'
      : job?.reason
    if (state === record.state && reason === record.reason) return record
    const updated: PreviewRecord = { ...record, state, ...(pending ? {} : { finishedAt: job?.finishedAt ?? this.now() }),
      ...(job?.exitCode === undefined ? {} : { exitCode: job.exitCode }), ...(reason ? { reason } : {}) }
    await tx.replace('preview', key(ticketId, previewId), updated)
    if (!pending) await this.index.remove(tx, ticketId, previewId)
    return updated
  }

  async isPreview(tx: AsyncTx, ticketId: string, jobId: string): Promise<boolean> {
    const record = await tx.get<PreviewRecord>('preview', key(ticketId, jobId))
    return record !== undefined
  }

  async markUnconfirmed(tx: AsyncTx, ticketId: string, previewId: string) {
    const record = await tx.get<PreviewRecord>('preview', key(ticketId, previewId))
    if (!record || record.state === 'unknown' || record.state === 'exited' || record.state === 'cancelled') return record
    const unknown: PreviewRecord = { ...record, state: 'unknown', finishedAt: record.finishedAt ?? this.now(),
      reason: 'The preview cancellation is pending confirmation; this Host cannot prove its process range stopped.' }
    await tx.replace('preview', key(ticketId, previewId), unknown)
    return unknown
  }

  /** Pending previews by durable index, not by the bounded history query. */
  async pending(tx: AsyncTx, ticketId: string): Promise<PreviewRecord[]> {
    const records: PreviewRecord[] = []
    for (const entry of await this.index.active(tx, ticketId)) {
      const record = await this.get(tx, ticketId, entry.id)
      if (record && isPending(record.state)) records.push(record)
    }
    return records
  }

  async resolve(tx: AsyncTx, ticketId: string, previewId: string, reason: string) {
    const record = await this.get(tx, ticketId, previewId)
    if (!record) throw new CoreError('NOT_FOUND', 'The preview does not belong to this Ticket.')
    if (record.state !== 'unknown') throw new CoreError('PREVIEW_NOT_UNKNOWN', 'Only an unconfirmed preview can be resolved by a person.')
    const resolved: PreviewRecord = { ...record, state: 'resolved', finishedAt: this.now(), reason }
    await tx.replace('preview', key(ticketId, previewId), resolved)
    await this.index.remove(tx, ticketId, previewId)
    return resolved
  }

  async list(tx: AsyncTx, ticketId: string): Promise<PreviewRecord[]> {
    identifier(ticketId, 'ticketId')
    const history = await tx.get<PreviewHistory>('preview-history', historyKey(ticketId))
    if (history) {
      const records: PreviewRecord[] = []
      for (const id of history.ids) {
        const record = await this.get(tx, ticketId, id)
        if (record) records.push(record)
      }
      return records
    }
    const records: PreviewRecord[] = []
    let cursor = `${prefix(ticketId)}:`
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<PreviewRecord>('preview', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(`${prefix(ticketId)}:`)) continue
        records.push((await this.get(tx, ticketId, item.value.id))!)
      }
      if (!page.cursor || !page.cursor.startsWith(`${prefix(ticketId)}:`)) break
      cursor = page.cursor
      if (pageCount === 9) break
    }
    return records.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)).slice(-this.maxRecords)
  }

  view(record: PreviewRecord): PreviewView {
    return { id: record.id, ticketId: record.ticketId, assignmentId: record.assignmentId, generation: record.generation,
      environmentId: record.environmentId, jobId: record.jobId, command: record.command, purpose: record.purpose,
      artifact: structuredClone(record.artifact), state: record.state, holdsSlot: false,
      pendingConfirmation: record.state === 'cancelling' || record.state === 'unknown', createdAt: record.createdAt,
      ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }), ...(record.reason ? { reason: record.reason } : {}) }
  }
}

function isPending(state: PreviewState) {
  return state === 'running' || state === 'cancelling' || state === 'unknown'
}
