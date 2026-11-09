import { CoreError } from './model.js'
import type { Work } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { Effect, EffectHandler, EffectResult } from './effects.js'
import type { SourceEvent, SourceEvents } from './source-events.js'
import { localDeliveryChannel, type Deliveries, type Delivery, type DeliveryChannel } from './deliveries.js'
import type { Attention } from './attention.js'
import type { Assignment, ReadyReport } from './execution.js'
import type { DeliveryState } from './delivery-state.js'

export class Outbox {
  private readonly channel: DeliveryChannel
  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    private readonly deliveries: Deliveries,
    private readonly sourceEvents: SourceEvents,
    private readonly deliveryState: DeliveryState,
    channel?: DeliveryChannel,
  ) {
    this.channel = channel ?? localDeliveryChannel
  }

  handler(): EffectHandler {
    return {
      execute: (effect, context) => this.deliver(effect, context, false),
      reconcile: (effect, context) => this.deliver(effect, context, true),
    }
  }

  private async deliver(effect: Effect, context: { idempotencyKey: string; signal: AbortSignal }, reconciling: boolean): Promise<EffectResult> {
    const ticketId = String(effect.payload.ticketId)
    const deliveryId = typeof effect.payload.deliveryId === 'string' ? effect.payload.deliveryId : undefined
    const prepared = await this.storage.transaction(this.instanceId, async transaction => {
      const trigger = await this.trigger(transaction, ticketId)
      let delivery = deliveryId ? await this.deliveries.get(transaction, deliveryId) : undefined
      if (!delivery) {
        const legacy = await this.legacyDelivery(transaction, effect, trigger)
        if (!legacy) return { invalid: 'INVALID_DELIVERY: the outbox effect has no delivery record.' }
        delivery = await this.deliveries.record(transaction, legacy, effect)
      }
      if (delivery.purpose === 'result') {
        const target = await this.deliveryState.target(transaction, ticketId, 'result')
        if (target) {
          const redirected: Delivery = { ...delivery, destination: { actorId: delivery.destination.actorId,
            sourceInstanceId: target.destination.sourceInstanceId, eventId: target.destination.objectId,
            ...(target.destination.threadId ? { threadId: target.destination.threadId } : {}) } }
          delivery = await this.deliveries.record(transaction, redirected, effect)
        }
      }
      const invalid = await this.validateDelivery(transaction, delivery, trigger)
      if (invalid) return { invalid }
      if (delivery.purpose === 'result') {
        const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
        if (!ticket) return { invalid: 'INCOMPLETE_STATE: result delivery is missing its Ticket.' }
        const outstanding = (await this.deliveryState.outstanding(transaction, ticketId)).length > 0
        // A result may still be delivered and the Ticket left open while it keeps tracked PR delivery conditions.
        if (!ticket.constraint && !outstanding) await transaction.replace('ticket', ticketId, { ...ticket, state: 'ended' })
      }
      return { view: await this.deliveries.view(transaction, delivery) }
    })
    if ('invalid' in prepared) return { type: 'permanent', reason: prepared.invalid }
    const action = reconciling ? this.channel.reconcile?.bind(this.channel) : this.channel.deliver.bind(this.channel)
    if (!action) return { type: 'unknown', reason: 'The delivery channel cannot reconcile an unknown outcome.' }
    return action(prepared.view, context)
  }

  private async trigger(transaction: AsyncTx, ticketId: string) {
    const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
    const trigger = ticket && await transaction.get<Work['trigger']>('trigger', ticket.triggerId)
    if (!ticket || !trigger) throw new CoreError('NOT_FOUND', 'The work does not exist in this instance.')
    return trigger
  }

  private async legacyDelivery(transaction: AsyncTx, effect: Effect, trigger: Work['trigger']): Promise<Omit<Delivery, 'instanceId' | 'sequence' | 'createdAt'> | undefined> {
    const purpose = effect.payload.purpose
    if (purpose !== 'acknowledgement' && purpose !== 'result' && purpose !== 'attention' && purpose !== 'policy') return undefined
    const ticketId = String(effect.payload.ticketId)
    const destination = { ...trigger.source, eventId: trigger.eventId, ...(trigger.threadId ? { threadId: trigger.threadId } : {}) }
    if (purpose === 'acknowledgement') return { id: `${ticketId}:acknowledgement`, ticketId, purpose,
      text: 'Request accepted.', destination, basis: { kind: 'accepted-request', triggerId: trigger.id },
      effectId: effect.id, effectGeneration: effect.generation }
    if (purpose === 'result') {
      const report = await transaction.get<ReadyReport>('report', ticketId)
      if (!report) return undefined
      return { id: `${ticketId}:result`, ticketId, purpose, text: report.result, destination,
        basis: { kind: 'ready-report', reportId: report.id, directionVersion: report.directionVersion },
        effectId: effect.id, effectGeneration: effect.generation }
    }
    if (purpose === 'attention') {
      const attention = await transaction.get<Attention>('attention', String(effect.payload.attentionId))
      if (!attention) return undefined
      return { id: `${ticketId}:attention:${attention.id}`, ticketId, purpose, text: attention.question,
        destination: attention.destination, basis: { kind: 'waiting-attention', attentionId: attention.id },
        effectId: effect.id, effectGeneration: effect.generation }
    }
    const revision = Number(effect.payload.revision)
    return { id: `${ticketId}:policy:${revision}`, ticketId, purpose, text: `Policy updated to revision ${revision}.`,
      destination, basis: { kind: 'policy-update', revision }, effectId: effect.id, effectGeneration: effect.generation }
  }

  private async validateDelivery(transaction: AsyncTx, delivery: Delivery, trigger: Work['trigger']): Promise<string | undefined> {
    if (!await transaction.get<Work['ticket']>('ticket', delivery.ticketId)) return 'NOT_FOUND: the delivery Ticket does not exist.'
    const authorizedTarget = delivery.purpose === 'result' ? await this.deliveryState.target(transaction, delivery.ticketId, 'result') : undefined
    if (delivery.destination.sourceInstanceId !== trigger.source.sourceInstanceId && !authorizedTarget) {
      return 'SOURCE_MISMATCH: the delivery destination belongs to another source instance.'
    }
    if (delivery.purpose === 'acknowledgement') {
      if (delivery.basis.kind !== 'accepted-request' || delivery.basis.triggerId !== trigger.id) return 'INVALID_DELIVERY: an acknowledgement needs the accepted request.'
      if (delivery.destination.eventId !== trigger.eventId || delivery.destination.threadId !== trigger.threadId) {
        return 'DESTINATION_MISMATCH: an acknowledgement returns to the original request.'
      }
      return undefined
    }
    if (delivery.purpose === 'result') {
      if (delivery.basis.kind !== 'ready-report') return 'INVALID_DELIVERY: a result needs a ready-report basis.'
      const report = await transaction.get<ReadyReport>('report', delivery.ticketId)
      if (!report || report.id !== delivery.basis.reportId) return 'NOT_READY: result delivery requires the current ready report.'
      const assignment = await transaction.get<Assignment>('assignment', delivery.ticketId)
      if (!assignment || report.assignmentId !== assignment.id) return 'NOT_READY: the ready report belongs to an older Assignment generation.'
      const ticket = await transaction.get<Work['ticket']>('ticket', delivery.ticketId)
      if (!ticket) return 'INCOMPLETE_STATE: result delivery is missing its Ticket.'
      if (ticket.constraint?.kind === 'stopped') return 'TICKET_STOPPED: a stopped Ticket cannot deliver a result.'
      if (ticket.constraint) return 'TICKET_CONSTRAINED: the Ticket is waiting for a person before delivery.'
      const authorizedEventId = authorizedTarget?.destination.objectId ?? trigger.eventId
      const authorizedThreadId = authorizedTarget?.destination.threadId ?? trigger.threadId
      if (delivery.destination.eventId !== authorizedEventId || delivery.destination.threadId !== authorizedThreadId) {
        return 'DESTINATION_MISMATCH: the result destination has not been authorized to change.'
      }
      return undefined
    }
    if (delivery.purpose === 'attention') {
      if (delivery.basis.kind !== 'waiting-attention') return 'INVALID_DELIVERY: an attention delivery needs its question.'
      const attention = await transaction.get<Attention>('attention', delivery.basis.attentionId)
      if (!attention || attention.ticketId !== delivery.ticketId || attention.status !== 'waiting') return 'ATTENTION_STALE: the question was answered or superseded before delivery.'
      const ticket = await transaction.get<Work['ticket']>('ticket', delivery.ticketId)
      if (ticket?.constraint?.kind !== 'waiting-human' || ticket.constraint.attentionId !== attention.id) return 'ATTENTION_STALE: the question is no longer the current constraint.'
      if (JSON.stringify(delivery.destination) !== JSON.stringify(attention.destination)) return 'DESTINATION_MISMATCH: a question returns to the message that caused it.'
      return undefined
    }
    if (delivery.purpose === 'answer') {
      if (delivery.basis.kind !== 'human-question' || !delivery.basis.fact.trim() || !delivery.basis.questionText.trim()) {
        return 'INVALID_DELIVERY: an answer needs a human question and an explicit Worker fact.'
      }
      const question = await transaction.get<SourceEvent>('source-event', delivery.basis.questionEventId)
      if (!question || !this.sourceEvents.belongsToSource(question) || question.authorKind !== 'human') {
        return 'ANSWER_WITHOUT_QUESTION: an answer must name a trusted human question from this source.'
      }
      const current = await this.sourceEvents.candidate(transaction, { threadId: question.threadId, objectId: question.objectId })
      if (current?.id !== question.id) return 'SOURCE_NOT_CURRENT: the answered question is no longer current.'
      if (delivery.destination.sourceInstanceId !== question.source.sourceInstanceId || delivery.destination.actorId !== question.authorId
        || delivery.destination.eventId !== question.objectId || delivery.destination.threadId !== question.threadId) {
        return 'DESTINATION_MISMATCH: an answer returns to the human question it names.'
      }
      return undefined
    }
    if (delivery.purpose === 'policy') {
      if (delivery.basis.kind !== 'policy-update' || !Number.isInteger(delivery.basis.revision) || delivery.basis.revision < 1) return 'INVALID_DELIVERY: a policy notice needs its revision.'
      return undefined
    }
    return 'INVALID_DELIVERY: unsupported delivery purpose.'
  }
}
