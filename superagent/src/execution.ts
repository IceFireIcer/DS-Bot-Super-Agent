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
import type { Slots, SlotActivation } from './slots.js'
import { Jobs, type JobRecord, type JobView } from './jobs.js'
import { Subagents, type SubagentRecord, type SubagentView } from './subagents.js'
import type { Agent } from '@deepseek-ai/dsh-agent'

/**
 * The completed job reaches its own Worker as a fact, with the confirmed exit and the bounded retained
 * output. The text never claims success on its own: only the ToolFact and exit code do.
 */
function jobEventText(job: JobRecord) {
  const output = job.output ?? { stdout: { text: '', lossy: false }, stderr: { text: '', lossy: false } }
  return `Background job ${job.id} (${job.command}) finished with state ${job.state}${job.exitCode === undefined ? '' : ` and exit code ${job.exitCode}`}. `
    + `${job.reason ? `${job.reason} ` : ''}Continue this Ticket using these facts. `
    + `Standard output:${JSON.stringify(output.stdout)} Standard error:${JSON.stringify(output.stderr)}`
}

/** A child Agent's outcome is evidence for the parent, never the Ticket's own completed result. */
function subagentEventText(subagent: SubagentRecord) {
  const result = subagent.result ?? { text: '', truncated: false }
  return `Subagent ${subagent.id} (delegated by Assignment generation ${subagent.generation}) finished with state ${subagent.state}. ${subagent.reason ? `${subagent.reason} ` : ''}`
    + `Continue this Ticket using this evidence; a subtask result is not a ready report.`
    + `${result.truncated ? ' Its result was shortened to the declared size limit.' : ''} Result:${JSON.stringify(result.text)}`
}

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
  private readonly jobs: Jobs | undefined
  private readonly subagents: Subagents | undefined
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly effects: Effects, private readonly sessions: NativeSessions,
    private readonly inputs: WorkInputs, private readonly attentions: Attentions, private readonly sourceEvents: SourceEvents,
    private allowedRequesterIds: string[], private readonly environments: LocalEnvironment[] = [], private readonly slots?: Slots, jobs?: Jobs,
    subagents?: Subagents) {
    this.routerSessionId = sessions.routerSessionId
    this.jobs = jobs
    this.subagents = subagents
    this.jobs?.setHandlers({ settled: record => this.wakeForJob(record), deadline: record => this.wakeForJob(record) })
    this.subagents?.setHandlers({ settled: record => this.wakeForSubagent(record), deadline: record => this.wakeForSubagent(record) })
  }

  /** Terminates managed background processes without writing business facts; the Host owns this shutdown. */
  async shutdown() {
    await this.subagents?.shutdown()
    this.jobs?.shutdown()
  }

  private async wakeForSubagent(record: SubagentRecord) {
    // A cancellation the person or the Worker decided is not new information; it must not start an unasked turn.
    if (record.state === 'cancelled' && (record.cancelReason === 'human' || record.cancelReason === 'worker')) return
    try {
      await commandTransaction(this.storage, this.instanceId, async transaction => {
        const ticket = await transaction.get<Work['ticket']>('ticket', record.ticketId)
        const assignment = await transaction.get<Assignment>('assignment', record.ticketId)
        // The completion only reaches the Assignment generation that delegated it.
        if (!ticket || ticket.state !== 'open' || ticket.constraint) return
        if (!assignment || assignment.state !== 'running' || assignment.id !== record.assignmentId || assignment.generation !== record.generation) return
        const intent = await transaction.get<Work['intent']>('intent', record.ticketId)
        if (intent) await transaction.replace('intent', record.ticketId, { ...intent, state: 'pending', reason: 'followup-pending' })
        // The wake names the generation that delegated the child, so a replacement Assignment can never consume it.
        await this.effects.enqueue(transaction, { key: `subagent:${record.id}`, stream: 'relay', scope: record.ticketId,
          payload: { ticketId: record.ticketId, subagentId: record.id, generation: record.generation } })
      })
    } catch { /* The durable subagent record stays queryable; the Ticket keeps its hold until the next wake. */ }
  }

  private async wakeForJob(record: JobRecord) {
    // A cancellation the person or the Worker itself decided is not new information; it must not start an
    // unasked turn. A stop is already guarded by the Ticket constraint below.
    if (record.state === 'cancelled' && (record.cancelReason === 'human' || record.cancelReason === 'worker')) return
    try {
      await commandTransaction(this.storage, this.instanceId, async transaction => {
        const ticket = await transaction.get<Work['ticket']>('ticket', record.ticketId)
        const assignment = await transaction.get<Assignment>('assignment', record.ticketId)
        // A stop, a waiting question, a ready handoff or a newer Assignment generation means the completion
        // must not wake work or a new generation.
        if (!ticket || ticket.state !== 'open' || ticket.constraint) return
        if (!assignment || assignment.state !== 'running' || assignment.id !== record.assignmentId || assignment.generation !== record.generation) return
        const intent = await transaction.get<Work['intent']>('intent', record.ticketId)
        if (intent) await transaction.replace('intent', record.ticketId, { ...intent, state: 'pending', reason: 'followup-pending' })
        await this.effects.enqueue(transaction, { key: `job:${record.id}`, stream: 'relay', scope: record.ticketId, payload: { ticketId: record.ticketId, jobId: record.id } })
      })
    } catch { /* The durable job record stays queryable; the Ticket keeps `worker-background` until the next wake. */ }
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
        try {
          const admitted = await this.worker(String(effect.payload.ticketId),
            typeof effect.payload.inputId === 'string' ? effect.payload.inputId : undefined, effect.payload.resume === true, effect.payload.status === true,
            typeof effect.payload.jobId === 'string' ? effect.payload.jobId : undefined,
            typeof effect.payload.subagentId === 'string' ? effect.payload.subagentId : undefined)
          return admitted === 'waiting'
            ? { type: 'defer', reason: 'The Worker turn is waiting for an execution slot.' }
            : { type: 'success' }
        } catch (error) {
          // A turn already running on this Ticket is not a failure of the queued wake: keep it due instead of
          // turning an ordinary overlap into an unknown outcome that would block the lane.
          if (error instanceof CoreError && error.code === 'TURN_ACTIVE') return { type: 'defer', reason: 'The Ticket already has an active Worker turn.' }
          throw error
        }
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

  private async admitSlot(transaction: AsyncTx, assignment: Assignment, request: { ticketId: string; activation: SlotActivation }) {
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

  private async worker(ticketId: string, inputId?: string, resume = false, status = false, jobId?: string, subagentId?: string) {
    let cancelledJobs: string[] = []
    let cancelledSubagents: string[] = []
    let confirmAfterStop = false
    const skipped = await this.storage.transaction(this.instanceId, async transaction => {
      const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
      if (!ticket?.constraint) return false
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      if (ticket.constraint.kind === 'stopped') {
        if (assignment && assignment.state !== 'ended') await this.saveAssignment(transaction, { ...assignment, state: 'ended' })
        const stop = await this.activeStop(transaction, ticketId)
        const live = await this.hasBackgroundWork(transaction, ticketId)
        // Background work that is only now being cancelled is not evidence of a quiet range; confirm it below.
        if (stop && !live) await transaction.replace('stop-state', stop.id, { ...stop, state: 'stopped', cancellationConfirmedAt: stop.cancellationConfirmedAt ?? Date.now() })
        const intent = await transaction.get<Work['intent']>('intent', ticketId)
        if (intent) await transaction.replace('intent', ticketId, { ...intent, state: 'pending', reason: 'stopped' })
        if (this.jobs) cancelledJobs = await this.jobs.requestCancelTicket(transaction, { ticketId, reason: 'stop' })
        if (this.subagents) cancelledSubagents = await this.subagents.requestCancelTicket(transaction, { ticketId, reason: 'stop' })
        confirmAfterStop = live
      }
      return true
    })
    if (skipped) {
      await this.storage.transaction(this.instanceId, transaction => this.slots?.release(transaction, { ticketId }) ?? Promise.resolve(false))
      const stoppedJobs = await this.stopJobs(ticketId, cancelledJobs)
      const stoppedSubagents = await this.stopSubagents(ticketId, cancelledSubagents)
      // Only a fully confirmed stop earns the cancellation fact; otherwise the Ticket stays `stopping`.
      if (confirmAfterStop && stoppedJobs.length === cancelledJobs.length && stoppedSubagents.length === cancelledSubagents.length) {
        await this.storage.transaction(this.instanceId, transaction => this.confirmStop(undefined, ticketId, transaction))
      }
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
      const job = jobId ? await this.jobs?.get(transaction, ticketId, jobId) : undefined
      // A completion of an earlier Assignment generation can never wake the current one.
      if (jobId && (!job || job.assignmentId !== assignment?.id || job.generation !== assignment.generation)) return { outcome: 'stale' as const }
      const subagent = subagentId ? await this.subagents?.get(transaction, ticketId, subagentId) : undefined
      if (subagentId && (!subagent || subagent.assignmentId !== assignment?.id || subagent.generation !== assignment.generation)) return { outcome: 'stale' as const }
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
      // A job or subagent completion is automatic input like a CI result: it wakes the Worker that started it but
      // never takes the person's extra slot.
      const activation = status ? 'status' : jobId || subagentId ? 'background' : input ? 'followup' : resume ? 'resume' : 'launch'
      if (!await this.admitSlot(transaction, assignment, { ticketId, activation })) return { outcome: 'waiting' as const }
      assignment.state = 'running'
      await this.saveAssignment(transaction, assignment)
      await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-running' })
      const environment = assignment.environment ? this.environments.find(candidate => candidate.config.id === assignment.environment!.id) : undefined
      if (assignment.environment && !environment) throw new CoreError('ENVIRONMENT_DENIED', 'The Assignment Environment is no longer configured.')
      return { outcome: 'admitted' as const, assignment, trigger, environment, input, job, subagent }
    })
    if (admitted.outcome === 'stale') return 'skipped' as const
    if (admitted.outcome === 'waiting') return 'waiting' as const
    const { assignment, trigger, environment, input, job, subagent } = admitted
    try {
      return await this.runTurn({ ticketId, assignment, trigger, environment, input, resume, status, job, subagent })
    } catch (error) {
      await this.releaseSlot(ticketId, assignment.id)
      throw error
    }
  }

  private async runTurn({ ticketId, assignment, trigger, environment, input, resume, status, job, subagent }: {
    ticketId: string; assignment: Assignment; trigger: Work['trigger']; environment: LocalEnvironment | undefined; input: WorkInput | undefined
    resume: boolean; status: boolean; job: JobRecord | undefined; subagent: SubagentRecord | undefined
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
          await this.confirmStop(assignment.id, ticketId)
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
    /**
     * A child gets the same local capabilities but its own accounting: its calls must not consume the parent's
     * tool budget or satisfy the parent's verification rule for `report_ready`.
     */
    const childTools = (): NativeTool[] => bound ? (['write_file', 'read_file', 'glob', 'grep', 'run_command'] as const).map(name => ({
      name,
      description: name === 'run_command'
        ? `Run one configured command inside the bound Environment: ${Object.keys(environment!.config.commands).filter(command => command !== environment!.config.setup).join(', ')}.`
        : localTools.find(tool => tool.name === name)!.description,
      parameters: localTools.find(tool => tool.name === name)!.parameters,
      execute: async (args: Record<string, string>, signal: AbortSignal) => JSON.stringify(await bound!.invoke(name, args, signal)),
    })) : []
    // Background work outlives the turn: the tool returns a job identity at once, and the completion event
    // arrives as a later turn on this same Session instead of holding the Router or this step open.
    const jobTools: NativeTool[] = bound && this.jobs ? [
      {
        name: 'start_command',
        description: `Start one configured command in the background and return its job identity at once: ${Object.keys(environment!.config.commands).filter(name => name !== environment!.config.setup).join(', ')}. Do not wait for it in this turn; its completion arrives as a later event.`,
        parameters: { name: { type: 'string', required: true } },
        execute: async (args: Record<string, string>) => {
          if (reported) throw new CoreError('REPORT_SEALED', 'Background work is sealed after the ready report; no later mutation is authorized.')
          if (askedAttention) throw new CoreError('ATTENTION_ACTIVE', 'Background work is sealed after asking a human question.')
          const job = await bound!.startCommand(args.name!)
          let record: JobRecord | undefined
          try {
            record = await this.storage.transaction(this.instanceId, async transaction => {
              const current = await transaction.get<Assignment>('assignment', ticketId)
              if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The starting Assignment is no longer current.')
              return this.jobs!.start(transaction, { ticketId, assignmentId: assignment.id, generation: assignment.generation,
                environmentId: assignment.environment!.id, command: args.name!, job })
            })
          } catch (error) {
            this.jobs!.abandon(job)
            throw error
          }
          if (!record) throw new CoreError('INCOMPLETE_STATE', 'The background job start did not record a job.')
          this.jobs!.attach(record)
          return JSON.stringify({ jobId: record.id, command: record.command, state: record.state, startedAt: record.startedAt })
        },
      },
      {
        name: 'job_status',
        description: 'Read one background job of this Ticket: state, confirmed exit and bounded output. A running job is not a result, and an unconfirmed exit stays unknown.',
        parameters: { jobId: { type: 'string', required: true } },
        execute: async (args: Record<string, string>) => JSON.stringify(await this.jobs!.read(ticketId, args.jobId!)),
      },
      {
        name: 'cancel_job',
        description: 'Cancel one running background job of this Ticket and record why.',
        parameters: { jobId: { type: 'string', required: true }, reason: { type: 'string', required: true } },
        execute: async (args: Record<string, string>) => {
          const reason = args.reason?.trim() ?? ''
          if (!reason || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'A job cancellation needs a bounded reason.')
          if (reported) throw new CoreError('REPORT_SEALED', 'Background work is sealed after the ready report.')
          const requested = await this.storage.transaction(this.instanceId, transaction => this.jobs!.requestCancel(transaction, { ticketId, jobId: args.jobId!, reason: 'worker' }))
          const [confirmed] = await this.jobs!.stopRanges([requested.id])
          let final: JobRecord | undefined
          try {
            final = await this.storage.transaction(this.instanceId, transaction => confirmed
              ? this.jobs!.confirmCancelled(transaction, { ticketId, jobId: requested.id, ...(confirmed.output ? { output: confirmed.output } : {}) })
              : this.jobs!.markUnconfirmed(transaction, { ticketId, jobId: requested.id }))
          } finally { this.jobs!.finishStopped([requested.id]) }
          return JSON.stringify({ jobId: requested.id, state: final?.state, cancelReason: requested.cancelReason })
        },
      },
    ] : []
    let statusFact: string | undefined
    // Delegation hands a child Agent the parent's own already-authorised work tools and bound directory. Router
    // tools, delivery tools, subscription changes and further delegation are never in that list.
    const subagentTools: NativeTool[] = bound && this.subagents ? (() => {
      // Only the parent's local work tools are inherited. Job tools are Ticket-wide closures: handing them down
      // would let a child see or cancel its parent's jobs, and the reference kills a subagent's jobs with it.
      const inherited = childTools()
      return [{
        name: 'delegate_subagent',
        description: 'Delegate one bounded subtask to a child Agent that inherits this Assignment\'s working directory, permissions and work tools. It starts at once and its completion arrives as a later event; do not wait in this turn.',
        parameters: { task: { type: 'string', required: true } },
        execute: async (args: Record<string, string>, _signal: AbortSignal, caller?: Agent) => {
          if (reported) throw new CoreError('REPORT_SEALED', 'Delegation is sealed after the ready report; no later mutation is authorized.')
          if (askedAttention) throw new CoreError('ATTENTION_ACTIVE', 'Delegation is sealed after asking a human question.')
          const task = args.task?.trim() ?? ''
          if (!task || Buffer.byteLength(task) > 16384) throw new CoreError('INVALID_INPUT', 'A subtask needs bounded nonempty text.')
          // A child never delegates again: only the parent's work tools travel down.
          const tools = inherited.filter(tool => tool.name !== 'delegate_subagent')
          // DSH reports the exact calling Agent; the child is registered under that same live parent.
          const parent = caller ?? this.sessions.agentOf(assignment.sessionId)
          if (!parent) throw new CoreError('STALE_ASSIGNMENT', 'The delegating Worker Session is no longer live.')
          const ticket = (await this.storage.transaction(this.instanceId, transaction => transaction.get<Work['ticket']>('ticket', ticketId)))!
          const scope = {
            parent, cwd: bound!.cwd, environmentId: assignment.environment!.id, mandateId: ticket.mandateId, tools,
            model: this.sessions.workerRoute,
            authorize: async (tx: AsyncTx) => {
              const current = await tx.get<Assignment>('assignment', ticketId)
              if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The delegating Assignment is no longer current.')
              const now = await tx.get<Work['ticket']>('ticket', ticketId)
              if (!now || now.state !== 'open' || now.constraint) throw new CoreError('TICKET_BLOCKED', 'A stopped or waiting Ticket cannot delegate work.')
              if (now.mandateId !== ticket.mandateId) throw new CoreError('MANDATE_CHANGED', 'The delegating Mandate is no longer the Ticket\'s current Mandate.')
            },
            guard: async () => {
              await this.storage.transaction(this.instanceId, async transaction => {
                const live = await this.subagents!.get(transaction, ticketId, id)
                if (!live || live.state !== 'running') throw new CoreError('SUBAGENT_CANCELLED', 'This subtask is no longer running.')
                const current = await transaction.get<Assignment>('assignment', ticketId)
                if (current?.id !== assignment.id || current.state === 'ended') throw new CoreError('STALE_ASSIGNMENT', 'The delegating Assignment is no longer current.')
                // A Mandate change mid-subtask must stop the child from acting under the old one.
                const now = await transaction.get<Work['ticket']>('ticket', ticketId)
                if (!now || now.state !== 'open' || now.constraint) throw new CoreError('TICKET_BLOCKED', 'The Ticket is no longer open for this subtask.')
                if (now.mandateId !== ticket.mandateId) throw new CoreError('MANDATE_CHANGED', 'The delegating Mandate is no longer the Ticket\'s current Mandate.')
              })
            },
          }
          const id = randomUUID()
          let record: SubagentRecord
          try {
            record = await this.storage.transaction(this.instanceId, transaction => this.subagents!.start(transaction, {
              id, ticketId, assignmentId: assignment.id, generation: assignment.generation, mandateId: ticket.mandateId, task, scope,
            }))
          } catch (error) {
            this.subagents!.abandon(id)
            throw error
          }
          this.subagents!.attach(record, scope)
          return JSON.stringify({ subagentId: record.id, state: record.state, startedAt: record.startedAt })
        },
      }, {
        name: 'subagent_status',
        description: 'Read one child Agent of this Ticket: state and its bounded result. A running child is not a result.',
        parameters: { subagentId: { type: 'string', required: true } },
        execute: async (args: Record<string, string>) => {
          const record = await this.storage.transaction(this.instanceId, transaction => this.subagents!.get(transaction, ticketId, args.subagentId!))
          if (!record) throw new CoreError('NOT_FOUND', 'The subagent does not belong to this Ticket.')
          return JSON.stringify({ subagentId: record.id, state: record.state, ...(record.result ? { result: record.result } : {}), ...(record.reason ? { reason: record.reason } : {}) })
        },
      }, {
        name: 'cancel_subagent',
        description: 'Cancel one running child Agent of this Ticket and record why.',
        parameters: { subagentId: { type: 'string', required: true }, reason: { type: 'string', required: true } },
        execute: async (args: Record<string, string>) => {
          const reason = args.reason?.trim() ?? ''
          if (!reason || Buffer.byteLength(reason) > 2048) throw new CoreError('INVALID_INPUT', 'A subagent cancellation needs a bounded reason.')
          if (reported) throw new CoreError('REPORT_SEALED', 'Delegation is sealed after the ready report.')
          const requested = await this.storage.transaction(this.instanceId, transaction =>
            this.subagents!.requestCancel(transaction, { ticketId, id: args.subagentId!, reason: 'worker' }))
          const stopped = await this.stopSubagents(ticketId, [requested.id])
          return JSON.stringify({ subagentId: requested.id, state: stopped.length ? 'cancelled' : requested.state, cancelReason: requested.cancelReason })
        },
      }]
    })() : []
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
          : job ? jobEventText(job) : subagent ? subagentEventText(subagent)
            : resume ? 'Continue after resume. Inspect the retained Session, files, version control and external state before making changes.' : input?.text ?? trigger.text,
        ...(bound ? { cwd: bound.cwd } : {}), signal: controller.signal, tools: status ? statusTools : [
      ...localTools,
      ...jobTools,
      ...subagentTools,
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
        // The turn is quiet, but its background work may not be: the stop's own path cancels it and confirms.
        if (!await this.hasLiveBackgroundWork(ticketId)) await this.confirmStop(assignment.id, ticketId)
        await this.releaseSlot(ticketId, assignment.id)
        return
      }
      throw error
    } finally {
      this.workerControllers.delete(ticketId)
    }
    let endedJobs: string[] = []
    let endedSubagents: string[] = []
    const keepSlot = await this.storage.transaction(this.instanceId, async transaction => {
      if (await this.activeStop(transaction, ticketId)) {
        // Background work is cancelled and confirmed after this transaction; claiming `stopped` here would be a lie.
        if (!await this.hasBackgroundWork(transaction, ticketId)) await this.confirmStop(assignment.id, ticketId, transaction)
        return false
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
        endedJobs = await this.endAssignmentJobs(transaction, ticketId, assignment.id)
        // A handoff to a person stops the related subagents; only the Worksheet keeps a review server running.
        endedSubagents = await this.endAssignmentSubagents(transaction, ticketId, assignment.id)
        return false
      }
      // Background work keeps its slot and keeps the Ticket working; it is not an idle Ticket and no report
      // is owed yet. Its completion event wakes this same Assignment on this same slot.
      if (!report && await this.hasBackgroundWork(transaction, ticketId, assignment.id)) {
        await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-background' })
        return true
      }
      await transaction.replace('intent', ticketId, { ...intent, state: report ? 'ready' : 'running', reason: report ? 'ready-report' : 'worker-idle' })
      if (report) {
        await this.saveAssignment(transaction, { ...assignment, state: 'ended' })
        await this.effects.enqueue(transaction, { key: report.id, stream: 'notice', scope: 'router', payload: { type: 'report-ready', ticketId, reportId: report.id } })
        endedJobs = await this.endAssignmentJobs(transaction, ticketId, assignment.id)
        endedSubagents = await this.endAssignmentSubagents(transaction, ticketId, assignment.id)
      }
      return false
    })
    await this.stopJobs(ticketId, endedJobs)
    await this.stopSubagents(ticketId, endedSubagents)
    if (!keepSlot) await this.releaseSlot(ticketId, assignment.id, true)
    return 'ran' as const
  }

  async conversation(ticketId: string) {
    identifier(ticketId, 'ticketId')
    let freed = false
    const conversation = await this.storage.transaction(this.instanceId, async transaction => {
      freed = await this.reconcileJobHold(transaction, ticketId) !== undefined
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
      const jobs = this.jobs ? await this.jobs.listIn(transaction, ticketId) : []
      const subagents = this.subagents ? await this.subagents.listIn(transaction, ticketId) : []
      return { ticketId, request: trigger.text, status: stop?.state ?? (attention?.status === 'waiting' ? 'waiting-human' : intent.state), reason: stop?.state ?? intent.reason,
        ...(slot ? { slot } : {}),
        ...(statusReport ? { statusReport } : {}),
        attention, attentionHistory, stop, assignments: assignment ? [assignment] : [],
        jobs: jobs.map(job => ({ id: job.id, assignmentId: job.assignmentId, command: job.command, state: job.state,
          ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }), ...(job.cancelReason ? { cancelReason: job.cancelReason } : {}),
          startedAt: job.startedAt, ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }) })),
        subagents: subagents.map(subagent => ({ id: subagent.id, assignmentId: subagent.assignmentId, task: subagent.task, state: subagent.state,
          ...(subagent.cancelReason ? { cancelReason: subagent.cancelReason } : {}), startedAt: subagent.startedAt,
          ...(subagent.finishedAt === undefined ? {} : { finishedAt: subagent.finishedAt }) })),
        assignmentHistory: assignmentHistory.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
        stopHistory: stopHistory.sort((left, right) => left.requestedAt - right.requestedAt), resumeHistory: resumeHistory.sort((left, right) => Number(left.resumedAt ?? 0) - Number(right.resumedAt ?? 0)),
        reports: report ? [report] : [],
        reportHistory: reportHistory.sort((left, right) => left.createdAt - right.createdAt), messages,
        messageHistory: messageHistory.sort((left, right) => (left.directionVersion ?? 0) - (right.directionVersion ?? 0)), ...(setup ? { setup } : {}) }
    })
    if (freed) this.wakeForFreedSlot()
    return conversation
  }

  private async wakeForFreedSlot() {
    if (await this.storage.transaction(this.instanceId, transaction => this.slots?.hasWaiting(transaction) ?? Promise.resolve(false))) this.effects.wake()
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

  /** An Assignment that hands the Ticket back to a person or ends keeps no background process range alive. */
  private async endAssignmentJobs(transaction: AsyncTx, ticketId: string, assignmentId: string) {
    if (!this.jobs) return []
    return this.jobs.requestCancelAssignment(transaction, { ticketId, assignmentId, reason: 'assignment-ended' })
  }

  /** A handed-back or ended Assignment owns no child Agents either; DSH's ownership seam disposes them. */
  private async endAssignmentSubagents(transaction: AsyncTx, ticketId: string, assignmentId: string) {
    if (!this.subagents) return []
    return this.subagents.requestCancelAssignment(transaction, { ticketId, assignmentId, reason: 'assignment-ended' })
  }

  private async hasBackgroundWork(transaction: AsyncTx, ticketId: string, assignmentId?: string) {
    if (this.jobs && await this.jobs.hasActive(transaction, { ticketId, ...(assignmentId === undefined ? {} : { assignmentId }) })) return true
    return this.subagents ? this.subagents.hasActive(transaction, ticketId, assignmentId) : false
  }

  /** The same check outside a caller-owned transaction, for the turn-abort path. */
  private hasLiveBackgroundWork(ticketId: string) {
    return this.storage.transaction(this.instanceId, transaction => this.hasBackgroundWork(transaction, ticketId))
  }

  /**
   * Disposes the named child Agents after their cancellation facts committed, then records `cancelled` only where
   * the child was really gone. An unconfirmed child keeps a visible pending state instead of claiming success.
   */
  private async stopSubagents(ticketId: string, ids: string[]): Promise<string[]> {
    if (!this.subagents || !ids.length) return []
    const stopped = await this.subagents.stopChildren(ids)
    const unresolved = ids.filter(id => !stopped.includes(id))
    try {
      await this.storage.transaction(this.instanceId, async transaction => {
        for (const id of stopped) await this.subagents!.confirmCancelled(transaction, { ticketId, id })
        for (const id of unresolved) await this.subagents!.markUnconfirmed(transaction, { ticketId, id })
      })
    } finally { await this.subagents.finishStopped(ids) }
    return stopped
  }

  /**
   * Terminates the named ranges after the cancellation facts committed, then records each `cancelled` only where
   * the managed range was observed empty. A range this Host cannot observe keeps its pending cancel.
   */
  private async stopJobs(ticketId: string, jobIds: string[]) {
    if (!this.jobs || !jobIds.length) return []
    const confirmed = await this.jobs.stopRanges(jobIds)
    const confirmedIds = confirmed.map(outcome => outcome.jobId)
    const unresolved = jobIds.filter(jobId => !confirmedIds.includes(jobId))
    try {
      await this.storage.transaction(this.instanceId, async transaction => {
        for (const outcome of confirmed) await this.jobs!.confirmCancelled(transaction, { ticketId, jobId: outcome.jobId, ...(outcome.output ? { output: outcome.output } : {}) })
        for (const jobId of unresolved) await this.jobs!.markUnconfirmed(transaction, { ticketId, jobId })
      })
    } finally {
      // The claim must not outlive this call, even when the terminal fact could not be written: a stale claim
      // would keep a job that no longer has a range counted as live work.
      this.jobs.finishStopped(jobIds)
    }
    return confirmedIds
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
    // T09's decided semantic: an interrupted stop reads `stopped` with a recovery reason and no cancellation
    // evidence, and resume stays blocked by `CANCELLATION_UNCONFIRMED` until a person resolves it explicitly.
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

  /** Records the local cancellation evidence for a stop; `assignmentId` only narrows which Assignment is ended. */
  private async confirmStop(assignmentId: string | undefined, ticketId: string, existing?: AsyncTx) {
    const operation = async (transaction: AsyncTx) => {
      const stop = await this.activeStop(transaction, ticketId)
      if (!stop) return
      const current = await transaction.get<Assignment>('assignment', ticketId)
      if (current && (assignmentId === undefined || current.id === assignmentId) && current.state !== 'ended') {
        await this.saveAssignment(transaction, { ...current, state: 'ended' })
      }
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
      // A turn ends while its background jobs still hold the slot, so a running Assignment is not proof of a live
      // local turn; background process ranges are cancelled with the stop and confirm quiescence below.
      const liveBackground = await this.hasBackgroundWork(transaction, command.ticketId)
      const running = assignment?.state === 'running' && (liveBackground || this.workerControllers.has(command.ticketId))
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
      const jobIds = this.jobs ? await this.jobs.requestCancelTicket(transaction, { ticketId: command.ticketId, reason: 'stop' }) : []
      const subagentIds = this.subagents ? await this.subagents.requestCancelTicket(transaction, { ticketId: command.ticketId, reason: 'stop' }) : []
      await transaction.insert('work-command', commandKey, { stopId, assignmentId: assignment?.id, fingerprint })
      return { stopId, assignmentId: assignment?.id, replay: false, jobIds, subagentIds }
    })
    const worker = this.workerControllers.get(command.ticketId)
    if (!outcome.replay && worker && outcome.assignmentId && worker.assignmentId === outcome.assignmentId) worker.controller.abort()
    if (outcome.replay) return this.conversation(command.ticketId)
    const ranges = outcome.jobIds ?? []
    const children = outcome.subagentIds ?? []
    const confirmed = await this.stopJobs(command.ticketId, ranges)
    const stoppedChildren = await this.stopSubagents(command.ticketId, children)
    // A confirmed empty set of ranges is the local cancellation evidence. A live turn that aborted deliberately
    // leaves confirmation to this path, because it cannot prove its own background work is quiet.
    const allStopped = confirmed.length === ranges.length && stoppedChildren.length === children.length
    if (allStopped && (ranges.length || children.length)) {
      await this.storage.transaction(this.instanceId, transaction => this.confirmStop(outcome.assignmentId, command.ticketId, transaction))
    }
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

  async listJobs(ticketId: string): Promise<JobView[]> {
    identifier(ticketId, 'ticketId')
    if (!this.jobs) throw new CoreError('WORKER_NOT_ENABLED', 'Background jobs require a configured native runtime.')
    await this.settleJobHold(ticketId)
    return this.jobs.listViews(ticketId)
  }

  async getJob(ticketId: string, jobId: string): Promise<JobView> {
    identifier(ticketId, 'ticketId'); identifier(jobId, 'jobId')
    if (!this.jobs) throw new CoreError('WORKER_NOT_ENABLED', 'Background jobs require a configured native runtime.')
    return this.jobs.read(ticketId, jobId)
  }

  async cancelJob(command: { commandId: string; ticketId: string; jobId: string; reason: string; actorId: string }) {
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.jobId, 'jobId'); identifier(command.actorId, 'actorId')
    if (!command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Cancelling a job needs a bounded reason.')
    if (!this.jobs) throw new CoreError('WORKER_NOT_ENABLED', 'Background jobs require a configured native runtime.')
    const commandKey = createHash('sha256').update(JSON.stringify(['cancel-job', this.instanceId, command.ticketId, command.jobId, command.actorId, command.commandId])).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify(['cancel-job-v1', this.instanceId, command.ticketId, command.jobId, command.reason])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get<{ fingerprint: string }>('job-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The job cancellation was reused with a different reason.')
        return
      }
      const trigger = await this.trigger(transaction, command.ticketId)
      if (trigger.source.sourceInstanceId !== this.sourceEvents.sourceInstanceId || trigger.source.actorId !== command.actorId
        || !this.allowedRequesterIds.includes(command.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'Only the trusted source actor may cancel this background job.')
      await this.jobs!.requestCancel(transaction, { ticketId: command.ticketId, jobId: command.jobId, reason: 'human' })
      await transaction.insert('job-command', commandKey, { fingerprint, ticketId: command.ticketId, jobId: command.jobId })
    })
    // The durable cancellation decision is committed before the process range is terminated, so a rejected
    // command never kills work; `cancelled` is written only once the range is observed empty.
    await this.stopJobs(command.ticketId, [command.jobId])
    await this.settleJobHold(command.ticketId)
    return this.listJobs(command.ticketId)
  }

  async listSubagents(ticketId: string): Promise<SubagentView[]> {
    identifier(ticketId, 'ticketId')
    if (!this.subagents) throw new CoreError('WORKER_NOT_ENABLED', 'Subagents require a configured native runtime.')
    await this.settleJobHold(ticketId)
    return this.subagents.list(ticketId)
  }

  async getSubagent(ticketId: string, subagentId: string) {
    identifier(ticketId, 'ticketId'); identifier(subagentId, 'subagentId')
    if (!this.subagents) throw new CoreError('WORKER_NOT_ENABLED', 'Subagents require a configured native runtime.')
    return this.subagents.view(ticketId, subagentId)
  }

  /** Cancels one child Agent; like a job cancel the durable decision precedes stopping the child. */
  async cancelSubagent(command: { commandId: string; ticketId: string; subagentId: string; reason: string; actorId: string }) {
    identifier(command.commandId, 'commandId'); identifier(command.ticketId, 'ticketId'); identifier(command.subagentId, 'subagentId'); identifier(command.actorId, 'actorId')
    if (!command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Cancelling a subagent needs a bounded reason.')
    if (!this.subagents) throw new CoreError('WORKER_NOT_ENABLED', 'Subagents require a configured native runtime.')
    const commandKey = createHash('sha256').update(JSON.stringify(['cancel-subagent', this.instanceId, command.ticketId, command.subagentId, command.actorId, command.commandId])).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify(['cancel-subagent-v1', this.instanceId, command.ticketId, command.subagentId, command.reason])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get<{ fingerprint: string }>('subagent-command', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The subagent cancellation was reused with a different reason.')
        return
      }
      const trigger = await this.trigger(transaction, command.ticketId)
      if (trigger.source.sourceInstanceId !== this.sourceEvents.sourceInstanceId || trigger.source.actorId !== command.actorId
        || !this.allowedRequesterIds.includes(command.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'Only the trusted source actor may cancel this subagent.')
      await this.subagents!.requestCancel(transaction, { ticketId: command.ticketId, id: command.subagentId, reason: 'human' })
      await transaction.insert('subagent-command', commandKey, { fingerprint, ticketId: command.ticketId, subagentId: command.subagentId })
    })
    await this.stopSubagents(command.ticketId, [command.subagentId])
    await this.settleJobHold(command.ticketId)
    return this.listSubagents(command.ticketId)
  }

  /**
   * A Ticket that ended its turn with background work keeps its slot until that work is gone. Once the last job
   * settles by a human cancel, the Ticket is idle again and the slot is freed; a completion that still warrants a
   * turn is woken separately by the job handler.
   */
  private async settleJobHold(ticketId: string) {
    if (!this.jobs && !this.subagents) return
    const released = await commandTransaction(this.storage, this.instanceId, transaction => this.reconcileJobHold(transaction, ticketId))
    if (released) await this.wakeForFreedSlot()
  }

  /**
   * Clearing a spent job hold is idempotent and safe to run on any read: a Ticket only reads as holding background
   * work while this process has a live turn or a live job for it. A record from an earlier runtime cannot be proven
   * live, so it becomes `unknown` and stops holding the slot instead of blocking the budget forever.
   */
  private async reconcileJobHold(transaction: AsyncTx, ticketId: string): Promise<string | undefined> {
    if (!this.jobs && !this.subagents) return undefined
    const intent = await transaction.get<Work['intent']>('intent', ticketId)
    if (intent?.reason !== 'worker-background') return undefined
    if (this.workerControllers.has(ticketId) || await this.hasBackgroundWork(transaction, ticketId)) return undefined
    // A completion or cancel wake that is already queued still warrants this slot: freeing it here would let
    // another Ticket take it before the waiting turn runs.
    if (await this.effects.hasPendingInTransaction(transaction, { ticketId, stream: 'relay' })) return undefined
    const assignment = await transaction.get<Assignment>('assignment', ticketId)
    await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-idle' })
    if (assignment) await this.slots?.release(transaction, { ticketId, assignmentId: assignment.id })
    return assignment?.id ?? ''
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
