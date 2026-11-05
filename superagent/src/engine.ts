import { createHash, randomUUID } from 'node:crypto'
import { CoreError, identifier, type CommandRecord, type DesktopSource, type EventRecord, type Receipt, type Source, type SubmitRequest, type Work } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { commandTransaction } from './commands.js'
import { Effects, type EffectsOptions } from './effects.js'
import { Execution } from './execution.js'
import type { NativeSessions } from './native-sessions.js'
import type { LocalEnvironment } from './local-environment.js'

export class Engine {
  readonly effects: Effects
  private readonly execution: Execution | undefined
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly source: DesktopSource, effectsOptions: EffectsOptions = {}, sessions?: NativeSessions, private readonly environments: LocalEnvironment[] = []) {
    identifier(instanceId, 'instanceId')
    identifier(source.sourceInstanceId, 'sourceInstanceId')
    identifier(source.actorId, 'actorId')
    if (!Array.isArray(source.allowedActorIds)) throw new CoreError('INVALID_CONFIG', 'allowedActorIds must be explicitly configured.')
    for (const actor of source.allowedActorIds) identifier(actor, 'allowedActorId')
    this.source = structuredClone(source)
    this.environments = [...environments]
    if (new Set(environments.map(environment => environment.config.id)).size !== environments.length) throw new CoreError('INVALID_CONFIG', 'Local Environment IDs must be unique within an Engine.')
    if (sessions && (effectsOptions.operationTimeoutMs ?? 60000) <= sessions.timeoutMs) throw new CoreError('INVALID_CONFIG', 'The effect deadline must exceed the native Session turn budget.')
    this.effects = new Effects(storage, instanceId, sessions ? { ...effectsOptions, operationTimeoutMs: effectsOptions.operationTimeoutMs ?? 60000 } : effectsOptions)
    if (sessions) {
      this.execution = new Execution(storage, instanceId, this.effects, sessions, environments)
      this.effects.configure(this.execution.handlers())
    }
  }

  async submit(command: SubmitRequest): Promise<Receipt> {
    if (!command || typeof command !== 'object' || Array.isArray(command) || Object.keys(command).some(key => !['commandId', 'eventId', 'text', 'mode', 'execution', 'environmentId'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'Only commandId, eventId, text, mode, execution and environmentId are accepted from request data.')
    }
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
      const existing = await tx.get<CommandRecord>('command', command.commandId)
      if (existing) return this.replay(existing, fingerprint, 'command')
      const event = await tx.get<EventRecord>('event', triggerId)
      if (event) {
        const receipt = this.replay(event, fingerprint, 'event')
        await tx.insert('command', command.commandId, { fingerprint, receipt })
        return receipt
      }
      const ticketId = randomUUID()
      const decisionId = randomUUID()
      const mandateId = randomUUID()
      const work: Work = {
        trigger: { id: triggerId, instanceId: this.instanceId, source, eventId: command.eventId, text: command.text, ...(command.environmentId ? { environmentId: command.environmentId } : {}) },
        decision: { id: decisionId, instanceId: this.instanceId, triggerId, outcome: 'accept', policyVersion: 'desktop-explicit-v1' },
        mandate: { id: mandateId, instanceId: this.instanceId, decisionId, scope: command.text, strength: 'explicit', environment: 'local' },
        ticket: { id: ticketId, instanceId: this.instanceId, mandateId, triggerId, state: 'open' },
        intent: { id: randomUUID(), instanceId: this.instanceId, ticketId, state: 'pending', reason: this.execution ? 'router-pending' : 'worker-not-enabled', environment: 'local' },
      }
      const receipt: Receipt = { instanceId: this.instanceId, ticketId, triggerId, acceptedCommandId: command.commandId, status: 'pending' }
      await tx.insert('trigger', triggerId, work.trigger)
      await tx.insert('decision', decisionId, work.decision)
      await tx.insert('mandate', mandateId, work.mandate)
      await tx.insert('ticket', ticketId, work.ticket)
      await tx.insert('intent', ticketId, work.intent)
      await tx.insert('event', triggerId, { fingerprint, receipt })
      await tx.insert('command', command.commandId, { fingerprint, receipt })
      await this.effects.enqueue(tx, { key: ticketId, stream: 'notice', scope: 'router', payload: { type: 'request-accepted', ticketId, triggerId } })
      await this.effects.enqueue(tx, { key: ticketId, stream: 'outbox', scope: ticketId, payload: {
        purpose: 'acknowledgement', text: 'Request accepted.', ticketId,
        destination: { ...source, eventId: command.eventId },
      } })
      return receipt
    })
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
