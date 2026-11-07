import { randomUUID } from 'node:crypto'
import { CoreError, identifier, type Work } from './model.js'
import type { Storage, AsyncTx } from './storage.js'
import type { Effects, Effect, EffectHandler, EffectResult } from './effects.js'
import type { NativeSessions, NativeTool } from './native-sessions.js'
import { LocalSetupError, type LocalEnvironment, type BoundLocalEnvironment } from './local-environment.js'
import { commandTransaction } from './commands.js'
import type { WorkInputs } from './work-inputs.js'
import type { Attention, Attentions } from './attention.js'

export interface Assignment { id: string; ticketId: string; sessionId: string; state: 'pending' | 'running' | 'ended'; generation: string; environment?: { id: string; kind: 'local'; root: string } }
export interface ReadyReport { id: string; ticketId: string; assignmentId: string; sessionId: string; kind: 'ready'; result: string; evidence: string; artifacts: Artifact[]; toolFacts: ToolFact[]; inputId?: string; directionVersion: number; createdAt: number }
export interface Artifact { path: string; bytes: number; sha256: string }
export interface ToolFact { tool: string; outcome: 'success' | 'failed'; output: Record<string, unknown> }
export interface Delivery { id: string; ticketId: string; purpose: 'acknowledgement' | 'result' | 'attention'; text: string; destination: { sourceInstanceId: string; actorId: string; eventId: string; threadId?: string }; reportId?: string; inputId?: string; directionVersion?: number; attentionId?: string }
export interface SetupState { assignmentId: string; state: 'failed' | 'ready' | 'pending'; output?: Record<string, unknown>; code?: string }

export class Execution {
  private readonly routerSessionId: string
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly effects: Effects, private readonly sessions: NativeSessions,
    private readonly inputs: WorkInputs, private readonly attentions: Attentions, private readonly environments: LocalEnvironment[] = []) {
    this.routerSessionId = sessions.routerSessionId
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
      relay: { execute: async effect => { await this.worker(String(effect.payload.ticketId), typeof effect.payload.inputId === 'string' ? effect.payload.inputId : undefined); return { type: 'success' } } },
      outbox: { execute: async effect => {
        const ticketId = String(effect.payload.ticketId)
        const purpose = effect.payload.purpose
        if (purpose !== 'acknowledgement' && purpose !== 'result' && purpose !== 'attention') throw new CoreError('INVALID_DELIVERY', 'Unsupported delivery purpose.')
        const staleAttention = await this.storage.transaction(this.instanceId, async transaction => {
          const trigger = await this.trigger(transaction, ticketId)
          const report = purpose === 'result' ? await transaction.get<ReadyReport>('report', ticketId) : undefined
          if (purpose === 'result' && (!report || report.id !== effect.payload.reportId)) throw new CoreError('NOT_READY', 'Result delivery requires the current ready report.')
          const attention = purpose === 'attention' ? await transaction.get<Attention>('attention', String(effect.payload.attentionId)) : undefined
          if (purpose === 'attention' && (!attention || attention.ticketId !== ticketId || attention.status !== 'waiting')) return true
          const destination = attention?.destination ?? { ...trigger.source, eventId: trigger.eventId, ...(trigger.threadId ? { threadId: trigger.threadId } : {}) }
          const delivery: Delivery = { id: purpose === 'attention' ? `${ticketId}:attention:${attention!.id}` : `${ticketId}:${purpose}`, ticketId, purpose,
            text: purpose === 'result' ? report!.result : purpose === 'attention' ? attention!.question : 'Request accepted.', destination,
            ...(attention ? { attentionId: attention.id } : {}),
            ...(report ? { reportId: report.id, ...(report.inputId ? { inputId: report.inputId } : {}), directionVersion: report.directionVersion } : {}) }
          if (!await transaction.replace('delivery', delivery.id, delivery)) await transaction.insert('delivery', delivery.id, delivery)
          const historyKey = `${JSON.stringify(['delivery-history', ticketId])}:${purpose}:${purpose === 'attention' ? attention!.id : report?.id ?? 'initial'}`
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

  private async routerRequest(ticketId: string, ready: boolean) {
    const trigger = await this.storage.transaction(this.instanceId, transaction => this.trigger(transaction, ticketId))
    const report = ready ? await this.storage.transaction(this.instanceId, transaction => transaction.get<ReadyReport>('report', ticketId)) : undefined
    if (ready && !report) throw new CoreError('NOT_READY', 'No ready report exists.')
    const tool: NativeTool = ready ? {
      name: 'deliver_result', description: 'Deliver the current verified ready report to the original request.', parameters: { reportId: { type: 'string', required: true } },
      execute: async args => this.storage.transaction(this.instanceId, async transaction => {
        const current = await transaction.get<ReadyReport>('report', ticketId)
        const assignment = await transaction.get<Assignment>('assignment', ticketId)
        if (!current || current.id !== args.reportId || current.assignmentId !== assignment?.id) throw new CoreError('NOT_READY', 'Only the current Assignment ready report may be delivered.')
        await this.effects.enqueue(transaction, { key: `${ticketId}:result`, stream: 'outbox', scope: ticketId, payload: { purpose: 'result', ticketId, reportId: current.id } })
        return 'Result queued for the original message.'
      }),
    } : {
      name: 'assign_worker', description: 'Assign the accepted original request to one Worker.', parameters: {},
      execute: async () => this.storage.transaction(this.instanceId, async transaction => {
        const existing = await transaction.get<Assignment>('assignment', ticketId)
        if (existing) return existing.id
        const trigger = await this.trigger(transaction, ticketId)
        const environment = this.environments.find(candidate => candidate.config.id === trigger.environmentId)
        if (trigger.environmentId && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The accepted request has no authorized local Environment binding.')
        const assignment: Assignment = { id: randomUUID(), generation: randomUUID(), ticketId, sessionId: `worker-${randomUUID()}`, state: 'pending', ...(environment ? { environment: { id: environment.config.id, kind: 'local', root: environment.config.root } } : {}) }
        await transaction.insert('assignment', ticketId, assignment)
        await this.effects.enqueue(transaction, { key: assignment.id, stream: 'relay', scope: ticketId, payload: { ticketId, assignmentId: assignment.id } })
        return assignment.id
      }),
    }
    return { sessionId: this.routerSessionId, role: 'router' as const, coalesce: true, text: report ? `Ready report:${JSON.stringify(report)}` : `Accepted original request:${JSON.stringify({ ticketId, text: trigger.text })}`, tools: [tool] }
  }

  private async router(ticketId: string, ready: boolean, signal: AbortSignal) {
    const result = await this.sessions.run({ ...await this.routerRequest(ticketId, ready), signal })
    await this.recordRouterSession(result)
  }

  private async routerBatch(effects: Effect[], signal: AbortSignal): Promise<EffectResult[]> {
    const requests = await Promise.allSettled(effects.map(effect => this.routerRequest(String(effect.payload.ticketId), effect.payload.type === 'report-ready')))
    return Promise.all(requests.map(async request => {
      if (request.status === 'rejected') return { type: 'unknown' as const, reason: 'The Router notification could not be prepared.' }
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

  private async worker(ticketId: string, inputId?: string) {
    const { assignment, trigger, environment, input } = await this.storage.transaction(this.instanceId, async transaction => {
      let assignment = await transaction.get<Assignment>('assignment', ticketId)
      const trigger = await this.trigger(transaction, ticketId)
      const ticket = (await transaction.get<Work['ticket']>('ticket', ticketId))!
      if (ticket.state !== 'open') throw new CoreError('TICKET_ENDED', 'The Ticket is not open for this Worker turn.')
      if (ticket.constraint) throw new CoreError('TICKET_BLOCKED', 'The Ticket constraint must be resolved before another Worker turn.')
      if (!assignment) {
        if (!inputId) throw new CoreError('NOT_FOUND', 'No active Assignment exists.')
        const environment = this.environments.find(candidate => candidate.config.id === trigger.environmentId)
        if (trigger.environmentId && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The accepted request has no authorized local Environment binding.')
        assignment = { id: randomUUID(), generation: randomUUID(), ticketId, sessionId: `worker-${randomUUID()}`, state: 'pending',
          ...(environment ? { environment: { id: environment.config.id, kind: 'local', root: environment.config.root } } : {}) }
        await transaction.insert('assignment', ticketId, assignment)
      }
      const input = inputId ? await this.inputs.getInput(transaction, inputId) : undefined
      if (inputId && (!input || input.ticketId !== ticketId)) throw new CoreError('STALE_INPUT', 'The follow-up Input does not belong to this Ticket.')
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      assignment.state = 'running'
      await transaction.replace('assignment', ticketId, assignment)
      await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-running' })
      const environment = assignment.environment ? this.environments.find(candidate => candidate.config.id === assignment.environment!.id) : undefined
      if (assignment.environment && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The Assignment Environment is no longer configured.')
      return { assignment, trigger, environment, input }
    })
    const toolFacts: ToolFact[] = []
    const artifacts: Artifact[] = []
    let reported = false
    let askedAttention: Attention | undefined
    let bound: BoundLocalEnvironment | undefined
    if (environment) {
      try {
        if (environment.config.root !== assignment.environment?.root) throw new CoreError('ENVIRONMENT_CHANGED', 'The original Assignment directory must be retained for setup retry.')
        bound = await environment.prepare({ instanceId: this.instanceId, actorId: trigger.source.actorId })
        await this.storage.transaction(this.instanceId, async transaction => {
          const setup: SetupState = { assignmentId: assignment.id, state: 'ready' }
          if (!await transaction.replace('setup', ticketId, setup)) await transaction.insert('setup', ticketId, setup)
        })
      } catch (error) {
        await this.storage.transaction(this.instanceId, async transaction => {
          const setup: SetupState = { assignmentId: assignment.id, state: 'failed', code: error instanceof CoreError ? error.code : 'SETUP_FAILED', ...(error instanceof LocalSetupError ? { output: error.output } : {}) }
          if (!await transaction.replace('setup', ticketId, setup)) await transaction.insert('setup', ticketId, setup)
          const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
          await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'setup-failed' })
          await transaction.replace('assignment', ticketId, { ...assignment, state: 'pending' })
        })
        return
      }
    }
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
    const outcome = await this.sessions.run({ sessionId: assignment.sessionId, role: 'worker', text: input?.text ?? trigger.text, ...(bound ? { cwd: bound.cwd } : {}), tools: [
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
    await this.storage.transaction(this.instanceId, async transaction => {
      const sessionMetadata = { id: outcome.sessionId, eventCount: outcome.events.length, ticketId, role: 'worker', status: outcome.status }
      if (!await transaction.replace('session', outcome.sessionId, sessionMetadata)) await transaction.insert('session', outcome.sessionId, sessionMetadata)
      if (input) await this.inputs.markDelivered(transaction, input)
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      if (askedAttention) {
        await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'waiting-human' })
        await transaction.replace('assignment', ticketId, { ...assignment, state: 'ended' })
        return
      }
      await transaction.replace('intent', ticketId, { ...intent, state: report ? 'ready' : 'running', reason: report ? 'ready-report' : 'worker-idle' })
      if (report) {
        await transaction.replace('assignment', ticketId, { ...assignment, state: 'ended' })
        await this.effects.enqueue(transaction, { key: report.id, stream: 'notice', scope: 'router', payload: { type: 'report-ready', ticketId, reportId: report.id } })
      }
    })
  }

  async conversation(ticketId: string) {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, async transaction => {
      const trigger = await this.trigger(transaction, ticketId)
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      const attention = await this.attentions.current(transaction, ticketId)
      const attentionHistory = await this.attentions.history(transaction, ticketId)
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
      const setup = await transaction.get<SetupState>('setup', ticketId)
      return { ticketId, request: trigger.text, status: attention?.status === 'waiting' ? 'waiting-human' : intent.state, reason: intent.reason,
        attention, attentionHistory, assignments: assignment ? [assignment] : [], reports: report ? [report] : [],
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
