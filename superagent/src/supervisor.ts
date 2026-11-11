import { createHash, randomUUID } from 'node:crypto'
import { CoreError } from './model.js'
import { commandTransaction } from './commands.js'
import { boundedInteger } from './bounds.js'
import type { AsyncTx, Storage } from './storage.js'

export type SupervisorFindingKind = 'normal' | 'normal-wait' | 'unknown' | 'ready' | 'ended'
  | 'no-progress' | 'loop' | 'deviation' | 'duplicate' | 'budget-exhausted'

export interface SupervisorAssessment {
  kind: 'normal' | 'deviation' | 'loop' | 'no-progress'
  reason: string
  recommendation?: string
  action?: 'correct' | 'pause'
  assessorVersion?: string
  model?: string
}

export type SupervisorAssessor = (snapshot: SupervisorSnapshot, signal: AbortSignal) => Promise<SupervisorAssessment>

export interface SupervisorSnapshot {
  ticketId: string
  request: string
  mandateId: string
  mandateScope: string
  assignmentId?: string
  generation?: string
  stage: string
  intentReason: string
  directionVersion: number
  reportIds: string[]
  lastReportId?: string
  lastReportAt?: number
  toolDigest: string
  reportDigest: string
  deliveryDigest: string
  jobStates: string[]
  subagentStates: string[]
  unknownEffects: number
  unknownJobs: number
  attention: string
  stop: string
  setup: string
  paused: boolean
  waiting: boolean
  observedAt: number
  progressFingerprint: string
}

export interface SupervisorProposal {
  id: string
  instanceId: string
  ticketId: string
  kind: 'correct' | 'pause'
  status: 'proposed' | 'deciding' | 'approved' | 'rejected'
  version: string
  fingerprint: string
  evidence: { snapshot: SupervisorSnapshot; assessment: SupervisorAssessment; finding: SupervisorFindingKind }
  recommendation: string
  impact: { stopsNewWork: boolean; wakesWorker: boolean; summary: string }
  createdAt: number
  decidedAt?: number
  decidedBy?: string
  decision?: 'approved' | 'rejected'
  decisionReason?: string
  decisionCommandId?: string
  action?: { kind: 'stop' | 'direction'; status: 'done' | 'failed'; id?: string; result?: Record<string, unknown>; error?: string }
}

export interface SupervisorObservationResult {
  ticketId: string
  at: number
  finding: SupervisorFindingKind
  snapshot: SupervisorSnapshot
  assessment?: SupervisorAssessment
  proposalId?: string
  reconciliation?: { kind: 'remote-work' | 'stop'; commandId: string; result?: Record<string, unknown>; error?: string }
}

export interface SupervisorObservationRecord {
  ticketId: string
  instanceId: string
  version: string
  fingerprints: { at: number; fingerprint: string; toolDigest: string; reportId?: string }[]
  proposals: number[]
  lastProposalFingerprint?: string
  last?: SupervisorObservationResult
  history: SupervisorObservationResult[]
  updatedAt: number
}

export interface SupervisorReport {
  version: string
  observations: SupervisorObservationResult[]
  proposals: SupervisorProposal[]
}

/** The narrow Engine surface the Supervisor reads and the two authorized commands it may be approved to run. */
export interface SupervisorEngine {
  getSupervision(options?: { includeHistory?: boolean }): Promise<{ items: Record<string, unknown>[]; processingPaused?: boolean }>
  getTicket(ticketId: string): Promise<{ mandate: { id: string; scope: string } } | undefined>
  getTicketDirection(ticketId: string): Promise<{ directionVersion: number } | undefined>
  correctTicket(command: { commandId: string; ticketId: string; text: string; reason: string }): Promise<{ id: string; directionVersion?: number }>
  stopTicket(command: { commandId: string; ticketId: string; reason: string }): Promise<unknown>
  reconcileRemoteWork?(command: { commandId: string; ticketId?: string }): Promise<unknown>
  reconcileStop?(command: { commandId: string; ticketId: string }): Promise<unknown>
}

export interface SupervisorOptions {
  engine: SupervisorEngine
  storage: Storage
  instanceId: string
  actorId: string
  assess?: SupervisorAssessor
  stallMs?: number
  stallObservations?: number
  loopObservations?: number
  proposalWindowMs?: number
  maxProposals?: number
  historyLimit?: number
  version?: string
  now?: () => number
}

const proposalKey = (proposalId: string) => JSON.stringify(['supervisor-proposal', proposalId])
const observationKey = (ticketId: string) => JSON.stringify(['supervisor-observation', ticketId])

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const summarizeActionResult = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return { value: String(value) }
  const record = value as Record<string, unknown>
  const summary = {
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.state === 'string' ? { state: record.state } : {}),
    ...(record.stop === undefined ? {} : { stop: record.stop }),
  }
  return Buffer.byteLength(JSON.stringify(summary)) <= 4_096 ? summary : { truncated: true }
}
const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const asNumber = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

const reportFacts = (value: unknown) => asArray(value).map(entry => {
  const report = asRecord(entry)
  return { id: asString(report.id), result: asString(report.result), evidence: asString(report.evidence), toolFacts: asArray(report.toolFacts), createdAt: asNumber(report.createdAt) }
})

const deliveryFacts = (value: unknown) => asArray(value).map(entry => {
  const message = asRecord(entry)
  return [asString(message.id), asString(message.state), asString(message.purpose)]
})

const stateList = (value: unknown) => asArray(value).map(entry => asString(asRecord(entry).state))

/**
 * Semantic supervision is a proposal engine, not an executor. It compares the goal, Mandate,
 * reports, tools and delivery progress, records what it saw, and writes one proposal at a time.
 * Approval is a separate authorized command; until then nothing is paused, stopped or changed.
 */
export class Supervisor {
  private readonly engine: SupervisorEngine
  private readonly storage: Storage
  private readonly instanceId: string
  private readonly actorId: string
  private readonly assess: SupervisorAssessor | undefined
  private readonly stallMs: number
  private readonly stallObservations: number
  private readonly loopObservations: number
  private readonly proposalWindowMs: number
  private readonly maxProposals: number
  private readonly historyLimit: number
  private readonly version: string
  private readonly now: () => number

  constructor(options: SupervisorOptions) {
    this.engine = options.engine
    this.storage = options.storage
    this.instanceId = options.instanceId
    this.actorId = options.actorId
    this.assess = options.assess
    this.stallMs = boundedInteger(options.stallMs, 1_800_000, 10, 86_400_000, 'stallMs')
    this.stallObservations = boundedInteger(options.stallObservations, 3, 2, 100, 'stallObservations')
    this.loopObservations = boundedInteger(options.loopObservations, 3, 2, 100, 'loopObservations')
    this.proposalWindowMs = boundedInteger(options.proposalWindowMs, 21_600_000, 1_000, 604_800_000, 'proposalWindowMs')
    this.maxProposals = boundedInteger(options.maxProposals, 2, 1, 100, 'maxProposals')
    this.historyLimit = boundedInteger(options.historyLimit, 50, 1, 1_000, 'historyLimit')
    this.version = options.version ?? 'supervisor-1'
    this.now = options.now ?? Date.now
  }

  /** Inspect every visible Ticket once. This never executes a proposal. */
  async inspect(): Promise<SupervisorReport> {
    const supervision = await this.engine.getSupervision({ includeHistory: true })
    const observations: SupervisorObservationResult[] = []
    const proposals: SupervisorProposal[] = []
    for (const entry of supervision.items.slice(0, 100)) {
      const result = await this.inspectItem(asRecord(entry), supervision.processingPaused === true)
      observations.push(result.observation)
      if (result.proposal !== undefined) proposals.push(result.proposal)
    }
    return { version: this.version, observations, proposals }
  }

  async listProposals(ticketId?: string): Promise<SupervisorProposal[]> {
    return this.storage.transaction(this.instanceId, async transaction => {
      if (ticketId !== undefined) return this.scanProposals(transaction, ticketId)
      return this.scanAllProposals(transaction)
    })
  }

  async getProposal(proposalId: string): Promise<SupervisorProposal | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<SupervisorProposal>('supervisor-proposal', proposalKey(proposalId)))
  }

  async getState(ticketId: string): Promise<SupervisorObservationRecord | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<SupervisorObservationRecord>('supervisor-observation', observationKey(ticketId)))
  }

  /**
   * Approve or reject one proposal. Approval runs only the existing authorized command:
   * `pause` stops the Ticket; `correct` adds one approved direction input. No tool, model or
   * config is changed, and the decision is claimed atomically before its action runs.
   */
  async decide(command: { commandId: string; proposalId: string; decision: 'approve' | 'reject'; reason?: string }): Promise<SupervisorProposal> {
    if (!command || Object.keys(command).some(key => !['commandId', 'proposalId', 'decision', 'reason'].includes(key))) throw new CoreError('INVALID_INPUT', 'A proposal decision accepts commandId, proposalId, decision and reason only.')
    if (typeof command.commandId !== 'string' || command.commandId.trim() === '') throw new CoreError('INVALID_INPUT', 'A proposal decision needs a commandId.')
    if (command.decision !== 'approve' && command.decision !== 'reject') throw new CoreError('INVALID_INPUT', 'A proposal decision is approve or reject.')
    if (command.reason !== undefined && (typeof command.reason !== 'string' || Buffer.byteLength(command.reason) > 4_096)) throw new CoreError('INVALID_INPUT', 'A decision reason is bounded to 4096 bytes.')
    const fingerprint = hash(['supervisor-decision-v1', command.proposalId, command.decision, command.reason ?? null])
    const decisionKey = JSON.stringify(['supervisor-decision', command.commandId])
    const claimed = await commandTransaction(this.storage, this.instanceId, async transaction => {
      const prior = await transaction.get<{ fingerprint: string; proposalId: string; proposal: SupervisorProposal }>('work-command', decisionKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.proposalId !== command.proposalId) throw new CoreError('IDENTITY_CONFLICT', 'The decision command was reused for another proposal or decision.')
        return prior.proposal
      }
      const existing = await transaction.get<SupervisorProposal>('supervisor-proposal', proposalKey(command.proposalId))
      if (existing === undefined) throw new CoreError('PROPOSAL_NOT_FOUND', 'The proposal does not exist.')
      if (existing.status !== 'proposed') throw new CoreError('PROPOSAL_CLOSED', 'The proposal has already been decided.')
      const next: SupervisorProposal = {
        ...existing, status: 'deciding', decidedAt: this.now(), decidedBy: this.actorId,
        decision: command.decision === 'approve' ? 'approved' : 'rejected', decisionCommandId: command.commandId,
        ...(command.reason === undefined ? {} : { decisionReason: command.reason }),
      }
      await transaction.replace('supervisor-proposal', proposalKey(existing.id), next)
      await transaction.insert('work-command', decisionKey, { fingerprint, proposalId: command.proposalId, proposal: next })
      return next
    })
    if (claimed.status === 'approved' || claimed.status === 'rejected') return claimed
    let action: SupervisorProposal['action']
    if (command.decision === 'approve') {
      try {
        if (claimed.kind === 'pause') {
          const result = await this.engine.stopTicket({ commandId: `${command.commandId}:stop`, ticketId: claimed.ticketId, reason: claimed.recommendation })
          action = { kind: 'stop', status: 'done', result: summarizeActionResult(result) }
        } else {
          const input = await this.engine.correctTicket({ commandId: `${command.commandId}:direction`, ticketId: claimed.ticketId, text: claimed.recommendation, reason: claimed.evidence.assessment.reason })
          action = { kind: 'direction', status: 'done', id: input.id, ...(input.directionVersion === undefined ? {} : { result: { directionVersion: input.directionVersion } }) }
        }
      } catch (error) {
        // The human decision is still recorded; the failed action is evidence, not a rewrite of it.
        action = { kind: claimed.kind === 'pause' ? 'stop' : 'direction', status: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
    }
    const decided: SupervisorProposal = {
      ...claimed, status: command.decision === 'approve' ? 'approved' : 'rejected',
      ...(action === undefined ? {} : { action }),
    }
    return commandTransaction(this.storage, this.instanceId, async transaction => {
      const current = await transaction.get<SupervisorProposal>('supervisor-proposal', proposalKey(command.proposalId))
      if (current === undefined) throw new CoreError('PROPOSAL_NOT_FOUND', 'The proposal does not exist.')
      if (current.status === 'approved' || current.status === 'rejected') {
        if (current.decisionCommandId === command.commandId) return current
        throw new CoreError('PROPOSAL_CLOSED', 'The proposal has already been decided.')
      }
      if (current.status !== 'deciding' || current.decisionCommandId !== command.commandId) throw new CoreError('PROPOSAL_CLOSED', 'The proposal was claimed by another decision.')
      await transaction.replace('supervisor-proposal', proposalKey(command.proposalId), decided)
      const prior = await transaction.get<{ fingerprint: string; proposalId: string; proposal: SupervisorProposal }>('work-command', decisionKey)
      if (prior !== undefined) await transaction.replace('work-command', decisionKey, { ...prior, proposal: decided })
      return decided
    })
  }

  private async inspectItem(item: Record<string, unknown>, processingPaused: boolean): Promise<{ observation: SupervisorObservationResult; proposal?: SupervisorProposal }> {
    const ticketId = asString(item.ticketId)
    if (ticketId === '') throw new CoreError('INCOMPLETE_STATE', 'The supervision item has no Ticket id.')
    const at = this.now()
    const record = await this.storage.transaction(this.instanceId, transaction => this.readObservation(transaction, ticketId))
    const snapshot = await this.snapshot(item, ticketId, processingPaused, at)
    const normal = this.normalFinding(item, snapshot)
    if (normal !== undefined) {
      const reconciliation = normal === 'unknown' ? await this.reconcile(snapshot) : undefined
      return this.finish(record, snapshot, normal, at, false, undefined, reconciliation)
    }
    record.fingerprints.push({ at, fingerprint: snapshot.progressFingerprint, toolDigest: snapshot.toolDigest, ...(snapshot.lastReportId === undefined ? {} : { reportId: snapshot.lastReportId }) })
    record.fingerprints = record.fingerprints.slice(-50)
    const same = record.fingerprints.filter(entry => entry.fingerprint === snapshot.progressFingerprint)
    const firstAt = same[0]?.at ?? at
    const recentTools = record.fingerprints.slice(-this.loopObservations).map(entry => entry.toolDigest)
    const repeatedTools = snapshot.toolDigest !== '' && recentTools.length >= this.loopObservations && recentTools.every(digest => digest === snapshot.toolDigest)
    const loop = same.length >= this.loopObservations && repeatedTools
    const noProgress = same.length >= this.stallObservations && at - firstAt >= this.stallMs
    let assessment: SupervisorAssessment | undefined
    if (loop || noProgress) {
      assessment = {
        kind: loop ? 'loop' : 'no-progress',
        reason: loop ? `The same tool/result fingerprint repeated at least ${String(this.loopObservations)} times.` : `No new report, tool fact or delivery for at least ${String(this.stallObservations)} observations.`,
        recommendation: loop ? 'Correct the direction or stop this Ticket and inspect the repeated step.' : 'Correct the direction or stop this Ticket and inspect why it is not progressing.',
        action: 'pause',
      }
    } else if (this.assess !== undefined) {
      assessment = await this.assess(snapshot, new AbortController().signal)
    }
    if (assessment === undefined || assessment.kind === 'normal') {
      return this.finish(record, snapshot, 'normal', at, true, assessment)
    }
    const finding = assessment.kind
    const proposalFingerprint = hash([ticketId, finding, snapshot.assignmentId, snapshot.generation, snapshot.lastReportId, snapshot.toolDigest, snapshot.deliveryDigest, assessment.reason, assessment.recommendation])
    const proposals = await this.storage.transaction(this.instanceId, transaction => this.scanProposals(transaction, ticketId))
    if (proposals.some(proposal => proposal.status === 'proposed') || record.lastProposalFingerprint === proposalFingerprint) {
      return this.finish(record, snapshot, 'duplicate', at, true, assessment)
    }
    const budget = record.proposals.filter(time => time > at - this.proposalWindowMs)
    if (budget.length >= this.maxProposals) {
      return this.finish(record, snapshot, 'budget-exhausted', at, true, assessment)
    }
    const kind = assessment.action ?? (assessment.kind === 'deviation' ? 'correct' : 'pause')
    const recommendation = assessment.recommendation?.trim() || assessment.reason
    const proposal: SupervisorProposal = {
      id: randomUUID(), instanceId: this.instanceId, ticketId, kind, status: 'proposed', version: this.version,
      fingerprint: proposalFingerprint, evidence: { snapshot, assessment, finding }, recommendation,
      impact: { stopsNewWork: kind === 'pause', wakesWorker: kind === 'correct',
        summary: kind === 'pause'
          ? 'Stops this Ticket; the Worker and later commands cannot continue until an explicit resume.'
          : 'Adds one approved direction input for the Worker; the Worker reads it on its next turn, and the Supervisor executes no tool.' },
      createdAt: at,
    }
    await this.storage.transaction(this.instanceId, async transaction => {
      await transaction.insert('supervisor-proposal', proposalKey(proposal.id), proposal)
    })
    record.proposals = [...record.proposals, at].slice(-100)
    record.lastProposalFingerprint = proposalFingerprint
    const result = this.result(record, snapshot, finding, at, true, assessment, proposal.id)
    await this.writeObservation(record)
    return { observation: result, proposal }
  }

  private normalFinding(item: Record<string, unknown>, snapshot: SupervisorSnapshot): SupervisorFindingKind | undefined {
    if (snapshot.unknownEffects > 0 || snapshot.unknownJobs > 0) return 'unknown'
    if (asString(item.bucket) === 'ready') return 'ready'
    if (snapshot.stage === 'ended' || asString(item.lifecycle) === 'ended') return 'ended'
    if (snapshot.waiting || snapshot.paused) return 'normal-wait'
    if (snapshot.stage !== 'running') return 'normal-wait'
    return undefined
  }

  private async finish(record: SupervisorObservationRecord, snapshot: SupervisorSnapshot, finding: SupervisorFindingKind, at: number, keepFingerprints: boolean, assessment?: SupervisorAssessment, reconciliation?: SupervisorObservationResult['reconciliation']): Promise<{ observation: SupervisorObservationResult; proposal?: SupervisorProposal }> {
    if (!keepFingerprints) record.fingerprints = []
    if (!keepFingerprints) delete record.lastProposalFingerprint
    const result = this.result(record, snapshot, finding, at, keepFingerprints, assessment, undefined, reconciliation)
    await this.writeObservation(record)
    return { observation: result }
  }

  private result(record: SupervisorObservationRecord, snapshot: SupervisorSnapshot, finding: SupervisorFindingKind, at: number, keepFingerprints: boolean, assessment?: SupervisorAssessment, proposalId?: string, reconciliation?: SupervisorObservationResult['reconciliation']): SupervisorObservationResult {
    if (!keepFingerprints) record.fingerprints = []
    const result: SupervisorObservationResult = {
      ticketId: snapshot.ticketId, at, finding, snapshot,
      ...(assessment === undefined ? {} : { assessment }), ...(proposalId === undefined ? {} : { proposalId }),
      ...(reconciliation === undefined ? {} : { reconciliation }),
    }
    record.last = result
    record.history = [result, ...record.history].slice(0, this.historyLimit)
    record.updatedAt = at
    return result
  }

  private async reconcile(snapshot: SupervisorSnapshot): Promise<SupervisorObservationResult['reconciliation']> {
    const commandId = `supervisor-reconcile:${snapshot.ticketId}:${snapshot.progressFingerprint}`
    const kind = snapshot.stop === 'stopping' && this.engine.reconcileStop !== undefined ? 'stop' : 'remote-work'
    try {
      const result = kind === 'stop'
        ? await this.engine.reconcileStop!({ commandId, ticketId: snapshot.ticketId })
        : await this.engine.reconcileRemoteWork?.({ commandId, ticketId: snapshot.ticketId })
      return result === undefined ? undefined : { kind, commandId, result: summarizeActionResult(result) }
    } catch (error) {
      return { kind, commandId, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async snapshot(item: Record<string, unknown>, ticketId: string, processingPaused: boolean, at: number): Promise<SupervisorSnapshot> {
    const health = asRecord(item.health)
    const assignment = asRecord(item.assignment)
    const reports = reportFacts(item.reports)
    const history = item.reportHistory === undefined ? [] : reportFacts(item.reportHistory)
    const allReports = [...reports, ...history]
    const lastReport = reports[0] ?? history[0]
    const messages = deliveryFacts(item.messages)
    const work = await this.engine.getTicket(ticketId)
    const direction = await this.engine.getTicketDirection(ticketId)
    const mandateId = work?.mandate.id ?? ''
    const mandateScope = work?.mandate.scope ?? ''
    const stage = asString(item.state)
    const intentReason = asString(item.reason)
    const toolDigest = lastReport === undefined || lastReport.toolFacts.length === 0 ? '' : hash(lastReport.toolFacts)
    const reportDigest = lastReport === undefined ? '' : hash([lastReport.id, lastReport.result, lastReport.evidence, lastReport.toolFacts])
    const deliveryDigest = hash(messages)
    const jobStates = stateList(item.jobs)
    const subagentStates = stateList(item.subagents)
    const unknownEffects = asNumber(health.effectsUnknown)
    const unknownJobs = asNumber(health.jobsUnknown)
    const attention = asString(asRecord(item.attention).status, asString(health.attention))
    const stop = asString(asRecord(item.stop).state, asString(health.stop))
    const setup = asString(asRecord(item.setup).state, asString(health.setup))
    const stopped = stop !== '' && stop !== 'none'
    const waitingReasons = new Set(['environment-waiting', 'handoff-pending', 'recovery-pending', 'recovery-blocked', 'router-pending',
      'worker-not-enabled', 'setup-pending', 'setup-failed', 'followup-pending', 'stopping', 'stopped', 'waiting-human',
      'context-rollover', 'recovery-exhausted', 'slot-queued', 'slot-priority-waiting'])
    const waiting = attention === 'waiting' || intentReason === 'environment-waiting' || asString(item.bucket) === 'needsHuman'
      || asString(item.bucket) === 'stopped' || asString(item.bucket) === 'ready' || asString(item.bucket) === 'ended'
      || stopped || setup === 'failed' || waitingReasons.has(intentReason) || asString(item.lifecycle) === 'ended'
    const progressFingerprint = hash([asString(item.request), mandateId, mandateScope,
      assignment.id, assignment.generation, reportDigest, toolDigest, deliveryDigest, direction?.directionVersion ?? 0, jobStates, subagentStates])
    return {
      ticketId, request: asString(item.request), mandateId, mandateScope,
      ...(asString(assignment.id) === '' ? {} : { assignmentId: asString(assignment.id) }),
      ...(asString(assignment.generation) === '' ? {} : { generation: asString(assignment.generation) }),
      stage, intentReason, directionVersion: direction?.directionVersion ?? 1,
      reportIds: allReports.map(report => report.id), ...(lastReport === undefined ? {} : { lastReportId: lastReport.id, lastReportAt: lastReport.createdAt }),
      toolDigest, reportDigest, deliveryDigest, jobStates, subagentStates, unknownEffects, unknownJobs,
      attention, stop, setup, paused: processingPaused, waiting, observedAt: at, progressFingerprint,
    }
  }

  private async readObservation(transaction: AsyncTx, ticketId: string): Promise<SupervisorObservationRecord> {
    return await transaction.get<SupervisorObservationRecord>('supervisor-observation', observationKey(ticketId)) ?? {
      ticketId, instanceId: this.instanceId, version: this.version, fingerprints: [], proposals: [], history: [], updatedAt: 0,
    }
  }

  private async writeObservation(record: SupervisorObservationRecord): Promise<void> {
    await this.storage.transaction(this.instanceId, async transaction => {
      if (!await transaction.replace('supervisor-observation', observationKey(record.ticketId), record)) await transaction.insert('supervisor-observation', observationKey(record.ticketId), record)
    })
  }

  private async scanProposals(transaction: AsyncTx, ticketId: string): Promise<SupervisorProposal[]> {
    return (await this.scanAllProposals(transaction)).filter(proposal => proposal.ticketId === ticketId)
  }

  private async scanAllProposals(transaction: AsyncTx): Promise<SupervisorProposal[]> {
    const proposals: SupervisorProposal[] = []
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<SupervisorProposal>('supervisor-proposal', { limit: 100, ...(cursor === undefined ? {} : { after: cursor }) })
      proposals.push(...page.items.map(item => item.value))
      if (!page.cursor) break
      cursor = page.cursor
    }
    return proposals.sort((left, right) => right.createdAt - left.createdAt)
  }
}

export async function listSupervisorProposals(storage: Storage, instanceId: string, ticketId?: string): Promise<SupervisorProposal[]> {
  return storage.transaction(instanceId, async transaction => {
    const proposals: SupervisorProposal[] = []
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<SupervisorProposal>('supervisor-proposal', { limit: 100, ...(cursor === undefined ? {} : { after: cursor }) })
      proposals.push(...page.items.map(item => item.value))
      if (!page.cursor) break
      cursor = page.cursor
    }
    return proposals.filter(proposal => ticketId === undefined || proposal.ticketId === ticketId).sort((left, right) => right.createdAt - left.createdAt)
  })
}
