import { createHash, randomUUID } from 'node:crypto'
import { CoreError, identifier, type CommandRecord, type DesktopSource, type EventRecord, type Receipt, type Source, type SubmitRequest, type Work } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { canonicalJson, commandTransaction } from './commands.js'
import { Effects, type EffectsOptions } from './effects.js'
import { Execution } from './execution.js'
import type { NativeSessions } from './native-sessions.js'
import type { LocalEnvironment } from './local-environment.js'
import { SourceEvents, type AcceptSourceRequest, type ReceiveSourceEvent, type SourceEvent, type SourceObjectRef } from './source-events.js'
import { SourceEvaluations, type SourceEvaluation } from './source-evaluations.js'
import { WorkInputs, type TicketDirection, type WorkNote } from './work-inputs.js'
import { Attentions, type Attention } from './attention.js'

export class Engine {
  readonly effects: Effects
  private readonly execution: Execution | undefined
  private readonly sourceEvents: SourceEvents
  private readonly evaluations: SourceEvaluations | undefined
  private readonly inputs: WorkInputs
  private readonly attentions: Attentions
  private commandKey(commandId: string) { return createHash('sha256').update(JSON.stringify([this.source.sourceInstanceId, this.source.actorId, commandId])).digest('hex') }
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly source: DesktopSource, effectsOptions: EffectsOptions = {}, sessions?: NativeSessions, private readonly environments: LocalEnvironment[] = []) {
    identifier(instanceId, 'instanceId')
    identifier(source.sourceInstanceId, 'sourceInstanceId')
    identifier(source.actorId, 'actorId')
    if (!Array.isArray(source.allowedActorIds)) throw new CoreError('INVALID_CONFIG', 'allowedActorIds must be explicitly configured.')
    for (const actor of source.allowedActorIds) identifier(actor, 'allowedActorId')
    const { intake, ...serializableSource } = source
    const clonedSource = structuredClone(serializableSource)
    this.source = intake ? { ...clonedSource, intake } : clonedSource
    const sourceBinding = { ...this.source }
    delete sourceBinding.intake
    this.sourceEvents = new SourceEvents(storage, instanceId, sourceBinding)
    if (sessions && (effectsOptions.operationTimeoutMs ?? 60000) <= sessions.timeoutMs) throw new CoreError('INVALID_CONFIG', 'The effect deadline must exceed the native Session turn budget.')
    this.effects = new Effects(storage, instanceId, sessions ? { ...effectsOptions, operationTimeoutMs: effectsOptions.operationTimeoutMs ?? 60000 } : effectsOptions)
    this.inputs = new WorkInputs(storage, instanceId, this.source, this.sourceEvents, (tx, request) => this.effects.enqueue(tx, request), Date.now)
    this.attentions = new Attentions(storage, instanceId, this.sourceEvents, this.inputs, this.effects, Date.now)
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
    if (sessions) {
      this.execution = new Execution(storage, instanceId, this.effects, sessions, this.inputs, this.attentions, environments)
      this.effects.configure(this.execution.handlers())
    }
  }

  receiveSource(event: ReceiveSourceEvent) { return this.sourceEvents.receive(event, (tx, sourceEvent) => this.inputs.recordFanout(tx, sourceEvent).then(() => {})) }
  getSourceObject(ref: SourceObjectRef) { return this.sourceEvents.get(ref) }
  getSourceHistory(ref: SourceObjectRef, options?: { limit?: number; after?: string }) { return this.sourceEvents.history(ref, options) }
  getSourceReceipt(commandId: string) { return this.sourceEvents.receipt(commandId) }
  getSourceCandidate(ref: SourceObjectRef) { return this.sourceEvents.getCandidate(ref) }

  async acceptSource(command: AcceptSourceRequest): Promise<Receipt> {
    if (this.evaluations) throw new CoreError('INTAKE_REQUIRED', 'This source has an Intake Policy; submit candidates through assessSourceBatch.')
    if (!command || Object.keys(command).some(key => !['commandId', 'threadId', 'objectId', 'expectedEventId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Accept a checked source reference and event identity only.')
    command = { ...command }
    identifier(command.commandId, 'commandId'); identifier(command.threadId, 'threadId'); identifier(command.objectId, 'objectId')
    if (typeof command.expectedEventId !== 'string' || command.expectedEventId.length > 8192) throw new CoreError('INVALID_INPUT', 'A checked current event ID is required.')
    const fingerprint = `source-accept:v1:${createHash('sha256').update(canonicalJson([this.source.sourceInstanceId, this.source.actorId, command.threadId, command.objectId, command.expectedEventId])).digest('hex')}`
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const existing = await tx.get<CommandRecord>('command', command.commandId)
      if (existing) return this.replay(existing, fingerprint, 'command')
      const event = await this.sourceEvents.candidate(tx, command)
      if (!event || event.id !== command.expectedEventId) throw new CoreError('SOURCE_NOT_CURRENT', 'This source reference is deleted, conflicted, unknown or no longer current; no new work is authorized.')
      if (event.source.actorId !== this.source.actorId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The source event cannot borrow another actor’s explicit authorization.')
      return this.accept(tx, command.commandId, { id: event.id, instanceId: this.instanceId, source: event.source, eventId: event.objectId,
        threadId: event.threadId, nativeVersion: event.version, text: event.text! }, fingerprint)
    })
  }

  assessSourceBatch(command: { commandId: string; threadId: string; eventIds: string[] }): Promise<SourceEvaluation> {
    if (!this.evaluations) throw new CoreError('INTAKE_NOT_CONFIGURED', 'Configure an Intake Policy before evaluating source candidates.')
    return this.evaluations.assess(command)
  }

  listEvaluations(threadId: string) {
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
    if (!command || typeof command !== 'object' || Array.isArray(command) || Object.keys(command).some(key => !['commandId', 'eventId', 'text', 'mode', 'execution', 'environmentId'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'Only commandId, eventId, text, mode, execution and environmentId are accepted from request data.')
    }
    if (this.source.allowedThreadIds !== undefined || this.source.versionOrder !== undefined) throw new CoreError('UNSUPPORTED_CAPABILITY', 'A versioned source must use receiveSource and acceptSource so native scope, conflicts and tombstones remain authoritative.')
    command = { ...command }
    identifier(command.commandId, 'commandId')
    identifier(command.eventId, 'eventId')
    if (typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text) > 65536) throw new CoreError('INVALID_INPUT', 'Request text must contain 1 to 65536 bytes.')
    if (command.mode !== undefined && command.mode !== 'explicit' || command.execution !== undefined && command.execution !== 'local') throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only explicit requests in the local environment are enabled.')
    if (!this.source.allowedActorIds.includes(this.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This desktop actor is not authorized by its source instance.')
    const source: Source = { kind: 'desktop', sourceInstanceId: this.source.sourceInstanceId, actorId: this.source.actorId }
    const triggerId = JSON.stringify([this.instanceId, 'desktop', source.sourceInstanceId, command.eventId, 'created', '1'])
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
    await this.effects.enqueue(tx, { key: ticketId, stream: 'outbox', scope: ticketId, payload: {
      purpose: 'acknowledgement', text: 'Request accepted.', ticketId,
      destination: { ...source, eventId: trigger.eventId, ...(trigger.threadId ? { threadId: trigger.threadId } : {}) },
    } })
    return receipt
  }

  private replay(record: CommandRecord | EventRecord, fingerprint: string, kind: string): Receipt {
    if (record.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', `The ${kind} ID was already used with different input.`)
    return record.receipt
  }

  conversation(ticketId: string) {
    if (!this.execution) throw new CoreError('WORKER_NOT_ENABLED', 'No native Session adapter is configured.')
    return this.execution.conversation(ticketId)
  }

  retrySetup(command: { commandId: string; ticketId: string }) {
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

  getTicket(ticketId: string): Promise<Work | undefined> {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, tx => this.readWork(tx, ticketId))
  }

  getTicketDirection(ticketId: string): Promise<TicketDirection | undefined> {
    return this.inputs.direction(ticketId)
  }

  getTicketAttention(ticketId: string) {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, async tx => {
      const current = await this.attentions.current(tx, ticketId)
      const history = await this.attentions.history(tx, ticketId)
      return { current, history }
    })
  }

  async answerAttention(command: { commandId: string; attentionId: string; text: string; sourceEventId?: string }) {
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

  async addThreadSubscription(command: { commandId: string; ticketId: string; threadId: string; reason: string; mode?: 'worker' | 'context' }) {
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
