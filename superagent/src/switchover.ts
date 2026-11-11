import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import { canonicalJson } from './commands.js'
import { HostLease } from './host.js'
import { getLegacyArchive } from './legacy-archive.js'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export type SwitchoverState = 'quiescing' | 'quiesced' | 'active'
export type LegacyReceiptState = 'accepted' | 'not-accepted' | 'rejected' | 'pending' | 'unknown'
export type GapInputState = 'held' | 'legacy-accepted' | 'quarantined' | 'released'

export interface LegacyCursorFact {
  sourceInstanceId: string
  value: string
  complete: boolean
  reason?: string
}

export interface LegacyReceiptFact {
  commandId: string
  eventId?: string
  ticketId?: string
  state: LegacyReceiptState
  cursor?: string
}

export interface LegacyReviewFact {
  id: string
  kind: string
  reason: string
  state?: string
}

/**
 * Facts read from the old core after its entry has been stopped. The adapter is responsible for
 * reading the old process' own durable facts; this module never trusts the old home lock as fencing.
 */
export interface LegacySnapshot {
  capturedAt: number
  stateRevision?: number
  activeTurns: string[]
  activeJobs: string[]
  pendingOutbound: string[]
  increments: { inputs: number; receipts: number; events: number; outbound: number }
  cursors: LegacyCursorFact[]
  receipts: LegacyReceiptFact[]
  review?: LegacyReviewFact[]
}

export interface LegacyStopEvidence {
  evidence?: string
}

export interface LegacyRestartEvidence {
  evidence: string
  entry?: string
}

/** The host-supplied control of the old core. The caller must implement it for its own entry. */
export interface LegacyCore {
  stop(): Promise<LegacyStopEvidence | void>
  /** Persistently disable the old process' restart entry; a live lock alone is not enough. */
  disableRestart(): Promise<LegacyRestartEvidence>
  /** Re-read that persistent fact. */
  restartDisabled(): Promise<boolean>
  snapshot(): Promise<LegacySnapshot>
}

export interface SwitchoverEntry {
  host: string
  port: number
}

export interface SwitchoverOptions {
  batchId: string
  newEpoch: number
  archive: { target: string }
  oldHome?: string
  entry: SwitchoverEntry
  legacy: LegacyCore
  settleMs?: number
  entryWaitMs?: number
  heartbeatMs?: number
}

export interface SwitchoverBlocker {
  code: string
  message: string
}

export interface SwitchoverCheckpoint {
  capturedAt: number
  digest: string
  activeTurns: string[]
  activeJobs: string[]
  pendingOutbound: string[]
  increments: LegacySnapshot['increments']
  cursors: LegacyCursorFact[]
  receipts: LegacyReceiptFact[]
  review: LegacyReviewFact[]
  entryHeld: boolean
}

export interface SwitchoverArchiveFact {
  target: string
  batchId: string
  sourceDigest: string
  mappingDigest: string
  stateRevision?: number
  publishedAt?: number
  review: LegacyReviewFact[]
}

export interface SwitchoverOldHomeFact {
  path: string
  lockPath?: string
  lockExists: boolean
  /** The old home lock protects old data only; it is evidence, never a new-epoch fence. */
  usedAsFence: false
}

export interface SwitchoverEntryFact extends SwitchoverEntry {
  isolated: boolean
  heartbeatMs?: number
  heldAt?: number
  releasedAt?: number
  holderPid?: number
  holderStartedAt?: number
  heartbeatAt?: number
}

export interface SwitchoverStopFact {
  requestedAt?: number
  confirmedAt?: number
  evidence?: string
}

export interface SwitchoverRestartFact {
  requestedAt?: number
  disabledAt?: number
  evidence?: string
  entry?: string
}

export interface GapCounts {
  held: number
  legacyAccepted: number
  quarantined: number
  released: number
}

export interface SwitchoverRecord {
  id: string
  instanceId: string
  batchId: string
  state: SwitchoverState
  newEpoch: number
  archive: SwitchoverArchiveFact
  oldHome?: SwitchoverOldHomeFact
  entry: SwitchoverEntryFact
  stop: SwitchoverStopFact
  restart: SwitchoverRestartFact
  gap: GapCounts
  checkpoints: SwitchoverCheckpoint[]
  blockers: SwitchoverBlocker[]
  quiescedAt?: number
  createdAt: number
  updatedAt: number
}

export interface SwitchoverView extends SwitchoverRecord {
  isolation: 'held-by-this-process' | 'held-elsewhere' | 'released'
  buffer: GapCounts
}

export interface GapVersion {
  order: 'sequence' | 'opaque'
  value: string
}

export interface GapCursor {
  sourceInstanceId: string
  value: string
}

export interface GapReceipt {
  commandId: string
  state: LegacyReceiptState
  eventId?: string
  ticketId?: string
  cursor?: string
}

export interface SwitchoverGapInput {
  id: string
  instanceId: string
  batchId: string
  state: GapInputState
  dispatch: 'not-dispatched' | 'released-to-current-entry'
  sourceInstanceId?: string
  threadId?: string
  objectId?: string
  version?: GapVersion
  text?: string
  authorId?: string
  authorKind?: 'human' | 'bot' | 'ci' | 'system'
  addressing?: 'direct' | 'mention' | 'ambient'
  cursor?: GapCursor
  receipt?: GapReceipt
  reason?: string
  rawDigest: string
  raw?: string
  receivedAt: number
}

export interface GapInputResult {
  id: string
  state: GapInputState
  durable: true
}

export interface GapInputPage {
  items: SwitchoverGapInput[]
  cursor?: string
}

const batchPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const maxLineBytes = 131_072
const maxTextBytes = 65_536
const maxReviewItems = 1_000
const maxFacts = 1_000
const receiptStates: LegacyReceiptState[] = ['accepted', 'not-accepted', 'rejected', 'pending', 'unknown']
const actorKinds = ['human', 'bot', 'ci', 'system'] as const
const addressingKinds = ['direct', 'mention', 'ambient'] as const
const allowedGapKeys = ['sourceInstanceId', 'threadId', 'objectId', 'version', 'text', 'authorId', 'authorKind', 'addressing', 'cursor', 'receipt']
const batchId = (value: string) => { if (!batchPattern.test(value)) throw new CoreError('SWITCHOVER_INPUT', 'A batch id is a bounded path-safe identifier.') }
const switchoverPrefix = (instanceId: string, batch: string) => JSON.stringify(['switchover', instanceId, batch])
const gapPrefix = (instanceId: string, batch: string) => JSON.stringify(['switchover-gap-input', instanceId, batch])
const gapKey = (instanceId: string, batch: string, id: string) => `${gapPrefix(instanceId, batch)}:${id}`
export const switchoverGapPrefix = (instanceId: string, batch: string) => gapPrefix(instanceId, batch)
export function loadSwitchover(transaction: AsyncTx, instanceId: string, batch: string) {
  batchId(batch)
  return transaction.get<SwitchoverRecord>('switchover', switchoverPrefix(instanceId, batch))
}
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const boundedText = (value: unknown, name: string, maximum = 2_048, code = 'SWITCHOVER_INPUT') => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum) throw new CoreError(code, `${name} must be bounded nonempty text.`)
  return value
}
const boundedInteger = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000
const count = (value: unknown, name: string) => {
  if (!boundedInteger(value)) throw new CoreError('SWITCHOVER_SNAPSHOT', `${name} must be a bounded non-negative integer.`)
  return value as number
}
const stringList = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.length > maxFacts) throw new CoreError('SWITCHOVER_SNAPSHOT', `${name} must be a bounded array.`)
  return value.map(item => { identifier(item, name); return item })
}
const unique = <T extends SwitchoverBlocker>(items: T[]) => items.filter((item, index) => items.findIndex(candidate => candidate.code === item.code) === index)
const delay = (ms: number) => new Promise<void>(resolveDelay => setTimeout(resolveDelay, ms))
const errorCode = (error: unknown) => error instanceof CoreError ? error.code : 'SWITCHOVER_FAILED'
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const normalizeCursor = (value: unknown): LegacyCursorFact => {
  if (!value || typeof value !== 'object') throw new CoreError('SWITCHOVER_SNAPSHOT', 'A cursor fact must be an object.')
  const cursor = value as Record<string, unknown>
  identifier(cursor.sourceInstanceId, 'cursor.sourceInstanceId')
  identifier(cursor.value, 'cursor.value')
  if (typeof cursor.complete !== 'boolean') throw new CoreError('SWITCHOVER_SNAPSHOT', 'A cursor fact needs a complete flag.')
  if (cursor.reason !== undefined && (typeof cursor.reason !== 'string' || Buffer.byteLength(cursor.reason) > 2_048)) throw new CoreError('SWITCHOVER_SNAPSHOT', 'A cursor reason is bounded text.')
  return { sourceInstanceId: cursor.sourceInstanceId as string, value: cursor.value as string, complete: cursor.complete,
    ...(cursor.reason === undefined ? {} : { reason: cursor.reason as string }) }
}

const normalizeReceipt = (value: unknown): LegacyReceiptFact => {
  if (!value || typeof value !== 'object') throw new CoreError('SWITCHOVER_SNAPSHOT', 'A receipt fact must be an object.')
  const receipt = value as Record<string, unknown>
  identifier(receipt.commandId, 'receipt.commandId')
  if (!receiptStates.includes(receipt.state as LegacyReceiptState)) throw new CoreError('SWITCHOVER_SNAPSHOT', 'A receipt fact has an unsupported state.')
  if (receipt.eventId !== undefined) identifier(receipt.eventId, 'receipt.eventId')
  if (receipt.ticketId !== undefined) identifier(receipt.ticketId, 'receipt.ticketId')
  if (receipt.cursor !== undefined) identifier(receipt.cursor, 'receipt.cursor')
  return { commandId: receipt.commandId as string, state: receipt.state as LegacyReceiptState,
    ...(receipt.eventId === undefined ? {} : { eventId: receipt.eventId as string }),
    ...(receipt.ticketId === undefined ? {} : { ticketId: receipt.ticketId as string }),
    ...(receipt.cursor === undefined ? {} : { cursor: receipt.cursor as string }) }
}

const normalizeReview = (value: unknown): LegacyReviewFact => {
  if (!value || typeof value !== 'object') throw new CoreError('SWITCHOVER_SNAPSHOT', 'A review fact must be an object.')
  const review = value as Record<string, unknown>
  identifier(review.id, 'review.id')
  return { id: review.id as string, kind: boundedText(review.kind, 'review.kind', 2_048, 'SWITCHOVER_SNAPSHOT'),
    reason: boundedText(review.reason, 'review.reason', 2_048, 'SWITCHOVER_SNAPSHOT'),
    ...(review.state === undefined ? {} : { state: boundedText(review.state, 'review.state', 2_048, 'SWITCHOVER_SNAPSHOT') }) }
}

const normalizeSnapshot = (value: LegacySnapshot): LegacySnapshot => {
  if (!value || typeof value !== 'object') throw new CoreError('SWITCHOVER_SNAPSHOT', 'The old core returned no snapshot.')
  if (typeof value.capturedAt !== 'number' || !Number.isFinite(value.capturedAt)) throw new CoreError('SWITCHOVER_SNAPSHOT', 'A snapshot needs a capture time.')
  if (value.stateRevision !== undefined && !boundedInteger(value.stateRevision)) throw new CoreError('SWITCHOVER_SNAPSHOT', 'A state revision is a bounded integer.')
  if (!value.increments || typeof value.increments !== 'object') throw new CoreError('SWITCHOVER_SNAPSHOT', 'A snapshot needs increment counts.')
  const cursors = Array.isArray(value.cursors) && value.cursors.length <= maxFacts ? value.cursors.map(normalizeCursor) : undefined
  if (!cursors) throw new CoreError('SWITCHOVER_SNAPSHOT', 'Snapshot cursors must be a bounded array.')
  const receipts = Array.isArray(value.receipts) && value.receipts.length <= maxFacts ? value.receipts.map(normalizeReceipt) : undefined
  if (!receipts) throw new CoreError('SWITCHOVER_SNAPSHOT', 'Snapshot receipts must be a bounded array.')
  const review = value.review === undefined ? [] : Array.isArray(value.review) && value.review.length <= maxFacts ? value.review.map(normalizeReview) : undefined
  if (!review) throw new CoreError('SWITCHOVER_SNAPSHOT', 'Snapshot review items must be a bounded array.')
  return { capturedAt: value.capturedAt, ...(value.stateRevision === undefined ? {} : { stateRevision: value.stateRevision }),
    activeTurns: stringList(value.activeTurns, 'activeTurns'), activeJobs: stringList(value.activeJobs, 'activeJobs'),
    pendingOutbound: stringList(value.pendingOutbound, 'pendingOutbound'),
    increments: { inputs: count(value.increments.inputs, 'increments.inputs'), receipts: count(value.increments.receipts, 'increments.receipts'),
      events: count(value.increments.events, 'increments.events'), outbound: count(value.increments.outbound, 'increments.outbound') },
    cursors, receipts, review }
}

const checkpoint = (snapshot: LegacySnapshot, entryHeld: boolean): SwitchoverCheckpoint => {
  const { capturedAt, ...facts } = snapshot
  return { capturedAt, digest: digest(facts), activeTurns: [...snapshot.activeTurns], activeJobs: [...snapshot.activeJobs],
    pendingOutbound: [...snapshot.pendingOutbound], increments: { ...snapshot.increments }, cursors: snapshot.cursors.map(cursor => ({ ...cursor })),
    receipts: snapshot.receipts.map(receipt => ({ ...receipt })), review: (snapshot.review ?? []).map(item => ({ ...item })), entryHeld }
}

const snapshotBlockers = (snapshot: LegacySnapshot): SwitchoverBlocker[] => {
  const blockers: SwitchoverBlocker[] = []
  if (snapshot.activeTurns.length) blockers.push({ code: 'ACTIVE_TURNS', message: `The old core still has ${String(snapshot.activeTurns.length)} active turn(s): ${snapshot.activeTurns.slice(0, 8).join(', ')}` })
  if (snapshot.activeJobs.length) blockers.push({ code: 'ACTIVE_JOBS', message: `The old core still has ${String(snapshot.activeJobs.length)} active job(s): ${snapshot.activeJobs.slice(0, 8).join(', ')}` })
  if (snapshot.pendingOutbound.length) blockers.push({ code: 'PENDING_OUTBOUND', message: `The old core still has ${String(snapshot.pendingOutbound.length)} pending outbound item(s): ${snapshot.pendingOutbound.slice(0, 8).join(', ')}` })
  const increments = snapshot.increments
  if (increments.inputs || increments.receipts || increments.events || increments.outbound) {
    blockers.push({ code: 'PENDING_INCREMENT', message: `The old core still reports unaccounted increments (inputs ${String(increments.inputs)}, receipts ${String(increments.receipts)}, events ${String(increments.events)}, outbound ${String(increments.outbound)}).` })
  }
  if (snapshot.cursors.some(cursor => !cursor.complete)) blockers.push({ code: 'INCOMPLETE_CURSOR', message: 'At least one source cursor has not durably covered its input.' })
  if (snapshot.receipts.some(receipt => receipt.state === 'pending' || receipt.state === 'unknown')) {
    blockers.push({ code: 'PENDING_RECEIPT', message: 'At least one old acceptance receipt is still pending or unknown.' })
  }
  return unique(blockers)
}

const canonicalSequence = /^(?:0|[1-9][0-9]{0,39})$/u
const cursorOrder = (left: string, right: string): number | undefined => {
  if (canonicalSequence.test(left) && canonicalSequence.test(right)) {
    const a = BigInt(left)
    const b = BigInt(right)
    return a === b ? 0 : a < b ? -1 : 1
  }
  return left === right ? 0 : undefined
}

const matchingReceipt = (input: SwitchoverGapInput, snapshot: LegacySnapshot) => {
  const receipt = input.receipt
  if (!receipt) return undefined
  if (receipt.eventId) {
    const byEvent = snapshot.receipts.find(candidate => candidate.eventId === receipt.eventId)
    if (byEvent) return byEvent
  }
  return snapshot.receipts.find(candidate => candidate.commandId === receipt.commandId)
}

const quarantined = (input: SwitchoverGapInput, reason: string): SwitchoverGapInput => ({ ...input, state: 'quarantined', reason })

const reconcileGapInput = (input: SwitchoverGapInput, snapshot: LegacySnapshot): SwitchoverGapInput => {
  if (input.state === 'quarantined' || input.state === 'released' || !input.receipt || !input.cursor) return input
  const receipt = matchingReceipt(input, snapshot)
  const finalCursor = snapshot.cursors.find(cursor => cursor.sourceInstanceId === input.cursor!.sourceInstanceId && cursor.complete)
  const receiptCursorOrder = receipt?.cursor ? cursorOrder(input.cursor.value, receipt.cursor) : undefined
  const finalCursorOrder = finalCursor ? cursorOrder(input.cursor.value, finalCursor.value) : undefined
  if (!receipt) return quarantined(input, 'RECEIPT_NOT_CONFIRMED')
  if (!receipt.cursor || receiptCursorOrder === undefined || receiptCursorOrder < 0) return quarantined(input, 'RECEIPT_CURSOR_UNVERIFIED')
  if (receipt.state === 'accepted') {
    if (!finalCursor || finalCursorOrder === undefined || finalCursorOrder > 0) return quarantined(input, 'CURSOR_NOT_COVERED')
    return input.state === 'legacy-accepted' ? input : { ...input, state: 'legacy-accepted', reason: 'OLD_ACCEPTED_DURING_GAP' }
  }
  if (receipt.state !== 'not-accepted') {
    return quarantined(input, receipt.state === 'pending' ? 'PENDING_ACCEPT_RECEIPT' : receipt.state === 'unknown' ? 'UNKNOWN_ACCEPT_RECEIPT' : 'REJECTED_ACCEPT_RECEIPT')
  }
  if (!finalCursor || finalCursorOrder === undefined || finalCursorOrder < 0) return quarantined(input, 'CURSOR_BEHIND')
  return input
}

const classifyGapInput = (parsed: ReturnType<typeof parseGapInput>): { state: GapInputState; reason?: string } => {
  if (!parsed.cursor) return { state: 'quarantined', reason: 'MISSING_CURSOR' }
  if (parsed.cursor.sourceInstanceId !== parsed.sourceInstanceId) return { state: 'quarantined', reason: 'CURSOR_SOURCE_MISMATCH' }
  if (!parsed.receipt) return { state: 'quarantined', reason: 'MISSING_ACCEPT_RECEIPT' }
  if (parsed.receipt.state === 'accepted') return { state: 'legacy-accepted' }
  if (parsed.receipt.state === 'not-accepted') return { state: 'held' }
  return { state: 'quarantined', reason: parsed.receipt.state === 'pending' ? 'PENDING_ACCEPT_RECEIPT'
    : parsed.receipt.state === 'unknown' ? 'UNKNOWN_ACCEPT_RECEIPT' : 'REJECTED_ACCEPT_RECEIPT' }
}

const parseGapInput = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreError('GAP_INPUT_INVALID', 'A gap input must be a JSON object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !allowedGapKeys.includes(key))) throw new CoreError('GAP_INPUT_INVALID', 'Gap input carries unsupported fields.')
  identifier(input.sourceInstanceId, 'sourceInstanceId')
  identifier(input.threadId, 'threadId')
  identifier(input.objectId, 'objectId')
  if (!input.version || typeof input.version !== 'object') throw new CoreError('GAP_INPUT_INVALID', 'A gap input needs a native version.')
  const version = input.version as Record<string, unknown>
  if (!['sequence', 'opaque'].includes(version.order as string) || Object.keys(version).some(key => !['order', 'value'].includes(key))) throw new CoreError('GAP_INPUT_INVALID', 'A native version is an order and a value.')
  identifier(version.value, 'version.value')
  if (version.order === 'sequence' && !/^(?:0|[1-9][0-9]{0,39})$/u.test(version.value as string)) throw new CoreError('GAP_INPUT_INVALID', 'A sequence version must be a canonical unsigned integer.')
  if (input.text !== undefined && (typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text) > maxTextBytes)) throw new CoreError('GAP_INPUT_INVALID', 'Gap input text is bounded.')
  if (input.authorId !== undefined) identifier(input.authorId, 'authorId')
  if (input.authorKind !== undefined && !actorKinds.includes(input.authorKind as typeof actorKinds[number])) throw new CoreError('GAP_INPUT_INVALID', 'Unsupported author kind.')
  if (input.addressing !== undefined && !addressingKinds.includes(input.addressing as typeof addressingKinds[number])) throw new CoreError('GAP_INPUT_INVALID', 'Unsupported addressing kind.')
  let cursor: GapCursor | undefined
  if (input.cursor !== undefined) {
    if (!input.cursor || typeof input.cursor !== 'object' || Object.keys(input.cursor as object).some(key => !['sourceInstanceId', 'value'].includes(key))) throw new CoreError('GAP_INPUT_INVALID', 'A cursor is a source instance and a value.')
    const candidate = input.cursor as Record<string, unknown>
    identifier(candidate.sourceInstanceId, 'cursor.sourceInstanceId')
    identifier(candidate.value, 'cursor.value')
    cursor = { sourceInstanceId: candidate.sourceInstanceId as string, value: candidate.value as string }
  }
  let receipt: GapReceipt | undefined
  if (input.receipt !== undefined) {
    if (!input.receipt || typeof input.receipt !== 'object' || Object.keys(input.receipt as object).some(key => !['commandId', 'state', 'eventId', 'ticketId', 'cursor'].includes(key))) throw new CoreError('GAP_INPUT_INVALID', 'A receipt connects a command, its state and optional event, Ticket or cursor.')
    const candidate = input.receipt as Record<string, unknown>
    identifier(candidate.commandId, 'receipt.commandId')
    if (!receiptStates.includes(candidate.state as LegacyReceiptState)) throw new CoreError('GAP_INPUT_INVALID', 'Unsupported receipt state.')
    if (candidate.eventId !== undefined) identifier(candidate.eventId, 'receipt.eventId')
    if (candidate.ticketId !== undefined) identifier(candidate.ticketId, 'receipt.ticketId')
    if (candidate.cursor !== undefined) identifier(candidate.cursor, 'receipt.cursor')
    receipt = { commandId: candidate.commandId as string, state: candidate.state as LegacyReceiptState,
      ...(candidate.eventId === undefined ? {} : { eventId: candidate.eventId as string }),
      ...(candidate.ticketId === undefined ? {} : { ticketId: candidate.ticketId as string }),
      ...(candidate.cursor === undefined ? {} : { cursor: candidate.cursor as string }) }
  }
  return { sourceInstanceId: input.sourceInstanceId, threadId: input.threadId, objectId: input.objectId,
    version: { order: version.order as GapVersion['order'], value: version.value as string },
    ...(input.text === undefined ? {} : { text: input.text as string }),
    ...(input.authorId === undefined ? {} : { authorId: input.authorId as string }),
    ...(input.authorKind === undefined ? {} : { authorKind: input.authorKind as NonNullable<SwitchoverGapInput['authorKind']> }),
    ...(input.addressing === undefined ? {} : { addressing: input.addressing as SwitchoverGapInput['addressing'] }),
    ...(cursor ? { cursor } : {}), ...(receipt ? { receipt } : {}) }
}

export class Switchover {
  private server: Server | undefined
  private readonly sockets = new Set<Socket>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private readonly startedAt = Date.now()
  private tail: Promise<unknown> = Promise.resolve()
  private heartbeatMs = 2_000

  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly now: () => number = Date.now) {
    identifier(instanceId, 'instanceId')
  }

  private exclusively<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private recordKey(batch: string) { return switchoverPrefix(this.instanceId, batch) }

  async begin(options: SwitchoverOptions): Promise<SwitchoverRecord> {
    const { settleMs, entryWaitMs } = this.validateBeginOptions(options)
    await this.assertCurrentEpoch(options.newEpoch)
    const manifest = this.publishedArchive(options.archive.target, options.batchId)
    const archive = this.archiveFact(options.archive.target, options.batchId, manifest)
    return this.exclusively(async () => {
      let record = await this.storage.transaction(this.instanceId, tx => this.load(tx, options.batchId))
      if (record) this.assertCompatible(record, options, archive)
      if (record?.state === 'active') throw new CoreError('SWITCHOVER_ACTIVE', 'This batch is already the active core entry.')
      if (!record) {
        record = {
          id: this.recordKey(options.batchId), instanceId: this.instanceId, batchId: options.batchId, state: 'quiescing',
          newEpoch: options.newEpoch, archive, ...this.oldHomeFact(options.oldHome),
          entry: { host: options.entry.host, port: options.entry.port, isolated: false },
          stop: {}, restart: {}, gap: { held: 0, legacyAccepted: 0, quarantined: 0, released: 0 },
          checkpoints: [], blockers: [], createdAt: this.now(), updatedAt: this.now(),
        }
        await this.save(record)
      }
      if (record.state === 'quiesced' && this.server?.listening && this.isHolder(record)) return record
      // A duplicate process must not downgrade a batch another live holder is still isolating.
      if (record.state === 'quiesced' && record.entry.isolated && !this.isHolder(record) && await this.entryReachable(record.entry)) return record
      record = await this.setBlockers({ ...record, state: 'quiescing' }, [])
      record = await this.stopLegacy(record, options.legacy)
      if (record.blockers.length) return record
      record = await this.disableLegacyRestart(record, options.legacy)
      if (record.blockers.length) return record
      record = await this.isolateEntry(record, options.entry, entryWaitMs)
      if (record.blockers.length) return record
      return this.verify(record, options.legacy, settleMs)
    })
  }

  async recheck(batch: string, options: { legacy: LegacyCore; settleMs?: number }): Promise<SwitchoverRecord> {
    batchId(batch)
    const settleMs = options.settleMs ?? 1_000
    if (!boundedInteger(settleMs) || settleMs > 60_000) throw new CoreError('SWITCHOVER_INPUT', 'The settle window is between 0 and 60000 ms.')
    return this.exclusively(async () => {
      const record = await this.storage.transaction(this.instanceId, tx => this.load(tx, batch))
      if (!record) throw new CoreError('SWITCHOVER_NOT_FOUND', 'No switchover record exists for this batch.')
      if (record.state === 'active') throw new CoreError('SWITCHOVER_ACTIVE', 'The active core entry is no longer a pending switchover.')
      return this.verify(record, options.legacy, settleMs)
    })
  }

  async status(batch: string): Promise<SwitchoverView | undefined> {
    batchId(batch)
    const record = await this.storage.transaction(this.instanceId, async tx => {
      const record = await this.load(tx, batch)
      if (!record) return undefined
      const buffer = await this.countIn(tx, batch)
      return { record, buffer }
    })
    if (!record) return undefined
    let isolation = this.isolation(record.record)
    if (isolation === 'released' && record.record.entry.isolated && await this.entryReachable(record.record.entry)) isolation = 'held-elsewhere'
    return { ...record.record, isolation, buffer: record.buffer }
  }

  async listGapInputs(batch: string, options: { state?: GapInputState; limit?: number; after?: string } = {}): Promise<GapInputPage> {
    batchId(batch)
    const limit = options.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CoreError('SWITCHOVER_INPUT', 'Use a bounded gap-input page.')
    if (options.state !== undefined && !['held', 'legacy-accepted', 'quarantined', 'released'].includes(options.state)) throw new CoreError('SWITCHOVER_INPUT', 'Unsupported gap-input state.')
    const prefix = gapPrefix(this.instanceId, batch)
    if (options.after !== undefined && (!options.after.startsWith(prefix) || options.after.length > 1_024)) throw new CoreError('SWITCHOVER_INPUT', 'Use a cursor from this batch.')
    return this.storage.transaction(this.instanceId, async tx => {
      const items: SwitchoverGapInput[] = []
      let cursor = options.after ?? prefix
      for (let page = 0; page < 10; page++) {
        const batchPage = await tx.scan<SwitchoverGapInput>('switchover-gap-input', { limit: Math.min(100, limit * 2), after: cursor })
        for (const item of batchPage.items) {
          if (!item.id.startsWith(prefix)) return { items }
          if (options.state && item.value.state !== options.state) continue
          items.push(item.value)
          if (items.length === limit) return { items, cursor: item.id }
        }
        if (!batchPage.cursor || !batchPage.cursor.startsWith(prefix)) return { items }
        cursor = batchPage.cursor
      }
      throw new CoreError('SWITCHOVER_BUDGET', 'The gap-input scan exceeded its declared 1000-record budget.')
    })
  }

  async getGapInput(batch: string, id: string) {
    batchId(batch)
    identifier(id, 'id')
    return this.storage.transaction(this.instanceId, tx => tx.get<SwitchoverGapInput>('switchover-gap-input', gapKey(this.instanceId, batch, id)))
  }

  async ingestGapInput(batch: string, value: unknown): Promise<GapInputResult> {
    batchId(batch)
    const raw = typeof value === 'string' ? value : JSON.stringify(value)
    if (Buffer.byteLength(raw) > maxLineBytes) throw new CoreError('GAP_INPUT_TOO_LARGE', 'The gap input exceeds its 131072-byte budget.')
    return this.exclusively(async () => {
      const record = await this.storage.transaction(this.instanceId, tx => this.load(tx, batch))
      if (!record) throw new CoreError('SWITCHOVER_NOT_FOUND', 'No switchover record exists for this batch.')
      if (record.state === 'active') throw new CoreError('CORE_NOT_ACTIVE', 'Gap intake is closed after activation; new input must use the active core entry.')
      if (!record.stop.confirmedAt || !record.entry.isolated || !this.isolationFresh(record)) throw new CoreError('ENTRY_NOT_ISOLATED', 'Gap input cannot be accepted before the old entry is actually isolated.')
      let parsed: ReturnType<typeof parseGapInput>
      try {
        let body: unknown = value
        if (typeof value === 'string') {
          try { body = JSON.parse(value) } catch { throw new CoreError('GAP_INPUT_INVALID', 'A gap input must be a JSON object.') }
        }
        parsed = parseGapInput(body)
      }
      catch (error) {
        const reason = errorCode(error)
        const id = `quarantine:${createHash('sha256').update(raw).digest('hex')}`
        const existing = await this.storage.transaction(this.instanceId, tx => tx.get<SwitchoverGapInput>('switchover-gap-input', gapKey(this.instanceId, batch, id)))
        if (existing) return { id, state: existing.state, durable: true }
        const quarantined: SwitchoverGapInput = { id, instanceId: this.instanceId, batchId: batch, state: 'quarantined', dispatch: 'not-dispatched',
          reason, rawDigest: createHash('sha256').update(raw).digest('hex'), raw: raw.slice(0, maxLineBytes), receivedAt: this.now() }
        await this.saveGap(quarantined)
        return { id, state: 'quarantined', durable: true }
      }
      const rawDigest = digest([parsed.sourceInstanceId, parsed.threadId, parsed.objectId, parsed.version.order, parsed.version.value,
        parsed.text ?? null, parsed.authorId ?? null, parsed.authorKind ?? null, parsed.addressing ?? null,
        parsed.cursor?.sourceInstanceId ?? null, parsed.cursor?.value ?? null,
        parsed.receipt?.commandId ?? null, parsed.receipt?.state ?? null, parsed.receipt?.eventId ?? null, parsed.receipt?.ticketId ?? null])
      const id = `gap:${digest([parsed.sourceInstanceId, parsed.threadId, parsed.objectId, parsed.version.order, parsed.version.value])}`
      const existing = await this.storage.transaction(this.instanceId, tx => tx.get<SwitchoverGapInput>('switchover-gap-input', gapKey(this.instanceId, batch, id)))
      if (existing) {
        if (existing.rawDigest !== rawDigest) throw new CoreError('GAP_INPUT_CONFLICT', 'This fully-qualified input ID was already buffered with different facts.')
        return { id, state: existing.state, durable: true }
      }
      const { state, reason } = classifyGapInput(parsed)
      const input: SwitchoverGapInput = { id, instanceId: this.instanceId, batchId: batch, state, dispatch: 'not-dispatched',
        sourceInstanceId: parsed.sourceInstanceId, threadId: parsed.threadId, objectId: parsed.objectId, version: parsed.version,
        ...(parsed.text === undefined ? {} : { text: parsed.text }),
        ...(parsed.authorId === undefined ? {} : { authorId: parsed.authorId }),
        ...(parsed.authorKind === undefined ? {} : { authorKind: parsed.authorKind }),
        ...(parsed.addressing === undefined ? {} : { addressing: parsed.addressing }),
        ...(parsed.cursor ? { cursor: parsed.cursor } : {}), ...(parsed.receipt ? { receipt: parsed.receipt } : {}),
        ...(reason ? { reason } : {}), rawDigest, receivedAt: this.now() }
      await this.saveGap(input)
      return { id, state, durable: true }
    })
  }

  async close(): Promise<void> {
    await this.exclusively(async () => {
      this.stopHeartbeat()
      const server = this.server
      this.server = undefined
      try {
        const prefix = `${JSON.stringify(['switchover', this.instanceId]).slice(0, -1)},`
        const records = await this.storage.transaction(this.instanceId, tx => tx.scan<SwitchoverRecord>('switchover', { limit: 100, after: prefix }))
        for (const item of records.items) {
          if (!item.id.startsWith(prefix)) break
          if (item.value.state === 'active') continue
          if (item.value.entry.holderPid !== process.pid || item.value.entry.holderStartedAt !== this.startedAt || !item.value.entry.isolated) continue
          await this.save({ ...item.value, state: 'quiescing', entry: { ...item.value.entry, isolated: false, releasedAt: this.now() },
            blockers: [{ code: 'ENTRY_RELEASED', message: 'The isolated intake entry was released; quiesced is no longer current.' }], updatedAt: this.now() })
        }
      } finally {
        if (server) {
          for (const socket of this.sockets) socket.destroy()
          this.sockets.clear()
          await new Promise<void>(resolveClose => server.close(() => resolveClose()))
        }
      }
    })
  }

  /** Close the gap intake after another transaction made this batch the active entry. */
  async detach(batch: string): Promise<void> {
    identifier(batch, 'batchId')
    await this.exclusively(async () => {
      this.stopHeartbeat()
      const server = this.server
      this.server = undefined
      if (!server) return
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    })
  }

  private validateBeginOptions(options: SwitchoverOptions) {
    batchId(options?.batchId)
    if (!Number.isSafeInteger(options.newEpoch) || options.newEpoch < 1) throw new CoreError('SWITCHOVER_INPUT', 'A new Host epoch is required; an old home lock is not an epoch.')
    if (!options.archive || !isAbsolute(options.archive.target)) throw new CoreError('SWITCHOVER_INPUT', 'An absolute published archive target is required.')
    this.validateEntry(options.entry)
    this.validateOldHome(options.oldHome)
    const settleMs = options.settleMs ?? 1_000
    if (!boundedInteger(settleMs) || settleMs > 60_000) throw new CoreError('SWITCHOVER_INPUT', 'The settle window is between 0 and 60000 ms.')
    const entryWaitMs = options.entryWaitMs ?? 5_000
    if (!boundedInteger(entryWaitMs) || entryWaitMs > 60_000) throw new CoreError('SWITCHOVER_INPUT', 'The entry wait is between 0 and 60000 ms.')
    const heartbeatMs = boundedInteger(options.heartbeatMs) && (options.heartbeatMs as number) >= 50 ? options.heartbeatMs as number : 2_000
    this.heartbeatMs = heartbeatMs
    return { settleMs, entryWaitMs }
  }

  private async assertCurrentEpoch(epoch: number) {
    const lease = await new HostLease(this.storage, this.instanceId).currentLease()
    if (!lease || lease.epoch !== epoch || lease.releasedAt !== undefined || lease.expiresAt <= this.now()) {
      throw new CoreError('SWITCHOVER_EPOCH_NOT_CURRENT', 'The switchover must use the current, unexpired Host epoch; an old home lock is not fencing.')
    }
  }

  private async stopLegacy(record: SwitchoverRecord, legacy: LegacyCore) {
    if (record.stop.confirmedAt) return record
    let next = await this.save({ ...record, stop: { ...record.stop, requestedAt: record.stop.requestedAt ?? this.now() }, updatedAt: this.now() })
    try {
      const stopped = await legacy.stop()
      const evidence = stopped && typeof stopped === 'object' ? stopped.evidence : undefined
      next = await this.save({ ...next, stop: { ...next.stop, confirmedAt: this.now(), ...(evidence ? { evidence } : {}) }, updatedAt: this.now() })
      return next
    } catch (error) {
      return this.setBlockers(next, [{ code: 'LEGACY_STOP_FAILED', message: `The old core was not stopped: ${errorMessage(error)}` }])
    }
  }

  private async disableLegacyRestart(record: SwitchoverRecord, legacy: LegacyCore) {
    if (record.restart.disabledAt) return record
    let next = await this.save({ ...record, restart: { ...record.restart, requestedAt: record.restart.requestedAt ?? this.now() }, updatedAt: this.now() })
    try {
      const disabled = await legacy.disableRestart()
      if (!disabled || typeof disabled.evidence !== 'string' || !disabled.evidence.trim()) throw new CoreError('RESTART_NOT_DISABLED', 'The old core did not prove its restart entry was disabled.')
      return this.save({ ...next, restart: { ...next.restart, disabledAt: this.now(), evidence: disabled.evidence, ...(disabled.entry ? { entry: disabled.entry } : {}) }, updatedAt: this.now() })
    } catch (error) {
      return this.setBlockers(next, [{ code: 'RESTART_NOT_DISABLED', message: `The old restart entry was not disabled: ${errorMessage(error)}` }])
    }
  }

  private async isolateEntry(record: SwitchoverRecord, entry: SwitchoverEntry, entryWaitMs: number) {
    if (this.server?.listening && this.isHolder(record)) return record
    if (this.server?.listening) {
      this.stopHeartbeat()
      return this.setBlockers(record, [{ code: 'ENTRY_HELD_BY_ANOTHER', message: 'This process no longer owns the isolated entry.' }])
    }
    const bound = await this.bind(entry.host, entry.port, entryWaitMs)
    if (!bound.ok) {
      return this.setBlockers(record, [{ code: bound.code === 'EADDRINUSE' ? 'ENTRY_STILL_HELD' : 'ENTRY_UNAVAILABLE',
        message: `The old intake entry could not be isolated (${bound.code}). A lock in the old home is not sufficient.` }])
    }
    this.server = bound.server
    this.startEntry(bound.server, record.batchId)
    const next = await this.save({ ...record, entry: { ...record.entry, isolated: true, heldAt: this.now(), holderPid: process.pid,
      holderStartedAt: this.startedAt, heartbeatAt: this.now(), heartbeatMs: this.heartbeatMs }, updatedAt: this.now() })
    this.startHeartbeat()
    return next
  }

  private async reconcileGapInputs(record: SwitchoverRecord, snapshot: LegacySnapshot): Promise<GapCounts> {
    return this.storage.transaction(this.instanceId, async tx => {
      const prefix = gapPrefix(this.instanceId, record.batchId)
      const items: SwitchoverGapInput[] = []
      let cursor = prefix
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await tx.scan<SwitchoverGapInput>('switchover-gap-input', { limit: 100, after: cursor })
        for (const item of page.items) {
          if (!item.id.startsWith(prefix)) break
          items.push(item.value)
        }
        if (!page.cursor || !page.cursor.startsWith(prefix)) break
        cursor = page.cursor
        if (pageCount === 9) throw new CoreError('SWITCHOVER_BUDGET', 'The gap-input reconciliation exceeded its declared 1000-record budget.')
      }
      const counts: GapCounts = { held: 0, legacyAccepted: 0, quarantined: 0, released: 0 }
      for (const input of items) {
        const next = reconcileGapInput(input, snapshot)
        if (next !== input) await tx.replace('switchover-gap-input', gapKey(this.instanceId, record.batchId, input.id), next)
        if (next.state === 'held') counts.held++
        else if (next.state === 'legacy-accepted') counts.legacyAccepted++
        else if (next.state === 'released') counts.released++
        else counts.quarantined++
      }
      return counts
    })
  }

  private async verify(record: SwitchoverRecord, legacy: LegacyCore, settleMs: number): Promise<SwitchoverRecord> {
    if (record.state === 'active') throw new CoreError('SWITCHOVER_ACTIVE', 'The active core entry is no longer a pending switchover.')
    const blockers: SwitchoverBlocker[] = []
    if (!record.stop.confirmedAt) blockers.push({ code: 'LEGACY_NOT_STOPPED', message: 'The old core stop has not been confirmed.' })
    if (!record.restart.disabledAt) blockers.push({ code: 'RESTART_NOT_DISABLED', message: 'The old restart entry has not been persistently disabled.' })
    else {
      try {
        if (!await legacy.restartDisabled()) blockers.push({ code: 'RESTART_NOT_DISABLED', message: 'The old restart entry is reachable again.' })
      } catch (error) {
        blockers.push({ code: 'RESTART_CHECK_FAILED', message: `The old restart entry could not be checked: ${errorMessage(error)}` })
      }
    }
    const entryHeld = this.isolationFresh(record) || (record.entry.isolated && !this.isHolder(record) && await this.entryReachable(record.entry))
    if (!entryHeld) blockers.push({ code: 'ENTRY_NOT_HELD', message: 'This process does not currently hold the isolated intake entry.' })
    const archive = getLegacyArchive(record.archive.target, record.archive.batchId)
    if (!archive || archive.status !== 'published') blockers.push({ code: 'ARCHIVE_NOT_PUBLISHED', message: 'The read-only archive batch is not currently published.' })
    else if (archive.source.digest !== record.archive.sourceDigest || archive.mappingDigest !== record.archive.mappingDigest) {
      blockers.push({ code: 'ARCHIVE_CHANGED', message: 'The archive facts no longer match the prepared batch.' })
    }
    let first: SwitchoverCheckpoint | undefined
    let second: SwitchoverCheckpoint | undefined
    let firstSnapshot: LegacySnapshot | undefined
    let gap = record.gap
    try {
      firstSnapshot = normalizeSnapshot(await legacy.snapshot())
      if (settleMs > 0) await delay(settleMs)
      const secondSnapshot = normalizeSnapshot(await legacy.snapshot())
      gap = await this.reconcileGapInputs(record, secondSnapshot)
      first = checkpoint(firstSnapshot, this.isolationFresh(record))
      second = checkpoint(secondSnapshot, this.isolationFresh(record))
      for (const blocker of snapshotBlockers(secondSnapshot)) if (!blockers.some(blockerSame => blockerSame.code === blocker.code)) blockers.push(blocker)
      if (first.digest !== second.digest) blockers.push({ code: 'SNAPSHOT_CHANGED', message: 'The old core facts changed during the settle window.' })
      if (firstSnapshot.stateRevision !== undefined && record.archive.stateRevision !== undefined && firstSnapshot.stateRevision !== record.archive.stateRevision) {
        blockers.push({ code: 'SOURCE_CHANGED', message: `The old source revision changed from ${String(record.archive.stateRevision)} to ${String(firstSnapshot.stateRevision)}.` })
      }
    } catch (error) {
      blockers.push({ code: 'SNAPSHOT_FAILED', message: `The old core snapshot could not be read: ${errorMessage(error)}` })
    }
    const checkpoints = [...record.checkpoints, ...(first ? [first] : []), ...(second ? [second] : [])].slice(-6)
    const clean = blockers.length === 0
    const next: SwitchoverRecord = { ...record, state: clean ? 'quiesced' : 'quiescing', checkpoints, gap, blockers: unique(blockers),
      ...(clean ? { quiescedAt: record.quiescedAt ?? this.now() } : {}), updatedAt: this.now() }
    if (!clean) delete next.quiescedAt
    return this.save(next)
  }

  private async bind(host: string, port: number, waitMs: number) {
    const deadline = this.now() + waitMs
    for (;;) {
      const result = await new Promise<{ ok: true; server: Server } | { ok: false; code: string }>(resolveBind => {
        const server = createServer()
        const failed = (error: NodeJS.ErrnoException) => { server.close(); resolveBind({ ok: false, code: error.code ?? 'ENTRY_UNAVAILABLE' }) }
        server.once('error', failed)
        server.listen({ host, port, exclusive: true }, () => {
          server.off('error', failed)
          resolveBind({ ok: true, server })
        })
      })
      if (result.ok || this.now() >= deadline) return result
      await delay(50)
    }
  }

  private startEntry(server: Server, batch: string) {
    server.on('connection', (socket: Socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      this.connection(socket, batch)
    })
  }

  private connection(socket: Socket, batch: string) {
    let buffer = ''
    let chain = Promise.resolve()
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > maxLineBytes) {
        socket.end(`${JSON.stringify({ ok: false, durable: false, error: { code: 'GAP_INPUT_TOO_LARGE', message: 'The gap input exceeds its 131072-byte budget.' } })}\n`)
        buffer = ''
        return
      }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) {
          chain = chain.then(async () => {
            try {
              const result = await this.ingestGapInput(batch, line)
              socket.write(`${JSON.stringify({ ok: true, durable: true, id: result.id, state: result.state })}\n`)
            } catch (error) {
              socket.write(`${JSON.stringify({ ok: false, durable: false, error: { code: errorCode(error), message: errorMessage(error) } })}\n`)
            }
          })
        }
        newline = buffer.indexOf('\n')
      }
    })
    socket.on('error', () => {})
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => { void this.beat() }, this.heartbeatMs)
    this.heartbeat.unref()
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
  }

  private async beat() {
    try {
      const prefix = `${JSON.stringify(['switchover', this.instanceId]).slice(0, -1)},`
      const records = await this.storage.transaction(this.instanceId, tx => tx.scan<SwitchoverRecord>('switchover', { limit: 100, after: prefix }))
      for (const item of records.items) {
        if (!item.id.startsWith(prefix)) break
        if (item.value.entry.holderPid !== process.pid || item.value.entry.holderStartedAt !== this.startedAt || !item.value.entry.isolated) continue
        await this.save({ ...item.value, entry: { ...item.value.entry, heartbeatAt: this.now() } })
      }
    } catch { /* A failed heartbeat is visible as stale isolation; it must not turn into an unbounded retry loop. */ }
  }

  private async save(record: SwitchoverRecord) {
    const next = { ...record, updatedAt: this.now() }
    await this.storage.transaction(this.instanceId, async tx => {
      if (!await tx.replace('switchover', next.id, next)) await tx.insert('switchover', next.id, next)
    })
    return next
  }

  private async setBlockers(record: SwitchoverRecord, blockers: SwitchoverBlocker[]) {
    return this.save({ ...record, state: 'quiescing', blockers: unique(blockers), updatedAt: this.now() })
  }

  private async saveGap(input: SwitchoverGapInput) {
    await this.storage.transaction(this.instanceId, async tx => {
      if (!await tx.replace('switchover-gap-input', gapKey(this.instanceId, input.batchId, input.id), input)) {
        await tx.insert('switchover-gap-input', gapKey(this.instanceId, input.batchId, input.id), input)
      }
    })
  }

  private async countIn(tx: AsyncTx, batch: string) {
    const prefix = gapPrefix(this.instanceId, batch)
    let cursor = prefix
    const buffer = { held: 0, legacyAccepted: 0, quarantined: 0, released: 0 }
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<SwitchoverGapInput>('switchover-gap-input', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(prefix)) return buffer
        if (item.value.state === 'held') buffer.held++
        else if (item.value.state === 'legacy-accepted') buffer.legacyAccepted++
        else if (item.value.state === 'released') buffer.released++
        else buffer.quarantined++
      }
      if (!page.cursor || !page.cursor.startsWith(prefix)) return buffer
      cursor = page.cursor
    }
    throw new CoreError('SWITCHOVER_BUDGET', 'The gap-input count exceeded its declared 1000-record budget.')
  }

  private load(tx: AsyncTx, batch: string) {
    return tx.get<SwitchoverRecord>('switchover', switchoverPrefix(this.instanceId, batch))
  }

  private publishedArchive(target: string, batch: string) {
    const manifest = getLegacyArchive(target, batch)
    if (!manifest) throw new CoreError('SWITCHOVER_ARCHIVE_MISSING', 'The read-only archive batch does not exist.')
    if (manifest.status !== 'published') throw new CoreError('SWITCHOVER_ARCHIVE_UNPUBLISHED', 'The read-only archive batch is not published.')
    return manifest
  }

  private archiveFact(target: string, batch: string, manifest: NonNullable<ReturnType<typeof getLegacyArchive>>): SwitchoverArchiveFact {
    return { target: resolve(target), batchId: batch, sourceDigest: manifest.source.digest, mappingDigest: manifest.mappingDigest,
      ...(manifest.source.stateRevision === undefined ? {} : { stateRevision: manifest.source.stateRevision }),
      ...(manifest.publishedAt === undefined ? {} : { publishedAt: manifest.publishedAt }),
      review: manifest.review.slice(0, maxReviewItems).map(item => ({ id: item.id, kind: item.kind, reason: item.reason, state: item.state })) }
  }

  private oldHomeFact(oldHome: string | undefined): { oldHome?: SwitchoverOldHomeFact } {
    if (!oldHome) return {}
    const path = resolve(oldHome)
    const candidates = ['bot/state.lock', 'state.lock', '.lock'].map(candidate => join(path, candidate))
    const lockPath = candidates.find(candidate => existsSync(candidate))
    return { oldHome: { path, ...(lockPath ? { lockPath } : {}), lockExists: lockPath !== undefined, usedAsFence: false } }
  }

  private validateOldHome(oldHome: string | undefined) {
    if (oldHome === undefined) return
    if (!isAbsolute(oldHome)) throw new CoreError('SWITCHOVER_INPUT', 'The old home path must be absolute.')
  }

  private validateEntry(entry: SwitchoverEntry | undefined) {
    if (!entry || typeof entry !== 'object') throw new CoreError('SWITCHOVER_INPUT', 'A legacy intake entry is required.')
    if (!['127.0.0.1', '::1', 'localhost'].includes(entry.host)) throw new CoreError('SWITCHOVER_ENTRY_LOCAL_ONLY', 'The gap intake entry must bind to loopback only.')
    if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65_535) throw new CoreError('SWITCHOVER_INPUT', 'A legacy entry port is between 1 and 65535.')
  }

  private assertCompatible(record: SwitchoverRecord, options: SwitchoverOptions, archive: SwitchoverArchiveFact) {
    if (record.newEpoch !== options.newEpoch || record.archive.sourceDigest !== archive.sourceDigest || record.archive.mappingDigest !== archive.mappingDigest
      || record.entry.host !== options.entry.host || record.entry.port !== options.entry.port
      || (options.oldHome !== undefined && record.oldHome?.path !== resolve(options.oldHome))) {
      throw new CoreError('SWITCHOVER_CONFLICT', 'This batch was prepared with a different epoch, archive, entry or old home.')
    }
  }

  private isHolder(record: SwitchoverRecord) {
    return record.entry.holderPid === process.pid && record.entry.holderStartedAt === this.startedAt && record.entry.isolated
  }

  private isolationFresh(record: SwitchoverRecord) {
    if (!record.entry.isolated) return false
    if (this.isHolder(record)) return Boolean(this.server?.listening)
    const heartbeat = record.entry.heartbeatAt ?? record.entry.heldAt
    return heartbeat !== undefined && this.now() - heartbeat <= (record.entry.heartbeatMs ?? this.heartbeatMs) * 3
  }

  private isolation(record: SwitchoverRecord): SwitchoverView['isolation'] {
    if (this.isHolder(record) && this.server?.listening) return 'held-by-this-process'
    if (!record.entry.isolated) return 'released'
    return this.isolationFresh(record) ? 'held-elsewhere' : 'released'
  }

  private entryReachable(entry: SwitchoverEntry) {
    return new Promise<boolean>(resolveProbe => {
      const socket = createConnection({ host: entry.host, port: entry.port })
      let settled = false
      const finish = (reachable: boolean) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolveProbe(reachable)
      }
      socket.setTimeout(250, () => finish(false))
      socket.on('connect', () => finish(true))
      socket.on('error', () => finish(false))
    })
  }
}
