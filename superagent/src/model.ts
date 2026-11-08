export class CoreError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CoreError' }
}

export type SourceKind = 'desktop' | 'github' | 'feishu' | 'schedule'
export interface Source {
  kind: SourceKind
  sourceInstanceId: string
  actorId: string
}

export interface DesktopSource {
  kind?: SourceKind
  sourceInstanceId: string
  actorId: string
  allowedActorIds: string[]
  allowedThreadIds?: string[]
  allowedThreadPrefixes?: string[]
  versionOrder?: 'sequence' | 'opaque'
  intake?: IntakePolicy
}

export type IntakeActorKind = 'human' | 'bot' | 'ci' | 'system'
export type IntakeAddressing = 'direct' | 'mention' | 'ambient'
export interface IntakeRule { id: string; actorKinds: IntakeActorKind[]; addressing: IntakeAddressing[]; mode: 'explicit' | 'inferred' }
export interface IntakeAssessment { eventId: string; outcome: 'accept' | 'reject'; reason: string; evidence?: string }
export interface IntakePolicy {
  mode?: 'off' | 'observe' | 'auto'
  maxBatchSize: number
  maxQueuedEvals?: number
  maxAttempts: number
  timeoutMs: number
  allowedRequesterIds: string[]
  allowedBotActorIds: string[]
  selfActorIds?: string[]
  rules: IntakeRule[]
  assess?: (events: Record<string, unknown>[], signal: AbortSignal, onDelivered: () => Promise<void>) => Promise<IntakeAssessment[]>
}

export interface SubmitRequest {
  commandId: string
  eventId: string
  text: string
  mode?: 'explicit'
  execution?: 'local'
  environmentId?: string
}

export interface Receipt {
  instanceId: string
  ticketId: string
  triggerId: string
  acceptedCommandId: string
  status: 'pending'
}

export interface Work {
  trigger: { id: string; instanceId: string; source: Source; eventId: string; text: string; environmentId?: string; threadId?: string; nativeVersion?: { order: 'sequence' | 'opaque'; value: string } }
  decision: { id: string; instanceId: string; triggerId: string; outcome: 'accept'; policyVersion: string }
  mandate: { id: string; instanceId: string; decisionId: string; scope: string; strength: 'explicit' | 'inferred'; environment: 'local' }
  ticket: { id: string; instanceId: string; mandateId: string; triggerId: string; state: 'open' | 'ended'; directionVersion?: number; constraint?: { kind: 'stopped' | 'waiting-human'; attentionId?: string; stopId?: string; reason?: string } }
  intent: { id: string; instanceId: string; ticketId: string; state: 'pending' | 'running' | 'ready'; reason: 'worker-not-enabled' | 'router-pending' | 'worker-running' | 'worker-idle' | 'worker-background' | 'ready-report' | 'setup-failed' | 'setup-pending' | 'followup-pending' | 'waiting-human' | 'stopping' | 'stopped' | 'slot-queued' | 'slot-priority-waiting' | 'recovery-exhausted' | 'recovery-pending' | 'recovery-blocked' | 'context-rollover'; environment: 'local' }
}

export interface CommandRecord { fingerprint: string; receipt: Receipt }
export interface EventRecord { fingerprint: string; receipt: Receipt }

export const recordKinds = ['trigger', 'decision', 'mandate', 'ticket', 'intent', 'command', 'event', 'effect', 'effect-key', 'effect-meta', 'effect-receipt', 'assignment', 'assignment-history', 'report', 'report-history', 'session', 'delivery', 'delivery-history', 'delivery-meta', 'setup', 'setup-retry', 'source-event', 'source-object', 'source-command', 'source-mode', 'source-members', 'source-members-history', 'eval', 'eval-command', 'eval-dismissal', 'policy-reevaluation', 'thread-subscription', 'ticket-thread-subscription', 'work-input', 'pending-input', 'work-fanout', 'work-fanout-target', 'work-ownership', 'event-work-ownership', 'work-note', 'work-note-meta', 'work-command', 'work-requeue', 'subscription-decision', 'recovery-decision', 'retry-decision', 'session-rollover', 'role-config', 'role-config-history', 'role-config-use', 'channel-cursor', 'schedule-state', 'schedule-rule', 'delivery-target', 'delivery-target-decision', 'delivery-condition', 'delivery-condition-history', 'proactive-rule', 'proactive-rule-history', 'proactive-run', 'attention', 'attention-head', 'attention-meta', 'stop-state', 'stop-head', 'stop-history', 'resume-decision', 'policy-state', 'policy-history', 'processing-state', 'execution-slot', 'execution-slot-meta', 'status-report', 'status-history', 'job', 'job-command', 'job-active', 'preview', 'preview-command', 'preview-history', 'subagent', 'subagent-command', 'background', 'session-meta', 'session-event', 'session-writer', 'host-lease'] as const
export type RecordKind = typeof recordKinds[number]

export function identifier(value: unknown, label: string): asserts value is string {
  const hasInvalidCharacter = typeof value === 'string' && Array.from(value).some(character => {
    const code = character.codePointAt(0)!
    return code < 32 || code === 127 || code >= 0xd800 && code <= 0xdfff
  })
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 512 || hasInvalidCharacter) {
    throw new CoreError('INVALID_INPUT', `${label} must be a well-formed nonempty identifier of at most 512 bytes without control characters.`)
  }
}
