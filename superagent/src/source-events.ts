import { createHash } from 'node:crypto'
import { canonicalJson, commandTransaction } from './commands.js'
import { CoreError, identifier, type DesktopSource, type IntakeAddressing, type IntakeActorKind, type Source } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export interface SourceObjectRef { threadId: string; objectId: string }
export interface AcceptSourceRequest extends SourceObjectRef { commandId: string; expectedEventId: string }
export interface ReceiveSourceEvent extends SourceObjectRef {
  commandId: string
  type: 'created' | 'edited' | 'deleted'
  version: string
  text?: string
  deletionEvidence?: string
  authorId?: string
  authorKind?: IntakeActorKind
  addressing?: IntakeAddressing
}
export interface SourceEvent extends SourceObjectRef {
  id: string
  instanceId: string
  source: Source
  type: ReceiveSourceEvent['type']
  version: { order: 'sequence' | 'opaque'; value: string }
  text?: string
  deletionEvidence?: string
  authorId: string
  authorKind: IntakeActorKind
  addressing: IntakeAddressing
}
export interface SourceProjection extends SourceObjectRef {
  id: string
  instanceId: string
  source: Source
  state: 'current' | 'conflict' | 'unknown' | 'deleted'
  eventId: string
  version: SourceEvent['version']
  text?: string
}
export interface SourceReceipt { status: 'recorded' | 'filtered'; eventId?: string; reason?: string }
interface Reception { fingerprint: string; receipt: SourceReceipt }

export class SourceEvents {
  readonly sourceInstanceId: string
  readonly actorId: string
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly binding: DesktopSource) {
    this.sourceInstanceId = binding.sourceInstanceId
    this.actorId = binding.actorId
    if (binding.allowedThreadIds !== undefined) {
      if (!Array.isArray(binding.allowedThreadIds) || binding.allowedThreadIds.length > 100) throw new CoreError('INVALID_CONFIG', 'Configure at most 100 native thread scopes.')
      for (const thread of binding.allowedThreadIds) identifier(thread, 'allowedThreadId')
    }
    if (binding.versionOrder !== undefined && !['sequence', 'opaque'].includes(binding.versionOrder)) throw new CoreError('INVALID_CONFIG', 'Unsupported native version ordering.')
  }

  private source(): Source { return { kind: 'desktop', sourceInstanceId: this.binding.sourceInstanceId, actorId: this.binding.actorId } }
  private modeKey() { return JSON.stringify(['desktop', this.binding.sourceInstanceId]) }

  async requireDirectMode(tx: AsyncTx) {
    const mode = await tx.get<{ mode: string }>('source-mode', this.modeKey())
    if (mode?.mode === 'versioned') throw new CoreError('UNSUPPORTED_CAPABILITY', 'This source identity uses versioned intake; legacy submit cannot bypass its native facts.')
    if (!mode) await tx.insert('source-mode', this.modeKey(), { mode: 'direct' })
  }

  private key(ref: SourceObjectRef) {
    identifier(ref?.threadId, 'threadId'); identifier(ref?.objectId, 'objectId')
    return JSON.stringify([this.instanceId, 'desktop', this.binding.sourceInstanceId, ref.threadId, ref.objectId])
  }

  private authorize(ref: SourceObjectRef) {
    if (!this.binding.allowedActorIds.includes(this.binding.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The receiving actor is not authorized by this source instance.')
    if (!this.binding.allowedThreadIds?.includes(ref.threadId)) throw new CoreError('SOURCE_SCOPE_DENIED', 'This native thread is outside the configured reception scope.')
  }

  authorizeThread(threadId: string) { this.authorize({ threadId, objectId: '__thread-scope-query__' }) }

  async receive(input: ReceiveSourceEvent): Promise<SourceReceipt> {
    identifier(input?.commandId, 'commandId')
    input = structuredClone({ ...input, authorId: input.authorId ?? this.binding.actorId, authorKind: input.authorKind ?? 'human', addressing: input.addressing ?? 'direct' })
    const authorId = input.authorId!
    const authorKind = input.authorKind!
    const addressing = input.addressing!
    const fingerprint = createHash('sha256').update(canonicalJson([this.source(), input, this.binding.versionOrder ?? 'opaque'])).digest('hex')
    const commandKey = JSON.stringify([this.binding.sourceInstanceId, this.binding.actorId, input.commandId])
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<Reception>('source-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This receiving command was already used with different input.')
        return existing.receipt
      }
      let reason: string | undefined
      try {
        if (Object.keys(input).some(key => !['commandId', 'threadId', 'objectId', 'type', 'version', 'text', 'deletionEvidence', 'authorId', 'authorKind', 'addressing'].includes(key))) throw new CoreError('INVALID_INPUT', 'Source identity comes from the receiving adapter.')
        this.key(input)
        this.authorize(input)
        identifier(input.version, 'nativeVersion')
        identifier(authorId, 'authorId')
        if (!['human', 'bot', 'ci', 'system'].includes(authorKind) || !['direct', 'mention', 'ambient'].includes(addressing)) throw new CoreError('INVALID_INPUT', 'Unsupported source actor or addressing kind.')
        if (!['created', 'edited', 'deleted'].includes(input.type)) throw new CoreError('INVALID_INPUT', 'Unsupported native event type.')
        if (this.binding.versionOrder === 'sequence' && !/^(?:0|[1-9][0-9]{0,39})$/u.test(input.version)) throw new CoreError('INVALID_INPUT', 'A native sequence must be a canonical unsigned integer of at most 40 digits.')
        if (input.type === 'deleted') {
          if (input.text !== undefined || typeof input.deletionEvidence !== 'string' || !input.deletionEvidence.trim() || Buffer.byteLength(input.deletionEvidence) > 2048) throw new CoreError('DELETE_UNVERIFIED', 'A delete requires bounded native deletion evidence and no message body.')
        } else if (typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text) > 65536 || input.deletionEvidence !== undefined) throw new CoreError('INVALID_INPUT', 'A create or edit needs bounded text and no deletion evidence.')
      } catch (error) {
        if (!(error instanceof CoreError)) throw error
        reason = error.code
      }
      let receipt: SourceReceipt
      if (!reason) {
        const mode = await tx.get<{ mode: string }>('source-mode', this.modeKey())
        const prefix = `${JSON.stringify([this.instanceId, 'desktop', this.binding.sourceInstanceId]).slice(0, -1)},`
        const prior = mode ? undefined : await tx.scan('trigger', { limit: 1, after: prefix })
        const legacy = prior?.items[0]?.id.startsWith(prefix) ?? false
        if (mode?.mode === 'direct' || legacy) {
          if (!mode) await tx.insert('source-mode', this.modeKey(), { mode: 'direct' })
          reason = 'SOURCE_MODE_CONFLICT'
        } else if (!mode) await tx.insert('source-mode', this.modeKey(), { mode: 'versioned' })
      }
      if (reason) receipt = { status: 'filtered', reason }
      else {
        const objectKey = this.key(input)
        const fact = { instanceId: this.instanceId, source: this.source(), threadId: input.threadId, objectId: input.objectId, type: input.type, authorId, authorKind, addressing,
          version: { order: this.binding.versionOrder ?? 'opaque', value: input.version },
          ...(input.text !== undefined ? { text: input.text } : {}), ...(input.deletionEvidence !== undefined ? { deletionEvidence: input.deletionEvidence } : {}) }
        const eventId = `${objectKey}:${createHash('sha256').update(canonicalJson(fact)).digest('hex')}`
        const event: SourceEvent = { id: eventId, ...fact }
        if (!await tx.get('source-event', eventId)) {
          await tx.insert('source-event', eventId, event)
          const current = await tx.get<SourceProjection>('source-object', objectKey)
          const projection = await this.project(tx, objectKey, current, event)
          if (current) await tx.replace('source-object', objectKey, projection)
          else await tx.insert('source-object', objectKey, projection)
        }
        receipt = { status: 'recorded', eventId }
      }
      await tx.insert('source-command', commandKey, { fingerprint, receipt })
      return receipt
    })
  }

  private async project(tx: AsyncTx, objectKey: string, current: SourceProjection | undefined, event: SourceEvent): Promise<SourceProjection> {
    if (current?.state === 'deleted') return current
    if (event.type === 'deleted') return { id: objectKey, instanceId: this.instanceId, source: event.source, threadId: event.threadId, objectId: event.objectId,
      state: 'deleted', eventId: event.id, version: event.version }
    if (current) {
      if (current.state === 'unknown' || current.version.order !== event.version.order || current.version.order === 'opaque' && current.version.value !== event.version.value) {
        const { text: _text, ...withoutText } = current
        return { ...withoutText, state: 'unknown' }
      }
      if (current.version.order === 'sequence' && BigInt(current.version.value) > BigInt(event.version.value)) return current
      if (current.version.value === event.version.value) {
        const original = await tx.get<SourceEvent>('source-event', current.eventId)
        if (!original) throw new CoreError('INCOMPLETE_STATE', 'The current projection is missing its immutable event.')
        if (current.state === 'conflict' || original.text !== event.text || original.type !== event.type || original.source.actorId !== event.source.actorId) {
          const { text: _text, ...withoutText } = current
          return { ...withoutText, state: 'conflict' }
        }
        return current
      }
    }
    return { id: objectKey, instanceId: this.instanceId, source: event.source, threadId: event.threadId, objectId: event.objectId,
      state: 'current', eventId: event.id, version: event.version, ...(event.text === undefined ? {} : { text: event.text }) }
  }

  get(ref: SourceObjectRef): Promise<SourceProjection | undefined> {
    const key = this.key(ref)
    this.authorize(ref)
    return this.storage.transaction(this.instanceId, tx => tx.get('source-object', key))
  }

  async candidate(tx: AsyncTx, ref: SourceObjectRef): Promise<SourceEvent | undefined> {
    const key = this.key(ref)
    this.authorize(ref)
    const projection = await tx.get<SourceProjection>('source-object', key)
    if (!projection || projection.state !== 'current') return undefined
    const event = await tx.get<SourceEvent>('source-event', projection.eventId)
    if (!event || event.type === 'deleted' || event.text === undefined) throw new CoreError('INCOMPLETE_STATE', 'The current source candidate is missing its immutable content.')
    return event
  }

  getCandidate(ref: SourceObjectRef) {
    ref = { ...ref }
    return this.storage.transaction(this.instanceId, tx => this.candidate(tx, ref))
  }

  history(ref: SourceObjectRef, options: { limit?: number; after?: string } = {}) {
    options = { ...options }
    const prefix = `${this.key(ref)}:`
    this.authorize(ref)
    const limit = options.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || options.after !== undefined && (!options.after.startsWith(prefix) || !/^[a-f0-9]{64}$/u.test(options.after.slice(prefix.length)))) throw new CoreError('INVALID_INPUT', 'Use a bounded history page and a cursor from this source object.')
    return this.storage.transaction(this.instanceId, async tx => {
      const page = await tx.scan<SourceEvent>('source-event', { limit: limit + 1, after: options.after ?? prefix })
      const matching = page.items.filter(item => item.id.startsWith(prefix))
      return { items: matching.slice(0, limit).map(item => item.value), ...(matching.length > limit ? { cursor: matching[limit - 1]!.id } : {}) }
    })
  }

  receipt(commandId: string) {
    identifier(commandId, 'commandId')
    return this.storage.transaction(this.instanceId, async tx => (await tx.get<Reception>('source-command', JSON.stringify([this.binding.sourceInstanceId, this.binding.actorId, commandId])))?.receipt)
  }
}
