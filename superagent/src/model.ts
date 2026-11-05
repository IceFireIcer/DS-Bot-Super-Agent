export class CoreError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CoreError' }
}

export interface Source {
  kind: 'desktop'
  sourceInstanceId: string
  actorId: string
}

export interface DesktopSource {
  sourceInstanceId: string
  actorId: string
  allowedActorIds: string[]
  allowedThreadIds?: string[]
  versionOrder?: 'sequence' | 'opaque'
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
  decision: { id: string; instanceId: string; triggerId: string; outcome: 'accept'; policyVersion: 'desktop-explicit-v1' }
  mandate: { id: string; instanceId: string; decisionId: string; scope: string; strength: 'explicit'; environment: 'local' }
  ticket: { id: string; instanceId: string; mandateId: string; triggerId: string; state: 'open' }
  intent: { id: string; instanceId: string; ticketId: string; state: 'pending' | 'running' | 'ready'; reason: 'worker-not-enabled' | 'router-pending' | 'worker-running' | 'worker-idle' | 'ready-report' | 'setup-failed' | 'setup-pending'; environment: 'local' }
}

export interface CommandRecord { fingerprint: string; receipt: Receipt }
export interface EventRecord { fingerprint: string; receipt: Receipt }

export const recordKinds = ['trigger', 'decision', 'mandate', 'ticket', 'intent', 'command', 'event', 'effect', 'effect-key', 'effect-meta', 'effect-receipt', 'assignment', 'report', 'session', 'delivery', 'setup', 'setup-retry', 'source-event', 'source-object', 'source-command', 'source-mode'] as const
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
