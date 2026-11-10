import type { AsyncTx } from './storage.js'

export type HostTakeoverOutcome = 'resumed' | 'waiting-job' | 'waiting-human' | 'stopped' | 'blocked'
  | 'idle' | 'ended' | 'revoked' | 'input-pending' | 'handoff-pending'

export interface HostTakeoverBlocker {
  code: string
  message: string
  jobId?: string
  subagentId?: string
}

/** The decision one Ticket received while a new Host epoch was being made current. */
export interface HostTakeoverTicket {
  ticketId: string
  outcome: HostTakeoverOutcome
  previousAssignmentId?: string
  previousGeneration?: string
  assignmentId?: string
  sessionId?: string
  blockers: HostTakeoverBlocker[]
}

/**
 * One durable Host replacement. `pending` is written in the same transaction that advances the epoch, so a
 * crash during reconciliation leaves new input and new Assignments blocked until a later explicit acquisition
 * finishes the same record.
 */
export interface HostTakeoverRecord {
  id: string
  instanceId: string
  epoch: number
  previousHostId?: string
  previousEpoch?: number
  previousToken?: string
  state: 'pending' | 'completed'
  startedAt: number
  completedAt?: number
  tickets: HostTakeoverTicket[]
}

export function hostTakeoverKey(instanceId: string, epoch: number) {
  return JSON.stringify(['host-takeover', instanceId, epoch])
}

export async function loadHostTakeover(transaction: AsyncTx, instanceId: string, epoch: number) {
  return transaction.get<HostTakeoverRecord>('host-takeover', hostTakeoverKey(instanceId, epoch))
}
