import { createHash, randomUUID } from 'node:crypto'
import { CoreError, identifier, type Work } from './model.js'
import type { Storage, AsyncTx } from './storage.js'
import type { Effects, Effect, EffectHandler, EffectResult } from './effects.js'
import type { NativeSessions, NativeTool } from './native-sessions.js'
import { LocalSetupError, type LocalEnvironment, type BoundLocalEnvironment } from './local-environment.js'
import { commandTransaction } from './commands.js'
import type { WorkInput, WorkInputs } from './work-inputs.js'
import type { Attention, Attentions } from './attention.js'
import type { SourceEvents } from './source-events.js'
import type { Slots } from './slots.js'

export interface Assignment { id: string; ticketId: string; sessionId: string; state: 'pending' | 'running' | 'stopping' | 'ended'; generation: string; createdAt: number; environment?: { id: string; kind: 'local'; root: string } }
export interface StopState {
  id: string
  instanceId: string
  ticketId: string
  state: 'stopping' | 'stopped'
  requestedAt: number
  requestedBy: string
  reason: string
  assignmentId?: string
  cancellationConfirmedAt?: number
  previousConstraint?: Work['ticket']['constraint']
  resumedAt?: number
  resumeCommandId?: string
  recoveryReason?: 'ENGINE_RESTARTED'
  recoveredAt?: number
  runtimeToken: string
}

interface StopHead { stopId: string }
export interface ReadyReport { id: string; ticketId: string; assignmentId: string; sessionId: string; kind: 'ready'; result: string; evidence: string; artifacts: Artifact[]; toolFacts: ToolFact[]; inputId?: string; directionVersion: number; createdAt: number }
export interface Artifact { path: string; bytes: number; sha256: string }
export interface ToolFact { tool: string; outcome: 'success' | 'failed'; output: Record<string, unknown> }
export interface Delivery { id: string; ticketId: string; purpose: 'acknowledgement' | 'result' | 'attention' | 'policy'; text: string; destination: { sourceInstanceId: string; actorId: string; eventId: string; threadId?: string }; reportId?: string; inputId?: string; directionVersion?: number; attentionId?: string; policyRevision?: number }
export interface SetupState { assignmentId: string; state: 'failed' | 'ready' | 'pending'; output?: Record<string, unknown>; code?: string }
export interface StatusReport { id: string; ticketId: string; assignmentId: string; text: string; createdAt: number }

export class Execution {
  private readonly routerSessionId: string
  private readonly runtimeToken = randomUUID()
  private readonly workerControllers = new Map<string, { assignmentId: string; controller: AbortController }>()
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly effects: Effects, private readonly sessions: NativeSessions,
    private readonly inputs: WorkInputs, private readonly attentions: Attentions, private readonly sourceEvents: SourceEvents,
    private allowedRequesterIds: string[], private readonly environments: LocalEnvironment[] = [], private readonly slots?: Slots) {
    this.routerSessionId = sessions.routerSessionId
  }

  setAllowedRequesterIds(ids: string[]) {
    this.allowedRequesterIds = [...ids]
  }

  handlers(): Record<'notice' | 'relay' | 'outbox', EffectHandler> {
    return {
      notice: { execute: async (effect, context) => {
        try { await this.router(String(effect.payload.ticketId), effect.payload.type === 'report-ready', context.signal); return { type: 'success' } }
        catch (error) {
          if (error instanceof CoreError && error.code === 'ROUTER_NOTICE_UNHANDLED') return { type: 'transient', reason: error.message }
          throw error
        }
      }, batch: { maxSize: 7, execute: (effects, context) => this.routerBatch(effects, context.signal) } },
      relay: { execute: async effect => {
        const admitted = await this.worker(String(effect.payload.ticketId),
          typeof effect.payload.inputId === 'string' ? effect.payload.inputId : undefined, effect.payload.resume === true, effect.payload.status === true)
        return admitted === 'waiting'
          ? { type: 'defer', reason: 'The Worker turn is waiting for an execution slot.' }
          : { type: 'success' }
      } },
      outbox: { execute: async effect => {
        const ticketId = String(effect.payload.ticketId)
        const purpose = effect.payload.purpose
        if (purpose !== 'acknowledgement' && purpose !== 'result' && purpose !== 'attention' && purpose !== 'policy') throw new CoreError('INVALID_DELIVERY', 'Unsupported delivery purpose.')
        const staleAttention = await this.storage.transaction(this.instanceId, async transaction => {
          const trigger = await this.trigger(transaction, ticketId)
          const report = purpose === 'result' ? await transaction.get<ReadyReport>('report', ticketId) : undefined
          if (purpose === 'result' && (!report || report.id !== effect.payload.reportId)) throw new CoreError('NOT_READY', 'Result delivery requires the current ready report.')
          const attention = purpose === 'attention' ? await transaction.get<Attention>('attention', String(effect.payload.attentionId)) : undefined
          if (purpose === 'attention' && (!attention || attention.ticketId !== ticketId || attention.status !== 'waiting')) return true
          const destination = attention?.destination ?? { ...trigger.source, eventId: trigger.eventId, ...(trigger.threadId ? { threadId: trigger.threadId } : {}) }
          const policyRevision = purpose === 'policy' ? Number(effect.payload.revision) : undefined
          const delivery: Delivery = { id: purpose === 'attention' ? `${ticketId}:attention:${attention!.id}`
            : purpose === 'policy' ? `${ticketId}:policy:${policyRevision}` : `${ticketId}:${purpose}`, ticketId, purpose,
            text: purpose === 'result' ? report!.result : purpose === 'attention' ? attention!.question : purpose === 'policy' ? `Policy updated to revision ${policyRevision}.` : 'Request accepted.', destination,
            ...(attention ? { attentionId: attention.id } : {}),
            ...(policyRevision ? { policyRevision } : {}),
            ...(report ? { reportId: report.id, ...(report.inputId ? { inputId: report.inputId } : {}), directionVersion: report.directionVersion } : {}) }
          if (!await transaction.replace('delivery', delivery.id, delivery)) await transaction.insert('delivery', delivery.id, delivery)
          const historyKey = `${JSON.stringify(['delivery-history', ticketId])}:${purpose}:${purpose === 'attention' ? attention!.id : purpose === 'policy' ? String(policyRevision) : report?.id ?? 'initial'}`
          const history = structuredClone(delivery)
          if (!await transaction.replace('delivery-history', historyKey, history)) await transaction.insert('delivery-history', historyKey, history)
          if (purpose === 'result') {
            const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
            if (!ticket) throw new CoreError('INCOMPLETE_STATE', 'Result delivery is missing its Ticket.')
            if (!ticket.constraint) await transaction.replace('ticket', ticketId, { ...ticket, state: 'ended' })
          }
          return false
        })
        if (staleAttention) return { type: 'permanent', reason: 'ATTENTION_STALE: the question was answered or superseded before delivery.' }
        return { type: 'success' }
      } },
    }
  }

  private async trigger(transaction: AsyncTx, ticketId: string) {
    const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
    const trigger = ticket && await transaction.get<Work['trigger']>('trigger', ticket.triggerId)
    if (!ticket || !trigger) throw new CoreError('NOT_FOUND', 'The work does not exist in this instance.')
    return trigger
  }

  /**
   * Frees a Ticket's slot after a turn. `wake` is only passed when the release is the last fact written,
   * so the dispatcher never runs a queued relay against a half-committed turn.
   */
  private async releaseSlot(ticketId: string, assignmentId: string, wake = false) {
    if (!this.slots) return
    const queued = await this.storage.transaction(this.instanceId, async transaction => {
      const released = await this.slots!.release(transaction, { ticketId, assignmentId })
      return released && await this.slots!.hasWaiting(transaction)
    })
    if (wake && queued) this.effects.wake()
  }

  private async admitSlot(transaction: AsyncTx, assignment: Assignment, request: { ticketId: string; activation: 'launch' | 'followup' | 'resume' | 'status' }) {
    const outcome = await this.slots?.acquire(transaction, { ticketId: request.ticketId, assignmentId: assignment.id, activation: request.activation })
    if (!outcome || outcome.acquired) return true
    const intent = await transaction.get<Work['intent']>('intent', request.ticketId)
    if (intent) await transaction.replace('intent', request.ticketId, { ...intent, state: 'pending', reason: outcome.reason === 'PRIORITY_WAITING' ? 'slot-priority-waiting' : 'slot-queued' })
    return false
  }

  private async routerRequest(ticketId: string, ready: boolean) {
    const ticket = await this.storage.transaction(this.instanceId, transaction => transaction.get<Work['ticket']>('ticket', ticketId))
    if (ticket?.constraint) return undefined
    const trigger = await this.storage.transaction(this.instanceId, transaction => this.trigger(transaction, ticketId))
    const report = ready ? await this.storage.transaction(this.instanceId, transaction => transaction.get<ReadyReport>('report', ticketId)) : undefined
    if (ready && !report) throw new CoreError('NOT_READY', 'No ready report exists.')
    const tool: NativeTool = ready ? {
      name: 'deliver_result', description: 'Deliver the current verified ready report to the original request.', parameters: { reportId: { type: 'string', required: true } },
      execute: async args => this.storage.transaction(this.instanceId, async transaction => {
        const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
        if (!ticket || ticket.state !== 'open' || ticket.constraint) return 'Result was not delivered because the Ticket is stopped or constrained.'
        const current = await transaction.get<ReadyReport>('report', ticketId)
        const assignment = await transaction.get<Assignment>('assignment', ticketId)
        if (!current || current.id !== args.reportId || current.assignmentId !== assignment?.id) throw new CoreError('NOT_READY', 'Only the current Assignment ready report may be delivered.')
        await this.effects.enqueue(transaction, { key: `${ticketId}:result`, stream: 'outbox', scope: ticketId, payload: { purpose: 'result', ticketId, reportId: current.id } })
        return 'Result queued for the original message.'
      }),
    } : {
      name: 'assign_worker', description: 'Assign the accepted original request to one Worker.', parameters: {},
      execute: async () => this.storage.transaction(this.instanceId, async transaction => {
        const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
        if (!ticket || ticket.state !== 'open' || ticket.constraint) return 'No Worker was assigned because the Ticket is stopped or constrained.'
        const existing = await transaction.get<Assignment>('assignment', ticketId)
        if (existing) return existing.id
        const trigger = await this.trigger(transaction, ticketId)
        const environment = this.environments.find(candidate => candidate.config.id === trigger.environmentId)
        if (trigger.environmentId && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The accepted request has no authorized local Environment binding.')
        const assignment: Assignment = { id: randomUUID(), generation: randomUUID(), ticketId, sessionId: `worker-${randomUUID()}`, state: 'pending', createdAt: Date.now(), ...(environment ? { environment: { id: environment.config.id, kind: 'local', root: environment.config.root } } : {}) }
        await this.saveAssignment(transaction, assignment)
        await this.effects.enqueue(transaction, { key: assignment.id, stream: 'relay', scope: ticketId, payload: { ticketId, assignmentId: assignment.id } })
        return assignment.id
      }),
    }
    return { sessionId: this.routerSessionId, role: 'router' as const, coalesce: true, text: report ? `Ready report:${JSON.stringify(report)}` : `Accepted original request:${JSON.stringify({ ticketId, text: trigger.text })}`, tools: [tool] }
  }

  private async router(ticketId: string, ready: boolean, signal: AbortSignal) {
    const request = await this.routerRequest(ticketId, ready)
    if (!request) return
    const result = await this.sessions.run({ ...request, signal })
    await this.recordRouterSession(result)
  }

  private async routerBatch(effects: Effect[], signal: AbortSignal): Promise<EffectResult[]> {
    const requests = await Promise.allSettled(effects.map(effect => this.routerRequest(String(effect.payload.ticketId), effect.payload.type === 'report-ready')))
    return Promise.all(requests.map(async request => {
      if (request.status === 'rejected') return { type: 'unknown' as const, reason: 'The Router notification could not be prepared.' }
      if (!request.value) return { type: 'success' as const }
      try {
        await this.recordRouterSession(await this.sessions.run({ ...request.value, signal }))
        return { type: 'success' as const }
      } catch (error) {
        return error instanceof CoreError && error.code === 'ROUTER_NOTICE_UNHANDLED'
          ? { type: 'transient' as const, reason: error.message }
          : { type: 'unknown' as const, reason: 'The Router notification outcome requires reconciliation.' }
      }
    }))
  }

  private async recordRouterSession(result: { sessionId: string; events: readonly unknown[]; status: string }) {
    await this.storage.transaction(this.instanceId, async transaction => {
      const metadata = { id: result.sessionId, eventCount: result.events.length, role: 'router', status: result.status }
      if (!await transaction.replace('session', result.sessionId, metadata)) await transaction.insert('session', result.sessionId, metadata)
    })
  }

  private async worker(ticketId: string, inputId?: string, resume = false, status = false) {
    const skipped = await this.storage.transaction(this.instanceId, async transaction => {
      const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
      if (!ticket?.constraint) return false
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      if (ticket.constraint.kind === 'stopped') {
        if (assignment && assignment.state !== 'ended') await this.saveAssignment(transaction, { ...assignment, state: 'ended' })
        const stop = await this.activeStop(transaction, ticketId)
        if (stop) await transaction.replace('stop-state', stop.id, { ...stop, state: 'stopped', cancellationConfirmedAt: stop.cancellationConfirmedAt ?? Date.now() })
        const intent = await transaction.get<Work['intent']>('intent', ticketId)
        if (intent) await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'stopped' })
      }
      return true
    })
    if (skipped) {
      await this.storage.transaction(this.instanceId, transaction => this.slots?.release(transaction, { ticketId }) ?? Promise.resolve(false))
      return 'skipped' as const
    }
    const admitted = await this.storage.transaction(this.instanceId, async transaction => {
      let assignment = await transaction.get<Assignment>('assignment', ticketId)
      const trigger = await this.trigger(transaction, ticketId)
      const ticket = (await transaction.get<Work['ticket']>('ticket', ticketId))!
      if (ticket.state !== 'open') throw new CoreError('TICKET_ENDED', 'The Ticket is not open for this Worker turn.')
      if (ticket.constraint) throw new CoreError('TICKET_BLOCKED', 'The Ticket constraint must be resolved before another Worker turn.')
      // An idle Assignment still reads as running, so only a live turn in this process proves a collision.
      if (this.workerControllers.has(ticketId)) throw new CoreError('TURN_ACTIVE', 'This Assignment already has an active Worker turn.')
      if (!assignment) {
        if (!inputId) throw new CoreError('NOT_FOUND', 'No active Assignment exists.')
        const environment = this.environments.find(candidate => candidate.config.id === trigger.environmentId)
        if (trigger.environmentId && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The accepted request has no authorized local Environment binding.')
        assignment = { id: randomUUID(), generation: randomUUID(), ticketId, sessionId: `worker-${randomUUID()}`, state: 'pending', createdAt: Date.now(),
          ...(environment ? { environment: { id: environment.config.id, kind: 'local', root: environment.config.root } } : {}) }
        await this.saveAssignment(transaction, assignment)
      }
      const input = inputId ? await this.inputs.getInput(transaction, inputId) : undefined
      if (inputId && (!input || input.ticketId !== ticketId)) throw new CoreError('STALE_INPUT', 'The follow-up Input does not belong to this Ticket.')
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      if (!await this.admitSlot(transaction, assignment, { ticketId, activation: status ? 'status' : input ? 'followup' : resume ? 'resume' : 'launch' })) return { assignment }
      assignment.state = 'running'
      await this.saveAssignment(transaction, assignment)
      await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-running' })
      const environment = assignment.environment ? this.environments.find(candidate => candidate.config.id === assignment.environment!.id) : undefined
      if (assignment.environment && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The Assignment Environment is no longer configured.')
      return { assignment, trigger, environment, input }
    })
    if (!('trigger' in admitted)) return 'waiting' as const
    const { assignment, trigger, environment, input } = admitted
    try {
      return await this.runTurn({ ticketId, assignment, trigger, environment, input, resume, status })
    } catch (error) {
      await this.releaseSlot(ticketId, assignment.id)
      throw error
    }
  }

  private async runTurn({ ticketId, assignment, trigger, environment, input, resume, status }: {
    ticketId: string; assignment: Assignment; trigger: Work['trigger']; environment: LocalEnvironment | undefined; input: WorkInput | undefined; resume: boolean; status: boolean
  }) {
    const controller = new AbortController()
    this.workerControllers.set(ticketId, { assignmentId: assignment.id, controller })
    const stoppedBeforeRun = await this.storage.transaction(this.instanceId, async transaction => Boolean(await this.activeStop(transaction, ticketId)))
    if (stoppedBeforeRun) controller.abort()
    const toolFacts: ToolFact[] = []
    const artifacts: Artifact[] = []
    let reported = false
    let askedAttention: Attention | undefined
    let bound: BoundLocalEnvironment | undefined
    if (environment) {
      try {
        if (environment.config.root !== assignment.environment?.root) throw new CoreError('ENVIRONMENT_CHANGED', 'The original Assignment directory must be retained for setup retry.')
        bound = await environment.prepare({ instanceId: this.instanceId, actorId: trigger.source.actorId }, controller.signal)
        await this.storage.transaction(this.instanceId, async transaction => {
          const setup: SetupState = { assignmentId: assignment.id, state: 'ready' }
          if (!await transaction.replace('setup', ticketId, setup)) await transaction.insert('setup', ticketId, setup)
          await this.slots?.phase(transaction, { ticketId, assignmentId: assignment.id, phase: 'turn' })
        })
      } catch (error) {
        if (controller.signal.aborted || await this.storage.transaction(this.instanceId, async transaction => Boolean(await this.activeStop(transaction, ticketId)))) {
          await this.storage.transaction(this.instanceId, transaction => this.slots?.release(transaction, { ticketId, assignmentId: assignment.id }) ?? Promise.resolve(false))
          await this.confirmStop(assignment, ticketId)
          this.workerControllers.delete(ticketId)
          return
        }
        await this.storage.transaction(this.instanceId, async transaction => {
          const setup: SetupState = { assignmentId: assignment.id, state: 'failed', code: error instanceof CoreError ? error.code : 'SETUP_FAILED', ...(error instanceof LocalSetupError ? { output: error.output } : {}) }
          if (!await transaction.replace('setup', ticketId, setup)) await transaction.insert('setup', ticketId, setup)
          const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
          await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'setup-failed' })
          await this.saveAssignment(transaction, { ...assignment, state: 'pending' })
          await this.slots?.release(transaction, { ticketId, assignmentId: assignment.id })
        })
        this.workerControllers.delete(ticketId)
        return
      }
    }
    if (!environment) await this.storage.transaction(this.instanceId, transaction => this.slots?.phase(transaction, { ticketId, assignmentId: assignment.id, phase: 'turn' }) ?? Promise.resolve())
    const localTool = async (name: string, args: Record<string, string>, signal: AbortSignal) => {
      if (!bound) throw new CoreError('ENVIRONMENT_DENIED', 'No local Environment is bound to this Assignment.')
      if (reported) throw new CoreError('REPORT_SEALED', 'Local tools are sealed after the ready report; no later mutation is authorized.')
      if (askedAttention) throw new CoreError('ATTENTION_ACTIVE', 'Local tools are sealed after asking a human question.')
      if (toolFacts.length >= 24) throw new CoreError('TOOL_BUDGET', 'The local tool-call budget was exhausted.')
      try {
        const output = await bound.invoke(name, args, signal)
        const success = name !== 'run_command' || output.exitCode === 0 && !output.cancelled && !output.truncated
        const summary = JSON.parse(JSON.stringify(output, (_key, value) => typeof value === 'string' ? value.slice(0, 2000) : value))
        toolFacts.push({ tool: name, outcome: success ? 'success' : 'failed', output: summary })
        return JSON.stringify(output)
      } catch (error) {
        const code = error instanceof CoreError ? error.code : 'LOCAL_TOOL_FAILED'
        toolFacts.push({ tool: name, outcome: 'failed', output: { code } })
        throw new CoreError(code, 'The bound local operation failed; check the tool fact and authorized directory.')
      }
    }
    const localTools: NativeTool[] = bound ? [
      { name: 'write_file', description: 'Write UTF-8 text inside the bound Environment.', parameters: { path: { type: 'string', required: true }, text: { type: 'string', required: true } }, execute: (args, signal) => localTool('write_file', args, signal) },
      { name: 'read_file', description: 'Read UTF-8 text inside the bound Environment.', parameters: { path: { type: 'string', required: true } }, execute: (args, signal) => localTool('read_file', args, signal) },
      { name: 'glob', description: 'Find files by glob inside the bound Environment.', parameters: { pattern: { type: 'string', required: true } }, execute: (args, signal) => localTool('glob', args, signal) },
      { name: 'grep', description: 'Search for literal text inside the bound Environment.', parameters: { pattern: { type: 'string', required: true } }, execute: (args, signal) => localTool('grep', args, signal) },
      { name: 'run_command', description: `Run one configured command inside the bound Environment: ${Object.keys(environment!.config.commands).filter(name => name !== environment!.config.setup).join(', ')}.`, parameters: { name: { type: 'string', required: true } }, execute: (args, signal) => localTool('run_command', args, signal) },
    ] : []
    let statusFact: string | undefined
    // A status turn reports facts only: it gets a single restricted tool and none of the delivery tools,
    // so it cannot turn an idle Ticket into a result, a question or a subscription change.
    const statusTools: NativeTool[] = status ? [{
      name: 'report_status', description: 'State the current status in one short bounded sentence. This records a fact only; it cannot complete the Ticket.',
      parameters: { text: { type: 'string', required: true } },
      execute: async (args: Record<string, string>) => {
        const text = args.text?.trim() ?? ''
        if (!text || Buffer.byteLength(text) > 2048) throw new CoreError('INVALID_STATUS', 'A status report needs bounded nonempty text.')
        statusFact = text
        return 'Status recorded.'
      },
    }] : []
    let outcome
    try {
      outcome = await this.sessions.run({ sessionId: assignment.sessionId, role: 'worker',
        text: status ? 'Report the current status of this Ticket in one short turn. Do not continue the work, do not report ready, and do not ask a question unless the current blocker genuinely needs a human.'
          : resume ? 'Continue after resume. Inspect the retained Session, files, version control and external state before making changes.' : input?.text ?? trigger.text,
        ...(bound ? { cwd: bound.cwd } : {}), signal: controller.signal, tools: status ? statusTools : [
      ...localTools,
      {
        name: 'add_thread_subscription',
        description: 'Attach an unrelated Thread inside the configured source scope. Mode worker assigns future human follow-ups; mode context supplies background only.',
        parameters: { threadId: { type: 'string' as const, required: true as const }, mode: { type: 'string' as const, required: true as const }, reason: { type: 'string' as const, required: true as const } },
        execute: async (args: Record<string, string>) => {
          if (reported || askedAttention) throw new CoreError('REPORT_SEALED', 'Subscription changes are sealed after completion or a human question.')
          const mode = args.mode
          if (mode !== 'worker' && mode !== 'context') throw new CoreError('INVALID_INPUT', 'Thread subscription mode is worker or context.')
          const threadId = args.threadId, reason = args.reason
          if (!threadId || !reason) throw new CoreError('INVALID_INPUT', 'A Thread subscription requires threadId and reason.')
          return this.storage.transaction(this.instanceId, async transaction => {
            const current = await transaction.get<Assignment>('assignment', ticketId)
            if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The subscription Assignment is no longer current.')
            const subscription = await this.inputs.addSubscription(transaction, ticketId, threadId, 'worker', false, mode, reason, assignment.id)
            return JSON.stringify(subscription)
          })
        },
      },
      {
        name: 'remove_thread_subscription',
        description: 'Remove an unrelated Thread subscription added by this Assignment. Original and source-bound Threads remain protected.',
        parameters: { threadId: { type: 'string' as const, required: true as const }, reason: { type: 'string' as const, required: true as const } },
        execute: async (args: Record<string, string>) => {
          if (reported || askedAttention) throw new CoreError('REPORT_SEALED', 'Subscription changes are sealed after completion or a human question.')
          const threadId = args.threadId, reason = args.reason
          if (!threadId || !reason) throw new CoreError('INVALID_INPUT', 'Removing a Thread subscription requires threadId and reason.')
          return this.storage.transaction(this.instanceId, async transaction => {
            const current = await transaction.get<Assignment>('assignment', ticketId)
            if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The subscription Assignment is no longer current.')
            const decision = await this.inputs.removeWorkerSubscription(transaction, ticketId, threadId, reason, assignment.id)
            return JSON.stringify(decision)
          })
        },
      },
      ...(input ? [{
        name: 'handback_input',
        description: 'Hand this follow-up back to Router because it is outside the original Ticket scope or needs reassignment. Include a concrete reason.',
        parameters: { reason: { type: 'string' as const, required: true as const } },
        execute: async (args: Record<string, string>) => {
          if (askedAttention) throw new CoreError('ATTENTION_ACTIVE', 'The message is already waiting for a human.')
          const reason = args.reason
          if (!reason?.trim() || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'Handback needs a bounded reason.')
          return this.storage.transaction(this.instanceId, async transaction => {
            const current = await transaction.get<Assignment>('assignment', ticketId)
            if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The handing-back Assignment is no longer current.')
            const ownership = await this.inputs.handback(transaction, ticketId, input.id, reason)
            return JSON.stringify({ ticketId, inputId: input.id, state: ownership.state, reason })
          })
        },
      }] : []),
      {
        name: 'ask_human',
        description: 'Ask one concise structured question when a human decision is required. Consequential or ambiguous actions must wait for an authorized answer.',
        parameters: { question: { type: 'string' as const, required: true as const }, options: { type: 'string' as const, required: true as const } },
        execute: async (args: Record<string, string>) => {
          if (reported || askedAttention) throw new CoreError('ATTENTION_ACTIVE', 'The Worker turn has already completed or asked a question.')
          const options = (args.options ?? '').split('\n').map(option => option.trim()).filter(Boolean)
          askedAttention = await this.storage.transaction(this.instanceId, async transaction => {
            const current = await transaction.get<Assignment>('assignment', ticketId)
            if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The asking Assignment is no longer current.')
            return this.attentions.ask(transaction, { ticketId, assignmentId: assignment.id, sessionId: assignment.sessionId,
              question: args.question ?? '', options, ...(input ? { input } : {}) })
          })
          return JSON.stringify({ attentionId: askedAttention.id, question: askedAttention.question, options: askedAttention.options })
        },
      },
      {
      name: 'report_ready', description: 'Record a completed answer and concrete verification evidence for the original request.',
      parameters: { result: { type: 'string', required: true }, evidence: { type: 'string', required: true }, ...(bound ? { artifacts: { type: 'string' as const, required: true as const } } : {}) },
      execute: async (args, signal) => {
        if (askedAttention) throw new CoreError('ATTENTION_ACTIVE', 'A ready report cannot be submitted while a human answer is pending.')
        for (const value of [args.result!, args.evidence!]) if (!value?.trim() || Buffer.byteLength(value) > 16384) throw new CoreError('INVALID_REPORT', 'A ready report needs bounded nonempty result and verification evidence.')
        if (bound) {
          const lastWrite = toolFacts.findLastIndex(fact => fact.tool === 'write_file' && fact.outcome === 'success')
          if (!toolFacts.some((fact, index) => index > lastWrite && fact.tool === 'run_command' && fact.outcome === 'success')) throw new CoreError('VERIFICATION_REQUIRED', 'A local ready report needs a successful configured verification command after the last file write.')
          const paths = [...new Set((args.artifacts ?? '').split('\n').map(path => path.trim()).filter(Boolean))]
          if (!paths.length || paths.length > 10) throw new CoreError('INVALID_REPORT', 'Provide one to ten newline-separated relative artifact paths.')
          artifacts.splice(0)
          for (const path of paths) artifacts.push(await bound.artifact(path, signal))
        }
        return this.storage.transaction(this.instanceId, async transaction => {
          const current = await transaction.get<Assignment>('assignment', ticketId)
          if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The reporting Assignment is no longer current.')
          const existing = await transaction.get<ReadyReport>('report', ticketId)
          if (existing && !input) return existing.id
          const report: ReadyReport = { id: randomUUID(), ticketId, assignmentId: assignment.id, sessionId: assignment.sessionId, kind: 'ready', result: bound ? bound.sanitize(args.result!) : args.result!, evidence: bound ? bound.sanitize(args.evidence!) : args.evidence!, artifacts: structuredClone(artifacts), toolFacts: structuredClone(toolFacts),
            ...(input ? { inputId: input.id } : {}), directionVersion: input?.directionVersion ?? 1, createdAt: Date.now() }
          const historyKey = `${JSON.stringify(['report-history', ticketId])}:${report.id}`
          if (!await transaction.replace('report-history', historyKey, report)) await transaction.insert('report-history', historyKey, report)
          if (!await transaction.replace('report', ticketId, report)) await transaction.insert('report', ticketId, report)
          reported = true
          return report.id
        })
      },
      },
    ] })
    } catch (error) {
      if (controller.signal.aborted || await this.storage.transaction(this.instanceId, async transaction => Boolean(await this.activeStop(transaction, ticketId)))) {
        await this.confirmStop(assignment, ticketId)
        await this.releaseSlot(ticketId, assignment.id)
        return
      }
      throw error
    } finally {
      this.workerControllers.delete(ticketId)
    }
    await this.storage.transaction(this.instanceId, async transaction => {
      if (await this.activeStop(transaction, ticketId)) {
        await this.confirmStop(assignment, ticketId, transaction)
        return
      }
      const sessionMetadata = { id: outcome.sessionId, eventCount: outcome.events.length, ticketId, role: 'worker', status: outcome.status }
      if (!await transaction.replace('session', outcome.sessionId, sessionMetadata)) await transaction.insert('session', outcome.sessionId, sessionMetadata)
      if (status && statusFact) {
        const fact: StatusReport = { id: `${JSON.stringify(['status-report', ticketId])}:${randomUUID()}`, ticketId, assignmentId: assignment.id, text: statusFact, createdAt: Date.now() }
        if (!await transaction.replace('status-report', `${JSON.stringify(['status-report', ticketId])}:current`, fact)) await transaction.insert('status-report', `${JSON.stringify(['status-report', ticketId])}:current`, fact)
        await transaction.insert('status-history', fact.id, fact)
      }
      if (input) await this.inputs.markDelivered(transaction, input)
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      if (askedAttention) {
        await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'waiting-human' })
        await this.saveAssignment(transaction, { ...assignment, state: 'ended' })
        return
      }
      await transaction.replace('intent', ticketId, { ...intent, state: report ? 'ready' : 'running', reason: report ? 'ready-report' : 'worker-idle' })
      if (report) {
        await this.saveAssignment(transaction, { ...assignment, state: 'ended' })
        await this.effects.enqueue(transaction, { key: report.id, stream: 'notice', scope: 'router', payload: { type: 'report-ready', ticketId, reportId: report.id } })
      }
    })
    await this.releaseSlot(ticketId, assignment.id, true)
    return 'ran' as const
  }

  async conversation(ticketId: string) {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, async transaction => {
      const trigger = await this.trigger(transaction, ticketId)
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      const stop = await this.recoverStaleStop(transaction, ticketId)
      const attention = await this.attentions.current(transaction, ticketId)
      const attentionHistory = await this.attentions.history(transaction, ticketId)
      const slot = await this.slots?.currentFor(transaction, ticketId)
      const assignmentHistory: Assignment[] = []
      let assignmentCursor = `${JSON.stringify(['assignment-history', ticketId])}:`
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await transaction.scan<Assignment>('assignment-history', { limit: 100, after: assignmentCursor })
        assignmentHistory.push(...page.items.map(item => item.value))
        if (!page.cursor || !page.cursor.startsWith(assignmentCursor)) break
        assignmentCursor = page.cursor
        if (pageCount === 9) throw new CoreError('ASSIGNMENT_BUDGET', 'The Assignment history exceeds its 1000-record budget.')
      }
      const stopHistory: StopState[] = []
      let stopCursor = `${JSON.stringify(['stop-history', ticketId])}:`
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await transaction.scan<StopState>('stop-history', { limit: 100, after: stopCursor })
        stopHistory.push(...page.items.map(item => item.value))
        if (!page.cursor || !page.cursor.startsWith(stopCursor)) break
        stopCursor = page.cursor
        if (pageCount === 9) throw new CoreError('STOP_BUDGET', 'The stop history exceeds its 1000-record budget.')
      }
      const resumeHistory: Record<string, unknown>[] = []
      let resumeCursor = `${JSON.stringify(['resume-decision', ticketId])}:`
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await transaction.scan<Record<string, unknown>>('resume-decision', { limit: 100, after: resumeCursor })
        resumeHistory.push(...page.items.map(item => item.value))
        if (!page.cursor || !page.cursor.startsWith(resumeCursor)) break
        resumeCursor = page.cursor
        if (pageCount === 9) throw new CoreError('RESUME_BUDGET', 'The resume history exceeds its 1000-record budget.')
      }
      const messages: Delivery[] = []
      for (const purpose of ['acknowledgement', 'result']) {
        const message = await transaction.get<Delivery>('delivery', `${ticketId}:${purpose}`)
        if (message) messages.push(message)
      }
      if (attention?.status === 'waiting') {
        const question = await transaction.get<Delivery>('delivery', `${ticketId}:attention:${attention.id}`)
        if (question) messages.push(question)
      }
      const reportHistory = await this.history<ReadyReport>(transaction, 'report-history', `${JSON.stringify(['report-history', ticketId])}:`)
      const messageHistory = await this.history<Delivery>(transaction, 'delivery-history', `${JSON.stringify(['delivery-history', ticketId])}:`)
      const latestPolicy = messageHistory.filter(message => message.purpose === 'policy').sort((left, right) => (left.policyRevision ?? 0) - (right.policyRevision ?? 0)).at(-1)
      if (latestPolicy) messages.push(latestPolicy)
      const setup = await transaction.get<SetupState>('setup', ticketId)
      const statusReport = await transaction.get<StatusReport>('status-report', `${JSON.stringify(['status-report', ticketId])}:current`)
      return { ticketId, request: trigger.text, status: stop?.state ?? (attention?.status === 'waiting' ? 'waiting-human' : intent.state), reason: stop?.state ?? intent.reason,
        ...(slot ? { slot } : {}),
        ...(statusReport ? { statusReport } : {}),
        attention, attentionHistory, stop, assignments: assignment ? [assignment] : [],
        assignmentHistory: assignmentHistory.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
        stopHistory: stopHistory.sort((left, right) => left.requestedAt - right.requestedAt), resumeHistory: resumeHistory.sort((left, right) => Number(left.resumedAt ?? 0) - Number(right.resumedAt ?? 0)),
        reports: report ? [report] : [],
        reportHistory: reportHistory.sort((left, right) => left.createdAt - right.createdAt), messages,
        messageHistory: messageHistory.sort((left, right) => (left.directionVersion ?? 0) - (right.directionVersion ?? 0)), ...(setup ? { setup } : {}) }
    })
  }

  private async history<T>(transaction: AsyncTx, kind: 'report-history' | 'delivery-history', prefix: string) {
    const items: T[] = []
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<T>(kind, { limit: 100, after: cursor })
      items.push(...page.items.map(item => item.value))
      if (!page.cursor || !page.cursor.startsWith(prefix)) return items
      cursor = page.cursor
      if (pageCount === 9) {
        const confirmation = await transaction.scan<T>(kind, { limit: 1, after: cursor })
        if (!confirmation.items[0]?.id.startsWith(prefix)) return items
      }
    }
    throw new CoreError('CONVERSATION_BUDGET', 'The Ticket conversation exceeds its declared 1000-record history budget.')
  }

  private stopHeadKey(ticketId: string) {
    return JSON.stringify(['stop-head', ticketId])
  }

  private async activeStop(transaction: AsyncTx, ticketId: string) {
    const head = await transaction.get<StopHead>('stop-head', this.stopHeadKey(ticketId))
    const stop = head ? await transaction.get<StopState>('stop-state', head.stopId) : undefined
    return stop?.resumedAt === undefined ? stop : undefined
  }

  private async recoverStaleStop(transaction: AsyncTx, ticketId: string) {
    const stop = await this.activeStop(transaction, ticketId)
    if (stop?.state !== 'stopping' || stop.runtimeToken === this.runtimeToken) return stop
    const current = await transaction.get<Assignment>('assignment', ticketId)
    if (current && current.state !== 'ended') await this.saveAssignment(transaction, { ...current, state: 'ended' })
    const recovered: StopState = { ...stop, state: 'stopped', recoveryReason: 'ENGINE_RESTARTED', recoveredAt: Date.now() }
    await transaction.replace('stop-state', stop.id, recovered)
    const intent = await transaction.get<Work['intent']>('intent', ticketId)
    if (intent) await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'stopped' })
    return recovered
  }

  private async saveAssignment(transaction: AsyncTx, assignment: Assignment) {
    const current = await transaction.get<Assignment>('assignment', assignment.ticketId)
    const prefix = JSON.stringify(['assignment-history', assignment.ticketId])
    if (current) {
      const key = `${prefix}:${current.id}`
      if (!await transaction.replace('assignment-history', key, current)) await transaction.insert('assignment-history', key, current)
    }
    if (!await transaction.replace('assignment', assignment.ticketId, assignment)) await transaction.insert('assignment', assignment.ticketId, assignment)
    const key = `${prefix}:${assignment.id}`
    if (!await transaction.replace('assignment-history', key, assignment)) await transaction.insert('assignment-history', key, assignment)
  }

  private async confirmStop(assignment: Assignment, ticketId: string, existing?: AsyncTx) {
    const operation = async (transaction: AsyncTx) => {
      const stop = await this.activeStop(transaction, ticketId)
      if (!stop) return
      const current = await transaction.get<Assignment>('assignment', ticketId)
      if (current?.id === assignment.id && current.state !== 'ended') await this.saveAssignment(transaction, { ...current, state: 'ended' })
      const confirmed: StopState = { ...stop, state: 'stopped', cancellationConfirmedAt: stop.cancellationConfirmedAt ?? Date.now() }
      await transaction.replace('stop-state', stop.id, confirmed)
      const intent = await transaction.get<Work['intent']>('intent', ticketId)
      if (intent) await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'stopped' })
    }
    if (existing) await operation(existing)
    else await this.storage.transaction(this.instanceId, operation)
  }

  async stopTicket(command: { commandId: string; ticketId: string; reason: string; actorId: string }) {
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.actorId, 'actorId')
    if (!command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Stop needs a bounded reason.')
    const commandKey = createHash('sha256').update(JSON.stringify(['stop', this.instanceId, command.ticketId, command.actorId, command.commandId])).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify(['stop-v1', this.instanceId, command.ticketId, command.actorId, command.reason])).digest('hex')
    const outcome = await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get<{ stopId: string; assignmentId?: string; fingerprint: string }>('work-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The stop command was reused with a different reason.')
        return { stopId: prior.stopId, assignmentId: prior.assignmentId, replay: true }
      }
      const trigger = await this.trigger(transaction, command.ticketId)
      if (trigger.source.sourceInstanceId !== this.sourceEvents.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The stopped Ticket belongs to a different source instance.')
      if (trigger.source.actorId !== command.actorId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'Only the trusted source actor may stop this Ticket.')
      const ticket = (await transaction.get<Work['ticket']>('ticket', command.ticketId))!
      const existingHead = await transaction.get<StopHead>('stop-head', this.stopHeadKey(command.ticketId))
      if (existingHead) {
        const existing = await transaction.get<StopState>('stop-state', existingHead.stopId)
        if (existing?.resumedAt === undefined && (existing?.state === 'stopping' || existing?.state === 'stopped')) {
          await transaction.insert('work-command', commandKey, { stopId: existing.id, assignmentId: existing.assignmentId, fingerprint })
          return { stopId: existing.id, assignmentId: existing.assignmentId, replay: false }
        }
      }
      const assignment = await transaction.get<Assignment>('assignment', command.ticketId)
      const running = assignment?.state === 'running'
      const stopId = randomUUID()
      const stop: StopState = { id: stopId, instanceId: this.instanceId, ticketId: command.ticketId, state: running ? 'stopping' : 'stopped',
        requestedAt: Date.now(), requestedBy: command.actorId, reason: command.reason, ...(assignment ? { assignmentId: assignment.id } : {}),
        runtimeToken: this.runtimeToken, ...(ticket.constraint ? { previousConstraint: structuredClone(ticket.constraint) } : {}), ...(!running ? { cancellationConfirmedAt: Date.now() } : {}) }
      await transaction.insert('stop-state', stopId, stop)
      if (!await transaction.replace('stop-head', this.stopHeadKey(command.ticketId), { stopId })) await transaction.insert('stop-head', this.stopHeadKey(command.ticketId), { stopId })
      await transaction.insert('stop-history', `${JSON.stringify(['stop-history', command.ticketId])}:${stopId}`, stop)
      await transaction.replace('ticket', command.ticketId, { ...ticket, constraint: { kind: 'stopped', stopId, reason: command.reason } })
      const intent = (await transaction.get<Work['intent']>('intent', command.ticketId))!
      await transaction.replace('intent', command.ticketId, { ...intent, state: 'pending', reason: running ? 'stopping' : 'stopped' })
      if (assignment && running) await this.saveAssignment(transaction, { ...assignment, state: 'stopping' })
      else if (assignment && assignment.state !== 'ended') await this.saveAssignment(transaction, { ...assignment, state: 'ended' })
      await this.slots?.release(transaction, { ticketId: command.ticketId })
      await this.effects.cancelScope(transaction, { ticketId: command.ticketId })
      await transaction.insert('work-command', commandKey, { stopId, assignmentId: assignment?.id, fingerprint })
      return { stopId, assignmentId: assignment?.id, replay: false }
    })
    const worker = this.workerControllers.get(command.ticketId)
    if (!outcome.replay && worker && outcome.assignmentId && worker.assignmentId === outcome.assignmentId) worker.controller.abort()
    return this.conversation(command.ticketId)
  }

  async requestStatus(command: { commandId: string; ticketId: string; actorId: string }) {
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.actorId, 'actorId')
    const commandKey = createHash('sha256').update(JSON.stringify(['status', this.instanceId, command.ticketId, command.actorId, command.commandId])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get('work-command', commandKey)
      if (prior) return
      const trigger = await this.trigger(transaction, command.ticketId)
      if (trigger.source.sourceInstanceId !== this.sourceEvents.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The status request belongs to a different source instance.')
      if (!this.allowedRequesterIds.includes(command.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This actor may not request status for the Ticket.')
      const ticket = (await transaction.get<Work['ticket']>('ticket', command.ticketId))!
      const attention = await this.attentions.current(transaction, command.ticketId)
      const assignment = await transaction.get<Assignment>('assignment', command.ticketId)
      // A stop, a waiting question or an unfinished Assignment is not an idle state; a status request must not bypass them.
      if (ticket.constraint) throw new CoreError('STATUS_UNAVAILABLE', `A status request cannot run while the Ticket is ${ticket.constraint.kind}.`)
      if (attention?.status === 'waiting') throw new CoreError('STATUS_UNAVAILABLE', 'Resolve the current human question before requesting status.')
      const intent = (await transaction.get<Work['intent']>('intent', command.ticketId))!
      // Only an Assignment that ended its turn without a result is idle; a queued or freshly launched Ticket has nothing to report yet.
      if (assignment?.state !== 'running' || intent.reason !== 'worker-idle') throw new CoreError('STATUS_UNAVAILABLE', 'Only a Worker that ended a turn without a result can be asked for status.')
      await transaction.replace('intent', command.ticketId, { ...intent, state: 'pending', reason: 'followup-pending' })
      await this.effects.enqueue(transaction, { key: `status:${command.commandId}`, stream: 'relay', scope: command.ticketId,
        payload: { ticketId: command.ticketId, status: true } })
      await transaction.insert('work-command', commandKey, { ticketId: command.ticketId })
    })
    return this.conversation(command.ticketId)
  }

  async resumeTicket(command: { commandId: string; ticketId: string; actorId: string }) {
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.actorId, 'actorId')
    const commandKey = createHash('sha256').update(JSON.stringify(['resume', this.instanceId, command.ticketId, command.actorId, command.commandId])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get('work-command', commandKey)
      if (prior) return
      const trigger = await this.trigger(transaction, command.ticketId)
      if (trigger.source.sourceInstanceId !== this.sourceEvents.sourceInstanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The resumed Ticket belongs to a different source instance.')
      if (trigger.source.actorId !== command.actorId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'Only the trusted source actor may resume this Ticket.')
      const stop = await this.recoverStaleStop(transaction, command.ticketId)
      if (!stop || stop.state === 'stopping') throw new CoreError('STOPPING', 'The previous execution has not confirmed cancellation.')
      if (stop.state !== 'stopped') throw new CoreError('STOP_REQUIRED', 'The Ticket is not stopped.')
      if (!stop.cancellationConfirmedAt) throw new CoreError('CANCELLATION_UNCONFIRMED', 'The previous local execution has not been confirmed stopped.')
      if (await this.effects.hasUnknownScopeInTransaction(transaction, command.ticketId)) throw new CoreError('UNKNOWN_OUTCOME', 'Unknown external work must be reconciled before resume.')
      const attention = await this.attentions.current(transaction, command.ticketId)
      if (attention?.status === 'waiting') throw new CoreError('WAITING_HUMAN', 'Resolve the current human question before resume.')
      if (trigger.threadId) {
        const current = await this.sourceEvents.candidate(transaction, { threadId: trigger.threadId, objectId: trigger.eventId })
        if (!current) throw new CoreError('SOURCE_NOT_CURRENT', 'The original source authorization is no longer current.')
        if (current.authorKind !== 'human' || !current.authorId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'Resume requires current human authorization.')
        if (!this.allowedRequesterIds.includes(current.authorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The original source actor is no longer allowed to resume work.')
      } else if (!this.allowedRequesterIds.includes(command.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The local actor is no longer allowed to resume work.')
      const ticket = (await transaction.get<Work['ticket']>('ticket', command.ticketId))!
      const previous = await transaction.get<Assignment>('assignment', command.ticketId)
      const environment = previous?.environment ? this.environments.find(candidate => candidate.config.id === previous.environment!.id) : undefined
      if (previous?.environment && (!environment || environment.config.root !== previous.environment.root)) throw new CoreError('ENVIRONMENT_CHANGED', 'The retained working directory is no longer available.')
      const assignment: Assignment = { id: randomUUID(), generation: randomUUID(), ticketId: command.ticketId, createdAt: Date.now(),
        sessionId: previous?.sessionId ?? `worker-${randomUUID()}`, state: 'pending',
        ...(previous?.environment ? { environment: structuredClone(previous.environment) } : {}) }
      await this.saveAssignment(transaction, assignment)
      const { constraint: _constraint, ...openTicket } = ticket
      await transaction.replace('ticket', command.ticketId, { ...openTicket, state: 'open' })
      const intent = (await transaction.get<Work['intent']>('intent', command.ticketId))!
      await transaction.replace('intent', command.ticketId, { ...intent, state: 'pending', reason: 'router-pending' })
      await transaction.replace('stop-state', stop.id, { ...stop, resumedAt: Date.now(), resumeCommandId: command.commandId })
      const resumeKey = `${JSON.stringify(['resume-decision', command.ticketId])}:${commandKey}`
      await transaction.insert('resume-decision', resumeKey, { ticketId: command.ticketId, stopId: stop.id, assignmentId: assignment.id, actorId: command.actorId, resumedAt: Date.now() })
      const pendingInput = await this.inputs.latestPendingInput(transaction, command.ticketId)
      await this.effects.enqueue(transaction, { key: `resume:${command.commandId}`, stream: 'relay', scope: command.ticketId,
        payload: { ticketId: command.ticketId, assignmentId: assignment.id, resume: !pendingInput, ...(pendingInput ? { inputId: pendingInput.id } : {}) } })
      await transaction.insert('work-command', commandKey, { assignmentId: assignment.id })
    })
    return this.conversation(command.ticketId)
  }

  async retrySetup(commandId: string, ticketId: string, actorId: string) {
    identifier(commandId, 'commandId')
    identifier(ticketId, 'ticketId')
    return commandTransaction(this.storage, this.instanceId, async transaction => {
      const fingerprint = JSON.stringify(['setup-retry-v1', ticketId, actorId])
      const previous = await transaction.get<{ fingerprint: string; ticketId: string }>('setup-retry', commandId)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The setup retry command was used for different work.')
        return { ticketId: previous.ticketId }
      }
      const trigger = await this.trigger(transaction, ticketId)
      if (trigger.source.actorId !== actorId) throw new CoreError('ENVIRONMENT_DENIED', 'Only the original authorized actor may retry this setup.')
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      const setup = await transaction.get<SetupState>('setup', ticketId)
      if (!assignment?.environment || setup?.state !== 'failed' || setup.assignmentId !== assignment.id) throw new CoreError('SETUP_NOT_RETRYABLE', 'Only failed setup on the original Assignment may be retried.')
      const environment = this.environments.find(candidate => candidate.config.id === assignment.environment!.id)
      if (!environment || environment.config.root !== assignment.environment.root) throw new CoreError('ENVIRONMENT_CHANGED', 'The original Environment directory must remain configured.')
      environment.authorize({ instanceId: this.instanceId, actorId })
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      await transaction.replace('setup', ticketId, { assignmentId: assignment.id, state: 'pending' })
      await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'setup-pending' })
      await this.effects.enqueue(transaction, { key: `setup:${commandId}`, stream: 'relay', scope: ticketId, payload: { ticketId, assignmentId: assignment.id } })
      await transaction.insert('setup-retry', commandId, { fingerprint, ticketId })
      return { ticketId }
    })
  }
}
