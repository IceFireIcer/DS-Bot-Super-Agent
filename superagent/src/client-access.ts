import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { commandTransaction, canonicalJson } from './commands.js'
import { CoreError, identifier } from './model.js'
import type { Storage } from './storage.js'
import type { Engine } from './engine.js'

export type ClientCapability = 'read' | 'command'
export interface ClientGrant { instanceId: string; capabilities: ClientCapability[] }
export interface ClientIdentity {
  id: string
  label: string
  grants: ClientGrant[]
  createdAt: number
  revokedAt?: number
  revokedReason?: string
}
export interface ClientEnrollment { client: ClientIdentity; token?: string }
export interface ClientEvent {
  seq: number
  key: string
  kind: 'receipt' | 'state' | 'attention' | 'result'
  ticketId?: string
  at: number
  data: unknown
}
export interface ClientEventPage { items: ClientEvent[]; cursor: string; hasMore: boolean }
export interface ClientEventInput { key: string; kind: ClientEvent['kind']; ticketId?: string; data: unknown }

interface ClientRecord extends ClientIdentity { tokenHash: string }
interface ClientCommandOutcome { fingerprint: string; client: ClientIdentity }
interface JournalHead { seq: number; at: number }
interface SupervisionReport { id: string; result: string; evidence: string }
interface SupervisionAttention {
  id: string
  status: string
  question: string
  options: string[]
  answerText?: string
  createdAt?: number
  answeredAt?: number
}
interface SupervisionItem {
  ticketId: string
  bucket: string
  state: string
  reason?: string
  lifecycle: string
  nextAction: string
  attention?: SupervisionAttention
  attentionHistory?: SupervisionAttention[]
  reports?: SupervisionReport[]
  reportHistory?: SupervisionReport[]
}

const capabilities: ClientCapability[] = ['read', 'command']
const credentialPattern = /^sc1\.([A-Za-z0-9-]{8,64})\.([A-Za-z0-9_-]{32,128})$/u
const sequenceDigits = 12

function digest(value: string) { return createHash('sha256').update(value).digest() }
function sequenceId(seq: number) { return String(seq).padStart(sequenceDigits, '0') }

function normalizeGrants(value: unknown): ClientGrant[] {
  if (!Array.isArray(value) || value.length !== 1) throw new CoreError('INVALID_INPUT', 'A client needs exactly one explicit Instance grant.')
  const seen = new Set<string>()
  return value.map(grant => {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)
      || Object.keys(grant).some(key => !['instanceId', 'capabilities'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'A client grant accepts instanceId and capabilities only.')
    }
    const { instanceId, capabilities: requested } = grant as { instanceId: unknown; capabilities: unknown }
    identifier(instanceId, 'instanceId')
    if (seen.has(instanceId)) throw new CoreError('INVALID_INPUT', 'A client cannot repeat an Instance grant.')
    seen.add(instanceId)
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > capabilities.length
      || requested.some(capability => !capabilities.includes(capability)) || new Set(requested).size !== requested.length) {
      throw new CoreError('INVALID_INPUT', 'A client grant needs distinct read and/or command capabilities.')
    }
    return { instanceId, capabilities: capabilities.filter(capability => requested.includes(capability)) }
  }).sort((left, right) => left.instanceId.localeCompare(right.instanceId))
}

function identity(record: ClientRecord): ClientIdentity {
  return { id: record.id, label: record.label, grants: record.grants, createdAt: record.createdAt,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
    ...(record.revokedReason === undefined ? {} : { revokedReason: record.revokedReason }) }
}

function cursorValue(after: string | undefined) {
  if (after === undefined || after === '') return undefined
  if (!/^\d{1,12}$/u.test(after)) throw new CoreError('INVALID_INPUT', 'A client event cursor is a nonnegative sequence number.')
  return sequenceId(Number(after))
}

export class ClientAccess {
  private engineOwner: Engine | undefined

  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    private readonly now: () => number = Date.now,
  ) { identifier(instanceId, 'instanceId') }

  static forEngine(engine: Engine, storage: Storage, instanceId: string, now: () => number = Date.now) {
    const access = new ClientAccess(storage, instanceId, now)
    access.engineOwner = engine
    return access
  }

  getInstanceId() { return this.instanceId }

  assertEngine(engine: Engine) {
    if (this.engineOwner !== engine) throw new CoreError('INVALID_CONFIG', 'Client access must be created by the serving Engine.')
  }

  /** Issues a client credential once. Repeating the command returns the same client without the secret. */
  async enroll(command: { commandId: string; label: string; grants: ClientGrant[] }): Promise<ClientEnrollment> {
    if (!command || typeof command !== 'object' || Array.isArray(command)
      || Object.keys(command).some(key => !['commandId', 'label', 'grants'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'Enrolling a client accepts commandId, label and grants only.')
    }
    identifier(command.commandId, 'commandId')
    if (typeof command.label !== 'string' || Buffer.byteLength(command.label.trim()) > 128 || !command.label.trim()) {
      throw new CoreError('INVALID_INPUT', 'A client label must contain 1 to 128 bytes.')
    }
    const grants = normalizeGrants(command.grants)
    if (grants.some(grant => grant.instanceId !== this.instanceId)) {
      throw new CoreError('INVALID_INPUT', 'A client grant must target the serving Instance.')
    }
    const label = command.label.trim()
    const fingerprint = digest(canonicalJson([label, grants])).toString('hex')
    return commandTransaction(this.storage, this.instanceId, async transaction => {
      const key = `enroll:${command.commandId}`
      const previous = await transaction.get<ClientCommandOutcome>('client-command', key)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The client enrollment ID was already used with different input.')
        const current = await transaction.get<ClientRecord>('client', previous.client.id)
        return { client: current ? identity(current) : previous.client }
      }
      const id = randomUUID()
      const secret = randomBytes(32).toString('base64url')
      const record: ClientRecord = { id, label, grants, createdAt: this.now(), tokenHash: digest(secret).toString('hex') }
      await transaction.insert('client', id, record)
      const client = identity(record)
      await transaction.insert('client-command', key, { fingerprint, client })
      return { client, token: `sc1.${id}.${secret}` }
    })
  }

  /** Reads the credential on every request so a revocation takes effect without a reconnect. */
  async authenticate(token: string): Promise<ClientIdentity> {
    const parsed = typeof token === 'string' ? credentialPattern.exec(token) : null
    if (!parsed) throw new CoreError('CLIENT_UNAUTHORIZED', 'The client credential is not valid.')
    const record = await this.storage.transaction(this.instanceId, transaction => transaction.get<ClientRecord>('client', parsed[1]!))
    const expected = record ? Buffer.from(record.tokenHash, 'hex') : undefined
    const actual = digest(parsed[2]!)
    if (!expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new CoreError('CLIENT_UNAUTHORIZED', 'The client credential is not valid.')
    }
    if (record!.revokedAt !== undefined) throw new CoreError('CLIENT_REVOKED', 'This client credential was revoked.')
    return identity(record!)
  }

  async authorize(token: string, instanceId: string, capability: ClientCapability): Promise<ClientIdentity> {
    identifier(instanceId, 'instanceId')
    if (!capabilities.includes(capability)) throw new CoreError('INVALID_INPUT', 'Unknown client capability.')
    const client = await this.authenticate(token)
    const grant = client.grants.find(candidate => candidate.instanceId === instanceId)
    if (!grant || !grant.capabilities.includes(capability)) {
      throw new CoreError('INSTANCE_NOT_AUTHORIZED', 'This client is not authorized for the requested Instance and capability.')
    }
    return client
  }

  async revoke(command: { commandId: string; clientId: string; reason: string }): Promise<ClientIdentity> {
    if (!command || typeof command !== 'object' || Array.isArray(command)
      || Object.keys(command).some(key => !['commandId', 'clientId', 'reason'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'Revoking a client accepts commandId, clientId and reason only.')
    }
    identifier(command.commandId, 'commandId'); identifier(command.clientId, 'clientId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 1024) {
      throw new CoreError('INVALID_INPUT', 'A revocation reason must contain 1 to 1024 bytes.')
    }
    const reason = command.reason.trim()
    const fingerprint = digest(canonicalJson([command.clientId, reason])).toString('hex')
    return commandTransaction(this.storage, this.instanceId, async transaction => {
      const key = `revoke:${command.commandId}`
      const previous = await transaction.get<ClientCommandOutcome>('client-command', key)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The revocation ID was already used with different input.')
        return previous.client
      }
      const record = await transaction.get<ClientRecord>('client', command.clientId)
      if (!record) throw new CoreError('NOT_FOUND', 'The client does not exist.')
      const revoked = record.revokedAt === undefined
        ? { ...record, revokedAt: this.now(), revokedReason: reason }
        : record
      if (revoked !== record) await transaction.replace('client', command.clientId, revoked)
      const client = identity(revoked)
      await transaction.insert('client-command', key, { fingerprint, client })
      return client
    })
  }

  list(): Promise<ClientIdentity[]> {
    return this.storage.transaction(this.instanceId, async transaction =>
      (await transaction.list<ClientRecord>('client', 100)).map(identity))
  }

  /** The latest committed cursor. A fresh client reads this before subscribing. */
  async cursor(): Promise<string> {
    const head = await this.storage.transaction(this.instanceId, transaction => transaction.get<JournalHead>('client-journal', 'head'))
    return String(head?.seq ?? 0)
  }

  async readEvents(after?: string, limit = 100): Promise<ClientEventPage> {
    const cursor = cursorValue(after)
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new CoreError('INVALID_INPUT', 'The client event page must be between 1 and 500 items.')
    return this.storage.transaction(this.instanceId, async transaction => {
      const page = await transaction.scan<ClientEvent>('client-event', { limit, ...(cursor ? { after: cursor } : {}) })
      const items = page.items.map(item => item.value)
      return { items, cursor: String(items.at(-1)?.seq ?? (cursor ? Number(cursor) : 0)), hasMore: page.cursor !== undefined }
    })
  }

  /** Appends only facts that are new for their stable key, so reconnecting clients see each transition once. */
  async record(entries: ClientEventInput[]): Promise<string> {
    if (!Array.isArray(entries) || entries.length > 1000) throw new CoreError('INVALID_INPUT', 'Client events must be a bounded list.')
    if (!entries.length) return this.cursor()
    return this.storage.transaction(this.instanceId, transaction => this.append(transaction, entries))
  }

  recordReceipt(commandId: string, receipt: unknown, clientId: string): Promise<string> {
    const ticketId = this.ticketOf(receipt)
    return this.record([{ key: `receipt:${digest(commandId).toString('hex')}`, kind: 'receipt',
      ...(ticketId ? { ticketId } : {}), data: { commandId, receipt, clientId } }])
  }

  /** Projects supervision changes into the journal; the journal itself stays the durable cursor source. */
  async reconcile(engine: Engine): Promise<void> {
    const supervision = await engine.getSupervision({ includeHistory: true })
    const entries: ClientEventInput[] = []
    for (const item of supervision.items as unknown as SupervisionItem[]) {
      const state = { ticketId: item.ticketId, bucket: item.bucket, state: item.state,
        ...(item.reason === undefined ? {} : { reason: item.reason }), lifecycle: item.lifecycle, nextAction: item.nextAction }
      entries.push({ key: `state:${digest(canonicalJson(state)).toString('hex')}`, kind: 'state', ticketId: item.ticketId, data: state })
      const attentions = item.attentionHistory?.length ? item.attentionHistory : item.attention ? [item.attention] : []
      for (const current of attentions) {
        const attention = { id: current.id, status: current.status, question: current.question,
          options: current.options, ...(current.answerText === undefined ? {} : { answerText: current.answerText }),
          ...(current.createdAt === undefined ? {} : { createdAt: current.createdAt }),
          ...(current.answeredAt === undefined ? {} : { answeredAt: current.answeredAt }) }
        entries.push({ key: `attention:${digest(canonicalJson(attention)).toString('hex')}`, kind: 'attention',
          ticketId: item.ticketId, data: attention })
      }
      const reports = item.reportHistory?.length ? item.reportHistory : item.reports ?? []
      for (const report of reports) {
        entries.push({ key: `result:${digest(canonicalJson([item.ticketId, report.id, report.result, report.evidence])).toString('hex')}`,
          kind: 'result', ticketId: item.ticketId, data: report })
      }
    }
    for (let start = 0; start < entries.length; start += 1000) await this.record(entries.slice(start, start + 1000))
  }

  private async append(transaction: import('./storage.js').AsyncTx, entries: ClientEventInput[]) {
    const head = await transaction.get<JournalHead>('client-journal', 'head')
    let seq = head?.seq ?? 0
    let added = 0
    for (const entry of entries) {
      if (typeof entry.key !== 'string' || !entry.key || Buffer.byteLength(entry.key) > 512) throw new CoreError('INVALID_INPUT', 'A client event key must be a bounded nonempty string.')
      if (!['receipt', 'state', 'attention', 'result'].includes(entry.kind)) throw new CoreError('INVALID_INPUT', 'Unknown client event kind.')
      if (await transaction.get('client-event-key', entry.key)) continue
      seq += 1
      await transaction.insert<ClientEvent>('client-event', sequenceId(seq), { seq, key: entry.key, kind: entry.kind,
        ...(entry.ticketId ? { ticketId: entry.ticketId } : {}), at: this.now(), data: entry.data })
      await transaction.insert('client-event-key', entry.key, { seq })
      added += 1
    }
    if (added) {
      const record: JournalHead = { seq, at: this.now() }
      if (!await transaction.replace('client-journal', 'head', record)) await transaction.insert('client-journal', 'head', record)
    }
    return String(seq)
  }

  private ticketOf(value: unknown) {
    return value && typeof value === 'object' && typeof (value as { ticketId?: unknown }).ticketId === 'string'
      ? (value as { ticketId: string }).ticketId : undefined
  }
}
