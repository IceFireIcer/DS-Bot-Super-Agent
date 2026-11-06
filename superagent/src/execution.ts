import { randomUUID } from 'node:crypto'
import { CoreError, identifier, type Work } from './model.js'
import type { Storage, AsyncTx } from './storage.js'
import type { Effects, Effect, EffectHandler, EffectResult } from './effects.js'
import type { NativeSessions, NativeTool } from './native-sessions.js'
import { LocalSetupError, type LocalEnvironment, type BoundLocalEnvironment } from './local-environment.js'
import { commandTransaction } from './commands.js'

export interface Assignment { id: string; ticketId: string; sessionId: string; state: 'pending' | 'running' | 'ended'; generation: string; environment?: { id: string; kind: 'local'; root: string } }
export interface ReadyReport { id: string; ticketId: string; assignmentId: string; sessionId: string; kind: 'ready'; result: string; evidence: string; artifacts: Artifact[]; toolFacts: ToolFact[] }
export interface Artifact { path: string; bytes: number; sha256: string }
export interface ToolFact { tool: string; outcome: 'success' | 'failed'; output: Record<string, unknown> }
export interface Delivery { id: string; ticketId: string; purpose: 'acknowledgement' | 'result'; text: string; destination: { sourceInstanceId: string; actorId: string; eventId: string; threadId?: string }; reportId?: string }
export interface SetupState { assignmentId: string; state: 'failed' | 'ready' | 'pending'; output?: Record<string, unknown>; code?: string }

export class Execution {
  private readonly routerSessionId: string
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly effects: Effects, private readonly sessions: NativeSessions, private readonly environments: LocalEnvironment[] = []) {
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
      relay: { execute: async effect => { await this.worker(String(effect.payload.ticketId)); return { type: 'success' } } },
      outbox: { execute: async effect => {
        const ticketId = String(effect.payload.ticketId)
        const purpose = effect.payload.purpose
        if (purpose !== 'acknowledgement' && purpose !== 'result') throw new CoreError('INVALID_DELIVERY', 'Unsupported delivery purpose.')
        await this.storage.transaction(this.instanceId, async transaction => {
          const trigger = await this.trigger(transaction, ticketId)
          const report = purpose === 'result' ? await transaction.get<ReadyReport>('report', ticketId) : undefined
          if (purpose === 'result' && (!report || report.id !== effect.payload.reportId)) throw new CoreError('NOT_READY', 'Result delivery requires the current ready report.')
          const delivery: Delivery = { id: `${ticketId}:${purpose}`, ticketId, purpose, text: purpose === 'result' ? report!.result : 'Request accepted.', destination: { ...trigger.source, eventId: trigger.eventId, ...(trigger.threadId ? { threadId: trigger.threadId } : {}) }, ...(report ? { reportId: report.id } : {}) }
          if (!await transaction.get('delivery', delivery.id)) await transaction.insert('delivery', delivery.id, delivery)
        })
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

  private async worker(ticketId: string) {
    const { assignment, trigger, environment } = await this.storage.transaction(this.instanceId, async transaction => {
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      if (!assignment) throw new CoreError('NOT_FOUND', 'No active Assignment exists.')
      const trigger = await this.trigger(transaction, ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      assignment.state = 'running'
      await transaction.replace('assignment', ticketId, assignment)
      await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-running' })
      const environment = assignment.environment ? this.environments.find(candidate => candidate.config.id === assignment.environment!.id) : undefined
      if (assignment.environment && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The Assignment Environment is no longer configured.')
      return { assignment, trigger, environment }
    })
    const toolFacts: ToolFact[] = []
    const artifacts: Artifact[] = []
    let reported = false
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
    const outcome = await this.sessions.run({ sessionId: assignment.sessionId, role: 'worker', text: trigger.text, ...(bound ? { cwd: bound.cwd } : {}), tools: [
      ...localTools,
      {
      name: 'report_ready', description: 'Record a completed answer and concrete verification evidence for the original request.',
      parameters: { result: { type: 'string', required: true }, evidence: { type: 'string', required: true }, ...(bound ? { artifacts: { type: 'string' as const, required: true as const } } : {}) },
      execute: async (args, signal) => {
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
          if (existing) return existing.id
          const report: ReadyReport = { id: randomUUID(), ticketId, assignmentId: assignment.id, sessionId: assignment.sessionId, kind: 'ready', result: bound ? bound.sanitize(args.result!) : args.result!, evidence: bound ? bound.sanitize(args.evidence!) : args.evidence!, artifacts: structuredClone(artifacts), toolFacts: structuredClone(toolFacts) }
          await transaction.insert('report', ticketId, report)
          reported = true
          return report.id
        })
      },
      },
    ] })
    await this.storage.transaction(this.instanceId, async transaction => {
      await transaction.insert('session', outcome.sessionId, { id: outcome.sessionId, eventCount: outcome.events.length, ticketId, role: 'worker', status: outcome.status })
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
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
      const messages: Delivery[] = []
      for (const purpose of ['acknowledgement', 'result']) {
        const message = await transaction.get<Delivery>('delivery', `${ticketId}:${purpose}`)
        if (message) messages.push(message)
      }
      const setup = await transaction.get<SetupState>('setup', ticketId)
      return { ticketId, request: trigger.text, status: intent.state, reason: intent.reason, assignments: assignment ? [assignment] : [], reports: report ? [report] : [], messages, ...(setup ? { setup } : {}) }
    })
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
