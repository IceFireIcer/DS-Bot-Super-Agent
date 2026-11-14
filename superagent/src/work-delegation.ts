import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson, commandTransaction } from './commands.js'
import { CoreError, identifier, type DesktopSource, type Work } from './model.js'
import type { RoleProfile } from './config.js'
import type { NativeSessions, NativeTool } from './native-sessions.js'
import type { AsyncTx, Storage } from './storage.js'
import type { Effect, EffectHandler, EffectResult, Effects } from './effects.js'

export interface MainWorkBrief {
  id: string
  version: 1
  instanceId: string
  mainId: string
  mainSessionId: string
  routerSessionId: string
  mainMessageId: string
  originalUserText: string
  authorization: { kind: 'authorized-main-actor'; sourceInstanceId: string; actorId: string }
  goal: string
  constraints: string
  acceptanceCriteria: string
  evidence: { kind: 'main-message'; id: string }
  environmentId: string
  configurationRevision: number
  createdAt: number
}

export interface MainWorkReceipt {
  version: 1
  workBriefId: string
  status: 'routing' | 'accepted' | 'rejected'
  ticketId?: string
  reason?: string
  nextStep: string
  createdAt: number
}

export interface MainWorkOutcome {
  version: 1
  workBriefId: string
  ticketId: string
  status: 'success' | 'failed' | 'unknown' | 'waiting' | 'stopped' | 'blocked'
  summary: string
  evidence: string
  artifacts: { path: string; bytes: number; sha256: string; reference?: unknown }[]
  reportId?: string
  nextStep: string
  updatedAt: number
}

export type MainWorkStatus = MainWorkReceipt['status'] | MainWorkOutcome['status'] | 'pending' | 'running'
export interface MainWorkUpdate {
  version: 1
  id: string
  workBriefId: string
  ticketId?: string
  status: MainWorkStatus
  owner: 'router' | 'worker' | 'user'
  summary: string
  needsDecision: boolean
  createdAt: number
}
export interface MainWorkNotification {
  mainId: string
  receipt: MainWorkReceipt
  update: MainWorkUpdate
  outcome?: MainWorkOutcome
}
export type MainWorkCardBrief = Pick<MainWorkBrief, 'id' | 'mainMessageId' | 'goal' | 'constraints' | 'acceptanceCriteria' | 'createdAt'>
export interface MainWorkCard { brief: MainWorkCardBrief; receipt: MainWorkReceipt; status: MainWorkStatus; update?: MainWorkUpdate; outcome?: MainWorkOutcome }

export interface MainWorkRequest {
  commandId: string
  mainId: string
  mainSessionId: string
  routerSessionId: string
  mainMessageId: string
  originalUserText: string
  goal: string
  constraints: string
  acceptanceCriteria: string
  configurationRevision: number
}

export interface MainWorkTicketSnapshot {
  ticketId: string
  status: Work['intent']['state'] | 'waiting-human' | 'stopping' | 'stopped'
  reason: Work['intent']['reason']
  lifecycle: Work['ticket']['state']
  setupCode?: string
  report?: { id: string; result: string; evidence: string; artifacts: MainWorkOutcome['artifacts'] }
}

export interface WorkDelegationOptions {
  storage: Storage
  instanceId: string
  source: DesktopSource
  sessions: NativeSessions
  effects: Effects
  environmentId: string
  now?: () => number
  createTicket(brief: MainWorkBrief): Promise<{ ticketId: string }>
  readTicket(ticketId: string): Promise<MainWorkTicketSnapshot>
  routerProfile(): Promise<{ revision: number; profile: RoleProfile }>
  recordRouterUse(sessionId: string, revision: number, profile: RoleProfile): Promise<void>
  notifyMain(notification: MainWorkNotification, signal: AbortSignal, isCurrent: (transaction?: AsyncTx) => Promise<boolean>): Promise<void>
}

const commandKey = (source: DesktopSource, commandId: string) => createHash('sha256')
  .update(canonicalJson([source.sourceInstanceId, source.actorId, commandId])).digest('hex')

function boundedText(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maximum) {
    throw new CoreError('INVALID_INPUT', `${label} must be nonempty and at most ${maximum} bytes.`)
  }
  return value.trim()
}

export class WorkDelegation {
  private readonly now: () => number

  constructor(private readonly options: WorkDelegationOptions) { this.now = options.now ?? Date.now }

  async create(request: MainWorkRequest) {
    if (!request || Object.keys(request).some(key => !['commandId', 'mainId', 'mainSessionId', 'routerSessionId', 'mainMessageId', 'originalUserText',
      'goal', 'constraints', 'acceptanceCriteria', 'configurationRevision'].includes(key))) {
      throw new CoreError('INVALID_INPUT', 'A Main delegation accepts only its source, goal, constraints and acceptance criteria.')
    }
    identifier(request.commandId, 'commandId'); identifier(request.mainId, 'mainId'); identifier(request.mainSessionId, 'mainSessionId')
    identifier(request.routerSessionId, 'routerSessionId'); identifier(request.mainMessageId, 'mainMessageId')
    if (!this.options.source.allowedActorIds.includes(this.options.source.actorId)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This actor cannot delegate work in the Main Instance.')
    identifier(this.options.environmentId, 'environmentId')
    if (!Number.isSafeInteger(request.configurationRevision) || request.configurationRevision < 1) throw new CoreError('INVALID_INPUT', 'A delegation needs its Main role configuration revision.')
    const originalUserText = boundedText(request.originalUserText, 'The original Main request', 32768)
    const goal = boundedText(request.goal, 'The work goal', 4096)
    const constraints = boundedText(request.constraints, 'The work constraints', 4096)
    const acceptanceCriteria = boundedText(request.acceptanceCriteria, 'The acceptance criteria', 4096)
    const fingerprint = createHash('sha256').update(canonicalJson(['main-work-brief-v1', this.options.instanceId, request.mainId,
      request.mainSessionId, request.routerSessionId, request.mainMessageId, originalUserText, goal, constraints, acceptanceCriteria,
      this.options.environmentId, request.configurationRevision])).digest('hex')
    const key = commandKey(this.options.source, request.commandId)
    return commandTransaction(this.options.storage, this.options.instanceId, async transaction => {
      const existing = await transaction.get<{ fingerprint: string; workBriefId: string }>('work-brief-command', key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This Main delegation identity was already used for different work.')
        const brief = await transaction.get<MainWorkBrief>('work-brief', existing.workBriefId)
        if (!brief) throw new CoreError('INCOMPLETE_STATE', 'The accepted WorkBrief is missing.')
        return brief
      }
      const brief: MainWorkBrief = { id: randomUUID(), version: 1, instanceId: this.options.instanceId,
        mainId: request.mainId, mainSessionId: request.mainSessionId, routerSessionId: request.routerSessionId,
        mainMessageId: request.mainMessageId, originalUserText,
        authorization: { kind: 'authorized-main-actor', sourceInstanceId: this.options.source.sourceInstanceId, actorId: this.options.source.actorId },
        goal, constraints, acceptanceCriteria,
        evidence: { kind: 'main-message', id: request.mainMessageId }, environmentId: this.options.environmentId,
        configurationRevision: request.configurationRevision, createdAt: this.now() }
      const receipt: MainWorkReceipt = { version: 1, workBriefId: brief.id, status: 'routing',
        nextStep: 'Router is establishing the local work item.', createdAt: this.now() }
      await transaction.insert('work-brief', brief.id, brief)
      await transaction.insert('work-receipt', brief.id, receipt)
      await transaction.insert('work-brief-command', key, { fingerprint, workBriefId: brief.id })
      await this.options.effects.enqueue(transaction, { key: brief.id, stream: 'notice', scope: brief.mainId,
        payload: { type: 'main-work-brief', workBriefId: brief.id } })
      return brief
    })
  }

  async route(workBriefId: string, signal: AbortSignal) {
    identifier(workBriefId, 'workBriefId')
    const brief = await this.options.storage.transaction(this.options.instanceId, async transaction => {
      const stored = await transaction.get<MainWorkBrief>('work-brief', workBriefId)
      if (!stored || stored.instanceId !== this.options.instanceId) throw new CoreError('NOT_FOUND', 'The Main WorkBrief does not exist in this Instance.')
      return stored
    })
    const existing = await this.options.storage.transaction(this.options.instanceId, tx => tx.get<MainWorkReceipt>('work-receipt', workBriefId))
    if (existing?.status === 'accepted' || existing?.status === 'rejected') {
      await this.publishUpdate(brief, existing)
      return
    }
    const { revision, profile } = await this.options.routerProfile()
    this.options.sessions.routerSessionId = brief.routerSessionId
    const tool: NativeTool = {
      name: 'establish_local_work',
      description: 'Accept this one authorized local WorkBrief and create exactly one Ticket. The original user request, limits and acceptance criteria are fixed in the brief. Do not claim the Worker has run or finished.',
      parameters: {},
      execute: async (_args, callSignal) => {
        callSignal.throwIfAborted()
        const prior = await this.options.storage.transaction(this.options.instanceId,
          transaction => transaction.get<MainWorkReceipt>('work-receipt', brief.id))
        if (prior?.status === 'accepted') return JSON.stringify(prior)
        let ticket: { ticketId: string }
        try {
          ticket = await this.options.createTicket(brief)
        } catch (error) {
          if (!(error instanceof CoreError) || ['COMMIT_UNKNOWN', 'STORAGE_UNAVAILABLE', 'HOST_LEASE_LOST'].includes(error.code)) throw error
          const reason = error instanceof CoreError ? error.code : 'WORK_REJECTED'
          const receipt: MainWorkReceipt = { version: 1, workBriefId: brief.id, status: 'rejected', reason,
            nextStep: 'No local work was accepted. Resolve the stated blocker before delegating again.', createdAt: this.now() }
          await this.options.storage.transaction(this.options.instanceId, transaction => transaction.replace('work-receipt', brief.id, receipt))
          await this.publishUpdate(brief, receipt)
          return JSON.stringify(receipt)
        }
        const receipt: MainWorkReceipt = { version: 1, workBriefId: brief.id, status: 'accepted', ticketId: ticket.ticketId,
          nextStep: 'The Worker must complete the authorized changes and verify the acceptance criteria.', createdAt: this.now() }
        await this.options.storage.transaction(this.options.instanceId, async transaction => {
          const current = await transaction.get<MainWorkReceipt>('work-receipt', brief.id)
          if (current?.status !== 'accepted') await transaction.replace('work-receipt', brief.id, receipt)
          if (!await transaction.get('work-ticket', ticket.ticketId)) await transaction.insert('work-ticket', ticket.ticketId, { workBriefId: brief.id })
        })
        await this.publishUpdate(brief, receipt)
        return JSON.stringify(receipt)
      },
    }
    const result = await this.options.sessions.run({ sessionId: brief.routerSessionId, role: 'router', signal,
      profile: structuredClone(profile), text: `Route this one versioned Main WorkBrief to one local Ticket. Preserve the source, limits and acceptance criteria exactly. Do not claim completion.\n${JSON.stringify(brief)}`,
      tools: [tool] })
    await this.options.recordRouterUse(result.sessionId, revision, profile)
    const receipt = await this.options.storage.transaction(this.options.instanceId,
      transaction => transaction.get<MainWorkReceipt>('work-receipt', brief.id))
    if (receipt?.status === 'routing') throw new CoreError('ROUTER_NOTICE_UNHANDLED', 'Router did not establish the authorized local Ticket.')
  }

  handlers(base: Record<'notice' | 'relay', EffectHandler>): Record<'notice' | 'relay', EffectHandler> {
    const execute = async (effect: Effect, context: { idempotencyKey: string; signal: AbortSignal }, handler: EffectHandler): Promise<EffectResult> => {
      try {
        if (effect.payload.type === 'main-work-brief') await this.route(String(effect.payload.workBriefId), context.signal)
        else if (effect.payload.type === 'main-work-update') {
          const notification = await this.options.storage.transaction(this.options.instanceId,
            tx => tx.get<MainWorkNotification>('work-update', String(effect.payload.updateId)))
          if (!notification) throw new CoreError('INCOMPLETE_STATE', 'The Router work update is missing.')
          await this.options.notifyMain(notification, context.signal, transaction => this.isCurrent(notification, transaction))
        } else {
          const result = await handler.execute(effect, context)
          if (result.type === 'success' && typeof effect.payload.ticketId === 'string') await this.refreshTicket(effect.payload.ticketId, context.signal)
          return result
        }
        return { type: 'success' }
      } catch (error) {
        if (error instanceof CoreError && error.code === 'MAIN_BUSY') return { type: 'defer', reason: error.message }
        if (error instanceof CoreError && error.code === 'MAIN_UPDATE_FAILED') return { type: effect.state === 'unknown' ? 'not-applied' : 'transient', reason: error.message }
        if (error instanceof CoreError && error.code === 'ROUTER_NOTICE_UNHANDLED') return { type: 'transient', reason: error.message }
        throw error
      }
    }
    const wrap = (handler: EffectHandler): EffectHandler => ({
      execute: (effect, context) => execute(effect, context, handler),
      reconcile: (effect, context) => execute(effect, context, { ...handler, execute: handler.reconcile ?? handler.execute }),
      ...(handler.batch ? { batch: { maxSize: handler.batch.maxSize, execute: async (effects, context) => {
        if (effects.some(effect => effect.payload.type === 'main-work-brief' || effect.payload.type === 'main-work-update')) {
          return Promise.all(effects.map(effect => execute(effect,
            { idempotencyKey: JSON.stringify([effect.id, effect.generation]), signal: context.signal }, handler)))
        }
        const results = await handler.batch!.execute(effects, context)
        return Promise.all(results.map(async (result, index) => {
          const ticketId = effects[index]?.payload.ticketId
          if (result.type !== 'success' || typeof ticketId !== 'string') return result
          try { await this.refreshTicket(ticketId, context.signal); return result }
          catch { return { type: 'transient', reason: 'The bounded Main work update could not be recorded yet.' } }
        }))
      } } } : {}),
    })
    return { notice: wrap(base.notice), relay: wrap(base.relay) }
  }

  private async isCurrent(notification: MainWorkNotification, transaction?: AsyncTx) {
    if (notification.outcome?.status !== 'success' || !notification.receipt.ticketId) return true
    const check = async (tx: AsyncTx) => {
      const ticket = await tx.get<Work['ticket']>('ticket', notification.receipt.ticketId!)
      const report = await tx.get<{ id: string; assignmentId: string }>('report', notification.receipt.ticketId!)
      const assignment = await tx.get<{ id: string }>('assignment', notification.receipt.ticketId!)
      const intent = await tx.get<Work['intent']>('intent', notification.receipt.ticketId!)
      return !!ticket && !ticket.constraint && !!report && report.id === notification.outcome!.reportId
        && report.assignmentId === assignment?.id && intent?.state === 'ready' && intent.reason === 'ready-report'
    }
    if (transaction) return check(transaction)
    return this.options.storage.transaction(this.options.instanceId, check)
  }

  private async refreshTicket(ticketId: string, signal: AbortSignal) {
    const brief = await this.options.storage.transaction(this.options.instanceId, async tx => {
      const index = await tx.get<{ workBriefId: string }>('work-ticket', ticketId)
      return index ? tx.get<MainWorkBrief>('work-brief', index.workBriefId) : undefined
    })
    if (!brief) return
    const snapshot = await this.options.readTicket(ticketId)
    const outcome = this.outcome(brief.id, snapshot)
    if (!outcome) return
    const receipt = await this.options.storage.transaction(this.options.instanceId, tx => tx.get<MainWorkReceipt>('work-receipt', brief.id))
    if (!receipt) throw new CoreError('INCOMPLETE_STATE', 'The work receipt is missing.')
    const updateId = this.updateId(brief.id, receipt, outcome)
    if (await this.options.storage.transaction(this.options.instanceId, tx => tx.get('work-update', updateId))) return
    const { revision, profile } = await this.options.routerProfile()
    let recorded = false
    const result = await this.options.sessions.run({ role: 'router', sessionId: brief.routerSessionId, signal, profile,
      text: `Return this bounded, verified work state to Main. Preserve the evidence and status; no Worker transcript is included.\n${JSON.stringify({ workBriefId: brief.id, receipt, outcome })}`,
      tools: [{ name: 'record_work_update', description: 'Record the supplied work status and evidence exactly and notify Main once.', parameters: {},
        execute: async () => { await this.publishUpdate(brief, receipt, outcome); recorded = true; return 'The bounded work update is queued for Main.' } }] })
    await this.options.recordRouterUse(result.sessionId, revision, profile)
    if (!recorded) throw new CoreError('ROUTER_NOTICE_UNHANDLED', 'Router did not record the bounded work result.')
  }

  private updateId(workBriefId: string, receipt: MainWorkReceipt, outcome?: MainWorkOutcome) {
    const { updatedAt: _time, ...facts } = outcome ?? {}
    return createHash('sha256').update(canonicalJson([workBriefId, receipt, facts])).digest('hex')
  }

  private publishUpdate(brief: MainWorkBrief, receipt: MainWorkReceipt, outcome?: MainWorkOutcome) {
    return commandTransaction(this.options.storage, this.options.instanceId, async tx => {
      const id = this.updateId(brief.id, receipt, outcome)
      if (await tx.get('work-update', id)) return
      if (outcome?.status === 'success') {
        const ticket = await tx.get<Work['ticket']>('ticket', outcome.ticketId)
        const report = await tx.get<{ id: string; assignmentId: string }>('report', outcome.ticketId)
        const assignment = await tx.get<{ id: string }>('assignment', outcome.ticketId)
        if (!ticket || ticket.constraint || !report || report.id !== outcome.reportId || report.assignmentId !== assignment?.id) return
      }
      const status = outcome?.status ?? receipt.status
      const update: MainWorkUpdate = { version: 1, id, workBriefId: brief.id, ...(receipt.ticketId ? { ticketId: receipt.ticketId } : {}),
        status, owner: outcome ? (outcome.status === 'waiting' || outcome.status === 'blocked' || outcome.status === 'unknown' ? 'user' : 'router') : 'router',
        summary: outcome?.summary ?? (status === 'accepted' ? 'Router accepted this work.' : 'Router declined this work.'),
        needsDecision: ['waiting', 'blocked', 'unknown', 'rejected'].includes(status), createdAt: this.now() }
      const notification: MainWorkNotification = { mainId: brief.mainId, receipt, update, ...(outcome ? { outcome } : {}) }
      await tx.insert('work-update', id, notification)
      if (!await tx.replace('work-update-head', brief.id, update)) await tx.insert('work-update-head', brief.id, update)
      if (outcome && !await tx.replace('work-outcome', brief.id, outcome)) await tx.insert('work-outcome', brief.id, outcome)
      await this.options.effects.enqueue(tx, { key: id, stream: 'notice', scope: `main:${brief.mainId}`, payload: { type: 'main-work-update', updateId: id } })
    })
  }

  async list(mainId: string): Promise<MainWorkCard[]> {
    identifier(mainId, 'mainId')
    const briefs: MainWorkBrief[] = []
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await this.options.storage.transaction(this.options.instanceId,
        transaction => transaction.scan<MainWorkBrief>('work-brief', { limit: 100, ...(cursor === undefined ? {} : { after: cursor }) }))
      briefs.push(...page.items.map(item => item.value).filter(brief => brief.mainId === mainId))
      if (page.cursor === undefined) break
      cursor = page.cursor
      if (pageCount === 9) throw new CoreError('WORK_LIST_BUDGET', 'The Main work list exceeds its 1000-record read budget.')
    }
    briefs.sort((left, right) => right.createdAt - left.createdAt)
    briefs.splice(20)
    const cards = await Promise.all(briefs.map(brief => this.card(brief)))
    return cards.sort((left, right) => left.brief.createdAt - right.brief.createdAt)
  }

  async query(mainId: string, workBriefId: string) {
    identifier(mainId, 'mainId'); identifier(workBriefId, 'workBriefId')
    const brief = await this.options.storage.transaction(this.options.instanceId,
      transaction => transaction.get<MainWorkBrief>('work-brief', workBriefId))
    if (!brief || brief.mainId !== mainId || brief.instanceId !== this.options.instanceId) {
      throw new CoreError('NOT_FOUND', 'This work item is not available in the current Main Instance.')
    }
    return this.card(brief)
  }

  private async card(brief: MainWorkBrief): Promise<MainWorkCard> {
    const cardBrief: MainWorkCardBrief = { id: brief.id, mainMessageId: brief.mainMessageId, goal: brief.goal,
      constraints: brief.constraints, acceptanceCriteria: brief.acceptanceCriteria, createdAt: brief.createdAt }
    const receipt = await this.options.storage.transaction(this.options.instanceId,
      transaction => transaction.get<MainWorkReceipt>('work-receipt', brief.id))
    if (!receipt) throw new CoreError('INCOMPLETE_STATE', 'The Main WorkReceipt is missing.')
    const projection = await this.options.storage.transaction(this.options.instanceId, async tx => ({
      update: await tx.get<MainWorkUpdate>('work-update-head', brief.id), outcome: await tx.get<MainWorkOutcome>('work-outcome', brief.id),
    }))
    if (!receipt.ticketId) return { brief: cardBrief, receipt, status: receipt.status, ...(projection.update ? { update: projection.update } : {}) }
    const snapshot = await this.options.readTicket(receipt.ticketId)
    const current = this.outcome(brief.id, snapshot)
    const persisted = !!current && projection.outcome?.status === current.status && projection.outcome.reportId === current.reportId
    const outcome = persisted ? projection.outcome : current
    const update = !current ? projection.update : persisted ? projection.update : undefined
    const status = this.status(snapshot)
    return { brief: cardBrief, receipt, status: outcome?.status ?? (status === 'success' ? 'running' : status),
      ...(update ? { update } : {}), ...(outcome ? { outcome } : {}) }
  }

  private status(snapshot: MainWorkTicketSnapshot): MainWorkStatus {
    if (snapshot.setupCode) return 'blocked'
    if (snapshot.status === 'waiting-human') return 'waiting'
    if (snapshot.status === 'stopped' || snapshot.status === 'stopping') return 'stopped'
    if (snapshot.reason === 'environment-waiting') return 'blocked'
    if (snapshot.reason === 'recovery-blocked' || snapshot.reason === 'recovery-exhausted') return 'unknown'
    if (snapshot.status === 'ready' && snapshot.report) return 'success'
    if (snapshot.reason === 'worker-idle' || snapshot.lifecycle === 'ended') return 'failed'
    if (snapshot.status === 'ready') return 'unknown'
    return snapshot.status
  }

  private outcome(workBriefId: string, snapshot: MainWorkTicketSnapshot): MainWorkOutcome | undefined {
    const report = snapshot.report
    const status = this.status(snapshot)
    if (report && status === 'success') return { version: 1, workBriefId, ticketId: snapshot.ticketId, status: 'success',
      summary: report.result.slice(0, 2048), evidence: report.evidence.slice(0, 2048),
      artifacts: report.artifacts.slice(0, 10).map(({ path, bytes, sha256, reference }) => ({ path, bytes, sha256, ...(reference === undefined ? {} : { reference }) })),
      reportId: report.id, nextStep: 'Review the verified result and artifact references.', updatedAt: this.now() }
    const details = {
      blocked: ['The Worker could not prepare the configured local workspace.', `Setup status: ${snapshot.setupCode ?? snapshot.reason}.`, 'Resolve the workspace blocker before retrying.'],
      waiting: ['The Worker is waiting for an authorized answer.', 'See the work question attached to this Ticket.', 'Answer the current work question.'],
      stopped: ['This work is stopped or stopping.', 'No completion is inferred from a stop request.', 'Check the confirmed stop state before resuming.'],
      unknown: ['The work result could not be confirmed.', 'No current verified result can be accepted.', 'Reconcile the original work before retrying.'],
      failed: ['The Worker ended without a verified result.', 'No ready report was recorded for the current Assignment.', 'Review the failure before deciding whether to retry.'],
    } as const
    if (!(status in details)) return undefined
    const [summary, evidence, nextStep] = details[status as keyof typeof details]
    return { version: 1, workBriefId, ticketId: snapshot.ticketId, status: status as keyof typeof details,
      summary, evidence, nextStep, artifacts: [], updatedAt: this.now() }
  }
}
