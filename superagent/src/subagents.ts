import { randomUUID } from 'node:crypto'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { NativeTool } from './native-sessions.js'
import { BackgroundWork } from './background.js'

export type SubagentState = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'unknown'
export type SubagentCancelReason = 'human' | 'worker' | 'stop' | 'assignment-ended' | 'deadline'

export interface SubagentResult { text: string; truncated: boolean }

/** One delegated subtask: a child Agent owned by the parent Worker's Assignment generation. */
export interface SubagentRecord {
  id: string
  ticketId: string
  assignmentId: string
  generation: string
  /** The Ticket Mandate the child acts under; it never receives a wider one. */
  mandateId: string
  environmentId: string
  sessionId: string
  task: string
  state: SubagentState
  startedAt: number
  runtimeToken: string
  finishedAt?: number
  result?: SubagentResult
  cancelReason?: SubagentCancelReason
  reason?: string
}

export interface SubagentView {
  id: string
  ticketId: string
  assignmentId: string
  generation: string
  mandateId: string
  task: string
  state: SubagentState
  /** A completed, failed or cancelled child has finished; only `completed` succeeded. */
  settled: boolean
  succeeded: boolean
  startedAt: number
  finishedAt?: number
  result?: SubagentResult
  cancelReason?: SubagentCancelReason
  reason?: string
}

export interface SubagentsOptions {
  /** Subagents allowed per Ticket at once. Defaults to 2. */
  maxPerTicket?: number
  /** How long one subagent may run before its declared deadline. Defaults to 10 minutes. */
  deadlineMs?: number
  /** Largest result kept from one subagent, in bytes. Defaults to 16384. */
  maxResultBytes?: number
  /** How long one child gets to confirm cancellation. Defaults to 5 s. */
  cleanupMs?: number
}

/** What a subagent is allowed to do: the parent's already-resolved world, never a fresh one. */
export interface SubagentScope {
  /** The parent Agent the child is registered under, from DSH's public ownership seam. */
  parent: Agent
  /** Absolute working directory of the Assignment Environment. */
  cwd: string
  environmentId: string
  /** The delegating Ticket's Mandate. */
  mandateId: string
  /** Tools that are safe to hand down. Router-only and delivery tools are never in this list. */
  tools: NativeTool[]
  model: { provider: string; model: string }
  /** Read-only look at the durable facts, used before a subtask may start. */
  authorize(tx: AsyncTx): Promise<void>
  /** Re-checks, before every child tool call, that this subtask is still the live one. */
  guard(): Promise<void>
}

export interface SubagentStart {
  /** Caller-generated stable identity, so a rolled-back start can be abandoned by id. */
  id: string
  ticketId: string
  assignmentId: string
  generation: string
  mandateId: string
  task: string
  scope: SubagentScope
}

export interface SubagentHandlers {
  settled(record: SubagentRecord): void
  deadline(record: SubagentRecord): void
}

const prefix = (ticketId: string) => JSON.stringify(['subagent', ticketId])
const key = (ticketId: string, id: string) => `${prefix(ticketId)}:${id}`
const settledStates: SubagentState[] = ['completed', 'failed', 'cancelled']

/**
 * Delegated subtasks running as real DSH child Agents. A child is created with `parentAgent`, so DSH records the
 * runtime ownership and the durable lineage; its tools are the parent's restricted work tools, its directory is the
 * parent's bound Environment, and it is disposed (never left running) when its Assignment ends or the Ticket stops.
 */
export class Subagents {
  readonly maxPerTicket: number
  readonly deadlineMs: number
  readonly maxResultBytes: number
  readonly cleanupMs: number
  /** Subtasks one Ticket may report at once; older records stay in the store as evidence. */
  readonly maxRecords = 100
  /** One live subtask: the record, its handle once created, and a promise that settles as soon as creation ends. */
  private readonly running = new Map<string, { record: SubagentRecord; handle?: AgentHandle; created: Promise<void> }>()
  /** Ids whose record committed but whose child Agent is still being created or stopped. */
  private readonly claimed = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly index: BackgroundWork
  private handlers: SubagentHandlers | undefined
  constructor(private readonly context: Context, private readonly storage: Storage, private readonly instanceId: string,
    private readonly runtimeToken: string, options: SubagentsOptions = {}, private readonly now: () => number = Date.now) {
    this.maxPerTicket = options.maxPerTicket ?? 2
    this.deadlineMs = options.deadlineMs ?? 600000
    this.maxResultBytes = options.maxResultBytes ?? 16384
    this.cleanupMs = options.cleanupMs ?? 5000
    if (!Number.isInteger(this.maxPerTicket) || this.maxPerTicket < 1 || this.maxPerTicket > 8) throw new CoreError('INVALID_CONFIG', 'Invalid subagent budget.')
    if (!Number.isInteger(this.deadlineMs) || this.deadlineMs < 1000 || this.deadlineMs > 3600000) throw new CoreError('INVALID_CONFIG', 'Invalid subagent deadline.')
    if (!Number.isInteger(this.maxResultBytes) || this.maxResultBytes < 256 || this.maxResultBytes > 262144) throw new CoreError('INVALID_CONFIG', 'Invalid subagent result budget.')
    if (!Number.isInteger(this.cleanupMs) || this.cleanupMs < 100 || this.cleanupMs > 30000) throw new CoreError('INVALID_CONFIG', 'Invalid subagent cleanup budget.')
    this.index = new BackgroundWork('subagent', async (tx, request) => {
      const record = await tx.get<SubagentRecord>('subagent', key(request.ticketId, request.id))
      return record === undefined ? undefined : isActive(record.state)
    })
  }

  setHandlers(handlers: SubagentHandlers) { this.handlers = handlers }

  /** The per-Ticket budget is checked inside the starting transaction, so two overlapping starts cannot both pass. */
  async start(tx: AsyncTx, request: SubagentStart): Promise<SubagentRecord> {
    identifier(request.ticketId, 'ticketId'); identifier(request.assignmentId, 'assignmentId')
    if (!request.task.trim() || Buffer.byteLength(request.task) > 16384) throw new CoreError('INVALID_INPUT', 'A subtask needs bounded nonempty text.')
    if ((await this.index.active(tx, request.ticketId)).length >= this.maxPerTicket) throw new CoreError('SUBAGENT_BUDGET', 'This Ticket already runs its declared number of subagents.')
    await request.scope.authorize(tx)
    identifier(request.id, 'subagentId')
    const record: SubagentRecord = { id: request.id, ticketId: request.ticketId, assignmentId: request.assignmentId,
      generation: request.generation, mandateId: request.mandateId, environmentId: request.scope.environmentId, sessionId: `subagent-${randomUUID()}`,
      task: request.task, state: 'running', startedAt: this.now(), runtimeToken: this.runtimeToken }
    await tx.insert('subagent', key(record.ticketId, record.id), record)
    await this.index.add(tx, record.ticketId, { id: record.id, assignmentId: record.assignmentId })
    // The claim starts with the record, not with the child: a read between commit and creation must not call it lost.
    this.claimed.add(record.id)
    // `attach` replaces this placeholder with the real creation promise; a start abandoned first never attaches.
    this.running.set(record.id, { record, created: Promise.resolve() })
    return record
  }

  /**
   * Launches the child Agent for a committed start record. The child is created through DSH's public registry with
   * `parentAgent`, its own Session metadata (`origin: 'subagent'`, inherited depth) and a restricted tool scope.
   */
  attach(record: SubagentRecord, scope: SubagentScope) {
    const timer = setTimeout(() => { void this.expire(record.id) }, this.deadlineMs)
    timer.unref()
    this.timers.set(record.id, timer)
    // `created` settles when the handle is available (or creation failed), so a stop can cancel a live child at
    // once instead of waiting for its whole turn to end.
    let announce: () => void = () => {}
    const created = new Promise<void>(resolve => { announce = resolve })
    const entry = this.running.get(record.id)
    if (entry) entry.created = created
    void this.drive(record, scope, announce).catch(() => announce())
  }

  /** Ends a start whose record did not commit; nothing was launched yet, so there is nothing to stop. */
  abandon(id: string) {
    this.claimed.delete(id)
    this.running.delete(id)
    this.releaseTimer(id)
  }

  async get(tx: AsyncTx, ticketId: string, id: string): Promise<SubagentRecord | undefined> {
    const record = await tx.get<SubagentRecord>('subagent', key(ticketId, id))
    return record && this.reconcile(tx, record)
  }

  async list(ticketId: string): Promise<SubagentView[]> {
    return this.storage.transaction(this.instanceId, async tx => (await this.listIn(tx, ticketId)).map(record => this.viewOf(record)))
  }

  /** Reads the durable record as a view; the public query and the conversation projection share one shape. */
  async view(ticketId: string, id: string): Promise<SubagentView> {
    const record = await this.storage.transaction(this.instanceId, tx => this.get(tx, ticketId, id))
    if (!record) throw new CoreError('NOT_FOUND', 'The subagent does not belong to this Ticket.')
    return this.viewOf(record)
  }

  async hasActive(tx: AsyncTx, ticketId: string, assignmentId?: string) {
    return this.index.hasActive(tx, ticketId, assignmentId)
  }

  /** Records the cancellation decision; only `confirmCancelled` writes the terminal fact after the child is gone. */
  async requestCancel(tx: AsyncTx, request: { ticketId: string; id: string; reason: SubagentCancelReason }) {
    const record = await this.get(tx, request.ticketId, request.id)
    if (!record) throw new CoreError('NOT_FOUND', 'The subagent does not belong to this Ticket.')
    if (!isActive(record.state)) return record
    const cancelling: SubagentRecord = { ...record, state: 'cancelling', cancelReason: request.reason }
    await tx.replace('subagent', key(record.ticketId, record.id), cancelling)
    return cancelling
  }

  async confirmCancelled(tx: AsyncTx, request: { ticketId: string; id: string }) {
    const record = await tx.get<SubagentRecord>('subagent', key(request.ticketId, request.id))
    if (!record || record.state !== 'cancelling') return record
    const cancelled: SubagentRecord = { ...record, state: 'cancelled', finishedAt: this.now() }
    await tx.replace('subagent', key(request.ticketId, request.id), cancelled)
    await this.index.remove(tx, request.ticketId, request.id)
    return cancelled
  }

  async markUnconfirmed(tx: AsyncTx, request: { ticketId: string; id: string }) {
    const record = await tx.get<SubagentRecord>('subagent', key(request.ticketId, request.id))
    if (!record || record.state !== 'cancelling') return record
    const unknown: SubagentRecord = { ...record, state: 'unknown', finishedAt: this.now(),
      reason: 'The cancellation was requested, but this Host could not confirm the child Agent stopped.' }
    await tx.replace('subagent', key(request.ticketId, request.id), unknown)
    await this.index.remove(tx, request.ticketId, request.id)
    return unknown
  }

  async requestCancelTicket(tx: AsyncTx, request: { ticketId: string; reason: SubagentCancelReason }) {
    const active = await this.index.active(tx, request.ticketId)
    for (const entry of active) await this.requestCancel(tx, { ticketId: request.ticketId, id: entry.id, reason: request.reason })
    return active.map(entry => entry.id)
  }

  async requestCancelAssignment(tx: AsyncTx, request: { ticketId: string; assignmentId: string; reason: SubagentCancelReason }) {
    const active = (await this.index.active(tx, request.ticketId)).filter(entry => entry.assignmentId === request.assignmentId)
    for (const entry of active) await this.requestCancel(tx, { ticketId: request.ticketId, id: entry.id, reason: request.reason })
    return active.map(entry => entry.id)
  }

  /**
   * Cancels and disposes the named children, returning only the ids that confirmed quiescence within the declared
   * budget. A child this runtime never held offers no evidence, so it is never reported as stopped.
   */
  async stopChildren(ids: string[]): Promise<string[]> {
    const stopped: string[] = []
    for (const id of ids) this.claimed.add(id)
    // One deadline covers the whole stop, so waiting for creation and for quiescence never adds up past the budget.
    const deadline = AbortSignal.timeout(this.cleanupMs)
    await Promise.all(ids.map(async id => {
      const entry = this.running.get(id)
      if (!entry) return
      // A child still being created has no handle yet; wait only for creation so it can be cancelled, not for its turn.
      if (!entry.handle) await withTimeout(entry.created, deadline).catch(() => {})
      const child = entry.handle?.agent
      if (!child) return
      try {
        child.cancel({ kind: 'parent' })
        await withTimeout(child.whenIdle(), deadline)
        stopped.push(id)
      } catch { /* An unconfirmed child keeps its pending cancel and is reported `unknown` by its caller. */ }
    }))
    return stopped
  }

  /** Releases the runtime handle of a child whose terminal fact is committed. */
  async finishStopped(ids: string[]) {
    for (const id of ids) {
      const entry = this.running.get(id)
      this.running.delete(id)
      this.claimed.delete(id)
      this.releaseTimer(id)
      await this.disposeBounded(entry?.handle)
    }
  }

  async shutdown() {
    for (const { handle } of this.running.values()) handle?.agent.cancel({ kind: 'disposed' })
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    const handles = [...this.running.values()].map(entry => entry.handle).filter(handle => handle !== undefined)
    this.running.clear()
    this.claimed.clear()
    await Promise.all(handles.map(handle => this.disposeBounded(handle)))
  }

  private releaseTimer(id: string) {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  /** Runs the child to completion and records its bounded result as a fact, never as a Ticket result. */
  private async drive(record: SubagentRecord, scope: SubagentScope, created: () => void) {
    let handle: AgentHandle | undefined
    let settled: SubagentRecord | undefined
    try {
      handle = await this.context.agents.create({
        sessionId: SessionId(record.sessionId),
        parentAgent: scope.parent,
        meta: { cwd: scope.cwd, origin: 'subagent', delegationDepth: 1, parentSession: scope.parent.id },
        agentOptions: scope.model,
        setup: scoped => {
          // The child inherits only the parent's already-authorised work tools; a fresh scope, never a global one.
          scoped.tools.restrict({ allow: [] })
          for (const tool of scope.tools) scoped.tools.register(defineChildTool(tool, scope.guard))
          scoped.systemPrompt.section({ name: 'superagent-subagent', order: 0, text: 'You are a delegated subtask of one Worker. Do the subtask, report what you did in plain text, and do not deliver results, ask a human or delegate further. Your working directory and tools are the Worker\'s own.' })
        },
      })
      const entry = this.running.get(record.id)
      // A stop that landed while the child was being created removed its entry; the handle must still be disposed.
      if (!entry) { created(); await this.disposeBounded(handle); return }
      entry.handle = handle
      created()
      const current = await this.storage.transaction(this.instanceId, tx => this.get(tx, record.ticketId, record.id))
      // A stop or cancel that landed while the child was starting must not be overtaken by this turn.
      if (!current || current.state !== 'running') { await this.close(record.id); return }
      handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', content: [{ type: 'text', text: record.task }], source: { kind: 'user' } })
      await handle.agent.whenIdle()
      if (!await this.context.sessions.flush(handle.agent.session)) throw new CoreError('PERSISTENCE_REQUIRED', 'No persistence provider confirmed the child Session flush.')
      const agent = handle.agent
      const result = boundedResult(agent, this.maxResultBytes)
      const outcome = turnOutcome(agent)
      settled = await this.storage.transaction(this.instanceId, tx => this.settle(tx, record, result, outcome))
      await this.close(record.id)
    } catch (error) {
      created()
      await this.close(record.id)
      const reason = error instanceof CoreError ? error.message : 'The child Agent did not finish its subtask.'
      settled = await this.storage.transaction(this.instanceId, tx => this.fail(tx, record, reason)).catch(() => undefined)
    }
    // Handlers run only after the terminal fact committed, so a rollback can never announce a completion.
    if (settled) this.handlers?.settled(settled)
  }

  private async close(id: string) {
    const entry = this.running.get(id)
    this.running.delete(id)
    this.claimed.delete(id)
    this.releaseTimer(id)
    await this.disposeBounded(entry?.handle)
  }

  /**
   * Disposes a child handle within the cleanup budget. A child that ignores cancellation must not hold the Host's
   * shutdown or a stop open; the record already reads `unknown` when quiescence could not be proven.
   */
  private async disposeBounded(handle: AgentHandle | undefined) {
    if (!handle) return
    await withTimeout(handle.dispose(), this.cleanupMs).catch(() => {})
  }

  private async settle(tx: AsyncTx, record: SubagentRecord, result: SubagentResult, outcome: ReturnType<typeof turnOutcome>) {
    const current = await tx.get<SubagentRecord>('subagent', key(record.ticketId, record.id))
    // A cancel, a stop or an older generation already wrote its own fact; keep it.
    if (!current || current.state !== 'running' || current.runtimeToken !== this.runtimeToken) return undefined
    const settledRecord: SubagentRecord = { ...current, ...outcome, result, finishedAt: this.now() }
    await tx.replace('subagent', key(record.ticketId, record.id), settledRecord)
    await this.index.remove(tx, record.ticketId, record.id)
    return settledRecord
  }

  private async fail(tx: AsyncTx, record: SubagentRecord, reason: string) {
    const current = await tx.get<SubagentRecord>('subagent', key(record.ticketId, record.id))
    if (!current || current.state !== 'running' || current.runtimeToken !== this.runtimeToken) return undefined
    const failed: SubagentRecord = { ...current, state: 'failed', reason, finishedAt: this.now() }
    await tx.replace('subagent', key(record.ticketId, record.id), failed)
    await this.index.remove(tx, record.ticketId, record.id)
    return failed
  }

  /** The declared deadline ends the child; only confirmed disposal becomes `cancelled`. */
  private async expire(id: string) {
    const entry = this.running.get(id)
    if (!entry) return
    const record = entry.record
    await this.storage.transaction(this.instanceId, tx => this.requestCancel(tx, { ticketId: record.ticketId, id, reason: 'deadline' })).catch(() => {})
    const stopped = await this.stopChildren([id])
    let expired: SubagentRecord | undefined
    try {
      expired = await this.storage.transaction(this.instanceId, async tx => {
        const current = await tx.get<SubagentRecord>('subagent', key(record.ticketId, id))
        if (!current || current.state !== 'cancelling' || current.runtimeToken !== this.runtimeToken) return undefined
        return stopped.length
          ? this.confirmCancelled(tx, { ticketId: record.ticketId, id })
          : this.markUnconfirmed(tx, { ticketId: record.ticketId, id })
      })
    } catch { /* The pending cancel stays visible; the claim is dropped below either way. */ }
    await this.finishStopped([id])
    if (expired) this.handlers?.deadline(expired)
  }

  private async reconcile(tx: AsyncTx, record: SubagentRecord) {
    if (!isActive(record.state)) return record
    // Only this runtime's own live claim proves the child is still running; anything else is unprovable.
    if (record.runtimeToken === this.runtimeToken && this.claimed.has(record.id)) return record
    const recovered: SubagentRecord = { ...record, state: 'unknown', finishedAt: this.now(),
      reason: record.runtimeToken === this.runtimeToken
        ? 'This process no longer holds the child Agent; its result could not be recorded.'
        : 'The Host restarted before this subagent finished; its outcome is unknown.' }
    await tx.replace('subagent', key(record.ticketId, record.id), recovered)
    await this.index.remove(tx, record.ticketId, record.id)
    return recovered
  }

  /** Every known subtask of the Ticket, bounded to the newest records so history never breaks the query. */
  async listIn(tx: AsyncTx, ticketId: string) {
    const items: SubagentRecord[] = []
    const recordPrefix = `${prefix(ticketId)}:`
    let cursor = recordPrefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<SubagentRecord>('subagent', { limit: 100, after: cursor })
      for (const item of page.items) {
        // The cursor is a lower bound, not a prefix filter; another Ticket's key can sort inside this range.
        if (!item.id.startsWith(recordPrefix)) continue
        items.push(await this.reconcile(tx, item.value))
      }
      if (!page.cursor || !page.cursor.startsWith(recordPrefix)) break
      cursor = page.cursor
    }
    return items.sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)).slice(-this.maxRecords)
  }

  private viewOf(record: SubagentRecord): SubagentView {
    return { id: record.id, ticketId: record.ticketId, assignmentId: record.assignmentId, generation: record.generation,
      mandateId: record.mandateId, task: record.task, state: record.state,
      settled: settledStates.includes(record.state), succeeded: record.state === 'completed',
      startedAt: record.startedAt, ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      ...(record.result ? { result: record.result } : {}), ...(record.cancelReason ? { cancelReason: record.cancelReason } : {}),
      ...(record.reason ? { reason: record.reason } : {}) }
  }
}

function isActive(state: SubagentState) {
  return state === 'running' || state === 'cancelling'
}

/** Bounds one wait; a shared `AbortSignal.timeout` lets several waits share a single deadline. */
function withTimeout<Value>(promise: Promise<Value>, budget: number | AbortSignal): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const deadline = new Promise<Value>((_resolve, reject) => {
    const reject_ = () => reject(new CoreError('CANCELLATION_UNCONFIRMED', 'The child Agent did not reach quiescence within the cleanup budget.'))
    if (typeof budget === 'number') {
      timer = setTimeout(reject_, budget)
      timer.unref()
      return
    }
    if (budget.aborted) reject_()
    else { onAbort = reject_; budget.addEventListener('abort', onAbort, { once: true }) }
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer)
    if (typeof budget !== 'number' && onAbort) budget.removeEventListener('abort', onAbort)
  })
}

/** The text the child produced, bounded and marked when it had to be shortened. */
function boundedResult(agent: Agent, maxBytes: number): SubagentResult {
  const texts: string[] = []
  for (const event of agent.session.snapshotEvents()) {
    const data = event.data as { message?: { role?: string; content?: { type: string; text?: string }[] } }
    if (event.type !== 'assistant/message' || data.message?.role !== 'assistant') continue
    for (const block of data.message.content ?? []) if (block.type === 'text' && block.text) texts.push(block.text)
  }
  const text = texts.join('\n')
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: true }
}

/**
 * The child's own durable turn outcome. A child that only went idle, or whose last turn failed, must never be
 * reported as a successful subtask just because its Agent reached the idle phase.
 */
function turnOutcome(agent: Agent): Pick<SubagentRecord, 'state'> & Pick<SubagentRecord, 'cancelReason'> & Pick<SubagentRecord, 'reason'> {
  // The child runs one turn, so its newest turn/end is the whole outcome. Reading the live snapshot is safe because
  // the Session is flushed before this runs.
  const ends = agent.session.snapshotEvents().filter(event => event.type === 'turn/end')
  const reason = (ends.at(-1)?.data as { reason?: TurnEndReason } | undefined)?.reason
  switch (reason?.kind) {
    case 'completed': return { state: 'completed' }
    case 'error': return { state: 'failed', reason: `The child turn ended with an error: ${reason.error.message}` }
    case 'max-tokens': return { state: 'failed', reason: 'The child turn reached an output-token limit.' }
    case 'blocked': return { state: 'failed', reason: 'The child turn was blocked.' }
    case 'interrupted': return { state: 'failed', reason: 'The child turn was interrupted by a restart.' }
    case 'aborted': return reason.reason.kind === 'user' || reason.reason.kind === 'parent' || reason.reason.kind === 'disposed'
      ? { state: 'cancelled', cancelReason: reason.reason.kind === 'user' ? 'human' : reason.reason.kind === 'parent' ? 'worker' : 'stop' }
      : { state: 'failed', reason: `The child turn was cancelled: ${reason.reason.kind}.` }
    default: return { state: 'failed', reason: 'The child turn ended without a completion fact.' }
  }
}

/** Registers one inherited tool in the child's own scope through the public tool helper. */
function defineChildTool(tool: NativeTool, guard: () => Promise<void>) {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, execution) => {
      // A child that was stopped, replaced or whose Assignment ended must not keep mutating the shared directory
      // just because its own turn has not unwound yet.
      await guard()
      return tool.execute(args as Record<string, string>, execution.signal)
    },
  })
}
