import { CoreError, identifier, type Work } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { SourceEvent } from './source-events.js'
import type { SourceEvents } from './source-events.js'
import type { Attentions, Attention } from './attention.js'
import type { Deliveries, DeliveryView } from './deliveries.js'
import type { ReadyReport } from './execution.js'

export type ContextKind = 'ticket' | 'trigger' | 'decision' | 'mandate' | 'report' | 'attention' | 'delivery' | 'source-event' | 'source-thread'
export interface ContextRef {
  kind: ContextKind
  ticketId: string
  id?: string
  threadId?: string
  objectId?: string
}
export interface ContextCard {
  ticketId: string
  ref: ContextRef
  title: string
  summary: string
  text: string
  facts: Record<string, unknown>
  pagination: { cursor?: string; totalBytes: number; returnedBytes: number; truncated: boolean }
  next: ContextRef[]
}
export interface ContextRequest {
  ticketId: string
  ref: ContextRef
  after?: string
  maxBytes?: number
}

const maxBytesLimit = 16384
const defaultMaxBytes = 4096
const reportPrefix = (ticketId: string) => `${JSON.stringify(['report-history', ticketId])}:`
const subscriptionPrefix = (ticketId: string) => `${JSON.stringify(['ticket-thread-subscription', ticketId])}:`

function chunkText(text: string, after: string | undefined, maxBytes: number) {
  const totalBytes = Buffer.byteLength(text)
  const offset = after === undefined ? 0 : Number(after)
  if (!Number.isInteger(offset) || offset < 0 || offset > totalBytes) throw new CoreError('INVALID_INPUT', 'Use a byte cursor from this context card.')
  if (offset === totalBytes) return { text: '', totalBytes, returnedBytes: 0, truncated: false, cursor: undefined }
  let counted = 0
  let start = -1
  let startByte = 0
  let bytes = 0
  let end = text.length
  let index = 0
  for (const character of text) {
    const width = Buffer.byteLength(character)
    if (start < 0 && counted + width > offset) { start = index; startByte = counted }
    if (start >= 0) {
      if (bytes + width > maxBytes) { end = index; break }
      bytes += width
    }
    counted += width
    index += character.length
  }
  if (start < 0) return { text: '', totalBytes, returnedBytes: 0, truncated: false, cursor: undefined }
  const returned = text.slice(start, end)
  const cursor = startByte + bytes < totalBytes ? String(startByte + bytes) : undefined
  return { text: returned, totalBytes, returnedBytes: Buffer.byteLength(returned), truncated: cursor !== undefined, ...(cursor ? { cursor } : {}) }
}

function summary(text: string) {
  const compact = text.replace(/\s+/gu, ' ').trim()
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact
}

export class ContextReader {
  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    private readonly sourceEvents: SourceEvents,
    private readonly attentions: Attentions,
    private readonly deliveries: Deliveries,
  ) {}

  read(request: ContextRequest): Promise<ContextCard> {
    identifier(request.ticketId, 'ticketId')
    if (!request.ref || !['ticket', 'trigger', 'decision', 'mandate', 'report', 'attention', 'delivery', 'source-event', 'source-thread'].includes(request.ref.kind)) {
      throw new CoreError('INVALID_INPUT', 'Unknown context reference.')
    }
    const maxBytes = request.maxBytes ?? defaultMaxBytes
    if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > maxBytesLimit) throw new CoreError('INVALID_INPUT', 'Choose a context page between 256 and 16384 bytes.')
    return this.storage.transaction(this.instanceId, async tx => {
      const work = await this.readWork(tx, request.ticketId)
      if (!work) throw new CoreError('NOT_FOUND', 'The context Ticket does not exist.')
      const card = await this.resolve(tx, work, { ...request.ref, ticketId: request.ticketId })
      const chunk = chunkText(card.text, request.after, maxBytes)
      return { ticketId: request.ticketId, ref: card.ref, title: card.title, summary: summary(card.text), text: chunk.text,
        facts: card.facts, pagination: { ...(chunk.cursor ? { cursor: chunk.cursor } : {}), totalBytes: chunk.totalBytes,
          returnedBytes: chunk.returnedBytes, truncated: chunk.truncated }, next: card.next }
    })
  }

  private async readWork(tx: AsyncTx, ticketId: string): Promise<Work | undefined> {
    const ticket = await tx.get<Work['ticket']>('ticket', ticketId)
    if (!ticket) return undefined
    const trigger = await tx.get<Work['trigger']>('trigger', ticket.triggerId)
    const mandate = await tx.get<Work['mandate']>('mandate', ticket.mandateId)
    const decision = mandate && await tx.get<Work['decision']>('decision', mandate.decisionId)
    const intent = await tx.get<Work['intent']>('intent', ticketId)
    if (!trigger || !mandate || !decision || !intent) throw new CoreError('INCOMPLETE_STATE', 'The Ticket is missing required context facts.')
    return { trigger, mandate, decision, ticket, intent }
  }

  private async resolve(tx: AsyncTx, work: Work, ref: ContextRef): Promise<Omit<ContextCard, 'ticketId' | 'summary' | 'text' | 'pagination' | 'facts'> & { text: string; facts: Record<string, unknown> }> {
    if (ref.kind === 'ticket') {
      const text = JSON.stringify(work, null, 2)
      return { ref, title: 'Ticket authorization and current intent', text, facts: { state: work.ticket.state, reason: work.intent.reason },
        next: this.ticketNext(work) }
    }
    if (ref.kind === 'trigger') return this.triggerCard(tx, work, ref)
    if (ref.kind === 'decision') return { ref, title: 'Acceptance decision', text: JSON.stringify(work.decision, null, 2),
      facts: { outcome: work.decision.outcome, policyVersion: work.decision.policyVersion }, next: [{ kind: 'mandate', ticketId: work.ticket.id, id: work.mandate.id }, { kind: 'ticket', ticketId: work.ticket.id }] }
    if (ref.kind === 'mandate') return { ref, title: 'Work mandate', text: JSON.stringify(work.mandate, null, 2),
      facts: { strength: work.mandate.strength, environment: work.mandate.environment }, next: [{ kind: 'decision', ticketId: work.ticket.id, id: work.decision.id }, { kind: 'ticket', ticketId: work.ticket.id }] }
    if (ref.kind === 'report') return this.reportCard(tx, work, ref)
    if (ref.kind === 'attention') return this.attentionCard(tx, work, ref)
    if (ref.kind === 'delivery') return this.deliveryCard(tx, work, ref)
    if (ref.kind === 'source-event') return this.sourceEventCard(tx, work, ref)
    return this.sourceThreadCard(tx, work, ref)
  }

  private async triggerCard(tx: AsyncTx, work: Work, ref: ContextRef) {
    const sourceEvent = work.trigger.threadId ? await this.findSourceEvent(tx, work) : undefined
    return { ref: { ...ref, id: work.trigger.id }, title: 'Original request', text: work.trigger.text,
      facts: { source: work.trigger.source, eventId: work.trigger.eventId, ...(work.trigger.threadId ? { threadId: work.trigger.threadId } : {}),
        ...(work.trigger.nativeVersion ? { nativeVersion: work.trigger.nativeVersion } : {}) },
      next: [{ kind: 'ticket' as const, ticketId: work.ticket.id }, { kind: 'decision' as const, ticketId: work.ticket.id, id: work.decision.id },
        ...(sourceEvent ? [{ kind: 'source-event' as const, ticketId: work.ticket.id, id: sourceEvent.id }] : [])] }
  }

  private async reportCard(tx: AsyncTx, work: Work, ref: ContextRef) {
    let report = await tx.get<ReadyReport>('report', work.ticket.id)
    if (ref.id) report = await this.findReport(tx, work.ticket.id, ref.id)
    if (!report) throw new CoreError('NOT_FOUND', 'The ready report does not exist.')
    return { ref: { ...ref, id: report.id }, title: 'Ready report', text: `Result:\n${report.result}\n\nEvidence:\n${report.evidence}`,
      facts: { assignmentId: report.assignmentId, sessionId: report.sessionId, directionVersion: report.directionVersion, artifacts: report.artifacts, toolFacts: report.toolFacts },
      next: [{ kind: 'ticket' as const, ticketId: work.ticket.id }, { kind: 'trigger' as const, ticketId: work.ticket.id }] }
  }

  private async attentionCard(tx: AsyncTx, work: Work, ref: ContextRef) {
    const attention = ref.id ? await this.findAttention(tx, work.ticket.id, ref.id) : await this.attentions.current(tx, work.ticket.id)
    if (!attention) throw new CoreError('NOT_FOUND', 'The Attention does not exist.')
    return { ref: { ...ref, id: attention.id }, title: 'Human question', text: `${attention.question}\n\n${attention.options.map(option => `- ${option}`).join('\n')}`,
      facts: { status: attention.status, assignmentId: attention.assignmentId, destination: attention.destination, sequence: attention.sequence,
        ...(attention.answerText ? { answerText: attention.answerText } : {}) },
      next: [{ kind: 'ticket' as const, ticketId: work.ticket.id }, { kind: 'attention' as const, ticketId: work.ticket.id, id: attention.id }] }
  }

  private async deliveryCard(tx: AsyncTx, work: Work, ref: ContextRef) {
    if (!ref.id) throw new CoreError('INVALID_INPUT', 'A delivery card needs its delivery ID.')
    const delivery = await this.deliveries.get(tx, ref.id)
    if (!delivery || delivery.ticketId !== work.ticket.id) throw new CoreError('NOT_FOUND', 'The delivery does not belong to this Ticket.')
    const view: DeliveryView = await this.deliveries.view(tx, delivery)
    return { ref: { ...ref, id: delivery.id }, title: 'Outgoing message', text: delivery.text,
      facts: { purpose: delivery.purpose, state: view.state, destination: delivery.destination, basis: delivery.basis,
        ...(view.reason ? { reason: view.reason } : {}), ...(view.attempts === undefined ? {} : { attempts: view.attempts }) },
      next: [{ kind: 'ticket' as const, ticketId: work.ticket.id }] }
  }

  private async sourceEventCard(tx: AsyncTx, work: Work, ref: ContextRef) {
    if (!ref.id) throw new CoreError('INVALID_INPUT', 'A source event card needs its event ID.')
    const event = await tx.get<SourceEvent>('source-event', ref.id)
    if (!event) throw new CoreError('NOT_FOUND', 'The source event does not exist.')
    await this.authorizeThread(tx, work, event.threadId)
    return { ref: { ...ref, id: event.id, threadId: event.threadId, objectId: event.objectId }, title: 'Source event',
      text: event.text ?? '', facts: { type: event.type, version: event.version, authorId: event.authorId, authorKind: event.authorKind,
        addressing: event.addressing, ...(event.deletionEvidence ? { deletionEvidence: event.deletionEvidence } : {}) },
      next: [{ kind: 'source-thread' as const, ticketId: work.ticket.id, threadId: event.threadId, objectId: event.objectId },
        { kind: 'ticket' as const, ticketId: work.ticket.id }] }
  }

  private async sourceThreadCard(tx: AsyncTx, work: Work, ref: ContextRef) {
    if (!ref.threadId) throw new CoreError('INVALID_INPUT', 'A source thread card needs its thread ID.')
    await this.authorizeThread(tx, work, ref.threadId)
    const events = await this.threadEvents(tx, work, ref.threadId, ref.objectId)
    const text = events.map(event => `[${event.version.order}:${event.version.value}] ${event.authorKind}/${event.authorId}\n${event.text ?? ''}`).join('\n\n')
    return { ref: { ...ref, threadId: ref.threadId }, title: ref.objectId ? 'Source object history' : 'Thread history', text,
      facts: { threadId: ref.threadId, ...(ref.objectId ? { objectId: ref.objectId } : {}), events: events.map(event => ({ id: event.id, type: event.type,
        version: event.version, authorId: event.authorId, objectId: event.objectId })) },
      next: [{ kind: 'ticket' as const, ticketId: work.ticket.id }] }
  }

  private ticketNext(work: Work): ContextRef[] {
    return [{ kind: 'trigger', ticketId: work.ticket.id }, { kind: 'decision', ticketId: work.ticket.id, id: work.decision.id },
      { kind: 'mandate', ticketId: work.ticket.id, id: work.mandate.id }, { kind: 'report', ticketId: work.ticket.id },
      { kind: 'attention', ticketId: work.ticket.id }]
  }

  private async authorizeThread(tx: AsyncTx, work: Work, threadId: string) {
    if (work.trigger.threadId === threadId) return
    let cursor = subscriptionPrefix(work.ticket.id)
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<{ threadId: string }>('ticket-thread-subscription', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(subscriptionPrefix(work.ticket.id))) continue
        if (item.value.threadId === threadId) return
      }
      if (!page.cursor || !page.cursor.startsWith(subscriptionPrefix(work.ticket.id))) break
      cursor = page.cursor
    }
    throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This Thread did not legally reach this Ticket.')
  }

  private async threadEvents(tx: AsyncTx, work: Work, threadId: string, objectId?: string) {
    const sourceInstanceId = work.trigger.source.sourceInstanceId
    const prefix = JSON.stringify([this.instanceId, work.trigger.source.kind, sourceInstanceId, threadId]).slice(0, -1)
    const items: SourceEvent[] = []
    let cursor = `${prefix},`
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<SourceEvent>('source-event', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(`${prefix},`)) return this.orderEvents(items)
        if (item.value.threadId !== threadId || item.value.source.sourceInstanceId !== sourceInstanceId) continue
        if (objectId && item.value.objectId !== objectId) continue
        items.push(item.value)
      }
      if (!page.cursor) break
      cursor = page.cursor
      if (pageCount === 9) throw new CoreError('CONTEXT_BUDGET', 'The Thread history exceeds its 1000-event budget.')
    }
    return this.orderEvents(items)
  }

  private orderEvents(items: SourceEvent[]) {
    return items.sort((left, right) => {
      if (left.version.order === 'sequence' && right.version.order === 'sequence') {
        const leftVersion = BigInt(left.version.value), rightVersion = BigInt(right.version.value)
        return leftVersion < rightVersion ? -1 : leftVersion > rightVersion ? 1 : 0
      }
      return left.objectId.localeCompare(right.objectId) || left.id.localeCompare(right.id)
    })
  }

  private async findSourceEvent(tx: AsyncTx, work: Work) {
    if (!work.trigger.threadId) return undefined
    return this.sourceEvents.candidate(tx, { threadId: work.trigger.threadId, objectId: work.trigger.eventId })
  }

  private async findReport(tx: AsyncTx, ticketId: string, reportId: string) {
    const reports: ReadyReport[] = []
    let cursor = reportPrefix(ticketId)
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<ReadyReport>('report-history', { limit: 100, after: cursor })
      reports.push(...page.items.map(item => item.value).filter(report => report.ticketId === ticketId))
      if (!page.cursor || !page.cursor.startsWith(reportPrefix(ticketId))) break
      cursor = page.cursor
    }
    return reports.find(report => report.id === reportId)
  }

  private async findAttention(tx: AsyncTx, ticketId: string, attentionId: string): Promise<Attention | undefined> {
    return (await this.attentions.history(tx, ticketId)).find(attention => attention.id === attentionId)
  }
}
