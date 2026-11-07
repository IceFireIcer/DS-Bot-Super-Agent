import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export interface SlotOptions {
  /** Normal slots: launches and automatic follow-ups. Defaults to 2. */
  maxSlots?: number
  /** Extra slots reserved for a person, a status request or a resume. Defaults to 1. */
  maxPrioritySlots?: number
}

export type SlotWaitingReason = 'SLOTS_FULL' | 'PRIORITY_WAITING'
export type SlotActivation = 'launch' | 'followup' | 'status' | 'resume'

export interface ExecutionSlot {
  ticketId: string
  assignmentId: string
  state: 'holding' | 'waiting'
  priority: boolean
  activation: SlotActivation
  phase: 'prepare' | 'turn'
  sequence: number
  since: number
  runtimeToken: string
  waitingReason?: SlotWaitingReason
}

export interface SlotLimits { normal: number; priority: number }
export interface SlotSnapshot { limits: SlotLimits; holding: ExecutionSlot[]; waiting: ExecutionSlot[] }
export type SlotAcquisition = { acquired: true; slot: ExecutionSlot } | { acquired: false; reason: SlotWaitingReason }

const slotPrefix = JSON.stringify(['execution-slot'])
const slotKey = (ticketId: string) => `${slotPrefix}:${ticketId}`
const sequenceKey = JSON.stringify(['execution-slot-meta', 'sequence'])

/**
 * Durable admission for Worker turns. A slot covers preparation, launch, wake-up and the active turn,
 * and is owned by one Assignment so two Tickets never share it or slip into each other's budget.
 */
export class Slots {
  readonly maxSlots: number
  readonly maxPrioritySlots: number
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly runtimeToken: string,
    options: SlotOptions = {}, private readonly now: () => number = Date.now) {
    this.maxSlots = options.maxSlots ?? 2
    this.maxPrioritySlots = options.maxPrioritySlots ?? 1
    if (!Number.isInteger(this.maxSlots) || this.maxSlots < 1 || this.maxSlots > 20) throw new CoreError('INVALID_CONFIG', 'Invalid execution slot budget.')
    if (!Number.isInteger(this.maxPrioritySlots) || this.maxPrioritySlots < 0 || this.maxPrioritySlots > 5) throw new CoreError('INVALID_CONFIG', 'Invalid execution slot budget.')
  }

  async acquire(tx: AsyncTx, request: { ticketId: string; assignmentId: string; activation: SlotActivation }): Promise<SlotAcquisition> {
    identifier(request.ticketId, 'ticketId')
    identifier(request.assignmentId, 'assignmentId')
    const slots = await this.current(tx)
    const own = slots.find(slot => slot.ticketId === request.ticketId)
    if (own?.state === 'holding' && own.assignmentId === request.assignmentId) return { acquired: true, slot: own }
    const holding = slots.filter(slot => slot.state === 'holding' && slot.ticketId !== request.ticketId)
    const normal = holding.filter(slot => !slot.priority).length
    const extra = holding.filter(slot => slot.priority).length
    const priorityWaiting = slots.some(slot => slot.state === 'waiting' && slot.priority && slot.ticketId !== request.ticketId)
    // A person's follow-up, a status request or a resume may use the bounded extra slot; a fresh launch may not.
    // Worker follow-up Inputs only ever come from an authorized human message, so they count as a person's input.
    // The extra slot is only an overflow: while normal capacity is free, every admission takes a normal slot so
    // the number of priority holds can never exceed its bound.
    const eligible = request.activation !== 'launch'
    const priority = eligible && normal >= this.maxSlots
    let reason: SlotWaitingReason | undefined
    if (priority && extra >= this.maxPrioritySlots) reason = 'SLOTS_FULL'
    else if (normal >= this.maxSlots && !priority) reason = 'SLOTS_FULL'
    else if (!priority && priorityWaiting) reason = 'PRIORITY_WAITING'
    const sequence = own?.sequence ?? await this.nextSequence(tx)
    if (reason) {
      await this.write(tx, { ticketId: request.ticketId, assignmentId: request.assignmentId, state: 'waiting', priority,
        activation: request.activation, phase: 'prepare', sequence, since: this.now(), runtimeToken: this.runtimeToken, waitingReason: reason })
      return { acquired: false, reason }
    }
    const slot: ExecutionSlot = { ticketId: request.ticketId, assignmentId: request.assignmentId, state: 'holding', priority,
      activation: request.activation, phase: 'prepare', sequence, since: this.now(), runtimeToken: this.runtimeToken }
    await this.write(tx, slot)
    return { acquired: true, slot }
  }

  async phase(tx: AsyncTx, request: { ticketId: string; assignmentId: string; phase: ExecutionSlot['phase'] }) {
    const current = await tx.get<ExecutionSlot>('execution-slot', slotKey(request.ticketId))
    if (current?.state !== 'holding' || current.assignmentId !== request.assignmentId || current.phase === request.phase) return
    await tx.replace('execution-slot', slotKey(request.ticketId), { ...current, phase: request.phase })
  }

  async release(tx: AsyncTx, request: { ticketId: string; assignmentId?: string }) {
    const current = await tx.get<ExecutionSlot>('execution-slot', slotKey(request.ticketId))
    if (!current) return false
    if (request.assignmentId !== undefined && current.assignmentId !== request.assignmentId) return false
    return tx.remove('execution-slot', slotKey(request.ticketId))
  }

  /** A queued relay becomes due the moment capacity frees, so the caller may wake the dispatcher. */
  async hasWaiting(tx: AsyncTx) {
    return (await this.current(tx)).some(slot => slot.state === 'waiting')
  }

  list(): Promise<SlotSnapshot> {
    return this.storage.transaction(this.instanceId, async tx => {
      const slots = await this.current(tx)
      return { limits: { normal: this.maxSlots, priority: this.maxPrioritySlots },
        holding: slots.filter(slot => slot.state === 'holding').sort((left, right) => left.sequence - right.sequence),
        waiting: slots.filter(slot => slot.state === 'waiting').sort((left, right) => left.sequence - right.sequence) }
    })
  }

  async currentFor(tx: AsyncTx, ticketId: string) {
    return tx.get<ExecutionSlot>('execution-slot', slotKey(ticketId))
  }

  private async write(tx: AsyncTx, slot: ExecutionSlot) {
    if (!await tx.replace('execution-slot', slotKey(slot.ticketId), slot)) await tx.insert('execution-slot', slotKey(slot.ticketId), slot)
  }

  private async nextSequence(tx: AsyncTx) {
    const sequence = (await tx.get<number>('execution-slot-meta', sequenceKey) ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) throw new CoreError('SLOT_BUDGET', 'The execution slot sequence is exhausted.')
    if (!await tx.replace('execution-slot-meta', sequenceKey, sequence)) await tx.insert('execution-slot-meta', sequenceKey, sequence)
    return sequence
  }

  // A hold recorded by an earlier runtime cannot be proven live, so it stops counting against this runtime's budget.
  private async current(tx: AsyncTx) {
    const items: ExecutionSlot[] = []
    let cursor = slotPrefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<ExecutionSlot>('execution-slot', { limit: 100, after: cursor })
      for (const item of page.items) {
        // Only this runtime's holds and waits can be proven live; anything older is audit-only.
        if (item.value.runtimeToken !== this.runtimeToken) {
          await tx.remove('execution-slot', item.id)
          continue
        }
        items.push(item.value)
      }
      if (!page.cursor || !page.cursor.startsWith(`${slotPrefix}:`)) return items
      cursor = page.cursor
    }
    throw new CoreError('SLOT_BUDGET', 'The execution slot query exceeded its 1000-record budget.')
  }
}
