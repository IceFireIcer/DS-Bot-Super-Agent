import { createHash } from 'node:crypto'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { Effect, Effects } from './effects.js'

export type DeliveryPurpose = 'acknowledgement' | 'answer' | 'result' | 'attention' | 'policy'
export type DeliveryState = 'pending' | 'sent' | 'dropped'

export interface DeliveryDestination {
  sourceInstanceId: string
  actorId: string
  eventId: string
  threadId?: string
}

export type DeliveryBasis =
  | { kind: 'accepted-request'; triggerId: string }
  | { kind: 'ready-report'; reportId: string; directionVersion: number }
  | { kind: 'waiting-attention'; attentionId: string }
  | { kind: 'human-question'; questionEventId: string; questionText: string; fact: string }
  | { kind: 'policy-update'; revision: number }

export interface Delivery {
  id: string
  instanceId: string
  ticketId: string
  purpose: DeliveryPurpose
  text: string
  destination: DeliveryDestination
  basis: DeliveryBasis
  effectId: string
  effectGeneration: string
  sequence: number
  createdAt: number
}

export interface DeliveryView extends Delivery {
  state: DeliveryState
  reason?: string
  attempts?: number
  reportId?: string
  inputId?: string
  directionVersion?: number
  attentionId?: string
  policyRevision?: number
}

export type DeliveryResult = { type: 'success' } | { type: 'transient' | 'permanent' | 'unknown' | 'not-applied'; reason: string }

export interface DeliveryContext {
  idempotencyKey: string
  signal: AbortSignal
}

export interface DeliveryChannel {
  deliver(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult>
  reconcile?(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult>
}

export interface DeliveryOptions {
  channel?: DeliveryChannel
}

/** The local preview has no external platform: recording the delivery in the isolated store is its receipt. */
export const localDeliveryChannel: DeliveryChannel = {
  deliver: async () => ({ type: 'success' }),
}

const historyPrefix = (ticketId: string) => JSON.stringify(['delivery-history', ticketId])
const sequenceKey = (ticketId: string) => JSON.stringify(['delivery-meta', ticketId])
const viewHash = (id: string) => createHash('sha256').update(id).digest('hex')

export class Deliveries {
  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    private readonly effects: Effects,
    private readonly now: () => number = Date.now,
  ) {}

  async record(transaction: AsyncTx, delivery: Omit<Delivery, 'instanceId' | 'sequence' | 'createdAt'>, effect: Effect) {
    identifier(delivery.id, 'deliveryId'); identifier(delivery.ticketId, 'ticketId')
    if (effect.id !== delivery.effectId || effect.generation !== delivery.effectGeneration) {
      throw new CoreError('INCOMPLETE_STATE', 'The delivery does not match the effect it was queued with.')
    }
    const existing = await transaction.get<Delivery>('delivery', delivery.id)
    if (existing) {
      if (existing.effectId === delivery.effectId && existing.effectGeneration === delivery.effectGeneration
        && existing.text === delivery.text && JSON.stringify(existing.destination) === JSON.stringify(delivery.destination)) return existing
    }
    const key = sequenceKey(delivery.ticketId)
    const sequence = (await transaction.get<number>('delivery-meta', key) ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) throw new CoreError('DELIVERY_BUDGET', 'The Ticket delivery sequence is exhausted.')
    if (!await transaction.replace('delivery-meta', key, sequence)) await transaction.insert('delivery-meta', key, sequence)
    const record: Delivery = { ...delivery, instanceId: this.instanceId, sequence, createdAt: this.now() }
    if (!await transaction.replace('delivery', record.id, record)) await transaction.insert('delivery', record.id, record)
    const historyKey = `${historyPrefix(delivery.ticketId)}:${viewHash(record.id)}:${String(sequence).padStart(16, '0')}`
    if (!await transaction.replace('delivery-history', historyKey, record)) await transaction.insert('delivery-history', historyKey, record)
    return record
  }

  async get(transaction: AsyncTx, id: string) {
    identifier(id, 'deliveryId')
    return transaction.get<Delivery>('delivery', id)
  }

  async list(transaction: AsyncTx, ticketId: string): Promise<DeliveryView[]> {
    identifier(ticketId, 'ticketId')
    const items: Delivery[] = []
    let cursor = historyPrefix(ticketId)
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<Delivery>('delivery-history', { limit: 100, after: cursor })
      items.push(...page.items.map(item => item.value).filter(item => item.ticketId === ticketId))
      if (!page.cursor || !page.cursor.startsWith(cursor)) {
        return Promise.all(items.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)).map(item => this.view(transaction, item)))
      }
      cursor = page.cursor
      if (pageCount === 9) {
        const confirmation = await transaction.scan<Delivery>('delivery-history', { limit: 1, after: cursor })
        if (!confirmation.items[0]?.value || confirmation.items[0].value.ticketId !== ticketId) {
          return Promise.all(items.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)).map(item => this.view(transaction, item)))
        }
      }
    }
    throw new CoreError('DELIVERY_BUDGET', 'The Ticket delivery history exceeds its 1000-record budget.')
  }

  async view(transaction: AsyncTx, delivery: Delivery): Promise<DeliveryView> {
    const receipt = await this.effects.receiptInTransaction(transaction, delivery.effectId, delivery.effectGeneration)
    const state: DeliveryState = !receipt ? 'pending' : receipt.state === 'done' ? 'sent' : receipt.state === 'failed' || receipt.state === 'superseded' ? 'dropped' : 'pending'
    return { ...delivery, state, ...(receipt?.reason ? { reason: receipt.reason } : {}), ...(receipt?.attempts === undefined ? {} : { attempts: receipt.attempts }),
      ...(delivery.basis.kind === 'ready-report' ? { reportId: delivery.basis.reportId, directionVersion: delivery.basis.directionVersion } : {}),
      ...(delivery.basis.kind === 'waiting-attention' ? { attentionId: delivery.basis.attentionId } : {}),
      ...(delivery.basis.kind === 'policy-update' ? { policyRevision: delivery.basis.revision } : {}) }
  }
}
