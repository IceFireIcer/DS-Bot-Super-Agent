import { createHash } from 'node:crypto'
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
  basis: 'trigger'
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
    const id = subscriptionKey(this.source.sourceInstanceId, trigger.threadId, ticketId)
    const subscription: ThreadSubscription = { id, instanceId: this.instanceId, ticketId, threadId: trigger.threadId,
      sourceInstanceId: this.source.sourceInstanceId, required: true, basis: 'trigger' }
    if (!await tx.replace('thread-subscription', id, subscription)) await tx.insert('thread-subscription', id, subscription)
    const ticketKey = ticketSubscriptionKey(ticketId, id)
    if (!await tx.replace('ticket-thread-subscription', ticketKey, subscription)) await tx.insert('ticket-thread-subscription', ticketKey, subscription)
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
      const reason = await this.ineligibleReason(tx, event, ticket)
      if (reason) {
        const target = { ticketId: ticket.id, subscriptionId: subscription.id, ownership: 'context' as const, reason }
        targetCount++
        await this.recordTarget(tx, event, target)
        continue
      }
      const id = inputKey(ticket.id, event.id)
      const existing = await tx.get<WorkInput>('work-input', id)
      if (existing) {
        const target = { ticketId: ticket.id, subscriptionId: subscription.id, ownership: 'worker' as const, inputId: id }
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
      ticket.state = 'open'
      ticket.directionVersion = directionVersion
      await tx.replace('ticket', ticket.id, ticket)
      const intent = await tx.get<Work['intent']>('intent', ticket.id)
      if (!intent) throw new CoreError('INCOMPLETE_STATE', 'Follow-up ownership is missing the Ticket intent.')
      await tx.replace('intent', ticket.id, { ...intent, state: 'pending', reason: 'followup-pending' })
      await this.enqueue(tx, { key: `followup:${id}`, stream: 'relay', scope: ticket.id, payload: { ticketId: ticket.id, inputId: id } })
      const target = { ticketId: ticket.id, subscriptionId: subscription.id, ownership: 'worker' as const, inputId: id }
      targetCount++
      owned = true
      await this.recordTarget(tx, event, target)
    }
    const fanout: WorkFanout = { eventId: event.id, targetCount, owned }
    await tx.insert('work-fanout', key, fanout)
    return fanout
  }

  async owns(tx: AsyncTx, event: SourceEvent) {
    const fanout = await tx.get<WorkFanout>('work-fanout', fanoutKey(event.id))
    return fanout?.owned ?? false
  }

  async getInput(tx: AsyncTx, inputId: string) {
    return tx.get<WorkInput>('work-input', inputId)
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
      return { ticketId, state: ticket.state, directionVersion: ticket.directionVersion ?? 1, ...(ticket.constraint ? { constraint: ticket.constraint } : {}),
        inputs, subscriptions, fanouts, recoveries }
    })
  }

  private async ineligibleReason(tx: AsyncTx, event: SourceEvent, ticket: Work['ticket']) {
    if (event.type === 'deleted') return 'DELETED'
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

  private async subscriptionsForThread(tx: AsyncTx, threadId: string) {
    return this.scanAll<ThreadSubscription>(tx, 'thread-subscription', subscriptionPrefix(this.source.sourceInstanceId, threadId),
      subscription => subscription.threadId === threadId && subscription.sourceInstanceId === this.source.sourceInstanceId, 'WORK_OWNERSHIP_BUDGET')
  }

  private async subscriptionsForTicket(tx: AsyncTx, ticketId: string) {
    return this.scanAll<ThreadSubscription>(tx, 'ticket-thread-subscription', ticketSubscriptionPrefix(ticketId),
      subscription => subscription.ticketId === ticketId, 'WORK_OWNERSHIP_BUDGET')
  }

  private async scanAll<T>(tx: AsyncTx, kind: 'thread-subscription' | 'ticket-thread-subscription' | 'work-input' | 'work-fanout-target' | 'recovery-decision', prefix: string,
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
