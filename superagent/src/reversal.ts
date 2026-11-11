import { createHash } from 'node:crypto'
import { canonicalJson, commandTransaction } from './commands.js'
import { activationRecordKey, loadActivation, type ActivationReleaseCounts } from './activation.js'
import { hostLeaseKey, hostProcessToken, type HostLeaseRecord } from './host.js'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { loadSwitchover, type GapCounts, type LegacyCore, type LegacyRestartEvidence, type LegacyReviewFact, type Switchover,
  type SwitchoverGapInput } from './switchover.js'

export interface LegacyRestartControl {
  enableRestart(): Promise<LegacyRestartEvidence>
  restartEnabled(): Promise<boolean>
}

export interface LegacyRecovery extends LegacyCore, LegacyRestartControl {}

export interface ReverseEvidence {
  activeTurns: string[]
  activeJobs: string[]
  pendingOutbound: string[]
  unknownEffects: string[]
  unknownJobs: string[]
  pendingReceipts: string[]
  manualStops: string[]
  compatibility: { canReopen: boolean; blockers: string[] }
}

export interface ReverseControl {
  /** Stop new turns/jobs/outbound and return the durable new-core facts. */
  stopAndSnapshot(): Promise<ReverseEvidence>
}

export interface AbandonOptions {
  batchId: string
  commandId: string
  reason: string
  legacy: LegacyRecovery
  settleMs?: number
}

export interface AbandonmentRecord {
  id: string
  instanceId: string
  batchId: string
  commandId: string
  state: 'abandoned' | 'blocked'
  reason: string
  gap: GapCounts
  oldReview: LegacyReviewFact[]
  restart: { enabledAt?: number; evidence?: string; entry?: string }
  blockers: string[]
  createdAt: number
  updatedAt: number
}

export interface ReverseOptions {
  batchId: string
  commandId: string
  reason: string
  control: ReverseControl
}

export type ReverseState = 'stopping' | 'blocked' | 'ready' | 'completed' | 'restart-failed'

export interface ReverseRecord {
  id: string
  instanceId: string
  batchId: string
  commandId: string
  activationId: string
  activationEpoch: number
  reverseEpoch: number
  state: ReverseState
  reason: string
  manifest: { gap: GapCounts; release: ActivationReleaseCounts; oldReview: LegacyReviewFact[]; manualStops: string[] }
  evidence?: ReverseEvidence
  restart: { enabledAt?: number; evidence?: string; entry?: string }
  blockers: string[]
  createdAt: number
  updatedAt: number
}

const abandonmentKey = (instanceId: string, batch: string) => JSON.stringify(['abandonment', instanceId, batch])
const abandonmentCommandKey = (instanceId: string, commandId: string) => JSON.stringify(['abandonment-command', instanceId, commandId])
const reversalKey = (instanceId: string, batch: string) => JSON.stringify(['reversal', instanceId, batch])
const reversalCommandKey = (instanceId: string, commandId: string) => JSON.stringify(['reversal-command', instanceId, commandId])
const abandonFingerprint = (batch: string, reason: string) => `abandon:v1:${createHash('sha256').update(canonicalJson([batch, reason])).digest('hex')}`
const reverseFingerprint = (batch: string, reason: string) => `reverse:v1:${createHash('sha256').update(canonicalJson([batch, reason])).digest('hex')}`
const reasonText = (value: string) => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 2_048) throw new CoreError('REVERSAL_INPUT', 'A reason is bounded nonempty text.')
  return value
}
const unique = (items: string[]) => [...new Set(items)]

export class Reversal {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: Storage, private readonly instanceId: string,
    private readonly switchover: Switchover, private readonly now: () => number = Date.now) {}

  private exclusively<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  async abandonment(batchId: string): Promise<AbandonmentRecord | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<AbandonmentRecord>('abandonment', abandonmentKey(this.instanceId, batchId)))
  }

  async reverseStatus(batchId: string): Promise<ReverseRecord | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<ReverseRecord>('reversal', reversalKey(this.instanceId, batchId)))
  }

  async abandon(options: AbandonOptions): Promise<AbandonmentRecord> {
    this.validateAbandon(options)
    return this.exclusively(async () => {
      const activation = await this.storage.transaction(this.instanceId, transaction => loadActivation(transaction, this.instanceId))
      if (activation) throw new CoreError('ACTIVATION_PRESENT', 'The batch cannot be abandoned after activation; use reverse handoff.')
      const prior = await this.storage.transaction(this.instanceId, transaction => transaction.get<AbandonmentRecord>('abandonment', abandonmentKey(this.instanceId, options.batchId)))
      const priorCommand = await this.storage.transaction(this.instanceId, transaction =>
        transaction.get<{ fingerprint: string }>('abandonment-command', abandonmentCommandKey(this.instanceId, options.commandId)))
      if (prior || priorCommand) {
        const fingerprint = abandonFingerprint(options.batchId, options.reason)
        if (priorCommand && priorCommand.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This abandonment command ID was used with different input.')
        if (!prior) throw new CoreError('REVERSAL_STALE', 'An abandonment command exists without its record.')
        if (prior.blockers.includes('GAP_OWNERSHIP_REVIEW')) return prior
        if (!prior.restart.enabledAt) return this.enableRestart(prior, options.legacy)
        return prior
      }
      const checked = await this.switchover.recheck(options.batchId, { legacy: options.legacy, settleMs: options.settleMs ?? 1_000 })
      if (checked.state !== 'quiesced' || checked.blockers.length) throw new CoreError('NOT_QUIESCED', 'The switchover batch is not quiesced.')
      const view = await this.switchover.status(options.batchId)
      if (!view || view.state !== 'quiesced' || view.isolation !== 'held-by-this-process') throw new CoreError('NOT_QUIESCED', 'The gap entry is not held by this process.')
      const gaps = await this.allGapInputs(options.batchId)
      const gap = gapCounts(gaps)
      const blockers = gap.held || gap.quarantined ? ['GAP_OWNERSHIP_REVIEW'] : []
      const fingerprint = abandonFingerprint(options.batchId, options.reason)
      const record = await commandTransaction(this.storage, this.instanceId, async transaction => {
        const command = await transaction.get<{ fingerprint: string }>('abandonment-command', abandonmentCommandKey(this.instanceId, options.commandId))
        if (command) {
          if (command.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This abandonment command ID was used with different input.')
          const existing = await transaction.get<AbandonmentRecord>('abandonment', abandonmentKey(this.instanceId, options.batchId))
          if (!existing) throw new CoreError('REVERSAL_STALE', 'The abandonment record is missing.')
          return existing
        }
        const switchRecord = await loadSwitchover(transaction, this.instanceId, options.batchId)
        if (!switchRecord || switchRecord.state !== 'quiesced' || switchRecord.blockers.length) throw new CoreError('NOT_QUIESCED', 'The switchover record changed before abandonment.')
        const next: AbandonmentRecord = {
          id: abandonmentKey(this.instanceId, options.batchId), instanceId: this.instanceId, batchId: options.batchId,
          commandId: options.commandId, state: blockers.length ? 'blocked' : 'abandoned', reason: options.reason, gap,
          oldReview: switchRecord.archive.review, restart: {}, blockers, createdAt: this.now(), updatedAt: this.now(),
        }
        await transaction.insert('abandonment', next.id, next)
        await transaction.insert('abandonment-command', abandonmentCommandKey(this.instanceId, options.commandId), { fingerprint, record: next.id })
        if (!blockers.length) {
          await transaction.replace('switchover', switchRecord.id, { ...switchRecord, state: 'abandoned',
            entry: { ...switchRecord.entry, isolated: false, releasedAt: this.now() }, updatedAt: this.now() })
        }
        return next
      })
      if (record.blockers.length) return record
      return this.enableRestart(record, options.legacy)
    })
  }

  async reverse(options: ReverseOptions): Promise<ReverseRecord> {
    this.validateReverse(options)
    return this.exclusively(async () => {
      const reverse = await this.storage.transaction(this.instanceId, transaction => this.reverseIn(transaction, options))
      if (reverse.state === 'completed' || reverse.state === 'ready' || reverse.state === 'restart-failed') return reverse
      try {
        const evidence = normalizeEvidence(await options.control.stopAndSnapshot())
        return this.recordEvidence(reverse, evidence)
      } catch (error) {
        return this.block(reverse, [`NEW_CORE_STOP_FAILED: ${error instanceof Error ? error.message : String(error)}`])
      }
    })
  }

  async completeReverse(options: { batchId: string; commandId: string; legacy: LegacyRestartControl;
    compatibility: () => Promise<{ canReopen: boolean; blockers: string[] }> }): Promise<ReverseRecord> {
    identifier(options.batchId, 'batchId')
    identifier(options.commandId, 'commandId')
    return this.exclusively(async () => {
      const reverse = await this.storage.transaction(this.instanceId, transaction => transaction.get<ReverseRecord>('reversal', reversalKey(this.instanceId, options.batchId)))
      if (!reverse) throw new CoreError('REVERSE_NOT_FOUND', 'No reverse handoff exists for this batch.')
      if (reverse.state === 'completed') return reverse
      if (reverse.state !== 'ready' && reverse.state !== 'restart-failed') throw new CoreError('REVERSE_NOT_READY', 'The reverse handoff has not passed new-core reconciliation.')
      if (reverse.commandId !== options.commandId) throw new CoreError('REVERSE_COMMAND_CONFLICT', 'The reverse command does not own this handoff.')
      const lease = await this.assertCurrentOwner(reverse.reverseEpoch)
      const compatibility = await options.compatibility()
      if (!compatibility || typeof compatibility.canReopen !== 'boolean' || !Array.isArray(compatibility.blockers)) {
        throw new CoreError('REVERSAL_EVIDENCE', 'Final compatibility must name whether the old core can reopen.')
      }
      if (!compatibility.canReopen || compatibility.blockers.length) {
        return this.block(reverse, ['COMPATIBILITY_CHANGED', ...compatibility.blockers])
      }
      let restart: { enabledAt: number; evidence?: string; entry?: string }
      try {
        const enabled = await options.legacy.restartEnabled() ? undefined : await options.legacy.enableRestart()
        restart = { enabledAt: this.now(), ...(enabled?.evidence ? { evidence: enabled.evidence } : {}), ...(enabled?.entry ? { entry: enabled.entry } : {}) }
      } catch (error) {
        return this.block(reverse, [`OLD_RESTART_FAILED: ${error instanceof Error ? error.message : String(error)}`], 'restart-failed')
      }
      return this.storage.transaction(this.instanceId, async transaction => {
        const current = await transaction.get<ReverseRecord>('reversal', reverse.id)
        if (!current) throw new CoreError('REVERSE_NOT_FOUND', 'The reverse record disappeared.')
        const completed: ReverseRecord = { ...current, reverseEpoch: lease.epoch, state: 'completed', restart, blockers: [], updatedAt: this.now() }
        await transaction.replace('reversal', completed.id, completed)
        const activation = await loadActivation(transaction, this.instanceId)
        if (activation && activation.batchId === options.batchId) await transaction.replace('activation', activationRecordKey(this.instanceId), { ...activation, state: 'reversed', updatedAt: this.now() })
        const switchRecord = await loadSwitchover(transaction, this.instanceId, options.batchId)
        if (switchRecord) await transaction.replace('switchover', switchRecord.id, { ...switchRecord, state: 'abandoned',
          entry: { ...switchRecord.entry, isolated: false, releasedAt: this.now() }, updatedAt: this.now() })
        return completed
      })
    })
  }

  private async reverseIn(transaction: AsyncTx, options: ReverseOptions): Promise<ReverseRecord> {
    const activation = await loadActivation(transaction, this.instanceId)
    if (!activation || activation.batchId !== options.batchId) throw new CoreError('ACTIVATION_NOT_FOUND', 'The batch is not the active core entry.')
    if (activation.state === 'reversed') throw new CoreError('ALREADY_REVERSED', 'The reverse handoff is already complete.')
    const lease = await this.leaseIn(transaction)
    if (lease.epoch < activation.epoch) throw new CoreError('REVERSE_EPOCH', 'The reverse epoch cannot precede the activation epoch.')
    const fingerprint = reverseFingerprint(options.batchId, options.reason)
    const priorCommand = await transaction.get<{ fingerprint: string }>('reversal-command', reversalCommandKey(this.instanceId, options.commandId))
    if (priorCommand && priorCommand.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This reverse command ID was used with different input.')
    const existing = await transaction.get<ReverseRecord>('reversal', reversalKey(this.instanceId, options.batchId))
    if (existing) {
      if (existing.commandId !== options.commandId) throw new CoreError('REVERSE_COMMAND_CONFLICT', 'A reverse handoff already exists for this batch.')
      if (existing.state === 'completed') return existing
      if (existing.state === 'ready' || existing.state === 'restart-failed') {
        if (lease.epoch <= existing.reverseEpoch) return existing
        const advanced: ReverseRecord = { ...existing, reverseEpoch: lease.epoch, updatedAt: this.now() }
        await transaction.replace('reversal', existing.id, advanced)
        return advanced
      }
      if (lease.epoch > existing.reverseEpoch) {
        const advanced: ReverseRecord = { ...existing, reverseEpoch: lease.epoch, updatedAt: this.now() }
        await transaction.replace('reversal', existing.id, advanced)
        return advanced
      }
    }
    if (!priorCommand) await transaction.insert('reversal-command', reversalCommandKey(this.instanceId, options.commandId), { fingerprint, record: reversalKey(this.instanceId, options.batchId) })
    if (existing) return existing
    const reverse: ReverseRecord = {
      id: reversalKey(this.instanceId, options.batchId), instanceId: this.instanceId, batchId: options.batchId, commandId: options.commandId,
      activationId: activation.manifest.activationId, activationEpoch: activation.epoch, reverseEpoch: lease.epoch, state: 'stopping',
      reason: options.reason, manifest: { gap: activation.manifest.gap, release: activation.release, oldReview: activation.manifest.oldReview, manualStops: [] },
      restart: {}, blockers: [], createdAt: this.now(), updatedAt: this.now(),
    }
    await transaction.insert('reversal', reverse.id, reverse)
    await transaction.replace('activation', activationRecordKey(this.instanceId), { ...activation, state: 'stopping', updatedAt: this.now() })
    return reverse
  }

  private async recordEvidence(reverse: ReverseRecord, evidence: ReverseEvidence): Promise<ReverseRecord> {
    const blockers = unique([
      ...(evidence.activeTurns.length ? ['ACTIVE_TURNS'] : []),
      ...(evidence.activeJobs.length ? ['ACTIVE_JOBS'] : []),
      ...(evidence.pendingOutbound.length ? ['PENDING_OUTBOUND'] : []),
      ...evidence.unknownEffects.map(item => `UNKNOWN_EFFECT: ${item}`),
      ...evidence.unknownJobs.map(item => `UNKNOWN_JOB: ${item}`),
      ...evidence.pendingReceipts.map(item => `PENDING_RECEIPT: ${item}`),
      ...(!evidence.compatibility.canReopen ? ['OLD_CORE_INCOMPATIBLE', ...evidence.compatibility.blockers] : evidence.compatibility.blockers),
      ...(reverse.manifest.release.pending || reverse.manifest.release.unknown || reverse.manifest.release.failed ? ['GAP_RELEASE_UNSETTLED'] : []),
    ])
    const next: ReverseRecord = { ...reverse, state: blockers.length ? 'blocked' : 'ready', evidence,
      manifest: { ...reverse.manifest, manualStops: [...evidence.manualStops] }, blockers, updatedAt: this.now() }
    return this.storage.transaction(this.instanceId, async transaction => {
      await transaction.replace('reversal', next.id, next)
      const activation = await loadActivation(transaction, this.instanceId)
      if (activation?.batchId === next.batchId && !blockers.length) {
        await transaction.replace('activation', activationRecordKey(this.instanceId), { ...activation, state: 'reversing', updatedAt: this.now() })
      }
      return next
    })
  }

  private async block(reverse: ReverseRecord, blockers: string[], state: ReverseState = 'blocked'): Promise<ReverseRecord> {
    const next: ReverseRecord = { ...reverse, state, blockers: unique(blockers), updatedAt: this.now() }
    return this.storage.transaction(this.instanceId, async transaction => {
      await transaction.replace('reversal', next.id, next)
      return next
    })
  }

  private async enableRestart(record: AbandonmentRecord, legacy: LegacyRecovery) {
    try {
      const enabled = await legacy.restartEnabled() ? undefined : await legacy.enableRestart()
      const next: AbandonmentRecord = { ...record, state: 'abandoned',
        restart: { enabledAt: this.now(), ...(enabled?.evidence ? { evidence: enabled.evidence } : {}), ...(enabled?.entry ? { entry: enabled.entry } : {}) },
        blockers: record.blockers.filter(item => item !== 'OLD_RESTART_FAILED'), updatedAt: this.now() }
      await this.storage.transaction(this.instanceId, transaction => transaction.replace('abandonment', next.id, next))
      return next
    } catch (error) {
      const next: AbandonmentRecord = { ...record, state: 'blocked', blockers: unique([...record.blockers, `OLD_RESTART_FAILED: ${error instanceof Error ? error.message : String(error)}`]), updatedAt: this.now() }
      await this.storage.transaction(this.instanceId, transaction => transaction.replace('abandonment', next.id, next))
      return next
    }
  }

  private async allGapInputs(batch: string): Promise<SwitchoverGapInput[]> {
    const items: SwitchoverGapInput[] = []
    let after: string | undefined
    for (let page = 0; page < 10; page++) {
      const result = await this.switchover.listGapInputs(batch, { limit: 100, ...(after ? { after } : {}) })
      items.push(...result.items)
      if (!result.cursor) return items
      after = result.cursor
    }
    throw new CoreError('REVERSAL_BUDGET', 'The gap review exceeded its 1000-record budget.')
  }

  private async leaseIn(transaction: AsyncTx) {
    const lease = await transaction.get<HostLeaseRecord>('host-lease', hostLeaseKey(this.instanceId))
    if (!lease || lease.owner !== hostProcessToken || lease.releasedAt !== undefined || lease.expiresAt <= this.now()) {
      throw new CoreError('REVERSE_EPOCH', 'The reverse handoff must be owned by the current, unexpired Host lease.')
    }
    return lease
  }

  private async assertCurrentOwner(epoch: number) {
    return this.storage.transaction(this.instanceId, async transaction => {
      const lease = await this.leaseIn(transaction)
      if (lease.epoch < epoch) throw new CoreError('REVERSE_EPOCH', 'The Host epoch precedes the reverse handoff.')
      return lease
    })
  }

  private validateAbandon(options: AbandonOptions) {
    identifier(options?.batchId, 'batchId')
    identifier(options.commandId, 'commandId')
    reasonText(options.reason)
    if (!options.legacy || typeof options.legacy.enableRestart !== 'function' || typeof options.legacy.restartEnabled !== 'function'
      || typeof options.legacy.snapshot !== 'function') {
      throw new CoreError('REVERSAL_INPUT', 'An old-entry recovery adapter is required.')
    }
    if (options.settleMs !== undefined && (!Number.isInteger(options.settleMs) || options.settleMs < 0 || options.settleMs > 60_000)) {
      throw new CoreError('REVERSAL_INPUT', 'The settle window is between 0 and 60000 ms.')
    }
  }

  private validateReverse(options: ReverseOptions) {
    identifier(options?.batchId, 'batchId')
    identifier(options.commandId, 'commandId')
    reasonText(options.reason)
    if (!options.control || typeof options.control.stopAndSnapshot !== 'function') {
      throw new CoreError('REVERSAL_INPUT', 'A new-core stop adapter is required.')
    }
  }
}

const gapCounts = (items: SwitchoverGapInput[]): GapCounts => ({
  held: items.filter(item => item.state === 'held').length,
  legacyAccepted: items.filter(item => item.state === 'legacy-accepted').length,
  quarantined: items.filter(item => item.state === 'quarantined').length,
  released: items.filter(item => item.state === 'released').length,
})

const normalizeEvidence = (value: ReverseEvidence): ReverseEvidence => {
  if (!value || typeof value !== 'object') throw new CoreError('REVERSAL_EVIDENCE', 'A new-core stop must return durable evidence.')
  for (const key of ['activeTurns', 'activeJobs', 'pendingOutbound', 'unknownEffects', 'unknownJobs', 'pendingReceipts', 'manualStops'] as const) {
    if (!Array.isArray(value[key]) || value[key].length > 1_000) throw new CoreError('REVERSAL_EVIDENCE', `${key} must be a bounded array.`)
    for (const item of value[key]) identifier(item, key)
  }
  if (!value.compatibility || typeof value.compatibility !== 'object' || typeof value.compatibility.canReopen !== 'boolean' || !Array.isArray(value.compatibility.blockers)) {
    throw new CoreError('REVERSAL_EVIDENCE', 'Compatibility must name whether the old core can reopen.')
  }
  return { activeTurns: [...value.activeTurns], activeJobs: [...value.activeJobs], pendingOutbound: [...value.pendingOutbound],
    unknownEffects: [...value.unknownEffects], unknownJobs: [...value.unknownJobs], pendingReceipts: [...value.pendingReceipts],
    manualStops: [...value.manualStops], compatibility: { canReopen: value.compatibility.canReopen,
      blockers: [...value.compatibility.blockers].map(item => { if (typeof item !== 'string' || Buffer.byteLength(item) > 2_048) throw new CoreError('REVERSAL_EVIDENCE', 'Compatibility blockers are bounded text.'); return item }) } }
}
