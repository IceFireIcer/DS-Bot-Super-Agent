import { createHash, randomUUID } from 'node:crypto'
import { CoreError, identifier, type DesktopSource, type Work } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { SourceEvent, SourceEvents } from './source-events.js'
import type { EffectRequest } from './effects.js'

export interface ThreadSubscription {
  id: string
  instanceId: string
  ticketId: string
  threadId: string
  sourceInstanceId: string
  required: boolean
  basis: 'trigger' | 'manual' | 'worker'
  mode: 'worker' | 'context'
  reason: string
  addedBy: string
}

export interface WorkInput {
  id: string
  instanceId: string
  ticketId: string
  sourceEventId: string
  threadId: string
  objectId: string
  text: string
  authorId: string
  ownership: 'worker'
  directionVersion: number
  state: 'pending' | 'delivered'
  recoveryDecisionId?: string
  receivedAt: number
}

export interface RecoveryDecision {
  id: string
  instanceId: string
  ticketId: string
  inputId: string
  sourceEventId: string
  mandateId: string
  mandateDecisionId: string
  policyVersion: string
  reason: 'AUTHORIZED_HUMAN_FOLLOWUP'
  checkedAt: number
}

export interface WorkOwnership {
  id: string
  instanceId: string
  ticketId: string
  sourceEventId: string
  inputId: string
  subscriptionId: string
  state: 'owned' | 'handed-back' | 'requeued'
  basis: 'fanout' | 'explicit-attach' | 'attention-answer'
  reason?: string
  requeueCommandId?: string
  assignedAt: number
  endedAt?: number
}

export interface RequeueDecision {
  id: string
  instanceId: string
  eventId: string
  commandId: string
  commandKey: string
  requesterId: string
  state: 'pending' | 'claimed' | 'consumed'
  evaluationId?: string
  createdAt: number
  claimedAt?: number
  consumedAt?: number
}

export interface WorkNote {
  id: string
  instanceId: string
  ticketId: string
  text: string
  createdBy: string
  sourceTicketId?: string
  sequence: number
  createdAt: number
}

export interface SubscriptionDecision {
  id: string
  commandId: string
  instanceId: string
  ticketId: string
  threadId: string
  sourceInstanceId: string
  basis: ThreadSubscription['basis']
  removedBy: string
  reason: string
  removedAt: number
}

export interface WorkFanoutTarget {
  id: string
  instanceId: string
  eventId: string
  ticketId: string
  subscriptionId: string
  threadId: string
  authorId: string
  authorKind: string
  addressing: string
  eventType: SourceEvent['type']
  ownership: 'worker' | 'context'
  inputId?: string
  ownershipId?: string
  reason?: string
  receivedAt: number
}

export interface WorkFanout {
  eventId: string
  targetCount: number
  owned: boolean
}

export interface TicketDirection {
  ticketId: string
  state: Work['ticket']['state']
  directionVersion: number
  constraint?: Work['ticket']['constraint']
  inputs: WorkInput[]
  subscriptions: ThreadSubscription[]
  fanouts: WorkFanoutTarget[]
  ownerships: WorkOwnership[]
  notes: WorkNote[]
  subscriptionDecisions: SubscriptionDecision[]
  requeues: RequeueDecision[]
  recoveries: RecoveryDecision[]
}

const stableKey = (prefix: string, values: string[]) => `${prefix}${createHash('sha256').update(JSON.stringify(values)).digest('hex')}`
const subscriptionPrefix = (sourceInstanceId: string, threadId: string) => JSON.stringify(['thread-subscription', sourceInstanceId, threadId])
const subscriptionKey = (sourceInstanceId: string, threadId: string, ticketId: string) => `${subscriptionPrefix(sourceInstanceId, threadId)}:${createHash('sha256').update(ticketId).digest('hex')}`
const ticketSubscriptionPrefix = (ticketId: string) => JSON.stringify(['ticket-thread-subscription', ticketId])
const ticketSubscriptionKey = (ticketId: string, subscriptionId: string) => `${ticketSubscriptionPrefix(ticketId)}:${createHash('sha256').update(subscriptionId).digest('hex')}`
const inputPrefix = (ticketId: string) => JSON.stringify(['work-input', ticketId])
const inputKey = (ticketId: string, eventId: string) => `${inputPrefix(ticketId)}:${createHash('sha256').update(eventId).digest('hex')}`
const fanoutKey = (eventId: string) => stableKey('work-fanout:', [eventId])
const fanoutTargetPrefix = (ticketId: string) => JSON.stringify(['work-fanout-target', ticketId])
const fanoutTargetKey = (ticketId: string, eventId: string) => `${fanoutTargetPrefix(ticketId)}:${createHash('sha256').update(eventId).digest('hex')}`
const recoveryPrefix = (ticketId: string) => JSON.stringify(['recovery-decision', ticketId])
const recoveryKey = (ticketId: string, inputId: string) => `${recoveryPrefix(ticketId)}:${createHash('sha256').update(inputId).digest('hex')}`
const ownershipPrefix = (ticketId: string) => JSON.stringify(['work-ownership', ticketId])
const ownershipKey = (ticketId: string, eventId: string) => `${ownershipPrefix(ticketId)}:${createHash('sha256').update(eventId).digest('hex')}`
const eventOwnershipPrefix = (eventId: string) => JSON.stringify(['event-work-ownership', eventId])
const eventOwnershipKey = (eventId: string, ownershipId: string) => `${eventOwnershipPrefix(eventId)}:${createHash('sha256').update(ownershipId).digest('hex')}`
const notePrefix = (ticketId: string) => JSON.stringify(['work-note', ticketId])
const noteKey = (ticketId: string, id: string) => `${notePrefix(ticketId)}:${createHash('sha256').update(id).digest('hex')}`
const subscriptionDecisionPrefix = (ticketId: string) => JSON.stringify(['subscription-decision', ticketId])
const requeueKey = (eventId: string) => JSON.stringify(['work-requeue', eventId])

export class WorkInputs {
  private readonly allowedRequesterIds: string[]
  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    private readonly source: DesktopSource,
    private readonly sources: SourceEvents,
    private readonly enqueue: (tx: AsyncTx, request: EffectRequest) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {
    this.allowedRequesterIds = [...(source.intake?.allowedRequesterIds ?? source.allowedActorIds)]
  }

  async subscribe(tx: AsyncTx, ticketId: string, trigger: Work['trigger']) {
    if (!trigger.threadId) return
    await this.addSubscription(tx, ticketId, trigger.threadId, 'trigger', true, 'worker', 'Original source Thread', this.source.actorId)
  }

  async addSubscription(tx: AsyncTx, ticketId: string, threadId: string, basis: ThreadSubscription['basis'], required: boolean, mode: ThreadSubscription['mode'], reason: string, addedBy: string) {
    identifier(ticketId, 'ticketId'); identifier(threadId, 'threadId'); identifier(addedBy, 'addedBy')
    if (!this.source.allowedThreadIds?.includes(threadId)) throw new CoreError('SOURCE_SCOPE_DENIED', 'The additional Thread is outside the configured reception scope.')
    if (!reason.trim() || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'A Thread subscription needs a bounded reason.')
    await this.authorizedTicket(tx, ticketId)
    const id = subscriptionKey(this.source.sourceInstanceId, threadId, ticketId)
    const existing = await tx.get<ThreadSubscription>('thread-subscription', id)
    if (!existing && basis === 'worker') {
      const decisions = await this.scanAll<SubscriptionDecision>(tx, 'subscription-decision', subscriptionDecisionPrefix(ticketId),
        decision => decision.ticketId === ticketId, 'WORK_SUBSCRIPTION_BUDGET')
      if (decisions.some(decision => decision.threadId === threadId && decision.removedBy === addedBy && decision.basis === 'worker')) throw new CoreError('SUBSCRIPTION_CYCLE_LIMIT', 'This Assignment cannot re-add a Thread subscription it already removed.')
    }
    if (!existing && (await this.subscriptionsForTicket(tx, ticketId)).length >= 1000
      || !existing && (await this.subscriptionsForThread(tx, threadId)).length >= 1000) throw new CoreError('WORK_OWNERSHIP_BUDGET', 'A Ticket or Thread already has its declared 1000 subscriptions.')
    const subscription: ThreadSubscription = { id, instanceId: this.instanceId, ticketId, threadId,
      sourceInstanceId: this.source.sourceInstanceId, required: existing?.required || required, basis: existing?.basis ?? basis, mode: existing?.required ? 'worker' : mode, reason, addedBy }
    if (!await tx.replace('thread-subscription', id, subscription)) await tx.insert('thread-subscription', id, subscription)
    const ticketKey = ticketSubscriptionKey(ticketId, id)
    if (!await tx.replace('ticket-thread-subscription', ticketKey, subscription)) await tx.insert('ticket-thread-subscription', ticketKey, subscription)
    return subscription
  }

  async recordFanout(tx: AsyncTx, event: SourceEvent): Promise<WorkFanout> {
    const key = fanoutKey(event.id)
    const prior = await tx.get<WorkFanout>('work-fanout', key)
    if (prior) return prior
    const subscriptions = await this.subscriptionsForThread(tx, event.threadId)
    let targetCount = 0
    let owned = false
    for (const subscription of subscriptions) {
      const ticket = await tx.get<Work['ticket']>('ticket', subscription.ticketId)
      if (!ticket) {
        const target = { ticketId: subscription.ticketId, subscriptionId: subscription.id, ownership: 'context' as const, reason: 'TICKET_NOT_FOUND' }
        targetCount++
        await this.recordTarget(tx, event, target)
        continue
      }
      const reason = await this.ineligibleReason(tx, event, ticket, subscription)
      if (reason) {
        const target = { ticketId: ticket.id, subscriptionId: subscription.id, ownership: 'context' as const, reason }
        targetCount++
        await this.recordTarget(tx, event, target)
        continue
      }
      const id = inputKey(ticket.id, event.id)
      const existing = await tx.get<WorkInput>('work-input', id)
      if (existing) {
        const ownership = await this.addOwnership(tx, ticket.id, event.id, id, subscription.id, 'fanout')
        const target = { ticketId: ticket.id, subscriptionId: subscription.id, ownership: 'worker' as const, inputId: id, ownershipId: ownership.id }
        targetCount++
        owned = true
        await this.recordTarget(tx, event, target)
        continue
      }
      const directionVersion = (ticket.directionVersion ?? 1) + 1
      const previousState = ticket.state
      const recoveryDecisionId = previousState === 'ended' ? await this.recordRecovery(tx, ticket, event, id) : undefined
      const input: WorkInput = { id, instanceId: this.instanceId, ticketId: ticket.id, sourceEventId: event.id, threadId: event.threadId, objectId: event.objectId,
        text: event.text!, authorId: event.authorId, ownership: 'worker', directionVersion, state: 'pending', ...(recoveryDecisionId ? { recoveryDecisionId } : {}), receivedAt: this.now() }
      await tx.insert('work-input', id, input)
      const ownership = await this.addOwnership(tx, ticket.id, event.id, id, subscription.id, 'fanout')
      ticket.state = 'open'
      ticket.directionVersion = directionVersion
      await tx.replace('ticket', ticket.id, ticket)
      const intent = await tx.get<Work['intent']>('intent', ticket.id)
      if (!intent) throw new CoreError('INCOMPLETE_STATE', 'Follow-up ownership is missing the Ticket intent.')
      await tx.replace('intent', ticket.id, { ...intent, state: 'pending', reason: 'followup-pending' })
      await this.enqueue(tx, { key: `followup:${id}`, stream: 'relay', scope: ticket.id, payload: { ticketId: ticket.id, inputId: id } })
      const target = { ticketId: ticket.id, subscriptionId: subscription.id, ownership: 'worker' as const, inputId: id, ownershipId: ownership.id }
      targetCount++
      owned = true
      await this.recordTarget(tx, event, target)
    }
    const fanout: WorkFanout = { eventId: event.id, targetCount, owned }
    await tx.insert('work-fanout', key, fanout)
    return fanout
  }

  async owns(tx: AsyncTx, event: SourceEvent) {
    return (await this.ownershipsForEvent(tx, event.id)).some(ownership => ownership.state === 'owned')
  }

  async attach(tx: AsyncTx, event: SourceEvent, ticketId: string, reason: string, actorId: string) {
    identifier(ticketId, 'ticketId'); identifier(actorId, 'actorId')
    if (!reason.trim() || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'Explicit attach needs a bounded reason.')
    const ticket = await this.authorizedTicket(tx, ticketId)
    if (ticket.constraint) throw new CoreError('TICKET_BLOCKED', 'The Ticket constraint must be resolved before explicit attach.')
    if (!this.allowedRequesterIds.includes(event.authorId)) throw new CoreError('ACTOR_NOT_ALLOWED', 'The source event author is not currently authorized for work.')
    const current = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
    if (current?.id !== event.id) throw new CoreError('SOURCE_NOT_CURRENT', 'Only a current source event can be explicitly attached.')
    const id = inputKey(ticket.id, event.id)
    const existing = await tx.get<WorkInput>('work-input', id)
    if (existing) return existing
    const directionVersion = (ticket.directionVersion ?? 1) + 1
    const input: WorkInput = { id, instanceId: this.instanceId, ticketId: ticket.id, sourceEventId: event.id, threadId: event.threadId, objectId: event.objectId,
      text: event.text!, authorId: event.authorId, ownership: 'worker', directionVersion, state: 'pending', receivedAt: this.now() }
    await tx.insert('work-input', id, input)
    await this.addOwnership(tx, ticket.id, event.id, id, subscriptionKey(this.source.sourceInstanceId, event.threadId, ticket.id), 'explicit-attach', reason)
    ticket.state = 'open'
    ticket.directionVersion = directionVersion
    await tx.replace('ticket', ticket.id, ticket)
    const intent = await tx.get<Work['intent']>('intent', ticket.id)
    if (!intent) throw new CoreError('INCOMPLETE_STATE', 'Explicit attach is missing the Ticket intent.')
    await tx.replace('intent', ticket.id, { ...intent, state: 'pending', reason: 'followup-pending' })
    await this.enqueue(tx, { key: `followup:${id}`, stream: 'relay', scope: ticket.id, payload: { ticketId: ticket.id, inputId: id } })
    return input
  }

  async attachSyntheticInput(tx: AsyncTx, request: { ticketId: string; sourceEventId: string; threadId: string; text: string; authorId: string; reason: string; dispatch?: boolean }) {
    const ticket = await this.authorizedTicket(tx, request.ticketId)
    const id = inputKey(ticket.id, request.sourceEventId)
    const existing = await tx.get<WorkInput>('work-input', id)
    if (existing) return existing
    const directionVersion = (ticket.directionVersion ?? 1) + 1
    const input: WorkInput = { id, instanceId: this.instanceId, ticketId: ticket.id, sourceEventId: request.sourceEventId, threadId: request.threadId,
      objectId: request.sourceEventId, text: request.text, authorId: request.authorId, ownership: 'worker', directionVersion, state: 'pending', receivedAt: this.now() }
    await tx.insert('work-input', id, input)
    await this.addOwnership(tx, ticket.id, request.sourceEventId, id, '__attention__', 'attention-answer', request.reason)
    ticket.state = 'open'
    ticket.directionVersion = directionVersion
    await tx.replace('ticket', ticket.id, ticket)
    const intent = await tx.get<Work['intent']>('intent', ticket.id)
    if (!intent) throw new CoreError('INCOMPLETE_STATE', 'Attention answer is missing the Ticket intent.')
    await tx.replace('intent', ticket.id, { ...intent, state: 'pending', reason: 'followup-pending' })
    if (request.dispatch !== false) await this.enqueue(tx, { key: `followup:${id}`, stream: 'relay', scope: ticket.id, payload: { ticketId: ticket.id, inputId: id } })
    return input
  }

  async latestPendingInput(tx: AsyncTx, ticketId: string) {
    return (await this.scanAll<WorkInput>(tx, 'work-input', inputPrefix(ticketId), input => input.ticketId === ticketId && input.state === 'pending', 'WORK_INPUT_BUDGET'))
      .sort((left, right) => right.directionVersion - left.directionVersion)[0]
  }

  async getInput(tx: AsyncTx, inputId: string) {
    return tx.get<WorkInput>('work-input', inputId)
  }

  async handback(tx: AsyncTx, ticketId: string, inputId: string, reason: string) {
    identifier(ticketId, 'ticketId'); identifier(inputId, 'inputId')
    if (!reason.trim() || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'Handback needs a bounded reason.')
    const input = await tx.get<WorkInput>('work-input', inputId)
    if (!input || input.ticketId !== ticketId) throw new CoreError('STALE_INPUT', 'The handed-back Input does not belong to this Ticket.')
    const id = ownershipKey(ticketId, input.sourceEventId)
    const ownership = await tx.get<WorkOwnership>('work-ownership', id)
    if (!ownership) throw new CoreError('OWNERSHIP_NOT_FOUND', 'The Input has no active ownership record.')
    if (ownership.state !== 'owned') return ownership
    const ended: WorkOwnership = { ...ownership, state: 'handed-back', reason, endedAt: this.now() }
    await tx.replace('work-ownership', id, ended)
    await tx.replace('event-work-ownership', eventOwnershipKey(input.sourceEventId, id), ended)
    return ended
  }

  async prepareRequeue(tx: AsyncTx, event: SourceEvent, commandId: string, commandKey: string, requesterId: string) {
    identifier(commandId, 'commandId')
    const prior = await tx.get<RequeueDecision>('work-requeue', requeueKey(event.id))
    if (prior) {
      if (prior.commandKey === commandKey) return prior
      if (prior.state !== 'pending') throw new CoreError('WORK_REQUEUE_CONSUMED', 'The event already has a completed manual requeue decision.')
    }
    const active = (await this.ownershipsForEvent(tx, event.id)).filter(ownership => ownership.state === 'owned')
    if (active.length) throw new CoreError('OWNERSHIP_ACTIVE', 'Every owner must hand back the event before it can be requeued.')
    const ownerships = await this.ownershipsForEvent(tx, event.id)
    if (!ownerships.length) throw new CoreError('OWNERSHIP_NOT_FOUND', 'The event has no ownership decision to requeue.')
    const endedAt = this.now()
    for (const ownership of ownerships) {
      if (ownership.state === 'requeued') continue
      const requeued: WorkOwnership = { ...ownership, state: 'requeued', requeueCommandId: commandId, endedAt }
      await tx.replace('work-ownership', ownership.id, requeued)
      await tx.replace('event-work-ownership', eventOwnershipKey(event.id, ownership.id), requeued)
    }
    const decision: RequeueDecision = { id: requeueKey(event.id), instanceId: this.instanceId, eventId: event.id, commandId, commandKey, requesterId, state: 'pending', createdAt: endedAt }
    if (prior) await tx.replace('work-requeue', decision.id, decision)
    else await tx.insert('work-requeue', decision.id, decision)
    return decision
  }

  async hasPendingRequeue(tx: AsyncTx, eventId: string) {
    return (await tx.get<RequeueDecision>('work-requeue', requeueKey(eventId)))?.state === 'pending'
  }

  async claimRequeue(tx: AsyncTx, eventId: string, evaluationId: string) {
    const key = requeueKey(eventId)
    const decision = await tx.get<RequeueDecision>('work-requeue', key)
    if (!decision || decision.state !== 'pending') return
    await tx.replace('work-requeue', key, { ...decision, state: 'claimed', evaluationId, claimedAt: this.now() })
  }

  async consumeRequeue(tx: AsyncTx, eventId: string, evaluationId: string) {
    const key = requeueKey(eventId)
    const decision = await tx.get<RequeueDecision>('work-requeue', key)
    if (!decision || decision.state !== 'claimed' || decision.evaluationId !== evaluationId) return
    await tx.replace('work-requeue', key, { ...decision, state: 'consumed', evaluationId, consumedAt: this.now() })
  }

  async releaseRequeue(tx: AsyncTx, eventId: string, evaluationId: string) {
    const key = requeueKey(eventId)
    const decision = await tx.get<RequeueDecision>('work-requeue', key)
    if (!decision || decision.state !== 'claimed' || decision.evaluationId !== evaluationId) return
    const { evaluationId: _evaluationId, claimedAt: _claimedAt, ...pending } = decision
    await tx.replace('work-requeue', key, { ...pending, state: 'pending' })
  }

  async removeSubscription(tx: AsyncTx, ticketId: string, threadId: string, reason: string, removedBy: string, commandId: string) {
    identifier(ticketId, 'ticketId'); identifier(threadId, 'threadId'); identifier(removedBy, 'removedBy')
    identifier(commandId, 'commandId')
    if (!reason.trim() || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'Removing a Thread subscription needs a bounded reason.')
    await this.authorizedTicket(tx, ticketId)
    const decisionKey = `${subscriptionDecisionPrefix(ticketId)}:${commandId}`
    const prior = await tx.get<SubscriptionDecision>('subscription-decision', decisionKey)
    if (prior) return prior
    const id = subscriptionKey(this.source.sourceInstanceId, threadId, ticketId)
    const subscription = await tx.get<ThreadSubscription>('thread-subscription', id)
    if (!subscription) throw new CoreError('NOT_FOUND', 'The Thread subscription does not exist.')
    if (subscription.required) throw new CoreError('REQUIRED_THREAD', 'The original or source-bound Thread subscription cannot be removed.')
    await tx.remove('thread-subscription', id)
    await tx.remove('ticket-thread-subscription', ticketSubscriptionKey(ticketId, id))
    const decisionId = decisionKey
    const decision: SubscriptionDecision = { id: decisionId, commandId, instanceId: this.instanceId, ticketId, threadId,
      sourceInstanceId: subscription.sourceInstanceId, basis: subscription.basis, removedBy, reason, removedAt: this.now() }
    await tx.insert('subscription-decision', decisionId, decision)
    return decision
  }

  async removeWorkerSubscription(tx: AsyncTx, ticketId: string, threadId: string, reason: string, assignmentId: string) {
    const commandId = `worker:${createHash('sha256').update(JSON.stringify([assignmentId, threadId])).digest('hex')}`
    const prior = await tx.get<SubscriptionDecision>('subscription-decision', `${subscriptionDecisionPrefix(ticketId)}:${commandId}`)
    if (prior) return prior
    const id = subscriptionKey(this.source.sourceInstanceId, threadId, ticketId)
    const subscription = await tx.get<ThreadSubscription>('thread-subscription', id)
    if (!subscription) throw new CoreError('NOT_FOUND', 'The Thread subscription does not exist.')
    if (subscription.basis !== 'worker' || subscription.addedBy !== assignmentId) throw new CoreError('SUBSCRIPTION_DENIED', 'A Worker may remove only subscriptions it added.')
    return this.removeSubscription(tx, ticketId, threadId, reason, assignmentId, commandId)
  }

  async addNote(tx: AsyncTx, ticketId: string, text: string, createdBy: string, sourceTicketId?: string) {
    identifier(ticketId, 'ticketId'); identifier(createdBy, 'createdBy')
    if (sourceTicketId !== undefined) identifier(sourceTicketId, 'sourceTicketId')
    if (!text.trim() || Buffer.byteLength(text) > 4096) throw new CoreError('INVALID_INPUT', 'A Ticket note needs bounded nonempty text.')
    await this.authorizedTicket(tx, ticketId)
    if (sourceTicketId) await this.authorizedTicket(tx, sourceTicketId)
    const id = `${ticketId}:${randomUUID()}`
    const sequenceKey = JSON.stringify(['work-note-meta', ticketId])
    const sequence = (await tx.get<number>('work-note-meta', sequenceKey) ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) throw new CoreError('WORK_NOTE_BUDGET', 'The Ticket note sequence is exhausted.')
    if (!await tx.replace('work-note-meta', sequenceKey, sequence)) await tx.insert('work-note-meta', sequenceKey, sequence)
    const note: WorkNote = { id, instanceId: this.instanceId, ticketId, text, createdBy, ...(sourceTicketId ? { sourceTicketId } : {}), sequence, createdAt: this.now() }
    await tx.insert('work-note', noteKey(ticketId, id), note)
    return note
  }

  async markDelivered(tx: AsyncTx, input: WorkInput) {
    const current = await tx.get<WorkInput>('work-input', input.id)
    if (!current || current.ticketId !== input.ticketId || current.sourceEventId !== input.sourceEventId) throw new CoreError('STALE_INPUT', 'The follow-up Input is no longer current.')
    await tx.replace('work-input', current.id, { ...current, state: 'delivered' })
  }

  async direction(ticketId: string): Promise<TicketDirection | undefined> {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, async tx => {
      const ticket = await tx.get<Work['ticket']>('ticket', ticketId)
      if (!ticket) return undefined
      const inputs = (await this.scanAll<WorkInput>(tx, 'work-input', inputPrefix(ticketId), input => input.ticketId === ticketId, 'WORK_INPUT_BUDGET'))
        .sort((left, right) => left.directionVersion - right.directionVersion)
      const subscriptions = await this.subscriptionsForTicket(tx, ticketId)
      const fanouts = (await this.scanAll<WorkFanoutTarget>(tx, 'work-fanout-target', fanoutTargetPrefix(ticketId), target => target.ticketId === ticketId, 'WORK_FANOUT_BUDGET'))
        .sort((left, right) => left.receivedAt - right.receivedAt)
      const recoveries = (await this.scanAll<RecoveryDecision>(tx, 'recovery-decision', recoveryPrefix(ticketId), decision => decision.ticketId === ticketId, 'WORK_RECOVERY_BUDGET'))
        .sort((left, right) => left.checkedAt - right.checkedAt)
      const ownerships = (await this.scanAll<WorkOwnership>(tx, 'work-ownership', ownershipPrefix(ticketId), ownership => ownership.ticketId === ticketId, 'WORK_OWNERSHIP_BUDGET'))
        .sort((left, right) => left.assignedAt - right.assignedAt)
      const notes = (await this.scanAll<WorkNote>(tx, 'work-note', notePrefix(ticketId), note => note.ticketId === ticketId, 'WORK_NOTE_BUDGET'))
        .sort((left, right) => left.sequence - right.sequence)
      const subscriptionDecisions = (await this.scanAll<SubscriptionDecision>(tx, 'subscription-decision', subscriptionDecisionPrefix(ticketId),
        decision => decision.ticketId === ticketId, 'WORK_SUBSCRIPTION_BUDGET')).sort((left, right) => left.removedAt - right.removedAt)
      const requeues = (await Promise.all([...new Set(ownerships.map(ownership => ownership.sourceEventId))]
        .map(async eventId => tx.get<RequeueDecision>('work-requeue', requeueKey(eventId))))).filter((decision): decision is RequeueDecision => decision !== undefined)
        .sort((left, right) => left.createdAt - right.createdAt)
      return { ticketId, state: ticket.state, directionVersion: ticket.directionVersion ?? 1, ...(ticket.constraint ? { constraint: ticket.constraint } : {}),
        inputs, subscriptions, fanouts, ownerships, notes, subscriptionDecisions, requeues, recoveries }
    })
  }

  private async ineligibleReason(tx: AsyncTx, event: SourceEvent, ticket: Work['ticket'], subscription: ThreadSubscription) {
    if (event.type === 'deleted') return 'DELETED'
    if (subscription.mode === 'context') return 'CONTEXT_ONLY'
    if (event.authorKind !== 'human') return 'CONTEXT_ONLY'
    if (event.addressing === 'ambient') return 'CONTEXT_ONLY'
    if (!this.allowedRequesterIds.includes(event.authorId)) return 'ACTOR_NOT_ALLOWED'
    const current = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
    if (current?.id !== event.id) return 'SOURCE_NOT_CURRENT'
    if (ticket.constraint) return `BLOCKED_${ticket.constraint.kind.toUpperCase().replace('-', '_')}`
    return undefined
  }

  private async recordTarget(tx: AsyncTx, event: SourceEvent, target: Omit<WorkFanoutTarget, 'id' | 'instanceId' | 'eventId' | 'threadId' | 'authorId' | 'authorKind' | 'addressing' | 'eventType' | 'receivedAt'>) {
    const id = fanoutTargetKey(target.ticketId, event.id)
    const record: WorkFanoutTarget = { id, instanceId: this.instanceId, eventId: event.id, threadId: event.threadId, authorId: event.authorId,
      authorKind: event.authorKind, addressing: event.addressing, eventType: event.type, receivedAt: this.now(), ...target }
    if (!await tx.replace('work-fanout-target', id, record)) await tx.insert('work-fanout-target', id, record)
  }

  private async addOwnership(tx: AsyncTx, ticketId: string, eventId: string, inputId: string, subscriptionId: string, basis: WorkOwnership['basis'], reason?: string) {
    const id = ownershipKey(ticketId, eventId)
    const existing = await tx.get<WorkOwnership>('work-ownership', id)
    if (existing) return existing
    const ownership: WorkOwnership = { id, instanceId: this.instanceId, ticketId, sourceEventId: eventId, inputId, subscriptionId, state: 'owned', basis,
      ...(reason ? { reason } : {}), assignedAt: this.now() }
    await tx.insert('work-ownership', id, ownership)
    const eventKey = eventOwnershipKey(eventId, id)
    if (!await tx.replace('event-work-ownership', eventKey, ownership)) await tx.insert('event-work-ownership', eventKey, ownership)
    return ownership
  }

  private async ownershipsForEvent(tx: AsyncTx, eventId: string) {
    return this.scanAll<WorkOwnership>(tx, 'event-work-ownership', eventOwnershipPrefix(eventId), ownership => ownership.sourceEventId === eventId, 'WORK_OWNERSHIP_BUDGET')
  }

  private async recordRecovery(tx: AsyncTx, ticket: Work['ticket'], event: SourceEvent, inputId: string) {
    const mandate = await tx.get<Work['mandate']>('mandate', ticket.mandateId)
    const decision = mandate && await tx.get<Work['decision']>('decision', mandate.decisionId)
    if (!mandate || !decision) throw new CoreError('INCOMPLETE_STATE', 'Recovering a Ticket requires its original Mandate and Decision.')
    const id = recoveryKey(ticket.id, inputId)
    const recovery: RecoveryDecision = { id, instanceId: this.instanceId, ticketId: ticket.id, inputId, sourceEventId: event.id,
      mandateId: mandate.id, mandateDecisionId: decision.id, policyVersion: decision.policyVersion,
      reason: 'AUTHORIZED_HUMAN_FOLLOWUP', checkedAt: this.now() }
    if (!await tx.replace('recovery-decision', id, recovery)) await tx.insert('recovery-decision', id, recovery)
    return id
  }

  private async authorizedTicket(tx: AsyncTx, ticketId: string) {
    const ticket = await tx.get<Work['ticket']>('ticket', ticketId)
    const trigger = ticket && await tx.get<Work['trigger']>('trigger', ticket.triggerId)
    if (!ticket || !trigger) throw new CoreError('NOT_FOUND', 'The Ticket does not exist.')
    if (trigger.source.sourceInstanceId !== this.source.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The Ticket belongs to a different source instance.')
    return ticket
  }

  private async subscriptionsForThread(tx: AsyncTx, threadId: string) {
    return this.scanAll<ThreadSubscription>(tx, 'thread-subscription', subscriptionPrefix(this.source.sourceInstanceId, threadId),
      subscription => subscription.threadId === threadId && subscription.sourceInstanceId === this.source.sourceInstanceId, 'WORK_OWNERSHIP_BUDGET')
  }

  private async subscriptionsForTicket(tx: AsyncTx, ticketId: string) {
    return this.scanAll<ThreadSubscription>(tx, 'ticket-thread-subscription', ticketSubscriptionPrefix(ticketId),
      subscription => subscription.ticketId === ticketId, 'WORK_OWNERSHIP_BUDGET')
  }

  private async scanAll<T>(tx: AsyncTx, kind: 'thread-subscription' | 'ticket-thread-subscription' | 'work-input' | 'work-fanout-target' | 'work-ownership' | 'event-work-ownership' | 'work-note' | 'subscription-decision' | 'recovery-decision', prefix: string,
    predicate: (value: T) => boolean, budget: string) {
    const items: T[] = []
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<T>(kind, { limit: 100, after: cursor })
      items.push(...page.items.map(item => item.value).filter(predicate))
      if (!page.cursor || !page.cursor.startsWith(prefix)) return items
      cursor = page.cursor
      if (pageCount === 9) {
        const confirmation = await tx.scan<T>(kind, { limit: 1, after: cursor })
        if (!confirmation.items.some(item => item.value !== undefined && predicate(item.value))) return items
      }
    }
    throw new CoreError(budget, 'The Ticket ownership query exceeds its declared 1000-record audit budget.')
  }
}
