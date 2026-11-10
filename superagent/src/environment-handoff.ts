import type { AsyncTx } from './storage.js'
import type { EnvironmentLocation } from './environment.js'
import type { HandoffCopyView } from './work-copy.js'
import { uniqueBlockers } from './work-copy.js'

export type HandoffOwner = 'operator' | 'human' | 'host'
export interface HandoffBlocker { code: string; message: string; nextOwner?: HandoffOwner }
export type EnvironmentHandoffState = 'requested' | 'blocked' | 'flushing' | 'switching' | 'completed'
export interface EnvironmentHandoffStep { name: string; state: 'completed' | 'blocked'; at: number; detail?: string }
export interface EnvironmentHandoffView {
  id: string
  instanceId: string
  ticketId: string
  source: EnvironmentLocation
  target: EnvironmentLocation
  sourceAssignmentId: string
  sourceGeneration: string
  targetAssignmentId?: string
  targetGeneration?: string
  copyId?: string
  state: EnvironmentHandoffState
  reason: string
  requestedBy: string
  requestedAt: number
  promptStartedAt?: number
  completedAt?: number
  recoveredAt?: number
  /** Settled source jobs that were queried before the switch; evidence that no unaccounted range was left behind. */
  settledJobs?: string[]
  blockers: HandoffBlocker[]
  steps: EnvironmentHandoffStep[]
  /** The command receipt that owns this record, kept so a restart can finish the same command instead of a new one. */
  command?: EnvironmentHandoffCommand
}
export interface EnvironmentHandoffCommand { key: string; fingerprint: string }
export interface EnvironmentHandoffRevalidation {
  target?: EnvironmentLocation
  copy?: HandoffCopyView
  blockers: HandoffBlocker[]
}

const environmentHandoffKey = (ticketId: string) => JSON.stringify(['handoff-state', ticketId])
const environmentHandoffHistoryPrefix = (ticketId: string) => JSON.stringify(['handoff-history', ticketId])

export function loadEnvironmentHandoff(transaction: AsyncTx, ticketId: string) {
  return transaction.get<EnvironmentHandoffView>('handoff-state', environmentHandoffKey(ticketId))
}

export async function saveEnvironmentHandoffIn(transaction: AsyncTx, record: EnvironmentHandoffView,
  command?: EnvironmentHandoffCommand) {
  const persisted: EnvironmentHandoffView = { ...record, blockers: withHandoffOwners(record.blockers) }
  const key = environmentHandoffKey(persisted.ticketId)
  if (!await transaction.replace('handoff-state', key, persisted)) await transaction.insert('handoff-state', key, persisted)
  const historyKey = `${environmentHandoffHistoryPrefix(persisted.ticketId)}:${String(persisted.requestedAt).padStart(16, '0')}:${persisted.id}`
  if (!await transaction.replace('handoff-history', historyKey, persisted)) await transaction.insert('handoff-history', historyKey, persisted)
  // The command receipt is written only with a terminal state, in the same transaction that writes it, so a
  // replay either returns this result or the handoff was not yet answered and can be retried.
  if (command && persisted.state !== 'requested' && persisted.state !== 'flushing' && persisted.state !== 'switching'
    && !await transaction.replace('work-command', command.key, { fingerprint: command.fingerprint, record: persisted })) {
    await transaction.insert('work-command', command.key, { fingerprint: command.fingerprint, record: persisted })
  }
  return persisted
}

const ownerByCode: Record<string, HandoffOwner> = {
  'target-ineligible': 'operator',
  'source-environment-changed': 'operator',
  'target-environment-changed': 'operator',
  'handoff-copy-missing': 'operator',
  'handoff-copy-not-verified': 'operator',
  'handoff-copy-stale': 'operator',
  'setup-failed': 'operator',
  'ticket-ended': 'human',
  'ticket-constrained': 'human',
  'ticket-stopping': 'human',
  'waiting-human': 'human',
  'unknown-effect': 'human',
  'handoff-superseded': 'human',
  'session-flush-failed': 'host',
  'handoff-recovery-failed': 'host',
  'active-turn': 'host',
  'active-job': 'host',
  'active-subagent': 'host',
  'active-preview': 'host',
  'handoff-stale': 'host',
  'handoff-revalidation-failed': 'host',
  'same-environment': 'operator',
  'no-assignment': 'host',
  'assignment-not-running': 'host',
  'ready-report': 'human',
}

export function withHandoffOwners(blockers: HandoffBlocker[]): HandoffBlocker[] {
  return uniqueBlockers(blockers.map(blocker => ({ ...blocker, nextOwner: blocker.nextOwner ?? ownerByCode[blocker.code] ?? 'operator' })))
}

export function isEnvironmentHandoffActive(record: EnvironmentHandoffView) {
  return Boolean(record && ['requested', 'flushing', 'switching'].includes(record.state))
}

export function isHandoffPromptPending(record: EnvironmentHandoffView | undefined, assignmentId: string | undefined) {
  return Boolean(record?.state === 'completed' && record.targetAssignmentId === assignmentId && record.promptStartedAt === undefined)
}

export function handoffCopyBlockers(copy: HandoffCopyView | undefined, assignmentId: string | undefined,
  source: EnvironmentLocation, target: EnvironmentLocation): HandoffBlocker[] {
  if (!copy) return [{ code: 'handoff-copy-missing', message: 'No prepared work copy exists for this handoff.' }]
  const blockers: HandoffBlocker[] = []
  if (copy.status !== 'verified') blockers.push({ code: 'handoff-copy-not-verified', message: 'The prepared work copy has not been verified.' })
  if (assignmentId && copy.assignmentId !== assignmentId) {
    blockers.push({ code: 'handoff-copy-stale', message: 'The work copy belongs to a different Assignment generation.' })
  }
  if (copy.source.id !== source.id || copy.source.kind !== source.kind || copy.source.root !== source.root) {
    blockers.push({ code: 'handoff-copy-stale', message: 'The work copy source no longer matches the fixed Assignment.' })
  }
  if (copy.target.id !== target.id || copy.target.kind !== target.kind || copy.target.root !== target.root
    || copy.target.deviceId !== target.deviceId || copy.target.deviceIncarnation !== target.deviceIncarnation) {
    blockers.push({ code: 'handoff-copy-stale', message: 'The work copy target no longer matches the requested Environment.' })
  }
  return uniqueBlockers(blockers)
}

export function environmentHandoffPrompt(record: EnvironmentHandoffView | undefined) {
  if (!record?.targetAssignmentId) {
    return 'Continue this Ticket after an execution Environment handoff. The Ticket, Mandate and Session history are unchanged. '
      + 'Inspect the retained Session, the current working directory, version control and external state before changing anything. '
      + 'Do not repeat completed side effects, do not re-add the original request, and do not widen scope.'
  }
  return `Continue this Ticket in the new execution Environment. Source: ${record.source.id} at ${record.source.root}. `
    + `Target: ${record.target.id} at ${record.target.root}. The Ticket, Mandate and Session history are unchanged; the work copy was verified as ${record.copyId ?? 'not recorded'}. `
    + 'Inspect the retained Session, the new working directory, version control and external state before changing anything. '
    + 'Do not repeat completed side effects, do not re-add the original request, and do not widen scope.'
}
