import type { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionOwnershipLostError,
  SessionPersistence,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import { CoreError } from './model.js'
import { SqliteStorage, type AsyncTx, type Storage } from './storage.js'

const storeNamespace = 'session-store'
const maxEventPages = 10000
const eventPageSize = 100

interface StoredSessionMeta {
  header: SessionHeader
  inheritedEventCount: number
  nextSeq: number
  revision: number
  updatedAt: number
}

interface StoredWriter {
  sessionId: string
  epoch: number
  active: boolean
  /** Process that took this write claim; a dead pid is the crash signal. */
  pid: number
}

const metaKey = (id: string) => JSON.stringify(['session-meta', id])
const writerKey = (id: string) => JSON.stringify(['session-writer', id])
const eventPrefix = (id: string) => `${JSON.stringify(['session-event', id])}:`
const eventKey = (id: string, seq: number) => `${eventPrefix(id)}${String(seq).padStart(12, '0')}`

function snapshot(meta: StoredSessionMeta): SessionPersistenceSnapshot {
  return { header: structuredClone(meta.header), revision: SessionPersistenceRevision(`${meta.revision}:${meta.nextSeq}`), eventCount: meta.nextSeq }
}

async function readMeta(transaction: AsyncTx, id: SessionId): Promise<StoredSessionMeta | undefined> {
  const key = String(id)
  const meta = await transaction.get<StoredSessionMeta>('session-meta', metaKey(key))
  if (meta === undefined) return undefined
  assertStoredId(id, meta.header)
  assertVersion(meta.header)
  return meta
}

async function requireMeta(transaction: AsyncTx, id: SessionId): Promise<StoredSessionMeta> {
  const meta = await readMeta(transaction, id)
  if (meta === undefined) throw new SessionPersistenceNotFoundError(id)
  return meta
}

async function readEvents(transaction: AsyncTx, id: SessionId, meta: StoredSessionMeta): Promise<SessionEvent[]> {
  const key = String(id)
  const prefix = eventPrefix(key)
  const events: SessionEvent[] = []
  let cursor = prefix
  for (let pageCount = 0; pageCount < maxEventPages; pageCount++) {
    const page = await transaction.scan<SessionEvent>('session-event', { limit: eventPageSize, after: cursor })
    for (const item of page.items) if (item.id.startsWith(prefix)) events.push(item.value)
    if (!page.cursor || !page.cursor.startsWith(prefix)) break
    cursor = page.cursor
    if (pageCount === maxEventPages - 1) throw new CoreError('SESSION_EVENT_BUDGET', 'The Session log exceeds its declared query budget.')
  }
  const validated = validateStoredEvents(meta.header, events)
  if (validated.length !== meta.nextSeq) throw new SessionPersistenceCorruptionError(`stored session "${id}" has ${validated.length} events but its header records ${meta.nextSeq}`, {})
  try { assertContiguous(id, validated, 0) }
  catch (error) { throw new SessionPersistenceCorruptionError(`stored session "${id}" is not contiguous: ${String(error)}`, { cause: error }) }
  return validated
}

async function readWriter(transaction: AsyncTx, id: SessionId): Promise<StoredWriter | undefined> {
  return transaction.get<StoredWriter>('session-writer', writerKey(String(id)))
}

function assertActiveWriter(id: SessionId, writer: StoredWriter | undefined, epoch: number) {
  if (writer === undefined || writer.sessionId !== String(id) || !writer.active || writer.epoch !== epoch) throw new SessionOwnershipLostError(id)
}

function ownerIsAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

class SqliteSessionHandle implements SessionHandle {
  readonly inheritedEventCount: SessionLogOffset
  private observedLength = 0
  private closed = false
  private closing: Promise<void> | undefined
  private materialized = false
  private liveChain = Promise.resolve()
  private liveError: unknown
  constructor(private readonly storage: Storage, readonly id: SessionId,
    readonly header: SessionHeader, inheritedEventCount: number, readonly access: SessionAccess, private readonly epoch: number,
    private readonly created: boolean, private readonly release: () => void) {
    this.inheritedEventCount = SessionLogOffset(inheritedEventCount)
  }

  private assertOpen(operation: string) {
    if (this.closed) throw new SessionHandleClosedError(this.id, operation)
  }

  private assertWritable(operation: string) {
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, operation)
  }

  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: { signal?: AbortSignal }) {
    this.assertOpen('read')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('read offset must be a non-negative safe integer')
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('read length must be a non-negative safe integer')
    options?.signal?.throwIfAborted()
    return this.storage.transaction(storeNamespace, async transaction => {
      const meta = await requireMeta(transaction, this.id)
      const events = await readEvents(transaction, this.id, meta)
      if (events.length < this.observedLength) throw new Error(`session "${this.id}": stored log shrank below an observed prefix`)
      this.observedLength = events.length
      return { eventState: 'shared-frozen' as const, events: events.slice(offset, offset + Math.min(length, events.length)) }
    })
  }

  async append(events: readonly SessionEvent[], options?: { signal?: AbortSignal }) {
    this.assertOpen('append')
    this.assertWritable('append')
    options?.signal?.throwIfAborted()
    const batch = materializeAppendBatch(events) as SessionEvent[]
    let committedLength = 0
    await this.storage.transaction(storeNamespace, async transaction => {
      const meta = await requireMeta(transaction, this.id)
      await this.assertWriter(transaction)
      if (this.liveError) throw this.liveError
      assertContiguous(this.id, batch, meta.nextSeq)
      for (const event of batch) await transaction.insert('session-event', eventKey(String(this.id), event.seq), event)
      committedLength = meta.nextSeq + batch.length
      await transaction.replace('session-meta', metaKey(String(this.id)), { ...meta, nextSeq: committedLength,
        revision: meta.revision + 1, updatedAt: Date.now() })
    })
    this.materialized = true
    this.observedLength = Math.max(this.observedLength, committedLength)
  }

  async flush(options?: { signal?: AbortSignal }) {
    this.assertOpen('flush')
    this.assertWritable('flush')
    options?.signal?.throwIfAborted()
    await this.drainLive()
    await this.storage.transaction(storeNamespace, async transaction => {
      const meta = await requireMeta(transaction, this.id)
      await this.assertWriter(transaction)
      await transaction.replace('session-meta', metaKey(String(this.id)), { ...meta, revision: meta.revision + 1, updatedAt: Date.now() })
    })
    this.materialized = true
  }

  async close(): Promise<void> {
    if (this.closed) return
    const attempt = this.closing ??= this.closeOnce()
    try { await attempt } finally { if (this.closing === attempt) this.closing = undefined }
  }

  private async closeOnce() {
    if (this.access === 'read') { this.closed = true; this.release(); return }
    await this.drainLive()
    await this.storage.transaction(storeNamespace, async transaction => {
      const meta = await requireMeta(transaction, this.id)
      const writer = await readWriter(transaction, this.id)
      assertActiveWriter(this.id, writer, this.epoch)
      if (this.created && !this.materialized) {
        await transaction.remove('session-writer', writerKey(String(this.id)))
        await transaction.remove('session-meta', metaKey(String(this.id)))
      } else {
        await transaction.replace('session-writer', writerKey(String(this.id)), { ...writer!, active: false })
        await transaction.replace('session-meta', metaKey(String(this.id)), { ...meta, updatedAt: Date.now() })
      }
    })
    this.closed = true
    this.release()
  }

  async [Symbol.asyncDispose]() { await this.close() }

  enqueueLive(event: SessionEvent) {
    if (this.liveError) return
    this.liveChain = this.liveChain.then(async () => {
      try { await this.append([event]) }
      catch (error) { this.liveError ??= error }
    })
  }

  private async drainLive() {
    await this.liveChain
    if (this.liveError) throw this.liveError
  }

  private async assertWriter(transaction: AsyncTx) {
    assertActiveWriter(this.id, await readWriter(transaction, this.id), this.epoch)
  }
}

/** SQLite-backed SessionPersistence implementation. It uses the same durable transaction worker as the domain store. */
export class SqliteSessionPersistence extends SessionPersistence {
  private readonly writers = new Map<string, SqliteSessionHandle>()
  private readonly openHandles = new Set<SqliteSessionHandle>()
  private closed = false
  constructor(private readonly context: Context, private readonly storage: Storage) {
    super(context)
  }

  async create(header: SessionHeader, options?: { signal?: AbortSignal; inheritedEventCount?: SessionLogOffset }) {
    this.assertOpen()
    options?.signal?.throwIfAborted()
    const value = materializeCreateHeader(header)
    assertVersion(value)
    const inherited = options?.inheritedEventCount ?? 0
    if (value.isSeeded && (!Number.isSafeInteger(inherited) || inherited < 1)) throw new TypeError('a seeded Session needs its inherited event count')
    if (!value.isSeeded && inherited !== 0) throw new TypeError('an unseeded Session cannot inherit an event prefix')
    const id = String(value.id)
    const handle = await this.storage.transaction(storeNamespace, async transaction => {
      if (await readMeta(transaction, value.id)) throw new SessionAlreadyExistsError(value.id)
      const meta: StoredSessionMeta = { header: structuredClone(value), inheritedEventCount: inherited, nextSeq: 0, revision: 1, updatedAt: Date.now() }
      const writer: StoredWriter = { sessionId: id, epoch: 1, active: true, pid: process.pid }
      await transaction.insert('session-meta', metaKey(id), meta)
      await transaction.insert('session-writer', writerKey(id), writer)
      let handle: SqliteSessionHandle
      handle = new SqliteSessionHandle(this.storage, value.id, value, inherited, 'write', writer.epoch, true, () => {
        this.writers.delete(id)
        this.openHandles.delete(handle)
      })
      return handle
    })
    this.writers.set(id, handle)
    this.openHandles.add(handle)
    return handle
  }

  async open(id: SessionId, access: SessionAccess, options?: { signal?: AbortSignal }) {
    this.assertOpen()
    options?.signal?.throwIfAborted()
    const result = await this.storage.transaction(storeNamespace, async transaction => {
      const meta = await requireMeta(transaction, id)
      if (access === 'read') return { meta, epoch: 0 }
      await readEvents(transaction, id, meta)
      const writer = await readWriter(transaction, id)
      if (writer?.active && ownerIsAlive(writer.pid)) throw new SessionAlreadyOwnedError(id)
      const next: StoredWriter = { sessionId: String(id), epoch: (writer?.epoch ?? 0) + 1, active: true, pid: process.pid }
      await transaction.replace('session-writer', writerKey(String(id)), next)
      return { meta, epoch: next.epoch }
    })
    let handle: SqliteSessionHandle
    handle = new SqliteSessionHandle(this.storage, id, result.meta.header, result.meta.inheritedEventCount,
      access, result.epoch, false, () => {
        if (access === 'write') this.writers.delete(String(id))
        this.openHandles.delete(handle)
      })
    this.openHandles.add(handle)
    if (access === 'write') this.writers.set(String(id), handle)
    return handle
  }

  async flush() {
    this.assertOpen()
    const errors: unknown[] = []
    for (const handle of this.openHandles) {
      if (handle.access !== 'write') continue
      try { await handle.flush() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Session persistence flush failed')
  }

  async stat(id: SessionId, options?: { signal?: AbortSignal }) {
    this.assertOpen()
    options?.signal?.throwIfAborted()
    return this.storage.transaction(storeNamespace, async transaction => {
      const meta = await readMeta(transaction, id)
      return meta === undefined ? undefined : snapshot(meta)
    })
  }

  async list(options?: { signal?: AbortSignal }) {
    this.assertOpen()
    options?.signal?.throwIfAborted()
    return this.storage.transaction(storeNamespace, async transaction => {
      const snapshots: SessionPersistenceSnapshot[] = []
      let cursor: string | undefined
      for (let pageCount = 0; pageCount < maxEventPages; pageCount++) {
        const page = await transaction.scan<StoredSessionMeta>('session-meta', { limit: eventPageSize, ...(cursor === undefined ? {} : { after: cursor }) })
        for (const item of page.items) snapshots.push(snapshot(item.value))
        if (!page.cursor) break
        cursor = page.cursor
        if (pageCount === maxEventPages - 1) throw new CoreError('SESSION_QUERY_BUDGET', 'The Session list exceeds its declared query budget.')
      }
      return snapshots
    })
  }

  enqueueLive(id: SessionId, event: SessionEvent) {
    this.writers.get(String(id))?.enqueueLive(event)
  }

  flushSession(id: SessionId) {
    return this.writers.get(String(id))?.flush()
  }

  disposeSession(id: SessionId) {
    const handle = this.writers.get(String(id))
    if (!handle) return
    void handle.close().catch(error => this.context.logger.warn(`session-persistence-sqlite: final drain for session "${id}" failed: ${String(error)}`))
  }

  async close() {
    if (this.closed) return
    const errors: unknown[] = []
    const handles = Array.from(this.openHandles)
    for (const handle of handles) {
      try { await handle.close() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Session persistence dispose failed')
    this.closed = true
    this.writers.clear()
    this.openHandles.clear()
  }

  private assertOpen() {
    if (this.closed) throw new CoreError('RUNTIME_CLOSED', 'The Session persistence service is closed.')
  }
}

export interface Config { databasePath: string }
export const name = 'session-persistence-sqlite'

export async function apply(ctx: Context, config: Config) {
  if (typeof config?.databasePath !== 'string') throw new CoreError('INVALID_CONFIG', 'A Session persistence database path is required.')
  const storage = await SqliteStorage.open(config.databasePath)
  let provider: SqliteSessionPersistence | undefined
  let fiber: ReturnType<Context['plugin']> | undefined
  try {
    ctx.effect(function* () {
      yield async () => {
        try { await provider?.close() } finally { await storage.close() }
      }
      fiber = ctx.plugin({
        name: 'session-persistence-sqlite-service',
        apply(serviceCtx) { provider = new SqliteSessionPersistence(serviceCtx, storage) },
      })
      yield ctx.on('session/event', (session, event) => provider?.enqueueLive(session.id, event))
      yield ctx.on('session/flush', session => provider?.flushSession(session.id))
      yield ctx.on('session/disposed', session => provider?.disposeSession(session.id))
      yield fiber.dispose
    }, 'session-persistence-sqlite resources')
    if (!fiber) throw new CoreError('SETUP_FAILED', 'The Session persistence service did not start.')
    await fiber.await()
  } catch (error) {
    await storage.close().catch(() => {})
    throw error
  }
}
