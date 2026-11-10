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
      if (existing && existing.hostId !== this.hostId && existing.expiresAt > now) {
        throw new CoreError('HOST_LEASED', 'Another Host holds an unexpired instance lease.')
      }
      const record: HostLeaseRecord = existing && existing.hostId === this.hostId
        ? { ...existing, renewedAt: now, expiresAt: now + this.leaseMs }
        : {
            instanceId: this.instanceId, hostId: this.hostId, epoch: (existing?.epoch ?? 0) + 1, token: randomUUID(),
            acquiredAt: now, renewedAt: now, expiresAt: now + this.leaseMs,
          }
      if (!await transaction.replace('host-lease', leaseKey(this.instanceId), record)) await transaction.insert('host-lease', leaseKey(this.instanceId), record)
      const previous = existing && existing.hostId !== this.hostId ? this.view(existing) : undefined
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
    if (existing && existing.hostId !== this.hostId) {
      if (existing.expiresAt <= now) throw new CoreError('HOST_LEASE_EXPIRED', 'The previous Host lease expired; acquire a fresh epoch explicitly.')
      throw new CoreError('HOST_LEASED', 'Another Host owns the current instance lease.')
    }
    const record: HostLeaseRecord = existing
      ? { ...existing, renewedAt: now, expiresAt: now + this.leaseMs }
      : { instanceId: this.instanceId, hostId: this.hostId, epoch: 1, token: randomUUID(),
          acquiredAt: now, renewedAt: now, expiresAt: now + this.leaseMs }
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
