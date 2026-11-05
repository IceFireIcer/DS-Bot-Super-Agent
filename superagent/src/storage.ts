import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { CoreError, identifier, type RecordKind } from './model.js'

export interface AsyncTx {
  readonly instanceId: string
  get<T>(kind: RecordKind, id: string): Promise<T | undefined>
  insert<T>(kind: RecordKind, id: string, value: T): Promise<void>
  list<T>(kind: RecordKind, limit: number): Promise<T[]>
  replace<T>(kind: RecordKind, id: string, value: T): Promise<boolean>
  remove(kind: RecordKind, id: string): Promise<boolean>
  scan<T>(kind: RecordKind, options: { limit: number; after?: string }): Promise<{ items: { id: string; value: T }[]; cursor?: string }>
}

export interface Storage {
  transaction<T>(instanceId: string, operation: (tx: AsyncTx) => Promise<T>): Promise<T>
  reconnect(): Promise<Storage>
  close(): Promise<void>
}

export interface SqliteOptions { busyTimeoutMs?: number; maxQueuedTransactions?: number }
interface Reply { id: number; value?: unknown; error?: { code: string; message: string } }

export class SqliteStorage implements Storage {
  private readonly worker: Worker
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private sequence = 0
  private tail: Promise<unknown> = Promise.resolve()
  private queued = 0
  private closed = false
  private failure: Error | undefined
  private closing: Promise<void> | undefined
  private constructor(private readonly databasePath: string, private readonly capacity: number, private readonly busyTimeoutMs: number) {
    this.worker = new Worker(new URL('./sqlite-worker.js', import.meta.url), { workerData: { databasePath, busyTimeoutMs } })
    this.worker.on('message', (reply: Reply) => {
      const deferred = this.pending.get(reply.id)
      if (!deferred) return
      this.pending.delete(reply.id)
      if (reply.error) deferred.reject(new CoreError(reply.error.code, reply.error.message))
      else deferred.resolve(reply.value)
    })
    const fail = (error: Error) => {
      this.failure = error
      for (const deferred of this.pending.values()) deferred.reject(error)
      this.pending.clear()
    }
    this.worker.on('error', () => fail(new CoreError('STORAGE_UNAVAILABLE', 'The storage worker failed; query the original command receipt before retrying.')))
    this.worker.on('exit', () => fail(new CoreError('STORAGE_UNAVAILABLE', 'The storage worker exited; the commit outcome may be unknown.')))
  }

  static async open(databasePath: string, options: SqliteOptions = {}): Promise<SqliteStorage> {
    if (!isAbsolute(databasePath)) throw new CoreError('INVALID_CONFIG', 'databasePath must be an explicit absolute isolated database path.')
    const capacity = options.maxQueuedTransactions ?? 128
    const timeout = options.busyTimeoutMs ?? 250
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024 || !Number.isInteger(timeout) || timeout < 1 || timeout > 5000) {
      throw new CoreError('INVALID_CONFIG', 'Invalid SQLite queue or lock budget.')
    }
    const storage = new SqliteStorage(databasePath, capacity, timeout)
    try { await storage.rpc('ready'); return storage }
    catch (error) { await storage.worker.terminate(); throw error }
  }

  private rpc(method: string, args: unknown = {}): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, method, args })
    })
  }

  transaction<T>(instanceId: string, operation: (tx: AsyncTx) => Promise<T>): Promise<T> {
    identifier(instanceId, 'instanceId')
    if (this.closed) return Promise.reject(new CoreError('STORAGE_CLOSED', 'The storage is closed.'))
    if (this.queued >= this.capacity) return Promise.reject(new CoreError('QUEUE_FULL', 'The transaction queue is full; no request has been accepted.'))
    this.queued++
    const run = this.tail.then(async () => {
      const transactionId = randomUUID()
      await this.rpc('begin', { instanceId, transactionId })
      let active = true
      const request = async (method: string, values: object) => {
        if (!active) throw new CoreError('TRANSACTION_CLOSED', 'The transaction capability has expired.')
        return this.rpc(method, { transactionId, ...values })
      }
      const tx: AsyncTx = {
        instanceId,
        get: async <V>(kind: RecordKind, id: string) => await request('get', { kind, key: id }) as V | undefined,
        insert: async (kind, id, value) => { await request('insert', { kind, key: id, body: JSON.stringify(value) }) },
        list: async <V>(kind: RecordKind, limit: number) => await request('list', { kind, limit }) as V[],
        replace: async (kind, id, value) => await request('replace', { kind, key: id, body: JSON.stringify(value) }) as boolean,
        remove: async (kind, id) => await request('remove', { kind, key: id }) as boolean,
        scan: async <V>(kind: RecordKind, options: { limit: number; after?: string }) => await request('scan', { kind, ...options }) as { items: { id: string; value: V }[]; cursor?: string },
      }
      try {
        const result = await operation(tx)
        active = false
        try { await this.rpc('commit', { transactionId }) }
        catch { throw new CoreError('COMMIT_UNKNOWN', 'The COMMIT outcome is unknown; reconcile the original command on a fresh locked connection.') }
        return result
      } catch (error) {
        active = false
        try { await this.rpc('rollback', { transactionId }) } catch { /* The original error retains any unknown commit outcome. */ }
        throw error
      }
    })
    const settled = run.finally(() => { this.queued-- })
    this.tail = settled.catch(() => {})
    return settled
  }

  reconnect(): Promise<Storage> {
    return SqliteStorage.open(this.databasePath, { maxQueuedTransactions: this.capacity, busyTimeoutMs: this.busyTimeoutMs })
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this.tail.then(async () => {
      try { await this.rpc('close') } finally { await this.worker.terminate() }
    })
    return this.closing
  }
}
