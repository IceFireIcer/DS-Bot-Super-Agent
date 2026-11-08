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
import type { DeliveryOptions } from './deliveries.js'
import type { HostOptions } from './host.js'
import type { ProactiveOptions } from './proactive.js'

export { Engine } from './engine.js'
export { LocalEnvironment, BoundLocalEnvironment, LocalSetupError } from './local-environment.js'
export type { LocalEnvironmentConfig, LocalCommand, LocalPermission, LocalToolFact, Artifact, LocalJob, LocalJobResult, LocalJobOutput } from './local-environment.js'
export { NativeSessions } from './native-sessions.js'
export type { NativeSessionsOptions, NativeSessionRequest, NativeTool } from './native-sessions.js'
export { SqliteSessionPersistence } from './session-persistence.js'
export type { Config as SessionPersistenceConfig } from './session-persistence.js'
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
export { localDeliveryChannel } from './deliveries.js'
export type { Delivery, DeliveryBasis, DeliveryChannel, DeliveryContext, DeliveryDestination, DeliveryOptions, DeliveryPurpose, DeliveryResult, DeliveryState, DeliveryView } from './deliveries.js'
export { HostLease } from './host.js'
export type { HostLeaseRecord, HostLeaseView, HostOptions } from './host.js'
export { RoleConfigStore, validateRoleConfig } from './config.js'
export type { RoleConfig, RoleConfigUse, RoleConfigView, RoleModel, RoleProfile, StoredRoleConfig } from './config.js'
export { FeishuSource, GitHubSource, ScheduleSource } from './channels.js'
export type { FeishuEvent, FeishuSourceConfig, GitHubEvent, GitHubSourceConfig, ScheduleConfig } from './channels.js'
export type { DeliveryCondition, DeliveryConditionKind, DeliveryConditionState, DeliveryTarget } from './delivery-state.js'
export { Proactive } from './proactive.js'
export type { ProactiveBudget, ProactiveCandidate, ProactiveMatch, ProactiveMode, ProactiveOptions, ProactivePreparation, ProactiveRule, ProactiveRun } from './proactive.js'
export { FeishuPoller, GitHubPoller, ScheduleRunner } from './pollers.js'
export type { ChannelHealth, FeishuTransport, GitHubTransport } from './pollers.js'
export { SourceMembership } from './membership.js'
export type { MembershipSnapshot, SourceMember } from './membership.js'
export { CoreError } from './model.js'
export type { DesktopSource, Receipt, SourceKind, SubmitRequest, Work, IntakePolicy, IntakeRule, IntakeAssessment, IntakeActorKind, IntakeAddressing } from './model.js'
export type { SourceObjectRef, ReceiveSourceEvent, AcceptSourceRequest, SourceEvent, SourceProjection, SourceReceipt } from './source-events.js'
export type { EvaluationItem, SourceEvaluation } from './source-evaluations.js'
export type { Attention } from './attention.js'
export type { InputDelivery, RecoveryDecision, RequeueDecision, SubscriptionDecision, ThreadSubscription, TicketDirection, WorkFanout, WorkFanoutTarget, WorkInput, WorkNote, WorkOwnership } from './work-inputs.js'
export type { AsyncTx, Storage } from './storage.js'

export interface Config { databasePath: string; instanceId: string; source: DesktopSource; storage?: Storage; effects?: EffectsOptions; sessions?: NativeSessions; environments?: LocalEnvironment[]; slots?: SlotOptions; jobs?: JobsOptions; subagents?: SubagentsOptions; delivery?: DeliveryOptions; host?: HostOptions; proactive?: ProactiveOptions }
export const name = 'ds-bot-superagent'

declare module '@deepseek-ai/cordis' { interface Context { superagent: Engine } }

export async function apply(ctx: Context, config: Config) {
  const storage = config.storage ?? await SqliteStorage.open(config.databasePath)
  let engine: Engine | undefined
  ctx.effect(() => async () => { try { await engine?.shutdown(); await engine?.effects.stop() } finally { await storage.close() } })
  engine = new Engine(storage, config.instanceId, config.source, config.effects, config.sessions, config.environments, config.slots, config.jobs, config.subagents, config.delivery, config.host, config.proactive)
  ctx.provide('superagent', engine)
  engine.effects.start()
}
