import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson, commandTransaction } from './commands.js'
import { getLegacyArchive } from './legacy-archive.js'
import { hostLeaseKey, hostProcessToken, type HostLeaseRecord } from './host.js'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { loadSwitchover, switchoverGapPrefix, type GapCounts, type LegacyCore, type LegacyReviewFact,
  type Switchover, type SwitchoverGapInput, type SwitchoverRecord, type SwitchoverView } from './switchover.js'

export type ActivationGapState = 'pending' | 'releasing' | 'released' | 'unknown' | 'failed' | 'skipped'
export const CURRENT_CORE = 'ds-superagent'
export type CurrentCore = typeof CURRENT_CORE

export interface ActivationReleaseContext {
  activationId: string
  batchId: string
  commandId: string
}

export interface ActivationReleaseResult {
  receiptId?: string
  ticketId?: string
}

/** The current core's idempotent acceptance path for one held gap input. */
export interface ActivationRelease {
  release(input: SwitchoverGapInput, context: ActivationReleaseContext): Promise<ActivationReleaseResult>
}

export interface ActivationManifest {
  activationId: string
  batchId: string
  epoch: number
  currentCore: CurrentCore
  switchoverId: string
  archiveSourceDigest: string
  archiveMappingDigest: string
  stateRevision?: number
  checkpoints: string[]
  gap: GapCounts
  oldReview: LegacyReviewFact[]
  entry: { host: string; port: number }
  quiescedAt?: number
}

export interface ActivationGapRecord {
  id: string
  instanceId: string
  batchId: string
  activationId: string
  gapId: string
  state: ActivationGapState
  attempts: number
  input: SwitchoverGapInput
  reason?: string
  receiptId?: string
  ticketId?: string
  claimedAt?: number
  updatedAt: number
}

export interface ActivationReleaseCounts {
  planned: number
  released: number
  pending: number
  unknown: number
  failed: number
  skipped: number
  legacyAccepted: number
  quarantined: number
}

export interface ActivationRecord {
  id: string
  instanceId: string
  batchId: string
  commandId: string
  epoch: number
  currentCore: CurrentCore
  state: 'active'
  manifest: ActivationManifest
  release: ActivationReleaseCounts
  activatedAt: number
  updatedAt: number
}

export interface ActivationView extends ActivationRecord {
  releases: ActivationGapRecord[]
}

export interface ActivationGate {
  active(transaction: AsyncTx): Promise<boolean>
}

export interface ActivationOptions {
  batchId: string
  commandId: string
  newEpoch: number
  legacy: LegacyCore
  release: ActivationRelease
  settleMs?: number
  maxReleaseAttempts?: number
}

const activationKey = (instanceId: string) => JSON.stringify(['activation', instanceId])
const activationCommandKey = (instanceId: string, commandId: string) => JSON.stringify(['activation-command', instanceId, commandId])
const activationHistoryPrefix = (instanceId: string) => JSON.stringify(['activation-history', instanceId])
const activationGapPrefix = (instanceId: string, batch: string) => JSON.stringify(['activation-gap', instanceId, batch])
const activationGapKey = (instanceId: string, batch: string, gapId: string) => `${activationGapPrefix(instanceId, batch)}:${gapId}`
const releaseCommandId = (activationId: string, gapId: string) => `release:${activationId}:${gapId}`
const fingerprint = (batchId: string, epoch: number) => `activation:v1:${createHash('sha256').update(canonicalJson([CURRENT_CORE, batchId, epoch])).digest('hex')}`
const releaseCounts = (items: ActivationGapRecord[]): ActivationReleaseCounts => ({
  planned: items.length,
  released: items.filter(item => item.state === 'released').length,
  pending: items.filter(item => item.state === 'pending' || item.state === 'releasing').length,
  unknown: items.filter(item => item.state === 'unknown').length,
  failed: items.filter(item => item.state === 'failed').length,
  skipped: items.filter(item => item.state === 'skipped').length,
  legacyAccepted: items.filter(item => item.state === 'skipped' && item.reason === 'OLD_ACCEPTED').length,
  quarantined: items.filter(item => item.state === 'skipped' && item.reason === 'QUARANTINED').length,
})
const errorCode = (error: unknown) => error instanceof CoreError ? error.code : 'ACTIVATION_FAILED'
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const gapCounts = (items: SwitchoverGapInput[]): GapCounts => ({
  held: items.filter(item => item.state === 'held').length,
  legacyAccepted: items.filter(item => item.state === 'legacy-accepted').length,
  quarantined: items.filter(item => item.state === 'quarantined').length,
  released: items.filter(item => item.state === 'released').length,
})

const quiescedEvidence = (record: SwitchoverRecord) => {
  if (record.state !== 'quiesced' || record.blockers.length) throw new CoreError('NOT_QUIESCED', 'The switchover batch is not quiesced.')
  if (!record.stop.confirmedAt || !record.restart.disabledAt || !record.entry.isolated) {
    throw new CoreError('NOT_QUIESCED', 'The old stop, restart disable or intake isolation evidence is missing.')
  }
  const checkpoints = record.checkpoints.slice(-2)
  if (checkpoints.length !== 2 || checkpoints[0]!.digest !== checkpoints[1]!.digest) {
    throw new CoreError('NOT_QUIESCED', 'The final two old-core snapshots are missing or not stable.')
  }
  const final = checkpoints[1]!
  if (final.activeTurns.length || final.activeJobs.length || final.pendingOutbound.length
    || final.increments.inputs || final.increments.receipts || final.increments.events || final.increments.outbound) {
    throw new CoreError('NOT_QUIESCED', 'The final old-core snapshot still has active work or unaccounted increments.')
  }
  if (final.cursors.some(cursor => !cursor.complete)) throw new CoreError('NOT_QUIESCED', 'A source cursor is incomplete.')
  if (final.receipts.some(receipt => receipt.state === 'pending' || receipt.state === 'unknown')) {
    throw new CoreError('NOT_QUIESCED', 'An acceptance receipt is still pending or unknown.')
  }
}

export class Activation {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: Storage, private readonly instanceId: string,
    private readonly switchover: Switchover, private readonly now: () => number = Date.now) {
    identifier(instanceId, 'instanceId')
  }

  private exclusively<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  gate(): ActivationGate {
    return { active: transaction => this.activeIn(transaction) }
  }

  async status(): Promise<ActivationView | undefined> {
    return this.storage.transaction(this.instanceId, async transaction => {
      const activation = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
      if (!activation) return undefined
      const releases = await this.scanReleases(transaction, activation.batchId)
      return { ...activation, releases }
    })
  }

  async listReleases(batchId: string): Promise<ActivationGapRecord[]> {
    return this.storage.transaction(this.instanceId, transaction => this.scanReleases(transaction, batchId))
  }

  async activate(options: ActivationOptions): Promise<ActivationView> {
    this.validate(options)
    const maxAttempts = options.maxReleaseAttempts ?? 5
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new CoreError('ACTIVATION_INPUT', 'Release attempts must be between 1 and 10.')
    const fingerprintValue = fingerprint(options.batchId, options.newEpoch)
    const existing = await commandTransaction(this.storage, this.instanceId, async transaction => {
      const current = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
      if (!current) return undefined
      if (current.batchId !== options.batchId || current.epoch !== options.newEpoch) throw new CoreError('ACTIVATION_CONFLICT', 'Another core entry is already active.')
      const commandKey = activationCommandKey(this.instanceId, options.commandId)
      const prior = await transaction.get<{ fingerprint: string; activationId: string }>('activation-command', commandKey)
      if (prior && (prior.fingerprint !== fingerprintValue || prior.activationId !== current.manifest.activationId)) {
        throw new CoreError('IDENTITY_CONFLICT', 'This activation command ID was already used with different input.')
      }
      if (!prior) await transaction.insert('activation-command', commandKey, { fingerprint: fingerprintValue, activationId: current.manifest.activationId })
      return current
    })
    if (existing) {
      return this.releasePending(existing.batchId, options.release, maxAttempts)
    }
    if (!options.legacy || typeof options.legacy !== 'object') throw new CoreError('ACTIVATION_INPUT', 'A final legacy snapshot adapter is required before activation.')
    const checked = await this.switchover.recheck(options.batchId, { legacy: options.legacy, settleMs: options.settleMs ?? 1_000 })
    if (checked.state !== 'quiesced' || checked.blockers.length) throw new CoreError('NOT_QUIESCED', 'The switchover batch did not pass the final quiescence recheck.')
    const view = await this.switchover.status(options.batchId)
    if (!view || view.state !== 'quiesced' || view.blockers.length || view.isolation !== 'held-by-this-process') {
      throw new CoreError('NOT_QUIESCED', 'The old entry is not currently held by this process.')
    }
    const archive = getLegacyArchive(view.archive.target, view.archive.batchId)
    if (!archive || archive.status !== 'published' || archive.source.digest !== view.archive.sourceDigest || archive.mappingDigest !== view.archive.mappingDigest) {
      throw new CoreError('NOT_QUIESCED', 'The read-only archive is not published or has changed.')
    }
    quiescedEvidence(view)
    const activation = await commandTransaction(this.storage, this.instanceId, transaction =>
      this.activateIn(transaction, options, view, archive.source.stateRevision, fingerprintValue))
    try { await this.switchover.detach(options.batchId) } catch { /* The active record already refuses gap intake. */ }
    return this.releasePending(activation.batchId, options.release, maxAttempts)
  }

  async releasePending(batchId: string, release: ActivationRelease, maxAttempts = 5): Promise<ActivationView> {
    identifier(batchId, 'batchId')
    if (!release || typeof release.release !== 'function') throw new CoreError('ACTIVATION_INPUT', 'A release adapter is required.')
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new CoreError('ACTIVATION_INPUT', 'Release attempts must be between 1 and 10.')
    return this.exclusively(async () => {
      const activation = await this.storage.transaction(this.instanceId, async transaction => {
        const record = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
        if (!record || record.state !== 'active' || record.batchId !== batchId) throw new CoreError('CORE_NOT_ACTIVE', 'This batch is not the active core entry.')
        if (!await this.activeIn(transaction)) throw new CoreError('CORE_NOT_ACTIVE', 'The current Host epoch is no longer active for this core.')
        return record
      })

      await this.storage.transaction(this.instanceId, async transaction => {
        for (const item of await this.scanReleases(transaction, batchId)) {
          if (item.state !== 'releasing') continue
          const { claimedAt: _claimedAt, ...rest } = item
          await transaction.replace('activation-gap', item.id,
            { ...rest, state: 'unknown', reason: 'RELEASE_OUTCOME_UNKNOWN', updatedAt: this.now() })
        }
      })

      const candidates = await this.storage.transaction(this.instanceId, async transaction =>
        (await this.scanReleases(transaction, batchId))
          .filter(item => (item.state === 'pending' || item.state === 'unknown') && item.attempts < maxAttempts)
          .map(item => item.id))
      for (const candidate of candidates) {
        const claimed = await this.storage.transaction(this.instanceId, async transaction => {
          const next = await transaction.get<ActivationGapRecord>('activation-gap', candidate)
          if (!next || (next.state !== 'pending' && next.state !== 'unknown') || next.attempts >= maxAttempts) return undefined
          const updated: ActivationGapRecord = { ...next, state: 'releasing', attempts: next.attempts + 1, claimedAt: this.now(), updatedAt: this.now() }
          await transaction.replace('activation-gap', next.id, updated)
          return updated
        })
        if (!claimed) continue
        try {
          const result = await release.release(claimed.input, { activationId: activation.manifest.activationId, batchId,
            commandId: releaseCommandId(activation.manifest.activationId, claimed.gapId) })
          await this.storage.transaction(this.instanceId, async transaction => {
            const current = await transaction.get<ActivationGapRecord>('activation-gap', claimed.id)
            if (!current || current.state !== 'releasing') return
            await transaction.replace('activation-gap', claimed.id, { ...current, state: 'released',
              ...(result.receiptId ? { receiptId: result.receiptId } : {}), ...(result.ticketId ? { ticketId: result.ticketId } : {}),
              updatedAt: this.now() })
            const gapKey = `${switchoverGapPrefix(this.instanceId, batchId)}:${claimed.gapId}`
            const gap = await transaction.get<SwitchoverGapInput>('switchover-gap-input', gapKey)
            if (gap) await transaction.replace('switchover-gap-input', gapKey, { ...gap, state: 'released', dispatch: 'released-to-current-entry' })
          })
        } catch (error) {
          const code = errorCode(error)
          if (code === 'CORE_NOT_ACTIVE') {
            const { claimedAt: _claimedAt, ...rest } = claimed
            await this.storage.transaction(this.instanceId, transaction => transaction.replace('activation-gap', claimed.id,
              { ...rest, state: 'pending', updatedAt: this.now() }))
            throw error
          }
          const exhausted = claimed.attempts >= maxAttempts
          const { claimedAt: _claimedAt, ...rest } = claimed
          await this.storage.transaction(this.instanceId, transaction => transaction.replace('activation-gap', claimed.id,
            { ...rest, state: exhausted ? 'failed' : 'unknown', reason: `${code}: ${errorMessage(error)}`, updatedAt: this.now() }))
        }
      }

      const releases = await this.storage.transaction(this.instanceId, transaction => this.scanReleases(transaction, batchId))
      const counts = releaseCounts(releases)
      await this.storage.transaction(this.instanceId, async transaction => {
        const current = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
        if (current?.state === 'active' && current.batchId === batchId) {
          await transaction.replace('activation', activationKey(this.instanceId), { ...current, release: counts, updatedAt: this.now() })
        }
      })
      return { ...activation, release: counts, releases }
    })
  }

  private async activateIn(transaction: AsyncTx, options: ActivationOptions, view: SwitchoverView, stateRevision: number | undefined,
    fingerprintValue: string): Promise<ActivationRecord> {
    const commandKey = activationCommandKey(this.instanceId, options.commandId)
    const priorCommand = await transaction.get<{ fingerprint: string; activationId: string }>('activation-command', commandKey)
    if (priorCommand) {
      if (priorCommand.fingerprint !== fingerprintValue) throw new CoreError('IDENTITY_CONFLICT', 'This activation command was already used with different input.')
      const prior = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
      if (!prior || prior.id !== priorCommand.activationId) throw new CoreError('COMMIT_UNKNOWN', 'The activation command has no matching current record.')
      return prior
    }
    const current = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
    if (current) {
      if (current.batchId !== options.batchId || current.epoch !== options.newEpoch) throw new CoreError('ACTIVATION_CONFLICT', 'Another core entry is already active.')
      await transaction.insert('activation-command', commandKey, { fingerprint: fingerprintValue, activationId: current.manifest.activationId })
      return current
    }
    const switchover = await loadSwitchover(transaction, this.instanceId, options.batchId)
    if (!switchover || switchover.state !== view.state || switchover.blockers.length !== view.blockers.length
      || JSON.stringify(switchover.checkpoints) !== JSON.stringify(view.checkpoints)) {
      throw new CoreError('ACTIVATION_STALE', 'The quiesced record changed after its final recheck.')
    }
    quiescedEvidence(switchover)
    const lease = await transaction.get<HostLeaseRecord>('host-lease', hostLeaseKey(this.instanceId))
    if (!lease || lease.epoch !== options.newEpoch || lease.releasedAt !== undefined || lease.expiresAt <= this.now()) {
      throw new CoreError('ACTIVATION_EPOCH', 'The activation must use the current, unexpired Host epoch.')
    }
    const gaps = await this.scanGapInputs(transaction, options.batchId)
    const currentGap = gapCounts(gaps)
    if (currentGap.held !== view.buffer.held || currentGap.legacyAccepted !== view.buffer.legacyAccepted || currentGap.quarantined !== view.buffer.quarantined) {
      throw new CoreError('ACTIVATION_STALE', 'The gap buffer changed after its final recheck.')
    }
    const activationId = randomUUID()
    const manifest: ActivationManifest = {
      activationId, batchId: options.batchId, epoch: options.newEpoch, currentCore: CURRENT_CORE, switchoverId: switchover.id,
      archiveSourceDigest: switchover.archive.sourceDigest, archiveMappingDigest: switchover.archive.mappingDigest,
      ...(stateRevision === undefined ? {} : { stateRevision }), checkpoints: switchover.checkpoints.slice(-2).map(item => item.digest),
      gap: currentGap, oldReview: switchover.archive.review, entry: { host: switchover.entry.host, port: switchover.entry.port },
      ...(switchover.quiescedAt === undefined ? {} : { quiescedAt: switchover.quiescedAt }),
    }
    const activation: ActivationRecord = {
      id: activationKey(this.instanceId), instanceId: this.instanceId, batchId: options.batchId, commandId: options.commandId,
      epoch: options.newEpoch, currentCore: CURRENT_CORE, state: 'active', manifest,
      release: { planned: gaps.length, released: 0, pending: currentGap.held, unknown: 0, failed: 0,
        skipped: currentGap.legacyAccepted + currentGap.quarantined, legacyAccepted: currentGap.legacyAccepted, quarantined: currentGap.quarantined },
      activatedAt: this.now(), updatedAt: this.now(),
    }
    await transaction.insert('activation', activation.id, activation)
    await transaction.insert('activation-command', commandKey, { fingerprint: fingerprintValue, activationId })
    await transaction.insert('activation-history', `${activationHistoryPrefix(this.instanceId)}:${String(activation.activatedAt).padStart(16, '0')}:${activationId}`, activation)
    for (const gap of gaps) {
      const state: ActivationGapState = gap.state === 'held' ? 'pending' : 'skipped'
      const reason = gap.state === 'legacy-accepted' ? 'OLD_ACCEPTED' : gap.state === 'quarantined' ? 'QUARANTINED' : undefined
      const release: ActivationGapRecord = { id: activationGapKey(this.instanceId, options.batchId, gap.id), instanceId: this.instanceId,
        batchId: options.batchId, activationId, gapId: gap.id, state, attempts: 0, input: gap,
        ...(reason ? { reason } : {}), updatedAt: this.now() }
      await transaction.insert('activation-gap', release.id, release)
    }
    await transaction.replace('switchover', switchover.id, { ...switchover, state: 'active',
      entry: { ...switchover.entry, isolated: false, releasedAt: this.now() }, updatedAt: this.now() })
    return activation
  }

  private async activeIn(transaction: AsyncTx) {
    const activation = await transaction.get<ActivationRecord>('activation', activationKey(this.instanceId))
    if (!activation || activation.state !== 'active') return false
    const lease = await transaction.get<HostLeaseRecord>('host-lease', hostLeaseKey(this.instanceId))
    return Boolean(lease && lease.epoch === activation.epoch && lease.owner === hostProcessToken
      && lease.releasedAt === undefined && lease.expiresAt > this.now())
  }

  private async scanGapInputs(transaction: AsyncTx, batch: string): Promise<SwitchoverGapInput[]> {
    const prefix = switchoverGapPrefix(this.instanceId, batch)
    const items: SwitchoverGapInput[] = []
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<SwitchoverGapInput>('switchover-gap-input', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(prefix)) return items
        items.push(item.value)
      }
      if (!page.cursor || !page.cursor.startsWith(prefix)) return items
      cursor = page.cursor
    }
    throw new CoreError('ACTIVATION_BUDGET', 'The gap buffer exceeds its declared 1000-record budget.')
  }

  private async scanReleases(transaction: AsyncTx, batch: string): Promise<ActivationGapRecord[]> {
    const prefix = activationGapPrefix(this.instanceId, batch)
    const items: ActivationGapRecord[] = []
    let cursor = prefix
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<ActivationGapRecord>('activation-gap', { limit: 100, after: cursor })
      for (const item of page.items) {
        if (!item.id.startsWith(prefix)) return items
        items.push(item.value)
      }
      if (!page.cursor || !page.cursor.startsWith(prefix)) return items
      cursor = page.cursor
    }
    throw new CoreError('ACTIVATION_BUDGET', 'The activation release ledger exceeds its declared 1000-record budget.')
  }

  private validate(options: ActivationOptions) {
    if (!options || typeof options !== 'object') throw new CoreError('ACTIVATION_INPUT', 'Activation options are required.')
    identifier(options.batchId, 'batchId')
    identifier(options.commandId, 'commandId')
    if (!Number.isSafeInteger(options.newEpoch) || options.newEpoch < 1) throw new CoreError('ACTIVATION_INPUT', 'A current Host epoch is required.')
    if (!options.release || typeof options.release.release !== 'function') {
      throw new CoreError('ACTIVATION_INPUT', 'A release adapter is required.')
    }
    if (options.settleMs !== undefined && (!Number.isInteger(options.settleMs) || options.settleMs < 0 || options.settleMs > 60_000)) {
      throw new CoreError('ACTIVATION_INPUT', 'The settle window is between 0 and 60000 ms.')
    }
  }
}
