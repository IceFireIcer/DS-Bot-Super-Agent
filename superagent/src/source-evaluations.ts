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
}

export interface SourceEvaluation {
  id: string
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
}

interface EvalIndex { fingerprint: string; evaluationId: string }
interface EvalHead { evaluationId: string }
interface PriorDecision { evaluationId: string; policyHash: string; item: EvaluationItem }

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
  private readonly policyHash: string
  private readonly assessor: IntakePolicy['assess'] | undefined
  private readonly policy: IntakePolicy

  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    policy: IntakePolicy,
    private readonly sources: SourceEvents,
    private readonly accept: (tx: AsyncTx, event: SourceEvent, strength: 'explicit' | 'inferred', commandId: string, policyVersion: string) => Promise<Receipt>,
    private readonly now: () => number = Date.now,
    assessor: IntakePolicy['assess'] | undefined = policy.assess,
  ) {
    this.validatePolicy(policy)
    const { assess: _assess, ...configuration } = policy
    this.assessor = assessor
    const snapshot = structuredClone(configuration)
    this.policy = snapshot
    this.policyHash = createHash('sha256').update(canonicalJson(configuration)).digest('hex')
  }

  private validatePolicy(policy: IntakePolicy) {
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

  private threadKey(threadId: string) { return JSON.stringify(['desktop', this.sources.sourceInstanceId, threadId]) }
  private evalPrefix(threadId: string) { return `${this.threadKey(threadId)}:` }

  private async allocate(tx: AsyncTx, threadId: string, commandId: string, candidateEventIds: string[], items: EvaluationItem[], state: SourceEvaluation['state']) {
    const counterKey = this.threadKey(threadId)
    const sequence = (await tx.get<number>('eval', `sequence:${counterKey}`) ?? 0) + 1
    if (!Number.isSafeInteger(sequence)) throw new CoreError('EVAL_BUDGET', 'The source evaluation sequence is exhausted.')
    const id = `${this.evalPrefix(threadId)}${String(sequence).padStart(16, '0')}`
    const evaluation: SourceEvaluation = { id, threadId, commandId, batchId: randomUUID(), state, status: state, attempt: 0, candidateEventIds, items, receipts: [], createdAt: this.now() }
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
      for (const eventId of command.eventIds) {
        const event = await tx.get<SourceEvent>('source-event', eventId)
        if (!event || event.threadId !== command.threadId) { items.push({ eventId, outcome: 'rejected', reason: 'SOURCE_EVENT_NOT_FOUND', matchedRules: [], ruleResults: [], semanticCalled: false }); continue }
        const current = await this.sources.candidate(tx, { threadId: event.threadId, objectId: event.objectId })
        if (!current || current.id !== event.id) { items.push({ eventId, outcome: 'rejected', reason: 'SOURCE_EVENT_NOT_CURRENT', matchedRules: [], ruleResults: [], semanticCalled: false }); continue }
        const previous = await tx.get<PriorDecision>('eval-command', `decision:${event.id}`)
        if (previous?.policyHash === this.policyHash && previous.item.outcome !== 'unavailable') { items.push({ ...previous.item, reason: 'ALREADY_DECIDED' }); continue }
        const item = this.gate(event)
        items.push(item)
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
          for (const item of running.items) if (item.outcome === 'pending') {
              item.outcome = 'unavailable'; item.reason = recoveryReason
            const decision: PriorDecision = { evaluationId: running.id, policyHash: this.policyHash, item: structuredClone(item) }
            if (!await tx.replace('eval-command', `decision:${item.eventId}`, decision)) await tx.insert('eval-command', `decision:${item.eventId}`, decision)
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
          const receipt = await this.accept(tx, event, 'explicit', key, `intake:v1:${this.policyHash}`)
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
      let didDeliver = false
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
        timer = setTimeout(() => { controller.abort(); rejectDeadline?.(new CoreError('EVAL_TIMEOUT', 'The semantic assessment exceeded its delivery-based deadline.')) }, this.policy.timeoutMs)
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
      finally { if (timer) clearTimeout(timer) }
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
          const receipt = await this.accept(tx, event, strength, key, `intake:v1:${this.policyHash}`)
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
      }
      current.state = current.items.some(item => item.outcome === 'unavailable') ? 'unavailable' : 'completed'
      current.status = current.state
      current.completedAt = this.now()
      await tx.replace('eval', current.id, current)
      await tx.remove('eval', headKey)
      return current
    })
    queueMicrotask(() => { void this.runNext(evaluation.threadId).catch(() => {}) })
    return completed
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
