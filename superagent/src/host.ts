import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { CoreError } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { hostTakeoverKey, type HostTakeoverRecord } from './host-takeover.js'

export interface HostOptions {
  hostId?: string
  leaseMs?: number
  now?: () => number
}

export interface HostLeaseRecord {
  instanceId: string
  hostId: string
  /** The process that holds the lease. Two Engine objects in one process are one Host; another process is not. */
  owner: string
  epoch: number
  token: string
  acquiredAt: number
  renewedAt: number
  expiresAt: number
  releasedAt?: number
}

export interface HostLeaseView {
  hostId: string
  epoch: number
  token: string
  acquiredAt: number
  renewedAt: number
  expiresAt: number
  releasedAt?: number
}

export interface HostAcquisition {
  lease: HostLeaseView
  /** The lease this Host replaced. Absent when the same Host renewed or no lease existed. */
  previous?: HostLeaseView
}

const leaseKey = (instanceId: string) => JSON.stringify(['host-lease', instanceId])
const processToken = randomUUID()

export class HostLease {
  readonly hostId: string
  readonly leaseMs: number
  private readonly now: () => number
  private current: HostLeaseRecord | undefined

  constructor(private readonly storage: Storage, private readonly instanceId: string, options: HostOptions = {}) {
    this.hostId = options.hostId ?? `local:${hostname()}`
    this.leaseMs = options.leaseMs ?? 30000
    this.now = options.now ?? Date.now
    if (!this.hostId.trim() || Buffer.byteLength(this.hostId) > 512) throw new CoreError('INVALID_CONFIG', 'hostId must be a bounded nonempty identity.')
    if (!Number.isInteger(this.leaseMs) || this.leaseMs < 10 || this.leaseMs > 3600000) throw new CoreError('INVALID_CONFIG', 'The Host lease must be between 10 ms and one hour.')
  }

  guard(storage: Storage): Storage {
    return {
      transaction: <T>(instanceId: string, operation: (tx: AsyncTx) => Promise<T>) => storage.transaction(instanceId, async transaction => {
        await this.assertInTransaction(transaction)
        return operation(transaction)
      }),
      reconnect: async () => this.guard(await storage.reconnect()),
      close: () => storage.close(),
    }
  }

  /** Explicit acquisition is the only path that may take over an expired lease. */
  acquire(): Promise<HostLeaseView> {
    return this.acquireWithPrevious().then(acquired => acquired.lease)
  }

  /**
   * Advances the epoch and writes the pending takeover record in one transaction. New admission checks that
   * record, so another process cannot accept work between the lease change and the reconciliation.
   */
  acquireWithPrevious(): Promise<HostAcquisition> {
    return this.storage.transaction(this.instanceId, async transaction => {
      const existing = await transaction.get<HostLeaseRecord>('host-lease', leaseKey(this.instanceId))
      const now = this.now()
      const mine = Boolean(existing && existing.owner === processToken && existing.hostId === this.hostId
        && existing.releasedAt === undefined)
      // A live process, including one that reuses the same stable Host ID, never shares an unexpired lease.
      if (existing && !mine && existing.expiresAt > now) {
        throw new CoreError('HOST_LEASED', 'Another Host holds an unexpired instance lease.')
      }
      const record: HostLeaseRecord = existing && mine
        ? { ...existing, renewedAt: now, expiresAt: now + this.leaseMs }
        : {
            instanceId: this.instanceId, hostId: this.hostId, owner: processToken, epoch: (existing?.epoch ?? 0) + 1, token: randomUUID(),
            acquiredAt: now, renewedAt: now, expiresAt: now + this.leaseMs,
          }
      if (!await transaction.replace('host-lease', leaseKey(this.instanceId), record)) await transaction.insert('host-lease', leaseKey(this.instanceId), record)
      // A released lease is a clean stop, not an active Host to replace. Only a lapsed lease may still be
      // running somewhere, so only that one needs its work reconciled before the new epoch accepts work.
      const previous = existing && !mine && existing.releasedAt === undefined ? this.view(existing) : undefined
      if (previous) {
        const takeover: HostTakeoverRecord = { id: hostTakeoverKey(this.instanceId, record.epoch), instanceId: this.instanceId,
          epoch: record.epoch, previousHostId: previous.hostId, previousEpoch: previous.epoch, previousToken: previous.token,
          state: 'pending', startedAt: now, tickets: [] }
        if (!await transaction.replace('host-takeover', takeover.id, takeover)) await transaction.insert('host-takeover', takeover.id, takeover)
      }
      this.current = record
      return { lease: this.view(record), ...(previous ? { previous } : {}) }
    })
  }

  async assertInTransaction(transaction: AsyncTx): Promise<HostLeaseRecord> {
    const existing = await transaction.get<HostLeaseRecord>('host-lease', leaseKey(this.instanceId))
    const now = this.now()
    if (!this.current) {
      if (existing) {
        if (existing.owner === processToken && existing.hostId === this.hostId && existing.releasedAt === undefined) {
          const record: HostLeaseRecord = { ...existing, renewedAt: now, expiresAt: now + this.leaseMs }
          if (!await transaction.replace('host-lease', leaseKey(this.instanceId), record)) await transaction.insert('host-lease', leaseKey(this.instanceId), record)
          this.current = record
          return record
        }
        if (existing.owner === processToken && existing.hostId === this.hostId) {
          // This process ended its lease cleanly; another Engine in the same process continues the next epoch.
          const { releasedAt: _released, ...previous } = existing
          const record: HostLeaseRecord = { ...previous, epoch: existing.epoch + 1, token: randomUUID(), acquiredAt: now,
            renewedAt: now, expiresAt: now + this.leaseMs }
          if (!await transaction.replace('host-lease', leaseKey(this.instanceId), record)) await transaction.insert('host-lease', leaseKey(this.instanceId), record)
          this.current = record
          return record
        }
        if (existing.expiresAt > now) throw new CoreError('HOST_LEASED', 'Another Host owns the current instance lease; acquire it explicitly.')
        throw new CoreError('HOST_LEASE_EXPIRED', 'The previous Host lease ended; acquire a fresh epoch explicitly.')
      }
      const bootstrap: HostLeaseRecord = { instanceId: this.instanceId, hostId: this.hostId, owner: processToken, epoch: 1, token: randomUUID(),
        acquiredAt: now, renewedAt: now, expiresAt: now + this.leaseMs }
      if (!await transaction.replace('host-lease', leaseKey(this.instanceId), bootstrap)) await transaction.insert('host-lease', leaseKey(this.instanceId), bootstrap)
      this.current = bootstrap
      return bootstrap
    }
    if (!existing) {
      // The transaction that created this lease rolled back; this process never actually held it.
      const record: HostLeaseRecord = { ...this.current, renewedAt: now, expiresAt: now + this.leaseMs }
      if (!await transaction.replace('host-lease', leaseKey(this.instanceId), record)) await transaction.insert('host-lease', leaseKey(this.instanceId), record)
      this.current = record
      return record
    }
    if (existing.token !== this.current.token || existing.epoch !== this.current.epoch) {
      throw new CoreError('HOST_LEASED', 'Another Host has replaced this Host lease.')
    }
    const record: HostLeaseRecord = { ...existing, renewedAt: now, expiresAt: now + this.leaseMs }
    if (!await transaction.replace('host-lease', leaseKey(this.instanceId), record)) await transaction.insert('host-lease', leaseKey(this.instanceId), record)
    this.current = record
    return record
  }

  async currentLease(): Promise<HostLeaseView | undefined> {
    const record = await this.storage.transaction(this.instanceId, transaction => transaction.get<HostLeaseRecord>('host-lease', leaseKey(this.instanceId)))
    return record ? this.view(record) : undefined
  }

  async release(): Promise<void> {
    await this.storage.transaction(this.instanceId, async transaction => {
      const existing = await transaction.get<HostLeaseRecord>('host-lease', leaseKey(this.instanceId))
      if (!existing || existing.hostId !== this.hostId || existing.token !== this.current?.token) return
      const now = this.now()
      await transaction.replace('host-lease', leaseKey(this.instanceId), { ...existing, releasedAt: now, expiresAt: Math.min(existing.expiresAt, now) })
      this.current = undefined
    })
  }

  epoch(): number | undefined { return this.current?.epoch }

  private view(record: HostLeaseRecord): HostLeaseView {
    return { hostId: record.hostId, epoch: record.epoch, token: record.token, acquiredAt: record.acquiredAt,
      renewedAt: record.renewedAt, expiresAt: record.expiresAt, ...(record.releasedAt === undefined ? {} : { releasedAt: record.releasedAt }) }
  }
}
