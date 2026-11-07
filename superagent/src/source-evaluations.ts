import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson, commandTransaction } from './commands.js'
import type { SourceEvents, SourceEvent } from './source-events.js'
import { CoreError, identifier, type IntakePolicy, type IntakeAssessment, type Receipt } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export interface EvaluationItem {
  eventId: string
  outcome: 'accepted' | 'rejected' | 'pending' | 'unavailable'
  strength?: 'explicit' | 'inferred'
  reason: string
  matchedRules: string[]
  ruleResults: { ruleId: string; matched: boolean }[]
  semanticCalled: boolean
  evidence?: string
  receipt?: Receipt
  reevaluation?: boolean
}

export interface SourceEvaluation {
  id: string
  sourceInstanceId: string
  threadId: string
  commandId: string
  batchId: string
  state: 'running' | 'queued' | 'completed' | 'unavailable'
  status: 'running' | 'queued' | 'completed' | 'unavailable'
  attempt: number
  candidateEventIds: string[]
  items: EvaluationItem[]
  receipts: Receipt[]
  createdAt: number
  deliveredAt?: number
  completedAt?: number
  dismissedAt?: number
  dismissedBy?: string
  dismissalReason?: string
  dismissals?: { commandId: string; actorId: string; reason: string; dismissedAt: number }[]
}

interface EvalIndex { fingerprint: string; evaluationId: string }
interface EvalHead { evaluationId: string }
interface PriorDecision { evaluationId: string; policyHash: string; item: EvaluationItem }
interface EvaluationSnapshot { evaluationId: string; threadId: string; candidateEventIds: string[] }

const transientAcceptanceErrors = new Set(['QUEUE_FULL', 'LOCK_TIMEOUT', 'RETRY_EXHAUSTED', 'STORAGE_UNAVAILABLE', 'STORAGE_CLOSED', 'COMMIT_UNKNOWN'])

function boundedText(value: string, maxBytes: number) {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character)
    if (bytes + size > maxBytes) break
    result += character
    bytes += size
  }
  return result
}

export class SourceEvaluations {
  private policyHash: string
  private assessor: IntakePolicy['assess'] | undefined
  private policy: IntakePolicy
  private policyRevision = 1
  private paused = false
  private readonly pauseListeners = new Set<() => void>()

  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    policy: IntakePolicy,
    private readonly sources: SourceEvents,
    private readonly accept: (tx: AsyncTx, event: SourceEvent, strength: 'explicit' | 'inferred', commandId: string, policyVersion: string, newDecision: boolean) => Promise<Receipt>,
    private readonly now: () => number = Date.now,
    assessor: IntakePolicy['assess'] | undefined = policy.assess,
    private readonly owns: (tx: AsyncTx, event: SourceEvent) => Promise<boolean> = async () => false,
    private readonly hasPendingRequeue: (tx: AsyncTx, eventId: string) => Promise<boolean> = async () => false,
    private readonly claimRequeue: (tx: AsyncTx, eventId: string, evaluationId: string) => Promise<void> = async () => {},
    private readonly consumeRequeue: (tx: AsyncTx, eventId: string, evaluationId: string) => Promise<void> = async () => {},
    private readonly releaseRequeue: (tx: AsyncTx, eventId: string, evaluationId: string) => Promise<void> = async () => {},
  ) {
    validateIntakePolicy(policy)
    const { assess: _assess, ...configuration } = policy
    this.assessor = assessor
    const snapshot = structuredClone(configuration)
    this.policy = snapshot
    this.policyHash = createHash('sha256').update(canonicalJson(configuration)).digest('hex')
  }

  replacePolicy(policy: IntakePolicy, revision = 1, assessor: IntakePolicy['assess'] | undefined = policy.assess) {
    validateIntakePolicy(policy)
    const { assess, ...configuration } = policy
    this.policy = structuredClone(configuration)
    this.assessor = assessor
    this.policyHash = createHash('sha256').update(canonicalJson(configuration)).digest('hex')
    this.policyRevision = revision
  }

  setPaused(paused: boolean) {
    this.paused = paused
    for (const listener of this.pauseListeners) listener()
  }

  async invalidateForPolicyChange(tx: AsyncTx, reason: string) {
    const interrupted: EvaluationSnapshot[] = []
    const queuedByThread = new Map<string, boolean>()
    const prefix = this.sourceEvalPrefix()
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<SourceEvaluation>('eval', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(prefix)) break
        const evaluation = item.value
        if (!['running', 'queued'].includes(evaluation.state)) continue
        if (evaluation.state === 'queued') queuedByThread.set(evaluation.threadId, true)
        evaluation.state = 'unavailable'; evaluation.status = 'unavailable'; evaluation.completedAt = this.now()
        interrupted.push({ evaluationId: evaluation.id, threadId: evaluation.threadId, candidateEventIds: [...evaluation.candidateEventIds] })
        for (const candidate of evaluation.items) if (['pending', 'accepted'].includes(candidate.outcome) && !candidate.receipt) {
          candidate.outcome = 'unavailable'; candidate.reason = reason
          if (candidate.reevaluation) await this.releaseRequeue(tx, candidate.eventId, evaluation.id)
        }
        await tx.replace('eval', evaluation.id, evaluation)
      }
      if (!page.cursor || !page.cursor.startsWith(prefix)) break
      cursor = page.cursor
      if (pageCount === 9) {
        const confirmation = await tx.scan<SourceEvaluation>('eval', { limit: 1, after: cursor })
        if (!confirmation.items[0]?.id.startsWith(prefix)) break
        throw new CoreError('EVAL_BUDGET', 'The policy-change scan exceeded its 1000-record budget.')
      }
    }
    const headPrefix = this.sourceHeadPrefix()
    let headCursor = headPrefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<EvalHead>('eval', { limit: 100, after: headCursor })
      for (const item of page.items) {
        if (!item.id.startsWith(headPrefix)) break
        await tx.remove('eval', item.id)
      }
      if (!page.cursor || !page.cursor.startsWith(headPrefix)) break
      headCursor = page.cursor
      if (pageCount === 9) {
        const confirmation = await tx.scan<EvalHead>('eval', { limit: 1, after: headCursor })
        if (!confirmation.items[0]?.id.startsWith(headPrefix)) break
        throw new CoreError('EVAL_BUDGET', 'The policy-change head scan exceeded its 1000-record budget.')
      }
    }
    for (const [threadId, hasQueued] of queuedByThread) {
      if (hasQueued) await tx.insert('eval', `head:${this.threadKey(threadId)}`, { evaluationId: 'policy-change' })
    }
    return interrupted
  }

  async requeueInterrupted(tx: AsyncTx, retry: { evaluationId: string; candidateEventIds: string[] }, reason: string) {
    const evaluation = await tx.get<SourceEvaluation>('eval', retry.evaluationId)
    if (!evaluation || !evaluation.id.startsWith(this.sourceEvalPrefix())) return
    const headKey = `head:${this.threadKey(evaluation.threadId)}`
    const head = await tx.get<EvalHead>('eval', headKey)
    if (head && head.evaluationId !== 'policy-change') await tx.insert('policy-reevaluation', JSON.stringify(['policy-reevaluation', this.sources.sourceInstanceId, 'deferred', evaluation.id]), {
      key: JSON.stringify(['policy-reevaluation', this.sources.sourceInstanceId, 'deferred', evaluation.id]),
      ticketId: evaluation.id, revision: this.policyRevision, reason
    })
    if (head && head.evaluationId !== 'policy-change') return
    const commandId = `policy-change:${evaluation.batchId}:${this.policyRevision}`
    const fingerprint = createHash('sha256').update(canonicalJson([evaluation.candidateEventIds, this.policyHash])).digest('hex')
    const indexKey = JSON.stringify([this.threadKey(evaluation.threadId), commandId])
    const prior = await tx.get<EvalIndex>('eval-command', indexKey)
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The interrupted Eval cannot be requeued under a conflicting policy generation.')
      return prior.evaluationId
    }
    const items: EvaluationItem[] = []
    for (const eventId of evaluation.candidateEventIds) {
      const event = await tx.get<SourceEvent>('source-event', eventId)
      if (!event || event.threadId !== evaluation.threadId) continue
      const current = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
      if (!current || current.id !== event.id || await this.owns(tx, event)) continue
      const previous = await tx.get<PriorDecision>('eval-command', `decision:${event.id}`)
      if (previous?.policyHash === this.policyHash && previous.item.outcome !== 'unavailable') continue
      const requeue = await this.hasPendingRequeue(tx, event.id)
      const item = this.gate(event)
      items.push(requeue ? { ...item, reevaluation: true } : item)
    }
    if (!items.length) {
      await tx.insert('eval-command', indexKey, { fingerprint, evaluationId: evaluation.id })
      return evaluation.id
    }
    const next = await this.allocate(tx, evaluation.threadId, commandId, evaluation.candidateEventIds, items, 'queued')
    await tx.insert('eval-command', indexKey, { fingerprint, evaluationId: next.id })
    for (const item of items) if (item.reevaluation) await this.claimRequeue(tx, item.eventId, next.id)
    return next.id
  }

  private threadKey(threadId: string) { return JSON.stringify(['desktop', this.sources.sourceInstanceId, threadId]) }
  private sourceEvalPrefix() { return `${JSON.stringify(['desktop', this.sources.sourceInstanceId]).slice(0, -1)},` }
  private sourceHeadPrefix() { return `head:${this.sourceEvalPrefix()}` }
  private evalPrefixForThread(threadId: string) { return `${this.threadKey(threadId)}:` }
  private evalPrefix(threadId: string) { return `${this.threadKey(threadId)}:` }

  private async allocate(tx: AsyncTx, threadId: string, commandId: string, candidateEventIds: string[], items: EvaluationItem[], state: SourceEvaluation['state']) {
    const counterKey = this.threadKey(threadId)
    const sequence = (await tx.get<number>('eval', `sequence:${counterKey}`) ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) throw new CoreError('EVAL_BUDGET', 'The source evaluation sequence is exhausted.')
    const id = `${this.evalPrefix(threadId)}${String(sequence).padStart(16, '0')}`
    const evaluation: SourceEvaluation = { id, sourceInstanceId: this.sources.sourceInstanceId, threadId, commandId, batchId: randomUUID(), state, status: state, attempt: 0, candidateEventIds, items, receipts: [], createdAt: this.now() }
    if (!await tx.replace('eval', `sequence:${counterKey}`, sequence)) await tx.insert('eval', `sequence:${counterKey}`, sequence)
    await tx.insert('eval', id, evaluation)
    return evaluation
  }

  private gate(event: SourceEvent): EvaluationItem {
    const base = { eventId: event.id, matchedRules: [] as string[], ruleResults: [] as { ruleId: string; matched: boolean }[], semanticCalled: false }
    let ruleResults = this.policy.rules.map(rule => ({ ruleId: rule.id, matched: false }))
    if (event.type === 'deleted') return { ...base, reason: 'DELETED', outcome: 'rejected', ruleResults }
    const sourceSelf = event.authorKind !== 'human' && event.authorId === this.sources.actorId
    const configuredSelf = this.policy.selfActorIds?.includes(event.authorId) ?? false
    if (event.authorKind === 'system' || sourceSelf || configuredSelf) return { ...base, reason: 'SOURCE_SELF_MESSAGE', outcome: 'rejected', ruleResults }
    const matched = this.policy.rules.filter(rule => rule.actorKinds.includes(event.authorKind) && rule.addressing.includes(event.addressing))
    ruleResults = this.policy.rules.map(rule => ({ ruleId: rule.id, matched: matched.includes(rule) }))
    const human = event.authorKind === 'human'
    const actorAllowed = human ? this.policy.allowedRequesterIds.includes(event.authorId) : ['bot', 'ci'].includes(event.authorKind) && this.policy.allowedBotActorIds.includes(event.authorId)
    if (!actorAllowed) return { ...base, outcome: 'rejected', reason: 'ACTOR_NOT_ALLOWED', ruleResults }
    if (!matched.length) return { ...base, outcome: 'rejected', reason: 'NO_MATCHED_RULE', ruleResults }
    const explicit = matched.filter(rule => rule.mode === 'explicit')
    if (explicit.length && human && event.addressing === 'direct') return { ...base, outcome: 'accepted', strength: 'explicit', reason: 'EXPLICIT_RULE', matchedRules: explicit.map(rule => rule.id), ruleResults }
    const inferred = matched.filter(rule => rule.mode === 'inferred')
    if (!inferred.length) return { ...base, outcome: 'rejected', reason: 'NO_MATCHED_RULE', matchedRules: matched.map(rule => rule.id), ruleResults }
    if ((this.policy.mode ?? 'off') === 'off') return { ...base, outcome: 'rejected', reason: 'PROACTIVE_OFF', matchedRules: inferred.map(rule => rule.id), ruleResults }
    if (this.policy.mode === 'observe') return { ...base, outcome: 'rejected', reason: 'WOULD_ACCEPT', matchedRules: inferred.map(rule => rule.id), ruleResults }
    return { ...base, outcome: 'pending', strength: 'inferred', reason: 'AWAITING_ASSESSMENT', matchedRules: inferred.map(rule => rule.id), ruleResults, semanticCalled: true }
  }

  async assess(command: { commandId: string; threadId: string; eventIds: string[] }): Promise<SourceEvaluation> {
    if (!command || Object.keys(command).some(key => !['commandId', 'threadId', 'eventIds'].includes(key))) throw new CoreError('INVALID_INPUT', 'A source batch accepts commandId, threadId and eventIds only.')
    command = structuredClone(command)
    identifier(command.commandId, 'commandId'); identifier(command.threadId, 'threadId')
    if (!Array.isArray(command.eventIds) || command.eventIds.length < 1 || command.eventIds.length > this.policy.maxBatchSize
      || command.eventIds.some(id => typeof id !== 'string' || id.length > 4096) || new Set(command.eventIds).size !== command.eventIds.length) throw new CoreError('EVAL_BATCH_LIMIT', 'A source batch needs unique bounded event IDs within its configured size.')
    const fingerprint = createHash('sha256').update(canonicalJson([this.threadKey(command.threadId), command.eventIds, this.policyHash])).digest('hex')
    const indexKey = JSON.stringify([this.threadKey(command.threadId), command.commandId])
    const initialized = await commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<EvalIndex>('eval-command', indexKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This evaluation command was reused for different candidates or policy.')
        return { evaluation: await tx.get<SourceEvaluation>('eval', prior.evaluationId), fresh: false }
      }
      const items: EvaluationItem[] = []
      const events: SourceEvent[] = []
      const requeueEvents: string[] = []
      for (const eventId of command.eventIds) {
        const event = await tx.get<SourceEvent>('source-event', eventId)
        if (!event || event.threadId !== command.threadId) { items.push({ eventId, outcome: 'rejected', reason: 'SOURCE_EVENT_NOT_FOUND', matchedRules: [], ruleResults: [], semanticCalled: false }); continue }
        const current = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
        if (!current || current.id !== event.id) { items.push({ eventId, outcome: 'rejected', reason: 'SOURCE_EVENT_NOT_CURRENT', matchedRules: [], ruleResults: [], semanticCalled: false }); continue }
        if (await this.owns(tx, event)) { items.push({ eventId, outcome: 'rejected', reason: 'ALREADY_OWNED', matchedRules: [], ruleResults: [], semanticCalled: false }); continue }
        const previous = await tx.get<PriorDecision>('eval-command', `decision:${event.id}`)
        const pendingRequeue = await this.hasPendingRequeue(tx, event.id)
        const requeue = pendingRequeue
        if (previous?.policyHash === this.policyHash && previous.item.outcome !== 'unavailable' && !requeue) { items.push({ ...previous.item, reason: 'ALREADY_DECIDED' }); continue }
        if (pendingRequeue) requeueEvents.push(event.id)
        const item = this.gate(event)
        items.push(requeue ? { ...item, reevaluation: true } : item)
        if (item.outcome === 'pending') events.push(event)
      }
      const maximumRuleResults = this.policy.rules.map(rule => rule.id)
      const boundedItems = items.map(item => ({ ...item, reason: '\0'.repeat(512), matchedRules: maximumRuleResults, ruleResults: maximumRuleResults.map(ruleId => ({ ruleId, matched: true })), evidence: '\0'.repeat(4096),
        receipt: { instanceId: this.instanceId, ticketId: 'x'.repeat(36), triggerId: item.eventId, acceptedCommandId: `eval:${'x'.repeat(64)}`, status: 'pending' as const } }))
      const recordBudget = { id: '', threadId: command.threadId, commandId: command.commandId, batchId: '', state: 'completed', status: 'completed', attempt: 0, candidateEventIds: command.eventIds, items: boundedItems, receipts: boundedItems.flatMap(item => item.receipt ? [item.receipt] : []), createdAt: 0 }
      if (Buffer.byteLength(JSON.stringify(recordBudget)) > 120000) throw new CoreError('EVAL_BATCH_LIMIT', 'The source batch exceeds the persisted evaluation record budget.')
      const routerBudget = events.map(event => ({ eventId: event.id, threadId: event.threadId, objectId: event.objectId, text: event.text, authorId: event.authorId, authorKind: event.authorKind, addressing: event.addressing,
        matchedRules: maximumRuleResults, ruleResults: maximumRuleResults.map(ruleId => ({ ruleId, matched: true })), policyMode: this.policy.mode ?? 'off' }))
      if (Buffer.byteLength(JSON.stringify(routerBudget)) > 100000) throw new CoreError('EVAL_BATCH_LIMIT', 'The semantic assessment batch exceeds the Router input budget.')
      const headKey = `head:${this.threadKey(command.threadId)}`
      let head = await tx.get<EvalHead>('eval', headKey)
      if (head) {
        const running = await tx.get<SourceEvaluation>('eval', head.evaluationId)
        if (running?.state === 'running' && this.now() - (running.deliveredAt ?? running.createdAt) >= this.policy.timeoutMs * this.policy.maxAttempts) {
            running.state = 'unavailable'; running.status = 'unavailable'; running.completedAt = this.now()
            const recoveryReason = running.deliveredAt === undefined ? 'EVAL_RECOVERED_BEFORE_DELIVERY' : 'EVAL_RECOVERED_AFTER_TIMEOUT'
          for (const item of running.items) {
            if (item.reevaluation) {
              if (item.outcome === 'accepted' && item.receipt) await this.consumeRequeue(tx, item.eventId, running.id)
              else await this.releaseRequeue(tx, item.eventId, running.id)
            }
            if (item.outcome === 'pending' || item.outcome === 'accepted' && !item.receipt) {
              item.outcome = 'unavailable'; item.reason = recoveryReason
              const decision: PriorDecision = { evaluationId: running.id, policyHash: this.policyHash, item: structuredClone(item) }
              if (!await tx.replace('eval-command', `decision:${item.eventId}`, decision)) await tx.insert('eval-command', `decision:${item.eventId}`, decision)
            }
          }
          await tx.replace('eval', running.id, running); await tx.remove('eval', headKey); head = undefined
        }
      }
      const queueLimit = this.policy.maxQueuedEvals ?? 100
      if (head) {
        let queued = 0
        let cursor = this.evalPrefix(command.threadId)
        for (let pageCount = 0; pageCount < 10; pageCount++) {
          const page = await tx.scan<SourceEvaluation>('eval', { limit: 100, after: cursor })
          queued += page.items.filter(entry => entry.id.startsWith(this.evalPrefix(command.threadId)) && entry.value.state === 'queued').length
          if (queued >= queueLimit || !page.cursor || !page.cursor.startsWith(this.evalPrefix(command.threadId))) break
          cursor = page.cursor
        }
        if (queued >= queueLimit) throw new CoreError('EVAL_QUEUE_FULL', 'The configured per-Thread evaluation queue is full; no candidates were accepted.')
      }
      const explicit = items.some(item => item.outcome === 'accepted' && item.strength === 'explicit')
      const evaluation = await this.allocate(tx, command.threadId, command.commandId, command.eventIds, items, head ? 'queued' : events.length || explicit ? 'running' : 'completed')
      if (!head && (events.length || explicit)) await tx.insert('eval', headKey, { evaluationId: evaluation.id })
      if (!events.length) evaluation.completedAt = this.now()
      await tx.replace('eval', evaluation.id, evaluation)
      await tx.insert('eval-command', indexKey, { fingerprint, evaluationId: evaluation.id })
      for (const eventId of requeueEvents) await this.claimRequeue(tx, eventId, evaluation.id)
      return { evaluation, fresh: true, events }
    })
    if (!initialized.evaluation) throw new CoreError('INCOMPLETE_STATE', 'The source evaluation is missing.')
    const hasExplicit = initialized.evaluation.items.some(item => item.outcome === 'accepted' && item.strength === 'explicit')
    if (!initialized.fresh || initialized.evaluation.state !== 'running' && !hasExplicit) return initialized.evaluation
    return this.run(initialized.evaluation, initialized.events ?? [])
  }

  private validateAssessments(events: SourceEvent[], assessments: IntakeAssessment[] | undefined) {
    if (!Array.isArray(assessments)) return undefined
    const expected = new Set(events.map(event => event.id))
    const seen = new Set<string>()
    const valid: IntakeAssessment[] = []
    for (const result of assessments) {
      if (!result || !expected.has(result.eventId) || seen.has(result.eventId) || !['accept', 'reject'].includes(result.outcome)
        || typeof result.reason !== 'string' || !result.reason.trim() || Buffer.byteLength(result.reason) > 512
        || result.evidence !== undefined && (typeof result.evidence !== 'string' || Buffer.byteLength(result.evidence) > 4096)) continue
      seen.add(result.eventId)
      valid.push(result)
    }
    return valid
  }

  private async run(evaluation: SourceEvaluation, events: SourceEvent[]): Promise<SourceEvaluation> {
    const explicitResults = new Map<string, EvaluationItem>()
    const initialEvaluation = await this.storage.transaction(this.instanceId, tx => tx.get<SourceEvaluation>('eval', evaluation.id))
    for (const item of initialEvaluation?.items ?? []) if (item.outcome === 'accepted' && item.strength === 'explicit') {
      const event = await this.storage.transaction(this.instanceId, tx => tx.get<SourceEvent>('source-event', item.eventId))
      if (!event) { explicitResults.set(item.eventId, { ...item, outcome: 'rejected', reason: 'SOURCE_EVENT_NOT_FOUND' }); continue }
      try {
        const receipt = await commandTransaction(this.storage, this.instanceId, async tx => {
          const currentEval = await tx.get<SourceEvaluation>('eval', evaluation.id)
          const head = await tx.get<EvalHead>('eval', `head:${this.threadKey(evaluation.threadId)}`)
          if (!currentEval || currentEval.state !== 'running' || head?.evaluationId !== currentEval.id) throw new CoreError('STALE_EVAL', 'This Eval no longer owns the Thread acceptance slot.')
          const currentEvent = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
          if (!currentEvent || currentEvent.id !== event.id) throw new CoreError('SOURCE_EVENT_NOT_CURRENT', 'The explicit candidate changed before acceptance.')
          const key = `eval:${createHash('sha256').update(`${evaluation.id}:${event.id}`).digest('hex')}`
          const receipt = await this.accept(tx, event, 'explicit', key, `intake:r${this.policyRevision}:${this.policyHash}`, item.reevaluation ?? false)
          const result: EvaluationItem = { ...item, receipt }
          currentEval.items = currentEval.items.map(existing => existing.eventId === event.id ? result : existing)
          currentEval.receipts = currentEval.items.flatMap(existing => existing.receipt ? [existing.receipt] : [])
          await tx.replace('eval', currentEval.id, currentEval)
          await tx.replace('eval-command', `decision:${event.id}`, { evaluationId: currentEval.id, policyHash: this.policyHash, item: result } satisfies PriorDecision)
          return receipt
        })
        explicitResults.set(item.eventId, { ...item, receipt })
      } catch (error) {
        const reason = error instanceof CoreError ? error.code : 'ACCEPT_FAILED'
        explicitResults.set(item.eventId, { ...item, outcome: transientAcceptanceErrors.has(reason) ? 'unavailable' : 'rejected', reason })
      }
    }
    const semanticEvents = events.filter(event => evaluation.items.some(item => item.eventId === event.id && item.outcome === 'pending'))
    let assessments: IntakeAssessment[] | undefined
    let assessmentFailure = 'ASSESSOR_UNAVAILABLE'
    for (let attempt = 1; attempt <= this.policy.maxAttempts && semanticEvents.length; attempt++) {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let remainingMs = this.policy.timeoutMs
      let deadlineAt: number | undefined
      let pausedDuringAssessment = false
      const startTimer = () => {
        deadlineAt = this.now() + remainingMs
        timer = setTimeout(() => {
          timer = undefined
          controller.abort()
          rejectDeadline?.(new CoreError('EVAL_TIMEOUT', 'The semantic assessment exceeded its delivery-based deadline.'))
        }, remainingMs)
      }
      const markPaused = async () => {
        await this.storage.transaction(this.instanceId, async tx => {
          const current = await tx.get<SourceEvaluation>('eval', evaluation.id)
          const headKey = `head:${this.threadKey(evaluation.threadId)}`
          const head = await tx.get<EvalHead>('eval', headKey)
          if (!current || current.state !== 'running' || head?.evaluationId !== current.id) return
          current.state = 'unavailable'; current.status = 'unavailable'; current.completedAt = this.now()
          for (const item of current.items) if (['pending', 'accepted'].includes(item.outcome) && !item.receipt) {
            item.outcome = 'unavailable'; item.reason = 'EVAL_PAUSED'
          }
          await tx.replace('eval', current.id, current)
          await tx.remove('eval', headKey)
        })
      }
      const onPauseChange = () => {
        if (this.paused && timer) {
          pausedDuringAssessment = true
          clearTimeout(timer)
          timer = undefined
          remainingMs = Math.max(1, deadlineAt! - this.now())
          deadlineAt = undefined
          void markPaused().catch(() => {})
        } else if (!this.paused && !timer && deadlineAt === undefined && !controller.signal.aborted && rejectDeadline) {
          startTimer()
        }
      }
      let didDeliver = false
      let deliveredDuringPause = false
      let rejectDeadline: ((reason: CoreError) => void) | undefined
      const onDelivered = async () => {
        if (didDeliver) return
        await this.storage.transaction(this.instanceId, async tx => {
          const current = await tx.get<SourceEvaluation>('eval', evaluation.id)
          const head = await tx.get<EvalHead>('eval', `head:${this.threadKey(evaluation.threadId)}`)
          if (!current || current.state !== 'running' || head?.evaluationId !== current.id) throw new CoreError('STALE_EVAL', 'The Thread evaluation is no longer current at Router delivery.')
          current.attempt = attempt
          current.deliveredAt = this.now()
          await tx.replace('eval', evaluation.id, current)
          evaluation = current
        })
        didDeliver = true
        deliveredDuringPause = this.paused
        this.pauseListeners.add(onPauseChange)
        if (this.paused) onPauseChange()
        else startTimer()
      }
      try {
        if (!this.assessor) throw new CoreError('MISSING_ASSESSOR', 'No semantic assessor is configured for inferred candidates.')
        const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject })
        const result = await Promise.race([this.assessor(semanticEvents.map(event => {
          const item = evaluation.items.find(candidate => candidate.eventId === event.id)!
          return { eventId: event.id, threadId: event.threadId, objectId: event.objectId, text: event.text!, authorId: event.authorId, authorKind: event.authorKind, addressing: event.addressing,
            matchedRules: item.matchedRules, ruleResults: item.ruleResults, policyMode: this.policy.mode ?? 'off' }
        }), controller.signal, onDelivered), deadline])
        assessments = this.validateAssessments(semanticEvents, result)
        if (!assessments) assessmentFailure = 'ASSESSOR_UNAVAILABLE'
        if (assessments) break
      } catch (error) { assessmentFailure = boundedText(error instanceof CoreError ? `${error.code}:${error.message}` : error instanceof Error ? `${error.name}:${error.message}` : 'ASSESSOR_UNAVAILABLE', 512); assessments = undefined }
      finally {
        if (timer) clearTimeout(timer)
        this.pauseListeners.delete(onPauseChange)
        deadlineAt = undefined
      }
      if (pausedDuringAssessment || deliveredDuringPause && this.paused) {
        controller.abort()
        assessmentFailure = 'EVAL_PAUSED'
        assessments = undefined
        break
      }
    }
    const decisions = new Map<string, EvaluationItem>()
    const byEvent = new Map((assessments ?? []).map(item => [item.eventId, item]))
    const initial = await this.storage.transaction(this.instanceId, tx => tx.get<SourceEvaluation>('eval', evaluation.id))
    for (const item of initial?.items ?? []) {
      if (explicitResults.has(item.eventId)) { decisions.set(item.eventId, explicitResults.get(item.eventId)!); continue }
      const assessment = byEvent.get(item.eventId)
      const strength = item.outcome === 'accepted' ? item.strength : assessment?.outcome === 'accept' ? 'inferred' : undefined
      if (assessment?.outcome === 'reject') {
        decisions.set(item.eventId, { ...item, outcome: 'rejected', reason: assessment.reason, ...(assessment.evidence === undefined ? {} : { evidence: assessment.evidence }) })
        continue
      }
      if (!strength) {
        if (item.outcome === 'pending') decisions.set(item.eventId, { ...item, outcome: 'unavailable', reason: assessment ? 'INVALID_ASSESSMENT' : assessmentFailure })
        continue
      }
      const event = await this.storage.transaction(this.instanceId, tx => tx.get<SourceEvent>('source-event', item.eventId))
      if (!event) { decisions.set(item.eventId, { ...item, outcome: 'rejected', reason: 'SOURCE_EVENT_NOT_FOUND' }); continue }
      try {
        const receipt = await commandTransaction(this.storage, this.instanceId, async tx => {
          const currentEval = await tx.get<SourceEvaluation>('eval', evaluation.id)
          const head = await tx.get<EvalHead>('eval', `head:${this.threadKey(evaluation.threadId)}`)
          if (!currentEval || currentEval.state !== 'running' || head?.evaluationId !== currentEval.id) throw new CoreError('STALE_EVAL', 'This Eval no longer owns the Thread acceptance slot.')
          const currentEvent = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
          if (!currentEvent || currentEvent.id !== event.id) throw new CoreError('SOURCE_EVENT_NOT_CURRENT', 'The candidate changed before its acceptance transaction.')
          const previous = await tx.get<PriorDecision>('eval-command', `decision:${event.id}`)
          if (previous?.evaluationId === evaluation.id && previous.item.receipt) return previous.item.receipt
          const key = `eval:${createHash('sha256').update(`${evaluation.id}:${event.id}`).digest('hex')}`
          const receipt = await this.accept(tx, event, strength, key, `intake:r${this.policyRevision}:${this.policyHash}`, item.reevaluation ?? false)
          const itemResult: EvaluationItem = { ...item, outcome: 'accepted', strength, reason: assessment?.reason ?? item.reason,
            ...(assessment?.evidence === undefined ? {} : { evidence: assessment.evidence }), receipt }
          await tx.replace('eval-command', `decision:${event.id}`, { evaluationId: evaluation.id, policyHash: this.policyHash, item: itemResult } satisfies PriorDecision)
          return receipt
        })
        decisions.set(item.eventId, { ...item, outcome: 'accepted', strength, reason: assessment?.reason ?? item.reason,
          ...(assessment?.evidence === undefined ? {} : { evidence: assessment.evidence }), receipt })
      } catch (error) {
        const reason = error instanceof CoreError ? error.code : 'ACCEPT_FAILED'
        decisions.set(item.eventId, { ...item, outcome: transientAcceptanceErrors.has(reason) ? 'unavailable' : 'rejected', reason })
      }
    }
    const completed = await this.storage.transaction(this.instanceId, async tx => {
      const current = await tx.get<SourceEvaluation>('eval', evaluation.id)
      const headKey = `head:${this.threadKey(evaluation.threadId)}`
      const head = await tx.get<EvalHead>('eval', headKey)
      if (!current) throw new CoreError('INCOMPLETE_STATE', 'The Thread evaluation disappeared before finalization.')
      if (head?.evaluationId !== evaluation.id) return current
      for (const item of current.items) {
        const result = decisions.get(item.eventId)
        if (result) Object.assign(item, result)
      }
      current.receipts = current.items.flatMap(item => item.receipt ? [item.receipt] : [])
      for (const item of current.items) {
        const decision: PriorDecision = { evaluationId: current.id, policyHash: this.policyHash, item: structuredClone(item) }
        if (!await tx.replace('eval-command', `decision:${item.eventId}`, decision)) await tx.insert('eval-command', `decision:${item.eventId}`, decision)
        if (item.reevaluation) {
          if (item.outcome === 'unavailable') await this.releaseRequeue(tx, item.eventId, current.id)
          else await this.consumeRequeue(tx, item.eventId, current.id)
        }
      }
      current.state = current.items.some(item => item.outcome === 'unavailable') ? 'unavailable' : 'completed'
      current.status = current.state
      current.completedAt = this.now()
      await tx.replace('eval', current.id, current)
      await tx.remove('eval', headKey)
      return current
    })
    if (!this.paused) queueMicrotask(() => { void this.runNext(evaluation.threadId).catch(() => {}) })
    return completed
  }

  resume() {
    if (this.paused) return
    queueMicrotask(() => { void this.runAllOfThread().catch(() => {}) })
  }

  async runAll(threadId: string) {
    for (let drain = 0; drain < 100; drain++) {
      await this.runNext(threadId)
      const head = await this.storage.transaction(this.instanceId, tx => tx.get<EvalHead>('eval', `head:${this.threadKey(threadId)}`))
      if (!head) return
    }
  }

  private async runAllOfThread() {
    const threads = new Set<string>()
    const prefix = this.sourceEvalPrefix()
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await this.storage.transaction(this.instanceId, tx => tx.scan<SourceEvaluation>('eval', { limit: 100, after: cursor }))
      for (const item of page.items) if (item.id.startsWith(prefix) && item.value.state === 'queued') threads.add(item.value.threadId)
      if (!page.cursor || !page.cursor.startsWith(prefix)) break
      cursor = page.cursor
      if (pageCount === 9) {
        const confirmation = await this.storage.transaction(this.instanceId, tx => tx.scan<SourceEvaluation>('eval', { limit: 1, after: cursor }))
        if (!confirmation.items[0]?.id.startsWith(prefix)) break
        throw new CoreError('EVAL_BUDGET', 'The paused Eval scan exceeded its 1000-record budget.')
      }
    }
    for (const threadId of threads) await this.runNext(threadId)
  }

  async dismiss(command: { commandId: string; evaluationId: string; reason: string; actorId: string }) {
    if (!command || Object.keys(command).some(key => !['commandId', 'evaluationId', 'reason', 'actorId'].includes(key))) throw new CoreError('INVALID_INPUT', 'Dismissing an Eval accepts commandId, evaluationId, reason and actorId only.')
    identifier(command.commandId, 'commandId'); identifier(command.evaluationId, 'evaluationId'); identifier(command.actorId, 'actorId')
    if (typeof command.reason !== 'string' || !command.reason.trim() || Buffer.byteLength(command.reason) > 2048) throw new CoreError('INVALID_INPUT', 'Dismissal needs a bounded reason.')
    const fingerprint = createHash('sha256').update(canonicalJson([command.evaluationId, command.actorId, command.reason])).digest('hex')
    const commandKey = JSON.stringify([this.sources.sourceInstanceId, command.actorId, command.commandId])
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<{ fingerprint: string; evaluationId: string }>('eval-dismissal', commandKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The dismissal command was reused for different input.')
        const evaluation = await tx.get<SourceEvaluation>('eval', prior.evaluationId)
        if (!evaluation) throw new CoreError('INCOMPLETE_STATE', 'The dismissed Eval is missing.')
        return evaluation
      }
      const evaluation = await tx.get<SourceEvaluation>('eval', command.evaluationId)
      if (!evaluation) throw new CoreError('NOT_FOUND', 'The Eval does not exist.')
      if (!evaluation.id.startsWith(`${this.threadKey(evaluation.threadId)}:`)) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'The Eval belongs to a different source instance.')
      this.sources.authorizeThread(evaluation.threadId)
      if (evaluation.state !== 'unavailable') throw new CoreError('EVAL_NOT_UNAVAILABLE', 'Only an unavailable Eval can be dismissed.')
      if (evaluation.dismissedAt !== undefined) throw new CoreError('EVAL_ALREADY_DISMISSED', 'The unavailable Eval already has a dismissal decision.')
      const dismissedAt = this.now()
      const dismissed: SourceEvaluation = { ...evaluation, dismissedAt, dismissedBy: command.actorId, dismissalReason: command.reason,
        dismissals: [...(evaluation.dismissals ?? []), { commandId: command.commandId, actorId: command.actorId, reason: command.reason, dismissedAt }] }
      await tx.replace('eval', dismissed.id, dismissed)
      await tx.insert('eval-dismissal', commandKey, { fingerprint, evaluationId: dismissed.id })
      return dismissed
    })
  }

  private async runNext(threadId: string) {
    for (let drain = 0; drain < 100; drain++) {
      const next = await this.storage.transaction(this.instanceId, async tx => {
        const headKey = `head:${this.threadKey(threadId)}`
        if (await tx.get<EvalHead>('eval', headKey)) return undefined
        const prefix = this.evalPrefix(threadId)
        let cursor = prefix
        for (let pageCount = 0; pageCount < 10; pageCount++) {
          const page = await tx.scan<SourceEvaluation>('eval', { limit: 100, after: cursor })
          const queued = page.items.map(item => item.value).find(item => item.id.startsWith(prefix) && item.state === 'queued')
          if (queued) {
            const events: SourceEvent[] = []
            for (const item of queued.items) if (item.outcome === 'pending' || item.outcome === 'accepted' && item.strength === 'explicit') {
              const event = await tx.get<SourceEvent>('source-event', item.eventId)
              const current = event && await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
              if (event && current?.id === event.id) events.push(event)
              else { item.outcome = 'rejected'; item.reason = 'SOURCE_EVENT_NOT_CURRENT' }
            }
            const needsRun = events.length > 0 || queued.items.some(item => item.outcome === 'accepted' && item.strength === 'explicit')
            queued.state = needsRun ? 'running' : 'completed'; queued.status = queued.state
            if (!needsRun) queued.completedAt = this.now()
            await tx.replace('eval', queued.id, queued)
            if (needsRun) await tx.insert('eval', headKey, { evaluationId: queued.id })
            return needsRun ? { evaluation: queued, events } : { discarded: true }
          }
          if (!page.cursor || !page.cursor.startsWith(prefix)) break
          cursor = page.cursor
        }
        return undefined
      })
      if (!next) return
      if (next.discarded) continue
      if (!next.evaluation) return
      await this.run(next.evaluation, next.events)
      return
    }
  }

  list(threadId: string) {
    identifier(threadId, 'threadId')
    const prefix = this.evalPrefix(threadId)
    this.sources.authorizeThread(threadId)
    return this.storage.transaction(this.instanceId, async tx => {
      let cursor = prefix
      const items: SourceEvaluation[] = []
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await tx.scan<SourceEvaluation>('eval', { limit: 100, after: cursor })
        items.push(...page.items.filter(item => item.id.startsWith(prefix)).map(item => item.value))
        if (!page.cursor || !page.cursor.startsWith(prefix) || items.length >= 1000) break
        cursor = page.cursor
      }
      return { items, queued: items.filter(item => item.state === 'queued').length }
    })
  }
}

export function validateIntakePolicy(policy: IntakePolicy) {
  if (!policy || policy.mode !== undefined && !['off', 'observe', 'auto'].includes(policy.mode)
    || !Number.isInteger(policy.maxBatchSize) || policy.maxBatchSize < 1 || policy.maxBatchSize > 20
    || policy.maxQueuedEvals !== undefined && (!Number.isInteger(policy.maxQueuedEvals) || policy.maxQueuedEvals < 1 || policy.maxQueuedEvals > 1000)
    || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 3
    || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 30000) throw new CoreError('INVALID_CONFIG', 'Intake needs bounded batch, attempt and timeout budgets.')
  if (!Array.isArray(policy.allowedRequesterIds) || !Array.isArray(policy.allowedBotActorIds) || policy.selfActorIds !== undefined && !Array.isArray(policy.selfActorIds) || !Array.isArray(policy.rules) || policy.rules.length > 32) throw new CoreError('INVALID_CONFIG', 'Intake needs explicit actor lists and at most 32 rules.')
  for (const actor of [...policy.allowedRequesterIds, ...policy.allowedBotActorIds, ...(policy.selfActorIds ?? [])]) identifier(actor, 'intakeActorId')
  const ids = new Set<string>()
  for (const rule of policy.rules) {
    identifier(rule.id, 'intakeRuleId')
    if (ids.has(rule.id) || !Array.isArray(rule.actorKinds) || !rule.actorKinds.length || rule.actorKinds.some(kind => !['human', 'bot', 'ci'].includes(kind))
      || !Array.isArray(rule.addressing) || !rule.addressing.length || rule.addressing.some(kind => !['direct', 'mention', 'ambient'].includes(kind))
      || !['explicit', 'inferred'].includes(rule.mode)) throw new CoreError('INVALID_CONFIG', 'Each intake rule needs a unique ID, supported actor/addressing combinations and a mode.')
    if (rule.mode === 'explicit' && (rule.actorKinds.some(kind => kind !== 'human') || rule.addressing.some(kind => kind !== 'direct'))) throw new CoreError('INVALID_CONFIG', 'Explicit rules must match human direct requests only.')
    ids.add(rule.id)
  }
  if (policy.assess !== undefined && typeof policy.assess !== 'function') throw new CoreError('INVALID_CONFIG', 'The configured semantic assessor must be callable.')
}
