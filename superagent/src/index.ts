import type { Context } from '@deepseek-ai/cordis'
import { Engine } from './engine.js'
import { SqliteStorage, type Storage } from './storage.js'
import type { DesktopSource } from './model.js'
import type { EffectsOptions } from './effects.js'
import type { NativeSessions } from './native-sessions.js'
import type { LocalEnvironment } from './local-environment.js'
import type { SlotOptions } from './slots.js'
import type { JobsOptions } from './jobs.js'
import type { SubagentsOptions } from './subagents.js'

export { Engine } from './engine.js'
export { LocalEnvironment, BoundLocalEnvironment, LocalSetupError } from './local-environment.js'
export type { LocalEnvironmentConfig, LocalCommand, LocalPermission, LocalToolFact, Artifact, LocalJob, LocalJobResult, LocalJobOutput } from './local-environment.js'
export { NativeSessions } from './native-sessions.js'
export type { NativeSessionsOptions, NativeSessionRequest, NativeTool } from './native-sessions.js'
export { Slots } from './slots.js'
export type { ExecutionSlot, SlotActivation, SlotLimits, SlotOptions, SlotSnapshot, SlotWaitingReason } from './slots.js'
export { Jobs } from './jobs.js'
export type { JobCancelReason, JobOutput, JobRecord, JobStart, JobState, JobStream, JobView, JobsOptions } from './jobs.js'
export { Previews } from './previews.js'
export type { PreviewRecord, PreviewState, PreviewView } from './previews.js'
export { Subagents } from './subagents.js'
export type { SubagentCancelReason, SubagentRecord, SubagentResult, SubagentScope, SubagentStart, SubagentState, SubagentView, SubagentsOptions } from './subagents.js'
export { BackgroundWork } from './background.js'
export type { BackgroundEntry, BackgroundIndexRecord, BackgroundKind, BackgroundLiveness } from './background.js'
export type { StatusReport } from './execution.js'
export { createChatServer } from './chat-server.js'
export { Effects } from './effects.js'
export type { Effect, EffectRequest, EffectReceipt, EffectResult, EffectHandler, EffectsOptions } from './effects.js'
export { CoreError } from './model.js'
export type { DesktopSource, Receipt, SubmitRequest, Work, IntakePolicy, IntakeRule, IntakeAssessment, IntakeActorKind, IntakeAddressing } from './model.js'
export type { SourceObjectRef, ReceiveSourceEvent, AcceptSourceRequest, SourceEvent, SourceProjection, SourceReceipt } from './source-events.js'
export type { EvaluationItem, SourceEvaluation } from './source-evaluations.js'
export type { Attention } from './attention.js'
export type { RecoveryDecision, RequeueDecision, SubscriptionDecision, ThreadSubscription, TicketDirection, WorkFanout, WorkFanoutTarget, WorkInput, WorkNote, WorkOwnership } from './work-inputs.js'
export type { AsyncTx, Storage } from './storage.js'

export interface Config { databasePath: string; instanceId: string; source: DesktopSource; storage?: Storage; effects?: EffectsOptions; sessions?: NativeSessions; environments?: LocalEnvironment[]; slots?: SlotOptions; jobs?: JobsOptions; subagents?: SubagentsOptions }
export const name = 'ds-bot-superagent'

declare module '@deepseek-ai/cordis' { interface Context { superagent: Engine } }

export async function apply(ctx: Context, config: Config) {
  const storage = config.storage ?? await SqliteStorage.open(config.databasePath)
  let engine: Engine | undefined
  ctx.effect(() => async () => { try { await engine?.shutdown(); await engine?.effects.stop() } finally { await storage.close() } })
  engine = new Engine(storage, config.instanceId, config.source, config.effects, config.sessions, config.environments, config.slots, config.jobs, config.subagents)
  ctx.provide('superagent', engine)
  if (config.effects?.handlers || config.sessions) engine.effects.start()
}
