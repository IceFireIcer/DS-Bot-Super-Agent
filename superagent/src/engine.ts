import { createHash, randomUUID } from 'node:crypto'
import { CoreError, identifier, type CommandRecord, type DesktopSource, type EventRecord, type IntakePolicy, type Receipt, type Source, type SubmitRequest, type Work } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { canonicalJson, commandTransaction } from './commands.js'
import { Effects, type EffectsOptions } from './effects.js'
import { Execution } from './execution.js'
import type { NativeSessions } from './native-sessions.js'
import type { LocalEnvironment } from './local-environment.js'
import { SourceEvents, type AcceptSourceRequest, type ReceiveSourceEvent, type SourceEvent, type SourceObjectRef } from './source-events.js'
import { SourceEvaluations, validateIntakePolicy, type SourceEvaluation } from './source-evaluations.js'
import { WorkInputs, type TicketDirection, type WorkNote } from './work-inputs.js'
import { Attentions, type Attention } from './attention.js'
import { Slots, type SlotOptions, type SlotSnapshot } from './slots.js'
import { Jobs, type JobsOptions, type JobView } from './jobs.js'
import type { Previews, PreviewView } from './previews.js'
import { Subagents, type SubagentsOptions, type SubagentView } from './subagents.js'
import { Deliveries, type DeliveryOptions, type DeliveryView } from './deliveries.js'
import { Outbox } from './outbox.js'
import { HostLease, type HostOptions } from './host.js'
import { ContextReader, type ContextCandidate, type ContextCard, type ContextRequest } from './context.js'
import { RoleConfigStore, validateRoleConfig, type RoleConfig, type RoleConfigUse, type RoleConfigView } from './config.js'
import { DeliveryState, type DeliveryCondition, type DeliveryTarget } from './delivery-state.js'
import { Proactive, type ProactiveCandidate, type ProactiveOptions, type ProactiveRule, type ProactiveRun } from './proactive.js'
import { SourceMembership, type MembershipSnapshot, type SourceMember } from './membership.js'

interface StoredPolicy { revision: number; configuration: Omit<IntakePolicy, 'assess'>; origin: 'bootstrap' | 'manual' | 'sync'; sourceRevision?: string; updatedAt: number }
interface ProcessingState { paused: boolean; revision: number; updatedAt: number }
interface StoredPolicyNotice { key: string; ticketId: string; revision: number; reason: string }

export class Engine {
  readonly effects: Effects
  private readonly slots: Slots | undefined
  private readonly jobs: Jobs | undefined
  private readonly previews: Previews | undefined
  private readonly subagents: Subagents | undefined
  private readonly execution: Execution | undefined
  private readonly sourceEvents: SourceEvents
  private readonly evaluations: SourceEvaluations | undefined
  private readonly inputs: WorkInputs
  private readonly attentions: Attentions
  private readonly deliveries: Deliveries
  private readonly outbox: Outbox
  private readonly storage: Storage
  private readonly host: HostLease
  private readonly context: ContextReader
  private readonly sessions: NativeSessions | undefined
  private readonly roleConfig: RoleConfigStore
  private readonly deliveryState: DeliveryState
  private readonly proactive: Proactive | undefined
  private readonly membership: SourceMembership
  private roleConfigRevision = 1
  private policyRevision = 1
  private processingPaused = false
  private policyReady: Promise<void> | undefined
  private configuredIntake: IntakePolicy | undefined
  private readonly configuredAssessor: IntakePolicy['assess'] | undefined
  private readonly defaultAssessor: IntakePolicy['assess'] | undefined
  private readonly initialIntake: IntakePolicy | undefined
  private initialPolicyRevision = 1
  private hasPersistedPolicy = false
  private avoidPolicyPersistence = false
  private commandKey(commandId: string) { return createHash('sha256').update(JSON.stringify([this.source.sourceInstanceId, this.source.actorId, commandId])).digest('hex') }
  private policyKey() { return JSON.stringify(['policy-state', this.source.sourceInstanceId]) }
  private processingKey() { return JSON.stringify(['processing-state', this.source.sourceInstanceId]) }

  private async ensurePolicy() {
    if (this.avoidPolicyPersistence) {
      if (this.configuredIntake) this.evaluations?.replacePolicy(this.configuredIntake, 1, this.configuredAssessor)
      return
    }

    if (this.policyReady) {
      try { await this.policyReady }
      catch (error) { this.policyReady = undefined; throw error }
      return
    }
    this.policyReady = commandTransaction(this.storage, this.instanceId, async tx => {
      const stored = await tx.get<StoredPolicy>('policy-state', this.policyKey())
      const currentAssessor = this.configuredAssessor
      const configured = this.initialIntake
      if (stored && stored.origin !== 'bootstrap') {
        this.hasPersistedPolicy = true
        this.applyPolicy(stored.configuration, stored.revision, currentAssessor)
      } else if (configured) {
        const { assess: _assess, ...configuration } = configured
        const persistedConfiguration = structuredClone(configuration)
        const initial: StoredPolicy = { revision: this.initialPolicyRevision, configuration: persistedConfiguration, origin: 'bootstrap', updatedAt: Date.now() }
        if (!await tx.replace('policy-state', this.policyKey(), initial)) await tx.insert('policy-state', this.policyKey(), initial)
      }
      const processing = await tx.get<ProcessingState>('processing-state', this.processingKey())
      if (processing) this.processingPaused = processing.paused
      this.effects.setPaused(this.processingPaused)
      this.evaluations?.setPaused(this.processingPaused)
    })
    try { await this.policyReady }
    catch (error) { this.policyReady = undefined; throw error }
    await this.getRoleConfig()
    if (this.configuredIntake && !this.hasPersistedPolicy) await this.syncConfiguredPolicy()
  }

  private async syncConfiguredPolicy() {
    if (!this.configuredIntake) return
    const configured = this.initialIntake!
    const { assess: _assess, ...configuration } = configured
    const fingerprint = createHash('sha256').update(canonicalJson(configuration)).digest('hex')
    const key = JSON.stringify(['policy-bootstrap', this.source.sourceInstanceId])
    await this.storage.transaction(this.instanceId, async tx => {
      const prior = await tx.get<{ fingerprint: string }>('policy-state', key)
      if (prior?.fingerprint === fingerprint) return
      const revision = Math.max(this.initialPolicyRevision, ((await tx.get<StoredPolicy>('policy-state', this.policyKey()))?.revision ?? 0) + 1)
      const stored: StoredPolicy = { revision, configuration: structuredClone(configuration), origin: 'bootstrap', updatedAt: Date.now() }
      if (!await tx.replace('policy-state', this.policyKey(), stored)) await tx.insert('policy-state', this.policyKey(), stored)
      if (!await tx.replace('policy-state', key, { fingerprint })) await tx.insert('policy-state', key, { fingerprint })
      this.hasPersistedPolicy = true
      this.applyPolicy(this.initialIntake!, revision, this.configuredAssessor)
    })
  }

  private applyPolicy(policy: IntakePolicy | undefined, revision: number, assessor: IntakePolicy['assess'] | undefined = undefined) {
    if (!policy) return
    this.source.intake = policy
    this.policyRevision = revision
    this.evaluations?.replacePolicy(policy, revision, assessor ?? this.defaultAssessor)
    this.inputs.setPolicy(policy)
    this.execution?.setAllowedRequesterIds(policy.allowedRequesterIds)
  }

  private async drainPolicyReevaluations() {
    if (this.processingPaused) return
      const prefix = JSON.stringify(['policy-reevaluation', this.source.sourceInstanceId])
    const pending = await commandTransaction(this.storage, this.instanceId, async tx => {
      let cursor = prefix
      const items: StoredPolicyNotice[] = []
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await tx.scan<StoredPolicyNotice>('policy-reevaluation', { limit: 100, after: cursor })
        items.push(...page.items.map(item => item.value))
        if (!page.cursor || !page.cursor.startsWith(prefix)) return items
        cursor = page.cursor
        if (pageCount === 9) {
          const confirmation = await tx.scan<StoredPolicyNotice>('policy-reevaluation', { limit: 1, after: cursor })
          if (!confirmation.items[0]?.id.startsWith(prefix)) return items
          throw new CoreError('EVAL_BUDGET', 'The pending Policy reevaluation scan exceeded its 1000-record budget.')
        }
      }
      return items
    })
    if (!this.evaluations) return
    for (const item of pending) {
      await commandTransaction(this.storage, this.instanceId, tx => this.evaluations!.requeueInterrupted(tx, { evaluationId: item.ticketId, candidateEventIds: [] }, item.reason))
    }
    const threads = new Set<string>()
    for (const item of pending) {
      const detail = await this.storage.transaction(this.instanceId, tx => tx.get<SourceEvaluation>('eval', item.ticketId))
      if (detail) threads.add(detail.threadId)
    }
    await commandTransaction(this.storage, this.instanceId, async tx => {
      for (const item of pending) await tx.remove('policy-reevaluation', item.key)
    })
    for (const threadId of threads) await this.evaluations.runAll(threadId)
  }
  constructor(rawStorage: Storage, private readonly instanceId: string, private readonly source: DesktopSource, effectsOptions: EffectsOptions = {}, sessions?: NativeSessions, private readonly environments: LocalEnvironment[] = [], slotOptions: SlotOptions = {}, jobOptions: JobsOptions = {}, subagentOptions: SubagentsOptions = {}, deliveryOptions: DeliveryOptions = {}, hostOptions: HostOptions = {}, proactiveOptions?: ProactiveOptions) {
    identifier(instanceId, 'instanceId')
    identifier(source.sourceInstanceId, 'sourceInstanceId')
    identifier(source.actorId, 'actorId')
    this.host = new HostLease(rawStorage, instanceId, hostOptions)
    const storage = this.host.guard(rawStorage)
    this.storage = storage
    this.sessions = sessions
    this.roleConfig = new RoleConfigStore(storage, instanceId, {
      router: { name: 'Router', model: sessions?.routerRoute ?? { provider: 'unconfigured', model: 'unconfigured' }, instructions: '', skills: [] },
      worker: { name: 'Worker', model: sessions?.workerRoute ?? { provider: 'unconfigured', model: 'unconfigured' }, instructions: '', skills: [] },
    }, Date.now)
    if (!Array.isArray(source.allowedActorIds)) throw new CoreError('INVALID_CONFIG', 'allowedActorIds must be explicitly configured.')
    for (const actor of source.allowedActorIds) identifier(actor, 'allowedActorId')
    const { intake, ...serializableSource } = source
    this.avoidPolicyPersistence = typeof storage.transaction !== 'function'
    this.defaultAssessor = intake?.assess ?? (sessions ? ((events: Record<string, unknown>[], signal: AbortSignal, onDelivered: () => Promise<void>) => sessions.assessSourceBatch(events, signal, onDelivered)) : undefined)
    this.configuredAssessor = this.defaultAssessor
    this.configuredIntake = intake
    if (intake) {
      const { assess: _assess, ...configuration } = intake
      const clonedConfiguration = structuredClone(configuration)
      this.initialIntake = intake.assess ? { ...clonedConfiguration, assess: intake.assess } : clonedConfiguration
    }
    const clonedSource = structuredClone(serializableSource)
    this.source = intake ? { ...clonedSource, intake } : clonedSource
    const sourceBinding = { ...this.source }
    delete sourceBinding.intake
    this.sourceEvents = new SourceEvents(storage, instanceId, sourceBinding)
    this.membership = new SourceMembership(storage, instanceId, this.source.sourceInstanceId, Date.now)
    this.deliveryState = new DeliveryState(storage, instanceId, this.sourceEvents, Date.now)
    this.proactive = proactiveOptions ? new Proactive(storage, instanceId, proactiveOptions) : undefined
    if (sessions && (effectsOptions.operationTimeoutMs ?? 60000) <= sessions.timeoutMs) throw new CoreError('INVALID_CONFIG', 'The effect deadline must exceed the native Session turn budget.')
    this.effects = new Effects(storage, instanceId, sessions ? { ...effectsOptions, operationTimeoutMs: effectsOptions.operationTimeoutMs ?? 60000 } : effectsOptions)
    this.effects.setGate({ paused: async tx => (await tx.get<ProcessingState>('processing-state', this.processingKey()))?.paused === true })
    this.deliveries = new Deliveries(storage, instanceId, this.effects, Date.now)
    this.outbox = new Outbox(storage, instanceId, this.deliveries, this.sourceEvents, this.deliveryState, deliveryOptions.channel)
    this.inputs = new WorkInputs(storage, instanceId, this.source, this.sourceEvents, (tx, request) => this.effects.enqueue(tx, request), Date.now)
    this.attentions = new Attentions(storage, instanceId, this.sourceEvents, this.inputs, this.effects, this.deliveries, Date.now)
    this.context = new ContextReader(storage, instanceId, this.sourceEvents, this.attentions, this.deliveries)
    const assessor = intake?.assess ?? (sessions ? ((events: Record<string, unknown>[], signal: AbortSignal, onDelivered: () => Promise<void>) => sessions.assessSourceBatch(events, signal, onDelivered)) : undefined)
    this.evaluations = intake ? new SourceEvaluations(storage, instanceId, intake, this.sourceEvents,
      (tx, event, strength, commandId, policyVersion, newDecision) => this.accept(tx, commandId, {
        id: newDecision ? JSON.stringify([event.id, 'manual-requeue', commandId]) : event.id,
        instanceId, source: event.source, eventId: event.objectId, threadId: event.threadId, nativeVersion: event.version, text: event.text!,
      }, `intake:${strength}:${policyVersion}:${event.id}`, { strength, policyVersion }), Date.now, assessor,
      (tx, event) => this.inputs.owns(tx, event), (tx, eventId) => this.inputs.hasPendingRequeue(tx, eventId),
      (tx, eventId, evaluationId) => this.inputs.claimRequeue(tx, eventId, evaluationId),
      (tx, eventId, evaluationId) => this.inputs.consumeRequeue(tx, eventId, evaluationId),
      (tx, eventId, evaluationId) => this.inputs.releaseRequeue(tx, eventId, evaluationId)) : undefined
    this.environments = [...environments]
    if (new Set(environments.map(environment => environment.config.id)).size !== environments.length) throw new CoreError('INVALID_CONFIG', 'Local Environment IDs must be unique within an Engine.')
    this.slots = sessions ? new Slots(storage, instanceId, randomUUID(), slotOptions, Date.now) : undefined
    const jobRuntimeToken = randomUUID()
    this.jobs = sessions ? new Jobs(storage, instanceId, jobRuntimeToken, jobOptions, Date.now) : undefined
    this.previews = this.jobs?.previews
    this.subagents = sessions ? new Subagents(sessions.context, storage, instanceId, randomUUID(), subagentOptions, Date.now) : undefined
    if (sessions) {
      this.execution = new Execution(storage, instanceId, this.effects, sessions, this.inputs, this.attentions, this.sourceEvents,
        this.source.intake?.allowedRequesterIds ?? this.source.allowedActorIds, environments, this.slots, this.jobs, this.subagents, this.previews,
        this.deliveries, this.context, this.roleConfig, this.deliveryState)
      this.effects.setStartup(() => this.execution!.recoverInputs())
    }
    this.effects.configure({ ...(this.execution && this.execution.handlers()), outbox: this.outbox.handler() })
  }

  async receiveSource(event: ReceiveSourceEvent) {
    await this.ensurePolicy()
    if (this.processingPaused) this.evaluations?.setPaused(true)
    const receipt = await this.sourceEvents.receive(event, (tx, sourceEvent) => this.inputs.recordFanout(tx, sourceEvent).then(() => {}))
    if (this.proactive && receipt.status === 'recorded' && !this.processingPaused) {
      void this.proactive.evaluate({ sourceInstanceId: this.source.sourceInstanceId, eventId: receipt.eventId!, threadId: event.threadId,
        objectId: event.objectId, text: event.text ?? '', authorKind: event.authorKind ?? 'human', addressing: event.addressing ?? 'direct' }).catch(() => {})
    }
    return receipt
  }
  getSourceObject(ref: SourceObjectRef) { return this.sourceEvents.get(ref) }
  getSourceHistory(ref: SourceObjectRef, options?: { limit?: number; after?: string }) { return this.sourceEvents.history(ref, options) }
  getSourceReceipt(commandId: string) { return this.sourceEvents.receipt(commandId) }
  getSourceCandidate(ref: SourceObjectRef) { return this.sourceEvents.getCandidate(ref) }

  async acceptSource(command: AcceptSourceRequest): Promise<Receipt> {
    await this.ensurePolicy()
    if (this.processingPaused) throw new CoreError('PROCESSING_PAUSED', 'New work cannot be accepted while processing is paused.')
    if (this.evaluations) throw new CoreError('INTAKE_REQUIRED', 'This source has an Intake Policy; submit candidates through assessSourceBatch.')
    if (!command || Object.keys(command).some(key => !['commandId', 'threadId', 'objectId', 'expectedEventId', 'environmentId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Accept a checked source reference, event identity and an optional Environment only.')
    command = { ...command }
    identifier(command.commandId, 'commandId'); identifier(command.threadId, 'threadId'); identifier(command.objectId, 'objectId')
    if (typeof command.expectedEventId !== 'string' || command.expectedEventId.length > 8192) throw new CoreError('INVALID_INPUT', 'A checked current event ID is required.')
    if (command.environmentId !== undefined) {
      identifier(command.environmentId, 'environmentId')
      const environment = this.environments.find(environment => environment.config.id === command.environmentId)
      if (!environment || !this.execution) throw new CoreError('ENVIRONMENT_DENIED', 'The requested local Environment and native runtime must be configured.')
      environment.authorize({ instanceId: this.instanceId, actorId: this.source.actorId })
    }
    const fingerprint = `source-accept:v2:${createHash('sha256').update(canonicalJson([this.source.sourceInstanceId, this.source.actorId, command.threadId, command.objectId, command.expectedEventId, command.environmentId ?? null])).digest('hex')}`
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<CommandRecord>('command', command.commandId)
      if (existing) return this.replay(existing, fingerprint, 'command')
      const event = await this.sourceEvents.candidate(tx, command)
      if (!event || event.id !== command.expectedEventId) throw new CoreError('SOURCE_NOT_CURRENT', 'This source reference is deleted, conflicted, unknown or no longer current; no new work is authorized.')
      if (event.source.actorId !== this.source.actorId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source event cannot borrow another actor’s explicit authorization.')
      return this.accept(tx, command.commandId, { id: event.id, instanceId: this.instanceId, source: event.source, eventId: event.objectId,
        threadId: event.threadId, nativeVersion: event.version, text: event.text!,
        ...(command.environmentId ? { environmentId: command.environmentId } : {}) }, fingerprint)
    })
  }

  async assessSourceBatch(command: { commandId: string; threadId: string; eventIds: string[] }): Promise<SourceEvaluation> {
    await this.ensurePolicy()
    if (!this.evaluations) throw new CoreError('INTAKE_NOT_CONFIGURED', 'Configure an Intake Policy before evaluating source candidates.')
    if (this.processingPaused) throw new CoreError('PROCESSING_PAUSED', 'Source events remain recorded while new evaluations are paused.')
    return this.evaluations.assess(command)
  }

  async listEvaluations(threadId: string) {
    await this.ensurePolicy()
    if (!this.evaluations) throw new CoreError('INTAKE_NOT_CONFIGURED', 'Configure an Intake Policy before querying source evaluations.')
    return this.evaluations.list(threadId)
  }

  dismissEvaluation(command: { commandId: string; evaluationId: string; reason: string }) {
    if (!this.evaluations) throw new CoreError('INTAKE_NOT_CONFIGURED', 'Configure an Intake Policy before dismissing an Eval.')
    if (!command || Object.keys(command).some(key => !['commandId', 'evaluationId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Dismissing an Eval accepts commandId, evaluationId and reason only.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor is not authorized to dismiss evaluations.')
    return this.evaluations.dismiss({ ...command, actorId: this.source.actorId })
  }

  async submit(command: SubmitRequest): Promise<Receipt> {
    const submitted = command ? structuredClone(command) : command
    await this.ensurePolicy()
    if (this.processingPaused) throw new CoreError('PROCESSING_PAUSED', 'New work cannot be accepted while processing is paused.')
    command = submitted
    if (!command || typeof command !== 'object' || Array.isArray(command) || Object.keys(command).some(key => !['commandId', 'eventId', 'text', 'mode', 'execution', 'environmentId'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'Only commandId, eventId, text, mode, execution and environmentId are accepted from request data.')
    }
    if (this.source.allowedThreadIds !== undefined || this.source.allowedThreadPrefixes !== undefined || this.source.versionOrder !== undefined) throw new CoreError('UNSUPPORTED_CAPABILITY', 'A versioned source must use receiveSource and acceptSource so native scope, conflicts and tombstones remain authoritative.')
    command = { ...command }
    identifier(command.commandId, 'commandId')
    identifier(command.eventId, 'eventId')
    if (typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text) > 65536) throw new CoreError('INVALID_INPUT', 'Request text must contain 1 to 65536 bytes.')
    if (command.mode !== undefined && command.mode !== 'explicit' || command.execution !== undefined && command.execution !== 'local') throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only explicit requests in the local environment are enabled.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This desktop actor is not authorized by its source instance.')
    const source: Source = { kind: this.source.kind ?? 'desktop', sourceInstanceId: this.source.sourceInstanceId, actorId: this.source.actorId }
    const triggerId = JSON.stringify([this.instanceId, source.kind, source.sourceInstanceId, command.eventId, 'created', '1'])
    if (command.environmentId !== undefined) identifier(command.environmentId, 'environmentId')
    if (command.environmentId !== undefined) {
      const environment = this.environments.find(environment => environment.config.id === command.environmentId)
      if (!environment || !this.execution) throw new CoreError('ENVIRONMENT_DENIED', 'The requested local Environment and native runtime must be configured.')
      environment.authorize({ instanceId: this.instanceId, actorId: source.actorId })
    }
    const input = command.environmentId === undefined ? ['desktop-submit-v1', source, command.eventId, command.text, 'explicit', 'local']
      : ['desktop-submit-v2', source, command.eventId, command.text, 'explicit', 'local', command.environmentId]
    const fingerprint = `sha256:${command.environmentId === undefined ? 'v1' : 'v2'}:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`
    return commandTransaction(this.storage, this.instanceId, async tx => {
      await this.sourceEvents.requireDirectMode(tx)
      const existing = await tx.get<CommandRecord>('command', command.commandId)
      if (existing) return this.replay(existing, fingerprint, 'command')
      return this.accept(tx, command.commandId, { id: triggerId, instanceId: this.instanceId, source, eventId: command.eventId, text: command.text,
        ...(command.environmentId ? { environmentId: command.environmentId } : {}) }, fingerprint)
    })
  }

  private async accept(tx: AsyncTx, commandId: string, trigger: Work['trigger'], fingerprint: string, options: { strength?: 'explicit' | 'inferred'; policyVersion?: string } = {}): Promise<Receipt> {
    const triggerId = trigger.id
    const source = trigger.source
    const event = await tx.get<EventRecord>('event', triggerId)
    if (event) {
      const receipt = this.replay(event, fingerprint, 'event')
      await tx.insert('command', commandId, { fingerprint, receipt })
      return receipt
    }
    const ticketId = randomUUID()
    const decisionId = randomUUID()
    const mandateId = randomUUID()
    const work: Work = {
      trigger,
      decision: { id: decisionId, instanceId: this.instanceId, triggerId, outcome: 'accept', policyVersion: options.policyVersion ?? 'desktop-explicit-v1' },
      mandate: { id: mandateId, instanceId: this.instanceId, decisionId, scope: trigger.text, strength: options.strength ?? 'explicit', environment: 'local' },
      ticket: { id: ticketId, instanceId: this.instanceId, mandateId, triggerId, state: 'open', directionVersion: 1 },
      intent: { id: randomUUID(), instanceId: this.instanceId, ticketId, state: 'pending', reason: this.execution ? 'router-pending' : 'worker-not-enabled', environment: 'local' },
    }
    const receipt: Receipt = { instanceId: this.instanceId, ticketId, triggerId, acceptedCommandId: commandId, status: 'pending' }
    await tx.insert('trigger', triggerId, work.trigger)
    await tx.insert('decision', decisionId, work.decision)
    await tx.insert('mandate', mandateId, work.mandate)
    await tx.insert('ticket', ticketId, work.ticket)
    await tx.insert('intent', ticketId, work.intent)
    await this.inputs.subscribe(tx, ticketId, trigger)
    await tx.insert('event', triggerId, { fingerprint, receipt })
    await tx.insert('command', commandId, { fingerprint, receipt })
    await this.effects.enqueue(tx, { key: ticketId, stream: 'notice', scope: 'router', payload: { type: 'request-accepted', ticketId, triggerId } })
    const deliveryId = `${ticketId}:acknowledgement`
    const destination = { ...source, eventId: trigger.eventId, ...(trigger.threadId ? { threadId: trigger.threadId } : {}) }
    const effect = await this.effects.enqueue(tx, { key: ticketId, stream: 'outbox', scope: ticketId, payload: {
      purpose: 'acknowledgement', text: 'Request accepted.', ticketId, deliveryId, destination,
    } })
    await this.deliveries.record(tx, { id: deliveryId, ticketId, purpose: 'acknowledgement', text: 'Request accepted.', destination,
      basis: { kind: 'accepted-request', triggerId }, effectId: effect.id, effectGeneration: effect.generation }, effect)
    return receipt
  }

  private replay(record: CommandRecord | EventRecord, fingerprint: string, kind: string): Receipt {
    if (record.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', `The ${kind} ID was already used with different input.`)
    return record.receipt
  }

  async conversation(ticketId: string) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'No native Session adapter is configured.')
    const conversation = await this.execution.conversation(ticketId)
    const delivery = await this.storage.transaction(this.instanceId, async tx => ({
      conditions: await this.deliveryState.list(tx, ticketId),
      resultTarget: await this.deliveryState.target(tx, ticketId, 'result'),
    }))
    return { ...conversation, globalPaused: this.processingPaused, policyRevision: this.policyRevision,
      roleConfigRevision: this.roleConfigRevision, deliveryConditions: delivery.conditions,
      resultDeliveryTarget: delivery.resultTarget, deliveryPending: delivery.conditions.some(condition => condition.state === 'open' || condition.state === 'draft') }
  }

  async retrySetup(command: { commandId: string; ticketId: string }) {
    await this.ensurePolicy()
    if (!this.execution || !this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'A configured authorized native runtime is required.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Setup retry accepts commandId and ticketId only.')
    return this.execution.retrySetup(command.commandId, command.ticketId, this.source.actorId)
  }

  listEnvironments() {
    return this.environments.filter(environment => environment.config.instanceId === this.instanceId && environment.config.allowedActorIds.includes(this.source.actorId))
      .map(environment => ({ id: environment.config.id, permissions: [...environment.config.permissions] }))
  }

  getReceipt(commandId: string): Promise<Receipt | undefined> {
    identifier(commandId, 'commandId')
    return this.storage.transaction(this.instanceId, async tx => (await tx.get<CommandRecord>('command', commandId))?.receipt)
  }

  /** Explicitly acquires or renews the instance lease; an expired other-host lease gets a fresh epoch. */
  acquireHost() {
    return this.host.acquire()
  }

  getHostLease() {
    return this.host.currentLease()
  }

  async getSessionHistory(sessionId: string, options: { limit?: number; after?: number } = {}) {
    if (!this.sessions) throw new CoreError('RUNTIME_NOT_ENABLED', 'Session history requires a configured native runtime.')
    return this.sessions.readSession(sessionId, options)
  }

  async getRoleConfig(): Promise<RoleConfigView> {
    const config = await this.roleConfig.ensure()
    this.roleConfigRevision = config.revision
    this.applyRoleRoutes(config)
    return config
  }

  async updateRoleConfig(command: { commandId: string; expectedRevision: number; roles: RoleConfig }, options: { verify?: (roles: RoleConfig, signal: AbortSignal) => Promise<void> } = {}): Promise<RoleConfigView> {
    await this.getRoleConfig()
    if (!command || Object.keys(command).some(key => !['commandId', 'expectedRevision', 'roles'].includes(key))) throw new CoreError('INVALID_INPUT', 'A role configuration update accepts commandId, expectedRevision and roles only.')
    identifier(command.commandId, 'commandId')
    validateRoleConfig(command.roles)
    if (options.verify) {
      const controller = new AbortController()
      await options.verify(structuredClone(command.roles), controller.signal)
      controller.abort()
    }
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['role-config-v1', command.expectedRevision, command.roles])).digest('hex')
    const result = await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get<{ fingerprint: string; revision: number }>('work-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The role configuration command was reused with different input.')
        return { revision: prior.revision, replayed: true }
      }
      const view = await this.roleConfig.write(transaction, command.expectedRevision, command.roles)
      await transaction.insert('work-command', commandKey, { fingerprint, revision: view.revision })
      return { revision: view.revision, replayed: false, view }
    })
    const view = 'view' in result ? result.view : await this.roleConfig.currentView()
    this.roleConfigRevision = view.revision
    this.applyRoleRoutes(view)
    return view
  }

  getRoleConfigUses(sessionId: string): Promise<RoleConfigUse[]> {
    return this.roleConfig.uses(sessionId)
  }

  /** Bind one tracked P/R delivery condition to a Ticket; a ready report does not finish while it is open. */
  async bindDeliveryCondition(command: { commandId: string; ticketId: string; kind: 'pr'; sourceInstanceId: string; repo: string; number: number; basis: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'kind', 'sourceInstanceId', 'repo', 'number', 'basis'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'Binding a delivery condition accepts commandId, ticketId, kind, sourceInstanceId, repo, number and basis only.')
    }
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (!this.source.allowedActorIds?.includes(this.source.actorId) && !this.source.intake?.allowedRequesterIds?.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This actor cannot bind a delivery condition.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['bind-delivery-condition-v1', command.ticketId, command.sourceInstanceId, command.repo, command.number, command.basis])).digest('hex')
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string; conditionId: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The delivery-condition command was reused for different input.')
        return tx.get<DeliveryCondition>('delivery-condition', existing.conditionId)
      }
      const work = await this.readWork(tx, command.ticketId)
      if (!work) throw new CoreError('NOT_FOUND', 'The delivery-condition Ticket does not exist.')
      if (work.trigger.source.sourceInstanceId !== this.source.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The delivery-condition Ticket belongs to another source instance.')
      const condition = await this.deliveryState.bindCondition(tx, { ...command, createdBy: this.source.actorId, basis: command.basis })
      await tx.insert('work-command', commandKey, { fingerprint, conditionId: condition.id })
      return condition
    })
  }

  async getDeliveryConditions(ticketId: string): Promise<DeliveryCondition[]> {
    await this.ensurePolicy()
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, tx => this.deliveryState.list(tx, ticketId))
  }

  /** Reconcile a P/R delivery condition from an already received source event. */
  async reconcileDeliveryCondition(command: { commandId: string; ticketId: string; sourceInstanceId: string; text: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'sourceInstanceId', 'text'].includes(key))) throw new CoreError('INVALID_INPUT', 'Reconciling accepts commandId, ticketId, sourceInstanceId and text only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (!this.source.allowedActorIds?.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This actor cannot reconcile delivery conditions.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['reconcile-delivery-condition-v1', command.ticketId, command.sourceInstanceId, command.text])).digest('hex')
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The reconcile command was reused for different input.')
        return this.deliveryState.list(tx, command.ticketId)
      }
      const conditions = await this.deliveryState.reconcileFromSource(tx, command.ticketId, { sourceInstanceId: command.sourceInstanceId, text: command.text })
      if (conditions && !conditions.some(condition => condition.state === 'open' || condition.state === 'draft')) {
        const ticket = await tx.get<Work['ticket']>('ticket', command.ticketId)
        const result = await tx.get('delivery', `${command.ticketId}:result`)
        const pendingInputs = await this.inputs.pendingInputsForTicket(tx, command.ticketId)
        // A resolved delivery condition ends a ready Ticket only after its result was queued/delivered and no person constraint remains.
        if (ticket?.state === 'open' && !ticket.constraint && result && pendingInputs.length === 0) {
          await tx.replace('ticket', command.ticketId, { ...ticket, state: 'ended' })
        }
      }
      await tx.insert('work-command', commandKey, { fingerprint })
      return conditions
    })
  }

  /** Record an authorized result destination change, with its evidence, for one Ticket. */
  async setDeliveryTarget(command: { commandId: string; ticketId: string; purpose: 'result' | 'answer'; sourceInstanceId: string; threadId: string; objectId: string; evidence: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'purpose', 'sourceInstanceId', 'threadId', 'objectId', 'evidence'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'A delivery-target change accepts commandId, ticketId, purpose, sourceInstanceId, threadId, objectId and evidence only.')
    }
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (!this.source.allowedActorIds?.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'Only a trusted actor may change a delivery destination.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['delivery-target-v1', command.ticketId, command.purpose, command.sourceInstanceId, command.threadId, command.objectId, command.evidence])).digest('hex')
    const target = await commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The delivery-target command was reused for different input.')
        return this.deliveryState.target(tx, command.ticketId, command.purpose)
      }
      const work = await this.readWork(tx, command.ticketId)
      if (!work) throw new CoreError('NOT_FOUND', 'The delivery-target Ticket does not exist.')
      if (work.trigger.source.sourceInstanceId !== this.source.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The delivery-target Ticket belongs to another source instance.')
      const target = await this.deliveryState.setTarget(tx, { ...command, authorizedBy: this.source.actorId })
      await tx.insert('work-command', commandKey, { fingerprint })
      return target
    })
    return target
  }

  async getDeliveryTarget(ticketId: string, purpose: 'result' | 'answer'): Promise<DeliveryTarget | undefined> {
    await this.ensurePolicy()
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, tx => this.deliveryState.target(tx, ticketId, purpose))
  }

  async getProactiveRules(): Promise<{ revision: number; rules: ProactiveRule[] }> {
    if (!this.proactive) throw new CoreError('PROACTIVE_NOT_CONFIGURED', 'Configure a proactive root directory before reading rules.')
    return this.proactive.rules()
  }

  async updateProactiveRules(command: { commandId: string; expectedRevision: number; rules: ProactiveRule[] }): Promise<{ revision: number; rules: ProactiveRule[] }> {
    if (!this.proactive) throw new CoreError('PROACTIVE_NOT_CONFIGURED', 'Configure a proactive root directory before saving rules.')
    if (!command || Object.keys(command).some(key => !['commandId', 'expectedRevision', 'rules'].includes(key))) throw new CoreError('INVALID_INPUT', 'A proactive rule update accepts commandId, expectedRevision and rules only.')
    identifier(command.commandId, 'commandId')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['proactive-rules-v1', command.expectedRevision, command.rules])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<{ fingerprint: string; revision: number }>('work-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The proactive rule command was reused with different input.')
        return { revision: prior.revision, replayed: true }
      }
      const rules = await this.proactive!.setRules(tx, command.expectedRevision, command.rules)
      await tx.insert('work-command', commandKey, { fingerprint, revision: rules.revision })
      return { revision: rules.revision, replayed: false }
    })
    return this.proactive.rules()
  }

  async evaluateProactive(candidate: ProactiveCandidate): Promise<ProactiveRun[]> {
    if (!this.proactive) throw new CoreError('PROACTIVE_NOT_CONFIGURED', 'Configure a proactive root directory before evaluating candidates.')
    if (this.processingPaused) return []
    return this.proactive.evaluate(candidate)
  }

  async listProactiveRuns(ruleId?: string): Promise<ProactiveRun[]> {
    if (!this.proactive) throw new CoreError('PROACTIVE_NOT_CONFIGURED', 'Configure a proactive root directory before reading runs.')
    return this.proactive.listRuns(ruleId)
  }

  async getSourceMembers(): Promise<MembershipSnapshot | undefined> {
    return this.membership.get()
  }

  async syncSourceMembers(command: { commandId: string; revision: number; members: SourceMember[]; origin: 'startup' | 'manual' }): Promise<MembershipSnapshot> {
    if (!command || Object.keys(command).some(key => !['commandId', 'revision', 'members', 'origin'].includes(key))) throw new CoreError('INVALID_INPUT', 'A member sync accepts commandId, revision, members and origin only.')
    identifier(command.commandId, 'commandId')
    if (command.origin !== 'startup' && command.origin !== 'manual') throw new CoreError('INVALID_INPUT', 'A member sync origin is startup or manual.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['membership-sync-v1', command.revision, command.origin, command.members])).digest('hex')
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<{ fingerprint: string }>('work-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The member-sync command was reused with different input.')
        const snapshot = await tx.get<MembershipSnapshot>('source-members', JSON.stringify(['source-members', this.source.sourceInstanceId]))
        if (!snapshot) throw new CoreError('INCOMPLETE_STATE', 'The member snapshot is missing.')
        return snapshot
      }
      await this.membership.sync(tx, command)
      const snapshot = await tx.get<MembershipSnapshot>('source-members', JSON.stringify(['source-members', this.source.sourceInstanceId]))
      if (!snapshot) throw new CoreError('INCOMPLETE_STATE', 'The member snapshot was not stored.')
      await tx.insert('work-command', commandKey, { fingerprint, revision: snapshot.revision })
      return snapshot
    })
  }

  async getSupervision() {
    const tickets = await this.listTickets()
    const items = [] as Record<string, unknown>[]
    const counts = { needsHuman: 0, blocked: 0, stopped: 0, ready: 0, running: 0, ended: 0, pending: 0 }
    for (const work of tickets.items) {
      const conversation = this.execution ? await this.execution.conversation(work.ticket.id) : undefined
      const unknownEffects = (await this.effects.listByScope(work.ticket.id)).filter(effect => effect.state === 'unknown')
      const unknownJobs = (conversation?.jobs ?? []).filter(job => job.state === 'unknown')
      const waiting = conversation?.attention?.status === 'waiting'
      const stop = conversation?.stop
      const setup = conversation?.setup
      let bucket: keyof typeof counts = 'pending'
      let priority = 8
      let nextAction = 'Review the accepted request and wait for a Worker assignment.'
      if (waiting) { bucket = 'needsHuman'; priority = 0; nextAction = 'Answer the current question. Other Tickets can continue while this one waits.' }
      else if (unknownEffects.length || unknownJobs.length) {
        bucket = 'blocked'; priority = 1
        nextAction = 'Reconcile the affected external action or job by its original ID before retrying; unrelated work can continue.'
      } else if (setup?.state === 'failed') { bucket = 'blocked'; priority = 2; nextAction = 'Recheck the original working directory and retry setup.' }
      else if (stop?.state === 'stopping') {
        bucket = 'stopped'; priority = 3; nextAction = 'Wait for confirmed cancellation of the original execution range; resume is blocked.'
      } else if (stop) { bucket = 'stopped'; priority = 4; nextAction = 'The Ticket is stopped. Resume only with an explicit authorized command after cancellation is confirmed.' }
      else if (conversation?.status === 'ready') { bucket = 'ready'; priority = 5; nextAction = 'Review the current report and its evidence.' }
      else if (conversation?.status === 'running' || conversation?.status === 'pending') {
        bucket = conversation.status === 'running' ? 'running' : 'pending'
        priority = conversation.status === 'running' ? 6 : 8
        nextAction = conversation.status === 'running' ? 'Inspect the active Assignment or wait for its next evidence event.' : 'The Ticket is queued; inspect its slot and intent reason.'
      } else if (work.ticket.state === 'ended') { bucket = 'ended'; priority = 7; nextAction = 'The Ticket is closed. An authorized human follow-up can reopen it.' }
      if (bucket in counts) counts[bucket]++
      items.push({ ticketId: work.ticket.id, request: work.trigger.text, bucket, priority,
        state: conversation?.status ?? work.intent.state, reason: conversation?.reason ?? work.intent.reason,
        lifecycle: work.ticket.state, nextAction,
        why: { triggerId: work.trigger.id, decisionId: work.decision.id, mandateId: work.mandate.id,
          ...(conversation?.assignments[0] ? { assignmentId: conversation.assignments[0].id, generation: conversation.assignments[0].generation } : {}),
          ...(conversation?.reports[0] ? { reportId: conversation.reports[0].id } : {}),
          ...(conversation?.attention ? { attentionId: conversation.attention.id } : {}),
          ...(conversation?.stop ? { stopId: conversation.stop.id } : {}) },
        health: { source: 'nominal', effectsUnknown: unknownEffects.length, jobsUnknown: unknownJobs.length,
          ...(setup ? { setup: setup.state } : {}), ...(conversation?.slot ? { slot: conversation.slot } : {}),
          attention: conversation?.attention?.status ?? 'none', stop: conversation?.stop?.state ?? 'none' },
        ...(conversation?.attention ? { attention: conversation.attention } : {}),
        ...(conversation?.stop ? { stop: conversation.stop } : {}),
        ...(setup ? { setup } : {}),
        ...(conversation?.assignments[0] ? { assignment: conversation.assignments[0] } : {}),
        messages: conversation?.messages ?? [],
        reports: conversation?.reports ?? [],
        jobs: conversation?.jobs ?? [], subagents: conversation?.subagents ?? [] })
    }
    items.sort((left, right) => Number(left.priority) - Number(right.priority) || String(left.ticketId).localeCompare(String(right.ticketId)))
    return { items, counts, hasMore: tickets.hasMore, roleConfigRevision: this.roleConfigRevision, processingPaused: this.processingPaused }
  }

  private applyRoleRoutes(config: RoleConfigView) {
    this.sessions?.setRoutes(config.roles.router.model, config.roles.worker.model)
    this.sessions?.setRoleInstructions(config.roles.router, config.roles.worker)
  }

  getTicket(ticketId: string): Promise<Work | undefined> {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, tx => this.readWork(tx, ticketId))
  }

  async getTicketDirection(ticketId: string): Promise<TicketDirection | undefined> {
    await this.ensurePolicy()
    return this.inputs.direction(ticketId)
  }

  /** Stops every managed background process range and releases this Host's lease. */
  async shutdown() {
    try { await this.execution?.shutdown() }
    finally { await this.host.release().catch(() => {}) }
  }

  async listSlots(): Promise<SlotSnapshot> {
    await this.ensurePolicy()
    if (!this.slots) throw new CoreError('WORKER_NOT_ENABLED', 'Slot budgets require a configured native runtime.')
    return this.slots.list()
  }

  /** Background jobs of one Ticket: start facts, confirmed exit and bounded retained output. */
  async listJobs(ticketId: string): Promise<JobView[]> {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Background jobs require a configured native runtime.')
    return this.execution.listJobs(ticketId)
  }

  /** Subtasks one Ticket delegated, with their state and bounded result. */
  async listSubagents(ticketId: string): Promise<SubagentView[]> {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Subagents require a configured native runtime.')
    return this.execution.listSubagents(ticketId)
  }

  async getSubagent(ticketId: string, subagentId: string) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Subagents require a configured native runtime.')
    return this.execution.getSubagent(ticketId, subagentId)
  }

  async cancelSubagent(command: { commandId: string; ticketId: string; subagentId: string; reason: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Cancelling a subagent requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'subagentId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Cancelling a subagent accepts commandId, ticketId, subagentId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.subagentId, 'subagentId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot cancel a subagent.')
    return this.execution.cancelSubagent({ ...command, actorId: this.source.actorId })
  }

  async getJob(ticketId: string, jobId: string): Promise<JobView> {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Background jobs require a configured native runtime.')
    return this.execution.getJob(ticketId, jobId)
  }

  async listPreviews(ticketId: string): Promise<PreviewView[]> {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Previews require a configured native runtime.')
    return this.execution.listPreviews(ticketId)
  }

  async getPreview(ticketId: string, previewId: string): Promise<PreviewView> {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Previews require a configured native runtime.')
    return this.execution.getPreview(ticketId, previewId)
  }

  async cancelPreview(command: { commandId: string; ticketId: string; previewId: string; reason: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Cancelling a preview requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'previewId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Cancelling a preview accepts commandId, ticketId, previewId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.previewId, 'previewId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot cancel a preview.')
    return this.execution.cancelPreview({ ...command, actorId: this.source.actorId })
  }

  async resolvePreview(command: { commandId: string; ticketId: string; previewId: string; reason: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Resolving a preview requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'previewId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Resolving a preview accepts commandId, ticketId, previewId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.previewId, 'previewId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot resolve a preview.')
    return this.execution.resolvePreview({ ...command, actorId: this.source.actorId })
  }

  async cancelJob(command: { commandId: string; ticketId: string; jobId: string; reason: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Cancelling a background job requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'jobId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Cancelling a background job accepts commandId, ticketId, jobId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.jobId, 'jobId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot cancel a background job.')
    return this.execution.cancelJob({ ...command, actorId: this.source.actorId })
  }

  /**
   * Asks a Worker that is merely idle (no ready report, no question, no stop) to state its status.
   * It is a bounded command: it only queues for an idle Ticket, and it never clears a stop or a waiting question.
   */
  async requestStatus(command: { commandId: string; ticketId: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Requesting status requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId'].includes(key))) throw new CoreError('INVALID_INPUT', 'A status request accepts commandId and ticketId only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot request status.')
    return this.execution.requestStatus({ ...command, actorId: this.source.actorId })
  }

  async getTicketAttention(ticketId: string) {
    await this.ensurePolicy()
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, async tx => {
      const current = await this.attentions.current(tx, ticketId)
      const history = await this.attentions.history(tx, ticketId)
      return { current, history }
    })
  }

  async getTicketDeliveries(ticketId: string): Promise<DeliveryView[]> {
    await this.ensurePolicy()
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, tx => this.deliveries.list(tx, ticketId))
  }

  readContext(request: ContextRequest): Promise<ContextCard> {
    return this.context.read(request)
  }

  findContextCandidates(ticketId: string, text: string, limit?: number): Promise<ContextCandidate[]> {
    return this.context.candidates(ticketId, text, limit)
  }

  /** Queues an answer only when it names a current human question and an explicit Worker fact. */
  async queueAnswer(command: { commandId: string; ticketId: string; questionEventId: string; text: string; fact: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'questionEventId', 'text', 'fact'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'An answer accepts commandId, ticketId, questionEventId, text and fact only.')
    }
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.questionEventId, 'questionEventId')
    if (typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text) > 65536) throw new CoreError('INVALID_INPUT', 'An answer needs bounded nonempty text.')
    if (typeof command.fact !== 'string' || !command.fact.trim() || Buffer.byteLength(command.fact) > 4096) throw new CoreError('INVALID_INPUT', 'An answer needs an explicit bounded fact.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot answer a source question.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['answer-v1', this.source.sourceInstanceId, this.source.actorId,
      command.ticketId, command.questionEventId, command.text, command.fact])).digest('hex')
    const deliveryId = await commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string; deliveryId: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The answer command was reused for different input.')
        return existing.deliveryId
      }
      const question = await tx.get<SourceEvent>('source-event', command.questionEventId)
      if (!question) throw new CoreError('NOT_FOUND', 'The named question does not exist.')
      if (!this.sourceEvents.belongsToSource(question) || question.authorKind !== 'human') throw new CoreError('SOURCE_NOT_AUTHORIZED', 'An answer must name a human question from this source.')
      const current = await this.sourceEvents.candidate(tx, { threadId: question.threadId, objectId: question.objectId })
      if (current?.id !== question.id) throw new CoreError('SOURCE_NOT_CURRENT', 'The named question is no longer current.')
      const ticket = await tx.get<Work['ticket']>('ticket', command.ticketId)
      const trigger = ticket && await tx.get<Work['trigger']>('trigger', ticket.triggerId)
      if (!ticket || !trigger) throw new CoreError('NOT_FOUND', 'The answer Ticket does not exist.')
      if (trigger.source.sourceInstanceId !== question.source.sourceInstanceId || question.threadId !== trigger.threadId) {
        throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The question is outside this Ticket’s reachable source scope.')
      }
      const id = `${command.ticketId}:answer:${createHash('sha256').update(question.id).digest('hex')}`
      const destination = { sourceInstanceId: question.source.sourceInstanceId, actorId: question.authorId,
        eventId: question.objectId, ...(question.threadId ? { threadId: question.threadId } : {}) }
      const effect = await this.effects.enqueue(tx, { key: `answer:${question.id}`, stream: 'outbox', scope: command.ticketId,
        payload: { purpose: 'answer', ticketId: command.ticketId, deliveryId: id } })
      await this.deliveries.record(tx, { id, ticketId: command.ticketId, purpose: 'answer', text: command.text, destination,
        basis: { kind: 'human-question', questionEventId: question.id, questionText: question.text ?? '', fact: command.fact },
        effectId: effect.id, effectGeneration: effect.generation }, effect)
      await tx.insert('work-command', commandKey, { fingerprint, deliveryId: id })
      return id
    })
    const delivery = await this.storage.transaction(this.instanceId, tx => this.deliveries.get(tx, deliveryId))
    if (!delivery) throw new CoreError('INCOMPLETE_STATE', 'The queued answer is missing its delivery record.')
    return this.storage.transaction(this.instanceId, tx => this.deliveries.view(tx, delivery))
  }

  async answerAttention(command: { commandId: string; attentionId: string; text: string; sourceEventId?: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'attentionId', 'text', 'sourceEventId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Answering Attention accepts commandId, attentionId, text and sourceEventId only.')
    identifier(command.commandId, 'commandId'); identifier(command.attentionId, 'attentionId')
    if (command.sourceEventId !== undefined) identifier(command.sourceEventId, 'sourceEventId')
    if (typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text) > 65536) throw new CoreError('INVALID_INPUT', 'An Attention answer needs bounded nonempty text.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['attention-answer-v2', this.source.sourceInstanceId, this.source.actorId,
      command.attentionId, command.text, command.sourceEventId ?? null])).digest('hex')
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string; attentionId: string; inputId: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The Attention answer command was reused for different input.')
        const answered = await tx.get<Attention>('attention', existing.attentionId)
        const input = await this.inputs.getInput(tx, existing.inputId)
        if (!answered || !input) throw new CoreError('INCOMPLETE_STATE', 'The answered Attention is missing its Input.')
        return { attention: answered, input }
      }
      const attention = await tx.get<Attention>('attention', command.attentionId)
      if (!attention) throw new CoreError('NOT_FOUND', 'The Attention does not exist.')
      if (attention.destination.sourceInstanceId !== this.source.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The Attention belongs to a different source instance.')
      const ticket = await tx.get<Work['ticket']>('ticket', attention.ticketId)
      const trigger = ticket && await tx.get<Work['trigger']>('trigger', ticket.triggerId)
      if (!ticket || !trigger || trigger.source.sourceInstanceId !== this.source.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The Attention Ticket belongs to a different source instance.')
      const answerers = this.source.intake?.allowedRequesterIds ?? this.source.allowedActorIds
      let actorId = this.source.actorId
      let answerText = command.text
      if (command.sourceEventId) {
        const event = await tx.get<SourceEvent>('source-event', command.sourceEventId)
        if (!event || !this.sourceEvents.belongsToSource(event) || event.authorKind !== 'human') throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The answer event is not trusted human input for this source.')
        const current = await this.sourceEvents.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
        if (current?.id !== event.id) throw new CoreError('SOURCE_NOT_CURRENT', 'The answer event is no longer current.')
        if (event.threadId !== attention.destination.threadId) throw new CoreError('ANSWER_THREAD_MISMATCH', 'The answer event is outside the question Thread.')
        actorId = event.authorId
        answerText = event.text!
      }
      if (!answerers.includes(actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This actor cannot answer work questions.')
      if (actorId !== attention.destination.actorId) throw new CoreError('ANSWER_ACTOR_MISMATCH', 'The current actor does not match the question recipient.')
      const result = await this.attentions.answer(tx, { ticketId: attention.ticketId, attentionId: attention.id, text: answerText,
        commandId: command.commandId, actorId, ...(command.sourceEventId ? { sourceEventId: command.sourceEventId } : {}) })
      await tx.insert('work-command', commandKey, { fingerprint, attentionId: result.attention.id, inputId: result.input.id })
      return result
    })
  }

  async stopTicket(command: { commandId: string; ticketId: string; reason: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Stopping work requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Stopping work accepts commandId, ticketId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Stopping work needs a bounded reason.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot stop work.')
    return this.execution.stopTicket({ ...command, actorId: this.source.actorId })
  }

  async resumeTicket(command: { commandId: string; ticketId: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Resuming work requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Resuming work accepts commandId and ticketId only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot resume work.')
    return this.execution.resumeTicket({ ...command, actorId: this.source.actorId })
  }

  async retryTicket(command: { commandId: string; ticketId: string; reason: string }) {
    await this.ensurePolicy()
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'Retrying work requires a configured native runtime.')
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Retrying work accepts commandId, ticketId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Retrying work needs a bounded reason.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor cannot retry work.')
    return this.execution.retryTicket({ ...command, actorId: this.source.actorId })
  }

  async updateIntakePolicy(command: { commandId: string; expectedRevision: number; policy: IntakePolicy; origin?: 'manual' | 'sync'; sourceRevision?: string }) {
    await this.ensurePolicy()
    if (!this.evaluations) throw new CoreError('INTAKE_NOT_CONFIGURED', 'Configure an Intake Policy before changing it.')
    if (!command || Object.keys(command).some(key => !['commandId', 'expectedRevision', 'policy', 'origin', 'sourceRevision'].includes(key))) throw new CoreError('INVALID_INPUT', 'A Policy update accepts commandId, expectedRevision, policy, origin and sourceRevision only.')
    identifier(command.commandId, 'commandId')
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) throw new CoreError('INVALID_INPUT', 'Policy expectedRevision must be a positive integer.')
    if (command.origin !== undefined && command.origin !== 'manual' && command.origin !== 'sync') throw new CoreError('INVALID_INPUT', 'Policy origin is manual or sync.')
    if (command.origin === 'sync' && (typeof command.sourceRevision !== 'string' || !command.sourceRevision.trim() || Buffer.byteLength(command.sourceRevision) > 512)) throw new CoreError('INVALID_INPUT', 'A synchronised Policy update needs a bounded sourceRevision.')
    const assessor = command.policy.assess ?? this.defaultAssessor
    const { assess: _providedAssess, ...commandConfiguration } = command.policy
    const configurationSnapshot = structuredClone(commandConfiguration)
    const policy: IntakePolicy = assessor ? { ...configurationSnapshot, assess: assessor } : configurationSnapshot
    validateIntakePolicy(policy)
    const { assess: _assess, ...configuration } = policy
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['policy-update-v1', command.expectedRevision, command.origin ?? 'manual', command.sourceRevision ?? null, configuration])).digest('hex')
    const outcome = await commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<{ fingerprint: string; revision: number }>('work-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The Policy command was reused with different input.')
        return { revision: prior.revision, replayed: true }
      }
      const current = await tx.get<StoredPolicy>('policy-state', this.policyKey())
      if (!current) throw new CoreError('INCOMPLETE_STATE', 'The current Policy snapshot is missing.')
      if (current.revision !== command.expectedRevision) throw new CoreError('POLICY_REVISION_CONFLICT', 'The Policy changed after this update was prepared.')
      if (command.origin === 'sync' && current.sourceRevision === command.sourceRevision) throw new CoreError('STALE_POLICY_SYNC', 'This member-sync revision was already applied.')
      const nextRevision = current.revision + 1
      const stored: StoredPolicy = { revision: nextRevision, configuration, origin: command.origin ?? 'manual',
        ...(command.sourceRevision ? { sourceRevision: command.sourceRevision } : {}), updatedAt: Date.now() }
      await tx.replace('policy-state', this.policyKey(), stored)
      await tx.insert('policy-history', `${JSON.stringify(['policy-history', this.source.sourceInstanceId])}:${nextRevision}`, stored)
      const interrupted = await this.evaluations!.invalidateForPolicyChange(tx, 'POLICY_CHANGED')
      const affectedTicketIds = new Set<string>()
      for (const evaluation of interrupted) {
        const requeue: StoredPolicyNotice = { key: `${JSON.stringify(['policy-reevaluation', this.source.sourceInstanceId])}:${evaluation.evaluationId}`,
          ticketId: evaluation.evaluationId, revision: nextRevision, reason: 'POLICY_CHANGED' }
        await tx.insert('policy-reevaluation', requeue.key, requeue)
        for (const eventId of evaluation.candidateEventIds) {
          for (const ownership of await this.inputs.ownershipsForEventInTransaction(tx, eventId)) {
            if (ownership.state === 'owned') affectedTicketIds.add(ownership.ticketId)
          }
        }
      }
      let ticketCursor: string | undefined
      let liveTickets = 0
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await tx.scan<Work['ticket']>('ticket', { limit: 100, ...(ticketCursor ? { after: ticketCursor } : {}) })
        for (const item of page.items) {
          const trigger = await tx.get<Work['trigger']>('trigger', item.value.triggerId)
          if (item.value.state !== 'open' || trigger?.source.sourceInstanceId !== this.source.sourceInstanceId || !affectedTicketIds.has(item.value.id)) continue
          liveTickets++
          if (liveTickets > 1000) throw new CoreError('POLICY_NOTICE_LIMIT', 'Too many live Tickets require a Policy notification.')
          await this.effects.enqueue(tx, { key: `policy:${item.value.id}:${nextRevision}`, stream: 'outbox', scope: item.value.id,
            payload: { purpose: 'policy', ticketId: item.value.id, revision: nextRevision } })
        }
        if (!page.cursor) break
        ticketCursor = page.cursor
        if (pageCount === 9) {
          const confirmation = await tx.scan<Work['ticket']>('ticket', { limit: 1, after: ticketCursor })
          if (!confirmation.items[0]) break
          throw new CoreError('POLICY_NOTICE_LIMIT', 'The live Ticket scan exceeded its 1000-record budget.')
        }
      }
      await tx.insert('work-command', commandKey, { fingerprint, revision: nextRevision })
      return { revision: nextRevision, replayed: false }
    })
    if (outcome.replayed) {
      const current = await this.storage.transaction(this.instanceId, tx => tx.get<StoredPolicy>('policy-state', this.policyKey()))
      return { revision: current?.revision ?? outcome.revision, policy: current ? structuredClone(current.configuration) : { ...configuration }, processingPaused: this.processingPaused }
    }
    this.applyPolicy(policy, outcome.revision)
    void this.drainPolicyReevaluations().catch(() => {})
    return { revision: outcome.revision, policy: { ...configuration }, processingPaused: this.processingPaused }
  }

  async setProcessingPaused(command: { commandId: string; paused: boolean }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'paused'].includes(key))) throw new CoreError('INVALID_INPUT', 'Pausing processing accepts commandId and paused only.')
    identifier(command.commandId, 'commandId')
    if (typeof command.paused !== 'boolean') throw new CoreError('INVALID_INPUT', 'paused must be boolean.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['processing-pause-v1', command.paused])).digest('hex')
    const outcome = await commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<{ fingerprint: string; state: ProcessingState }>('work-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The pause command was reused with different input.')
        return { state: prior.state, replayed: true }
      }
      const current = await tx.get<ProcessingState>('processing-state', this.processingKey())
      const next: ProcessingState = { paused: command.paused, revision: (current?.revision ?? 0) + 1, updatedAt: Date.now() }
      if (!await tx.replace('processing-state', this.processingKey(), next)) await tx.insert('processing-state', this.processingKey(), next)
      await tx.insert('work-command', commandKey, { fingerprint, state: next })
      return { state: next, replayed: false }
    })
    if (outcome.replayed) return outcome.state
    this.processingPaused = outcome.state.paused
    this.evaluations?.setPaused(this.processingPaused)
    if (outcome.state.paused) this.effects.setPaused(true)
    else {
      await this.effects.resume()
      this.evaluations?.resume()
    }
    return outcome.state
  }

  async addThreadSubscription(command: { commandId: string; ticketId: string; threadId: string; reason: string; mode?: 'worker' | 'context' }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'threadId', 'reason', 'mode'].includes(key))) throw new CoreError('INVALID_INPUT', 'A Thread subscription accepts commandId, ticketId, threadId, reason and mode only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.threadId, 'threadId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'A Thread subscription needs a bounded reason.')
    if (command.mode !== undefined && command.mode !== 'worker' && command.mode !== 'context') throw new CoreError('INVALID_INPUT', 'A Thread subscription mode is worker or context.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor is not authorized to manage subscriptions.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['manual-subscription-v1', this.source.sourceInstanceId, this.source.actorId, command.ticketId, command.threadId, command.reason, command.mode ?? 'worker'])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The subscription command was reused for different input.')
        return
      }
      await this.inputs.addSubscription(tx, command.ticketId, command.threadId, 'manual', false, command.mode ?? 'worker', command.reason, this.source.actorId)
      await tx.insert('work-command', commandKey, { fingerprint })
    })
    return this.inputs.direction(command.ticketId)
  }

  async attachSourceEvent(command: { commandId: string; eventId: string; ticketId: string; reason: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'eventId', 'ticketId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Explicit attach accepts commandId, eventId, ticketId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.eventId, 'eventId'); identifier(command.ticketId, 'ticketId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Explicit attach needs a bounded reason.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor is not authorized to attach events.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['explicit-attach-v1', this.source.sourceInstanceId, this.source.actorId, command.eventId, command.ticketId, command.reason])).digest('hex')
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string; inputId: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The attach command was reused for different input.')
        return (await this.inputs.getInput(tx, existing.inputId))!
      }
      const event = await tx.get<SourceEvent>('source-event', command.eventId)
      if (!event) throw new CoreError('NOT_FOUND', 'The source event does not exist.')
      const input = await this.inputs.attach(tx, event, command.ticketId, command.reason, this.source.actorId)
      await tx.insert('work-command', commandKey, { fingerprint, inputId: input.id })
      return input
    })
  }

  async requeueSourceEvent(command: { commandId: string; eventId: string }) {
    await this.ensurePolicy()
    if (!this.evaluations) throw new CoreError('INTAKE_NOT_CONFIGURED', 'Manual requeue requires an Intake Policy.')
    if (!command || Object.keys(command).some(key => !['commandId', 'eventId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Manual requeue accepts commandId and eventId only.')
    identifier(command.commandId, 'commandId'); identifier(command.eventId, 'eventId')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor is not authorized to requeue work.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['manual-requeue-v1', this.source.sourceInstanceId, this.source.actorId, command.eventId])).digest('hex')
    const event = await commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string }>('work-command', commandKey)
      if (existing && existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The requeue command was reused for a different event.')
      const sourceEvent = await tx.get<SourceEvent>('source-event', command.eventId)
      if (!sourceEvent) throw new CoreError('NOT_FOUND', 'The requeued source event does not exist.')
      if (!this.sourceEvents.belongsToSource(sourceEvent)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source event belongs to a different source instance.')
      if (!existing) {
        await this.inputs.prepareRequeue(tx, sourceEvent, command.commandId, commandKey, this.source.actorId)
        await tx.insert('work-command', commandKey, { fingerprint })
      }
      return sourceEvent
    })
    return this.evaluations.assess({ commandId: `requeue:${commandKey}`, threadId: event.threadId, eventIds: [event.id] })
  }

  async removeThreadSubscription(command: { commandId: string; ticketId: string; threadId: string; reason: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'threadId', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'Removing a Thread subscription accepts commandId, ticketId, threadId and reason only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.threadId, 'threadId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Removing a Thread subscription needs a bounded reason.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor is not authorized to manage subscriptions.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['remove-subscription-v1', this.source.sourceInstanceId, this.source.actorId, command.ticketId, command.threadId, command.reason])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The unsubscribe command was reused for different input.')
        return
      }
      await this.inputs.removeSubscription(tx, command.ticketId, command.threadId, command.reason, this.source.actorId, commandKey)
      await tx.insert('work-command', commandKey, { fingerprint })
    })
    return this.inputs.direction(command.ticketId)
  }

  async addTicketNote(command: { commandId: string; ticketId: string; text: string; sourceTicketId?: string }) {
    await this.ensurePolicy()
    if (!command || Object.keys(command).some(key => !['commandId', 'ticketId', 'text', 'sourceTicketId'].includes(key))) throw new CoreError('INVALID_INPUT', 'A Ticket note accepts commandId, ticketId, text and sourceTicketId only.')
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId')
    if (typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text) > 4096) throw new CoreError('INVALID_INPUT', 'A Ticket note needs bounded nonempty text.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source actor is not authorized to add notes.')
    const commandKey = this.commandKey(command.commandId)
    const fingerprint = createHash('sha256').update(canonicalJson(['ticket-note-v1', this.source.sourceInstanceId, this.source.actorId, command.ticketId, command.text, command.sourceTicketId ?? null])).digest('hex')
    const result = await commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<{ fingerprint: string; noteId?: string; note?: WorkNote }>('work-command', commandKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The note command was reused for different input.')
        if (existing.note) return existing.note
        return { noteId: existing.noteId }
      }
      const note = await this.inputs.addNote(tx, command.ticketId, command.text, this.source.actorId, command.sourceTicketId)
      await tx.insert('work-command', commandKey, { fingerprint, noteId: note.id, note })
      return note
    })
    if ('text' in result && 'createdAt' in result) return result
    return (await this.inputs.direction(command.ticketId))?.notes.find(note => note.id === result.noteId)!
  }

  listTickets(): Promise<{ items: Work[]; hasMore: boolean }> {
    return this.storage.transaction(this.instanceId, async tx => {
      const tickets = await tx.list<Work['ticket']>('ticket', 101)
      const items: Work[] = []
      for (const ticket of tickets.slice(0, 100)) items.push((await this.readWork(tx, ticket.id))!)
      return { items, hasMore: tickets.length > 100 }
    })
  }

  private async readWork(tx: AsyncTx, ticketId: string): Promise<Work | undefined> {
    const ticket = await tx.get<Work['ticket']>('ticket', ticketId)
    if (!ticket) return undefined
    const trigger = await tx.get<Work['trigger']>('trigger', ticket.triggerId)
    const mandate = await tx.get<Work['mandate']>('mandate', ticket.mandateId)
    const decision = mandate && await tx.get<Work['decision']>('decision', mandate.decisionId)
    const intent = await tx.get<Work['intent']>('intent', ticket.id)
    if (!trigger || !mandate || !decision || !intent) throw new CoreError('INCOMPLETE_STATE', 'Accepted work is missing required durable facts.')
    return { trigger, decision, mandate, ticket, intent }
  }
}
