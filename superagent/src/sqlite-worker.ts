import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync, backup } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { CoreError, recordKinds, type RecordKind } from './model.js'

const port = parentPort!
let db: DatabaseSync | undefined
let startupError: unknown
try {
  db = new DatabaseSync(workerData.databasePath)
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (![0, 1, 2].includes(version)) throw new CoreError('UNSUPPORTED_SCHEMA', 'This database schema is not supported; no migration was attempted.')
  if (version === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND type IN ('table', 'view') LIMIT 1").get()) {
    throw new CoreError('UNSUPPORTED_SCHEMA', 'The unversioned database already contains application data; it was left unchanged.')
  }
  if (version !== 0) {
    const columns = db.prepare('PRAGMA table_info(records)').all().map(column => String(column.name))
    if (JSON.stringify(columns) !== JSON.stringify(['instance_id', 'kind', 'id', 'body'])) throw new CoreError('UNSUPPORTED_SCHEMA', 'The versioned records schema is not supported.')
  }
  if (version === 1) {
    const backupPath = `${workerData.databasePath}.before-v2-${randomUUID()}.sqlite`
    await backup(db, backupPath)
    const saved = new DatabaseSync(backupPath, { readOnly: true })
    try {
      if (saved.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' || saved.prepare('PRAGMA user_version').get()!.user_version !== 1) throw new CoreError('BACKUP_FAILED', 'The pre-upgrade backup could not be verified.')
    } finally { saved.close() }
  }
  db.exec(`PRAGMA busy_timeout=${workerData.busyTimeoutMs}; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;`)
  db.exec('BEGIN IMMEDIATE')
  const lockedVersion = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (![0, 1, 2].includes(lockedVersion)) throw new CoreError('UNSUPPORTED_SCHEMA', 'The schema changed before the migration lock was acquired.')
  db.exec('CREATE TABLE IF NOT EXISTS records (instance_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(instance_id, kind, id)); PRAGMA user_version=2; COMMIT;')
} catch (error) { startupError = error; db?.close(); db = undefined }
let current: { transactionId: string; instanceId: string } | undefined

interface Args { transactionId: string; instanceId: string; kind: RecordKind; key: string; body: string; limit: number; after?: string }

function execute(method: string, args: Args): unknown {
  if (startupError) throw startupError
  if (!db) throw new CoreError('STORAGE_CLOSED', 'The database is closed.')
  if (method === 'ready') return true
  if (method === 'close') { db.close(); return true }
  if (method === 'begin') {
    if (current) throw new CoreError('TRANSACTION_ACTIVE', 'A transaction is already active.')
    db.exec('BEGIN IMMEDIATE')
    current = { transactionId: args.transactionId, instanceId: args.instanceId }
    return true
  }
  if (!current || current.transactionId !== args.transactionId) throw new CoreError('TRANSACTION_CLOSED', 'Invalid transaction capability.')
  if (method === 'commit' || method === 'rollback') {
    db.exec(method.toUpperCase())
    current = undefined
    return true
  }
  if (!recordKinds.includes(args.kind)) throw new CoreError('INVALID_INPUT', 'Unknown record kind.')
  const instanceId = current.instanceId
  if (method === 'get') {
    const row = db.prepare('SELECT body FROM records WHERE instance_id=? AND kind=? AND id=?').get(instanceId, args.kind, args.key)
    return row ? JSON.parse(String(row.body)) : undefined
  }
  if (method === 'insert' || method === 'replace') {
    if (typeof args.body !== 'string' || Buffer.byteLength(args.body) > 131072) throw new CoreError('INVALID_INPUT', 'Record exceeds storage limits.')
    if (method === 'replace') return db.prepare('UPDATE records SET body=? WHERE instance_id=? AND kind=? AND id=?').run(args.body, instanceId, args.kind, args.key).changes === 1
    db.prepare('INSERT INTO records(instance_id, kind, id, body) VALUES(?, ?, ?, ?)').run(instanceId, args.kind, args.key, args.body)
    return true
  }
  if (method === 'remove') return db.prepare('DELETE FROM records WHERE instance_id=? AND kind=? AND id=?').run(instanceId, args.kind, args.key).changes === 1
  if (method === 'scan') {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 101 || args.after !== undefined && typeof args.after !== 'string') throw new CoreError('INVALID_INPUT', 'Invalid bounded scan options.')
    const rows = args.after === undefined
      ? db.prepare('SELECT id, body FROM records WHERE instance_id=? AND kind=? ORDER BY id LIMIT ?').all(instanceId, args.kind, args.limit + 1)
      : db.prepare('SELECT id, body FROM records WHERE instance_id=? AND kind=? AND id>? ORDER BY id LIMIT ?').all(instanceId, args.kind, args.after, args.limit + 1)
    const items = rows.slice(0, args.limit).map(row => ({ id: String(row.id), value: JSON.parse(String(row.body)) }))
    return { items, ...(rows.length > args.limit ? { cursor: items.at(-1)!.id } : {}) }
  }
  if (method === 'list') {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 101) throw new CoreError('INVALID_INPUT', 'Query limit must be between 1 and 101.')
    return db.prepare('SELECT body FROM records WHERE instance_id=? AND kind=? ORDER BY rowid LIMIT ?').all(instanceId, args.kind, args.limit).map(row => JSON.parse(String(row.body)))
  }
  throw new CoreError('INVALID_INPUT', 'Unknown storage operation.')
}

port.on('message', ({ id, method, args }) => {
  try { port.postMessage({ id, value: execute(method, args) }) }
  catch (error) {
    const problem = error as Error & { code?: string; errcode?: number }
    const code = problem.errcode === 5 ? 'LOCK_TIMEOUT' : problem.code ?? 'STORAGE_ERROR'
    port.postMessage({ id, error: { code, message: problem.message } })
  }
})
