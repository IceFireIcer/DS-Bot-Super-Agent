import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import { CoreError, identifier, recordKinds, type RecordKind } from './model.js'
import { validateQueryLimit, validateStoredRecord } from './storage-limits.js'
import type { AsyncTx, Storage, WriterLease } from './storage.js'

export interface PostgresOptions {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean
  maxConnections?: number
  lockTimeoutMs?: number
  statementTimeoutMs?: number
  /** Absolute directory that receives a verified logical backup before an unsupported-version upgrade. */
  backupDirectory?: string
}

interface ResolvedPostgresOptions {
  connectionString?: string
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
  maxConnections: number
  lockTimeoutMs: number
  statementTimeoutMs: number
  backupDirectory?: string
}

const schemaVersion = 1
const metaTable = 'ds_superagent_meta'
const recordsTable = 'ds_superagent_records'
const instancesTable = 'ds_superagent_instances'
const legacyRecordsTable = 'records'

export class PostgresStorage implements Storage {
  private closed = false
  private closing: Promise<void> | undefined
  private leasePool: Pool | undefined
  private readonly leases = new Set<WriterLease>()
  private constructor(private readonly pool: Pool, private readonly options: ResolvedPostgresOptions) {}

  static async open(options: PostgresOptions): Promise<PostgresStorage> {
    const resolved = resolveOptions(options)
    const pool = createPool(resolved, 'ds-superagent')
    pool.on('connect', client => client.on('error', () => {}))
    pool.on('error', () => {})
    try {
      await initialiseSchema(pool, resolved)
      return new PostgresStorage(pool, resolved)
    } catch (error) {
      await pool.end().catch(() => {})
      throw error
    }
  }

  async transaction<T>(instanceId: string, operation: (tx: AsyncTx) => Promise<T>): Promise<T> {
    identifier(instanceId, 'instanceId')
    if (this.closed) throw new CoreError('STORAGE_CLOSED', 'The storage is closed.')
    const client = await this.pool.connect().catch(error => { throw translateError(error) })
    let released = false
    try {
      await configureConnection(client, this.options)
      // The coordinator row exists before the command lock; concurrent first commands converge on the same row.
      await client.query(`INSERT INTO ${instancesTable}(instance_id) VALUES($1) ON CONFLICT(instance_id) DO NOTHING`, [instanceId])
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await client.query(`SET LOCAL lock_timeout='${this.options.lockTimeoutMs}ms'; SET LOCAL statement_timeout='${this.options.statementTimeoutMs}ms'`)
      const locked = await client.query(`SELECT instance_id FROM ${instancesTable} WHERE instance_id=$1 FOR UPDATE`, [instanceId])
      if (locked.rowCount !== 1) throw new CoreError('INSTANCE_NOT_COORDINATED', 'The Instance coordinator row does not exist.')
      const tx = new PostgresTransaction(client, instanceId)
      let result: T
      try { result = await operation(tx) }
      finally { tx.expire() }
      try {
        const committed = await client.query('COMMIT')
        if (committed.command !== 'COMMIT') throw new CoreError('TRANSACTION_ABORTED', 'The PostgreSQL transaction was rolled back.')
      }
      catch (error) {
        if (error instanceof CoreError || /^[0-9A-Z]{5}$/u.test((error as { code?: string }).code ?? '') && !connectionFailure(error)) throw translateError(error)
        client.release(error as Error)
        released = true
        throw new CoreError('COMMIT_UNKNOWN', 'The COMMIT outcome is unknown; reconcile the original command on a fresh locked connection.')
      }
      return result
    } catch (error) {
      if (!released) {
        try { await client.query('ROLLBACK') }
        catch { released = true; client.release(error as Error) }
      }
      if (error instanceof CoreError) throw error
      if (connectionFailure(error)) {
        throw new CoreError('COMMIT_UNKNOWN', 'The PostgreSQL connection failed; the commit outcome is unknown.')
      }
      // A callback may throw a domain error (a Session ownership or format error, a validation TypeError);
      // only server errors are the storage layer's to translate.
      if (isServerError(error)) throw translateError(error)
      throw error
    } finally {
      if (!released) client.release()
    }
  }

  reconnect(): Promise<Storage> {
    return PostgresStorage.open({ ...this.options, ...(this.options.backupDirectory ? { backupDirectory: this.options.backupDirectory } : {}) })
  }

  async acquireWriterLease(key: string): Promise<WriterLease | undefined> {
    if (this.closed) throw new CoreError('STORAGE_CLOSED', 'The storage is closed.')
    if (typeof key !== 'string' || !key || key.length > 512) throw new CoreError('INVALID_INPUT', 'A writer lease key is required.')
    this.leasePool ??= createPool(this.options, 'ds-superagent-lease')
    const client = await this.leasePool.connect().catch(error => { throw translateError(error) })
    const name = `ds-superagent-session-writer:${key}`
    let handedOff = false
    try {
      const result = await client.query<{ locked: boolean; pid: number }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked, pg_backend_pid() AS pid', [name])
      if (!result.rows[0]?.locked) {
        client.release()
        return undefined
      }
      let active = true
      let released = false
      const lost = () => { active = false }
      // A terminated backend may deliver more than one error while it tears down; keep the listener until release.
      client.on('error', lost)
      client.once('end', lost)
      const lease: WriterLease = {
        get active() { return active },
        backendPid: result.rows[0].pid,
        release: async () => {
          if (released) return
          released = true
          this.leases.delete(lease)
          if (active) {
            try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [name]) }
            catch { active = false }
          }
          client.removeListener('error', lost)
          client.removeListener('end', lost)
          client.release(active ? undefined : new Error('The writer lease connection was lost.'))
        },
      }
      if (this.closed) {
        try { await lease.release() } finally { handedOff = true }
        throw new CoreError('STORAGE_CLOSED', 'The storage is closed.')
      }
      this.leases.add(lease)
      return lease
    } catch (error) {
      if (!handedOff) client.release(error as Error)
      throw error instanceof CoreError ? error : translateError(error)
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = (async () => {
      // A handle whose final transaction failed still owns its lease; closing the storage must not wait forever for it.
      await Promise.allSettled(Array.from(this.leases, lease => lease.release()))
      await this.leasePool?.end()
      await this.pool.end()
    })()
    return this.closing
  }
}

function createPool(options: ResolvedPostgresOptions, applicationName: string) {
  const pool = new Pool({
    ...(options.connectionString ? { connectionString: options.connectionString } : {
      host: options.host, port: options.port, user: options.user, password: options.password,
      database: options.database, ssl: options.ssl,
    }),
    max: options.maxConnections,
    connectionTimeoutMillis: 5000,
    options: `-c search_path=public -c lock_timeout=${options.lockTimeoutMs} -c statement_timeout=${options.statementTimeoutMs}`,
    application_name: applicationName,
  })
  pool.on('error', () => {})
  return pool
}

class PostgresTransaction implements AsyncTx {
  private active = true
  constructor(private readonly client: PoolClient, readonly instanceId: string) {}

  expire() { this.active = false }

  private assertActive() {
    if (!this.active) throw new CoreError('TRANSACTION_CLOSED', 'The transaction capability has expired.')
  }

  async get<T>(kind: RecordKind, id: string): Promise<T | undefined> {
    this.assertActive()
    assertKind(kind)
    const result = await this.client.query(`SELECT body FROM ${recordsTable} WHERE instance_id=$1 AND kind=$2 AND id=$3`, [this.instanceId, kind, id])
    return result.rows[0]?.body as T | undefined
  }

  async insert<T>(kind: RecordKind, id: string, value: T): Promise<void> {
    this.assertActive()
    assertKind(kind)
    const body = recordBody(value)
    await this.client.query(`INSERT INTO ${recordsTable}(instance_id, kind, id, body) VALUES($1, $2, $3, $4::jsonb)`, [this.instanceId, kind, id, body])
  }

  async list<T>(kind: RecordKind, limit: number): Promise<T[]> {
    this.assertActive()
    assertKind(kind)
    validateQueryLimit(limit)
    const result = await this.client.query(`SELECT body FROM ${recordsTable} WHERE instance_id=$1 AND kind=$2 ORDER BY seq LIMIT $3`, [this.instanceId, kind, limit])
    return result.rows.map(row => row.body as T)
  }

  async replace<T>(kind: RecordKind, id: string, value: T): Promise<boolean> {
    this.assertActive()
    assertKind(kind)
    const body = recordBody(value)
    const result = await this.client.query(`UPDATE ${recordsTable} SET body=$4::jsonb WHERE instance_id=$1 AND kind=$2 AND id=$3`, [this.instanceId, kind, id, body])
    return result.rowCount === 1
  }

  async remove(kind: RecordKind, id: string): Promise<boolean> {
    this.assertActive()
    assertKind(kind)
    const result = await this.client.query(`DELETE FROM ${recordsTable} WHERE instance_id=$1 AND kind=$2 AND id=$3`, [this.instanceId, kind, id])
    return result.rowCount === 1
  }

  async scan<T>(kind: RecordKind, options: { limit: number; after?: string }): Promise<{ items: { id: string; value: T }[]; cursor?: string }> {
    this.assertActive()
    assertKind(kind)
    validateQueryLimit(options.limit)
    if (options.after !== undefined && typeof options.after !== 'string') throw new CoreError('INVALID_INPUT', 'Invalid bounded scan options.')
    const result = options.after === undefined
      ? await this.client.query(`SELECT id, body FROM ${recordsTable} WHERE instance_id=$1 AND kind=$2 ORDER BY id COLLATE "C" LIMIT $3`, [this.instanceId, kind, options.limit + 1])
      : await this.client.query(`SELECT id, body FROM ${recordsTable} WHERE instance_id=$1 AND kind=$2 AND id COLLATE "C">$3 ORDER BY id COLLATE "C" LIMIT $4`, [this.instanceId, kind, options.after, options.limit + 1])
    const items = result.rows.slice(0, options.limit).map(row => ({ id: String(row.id), value: row.body as T }))
    return { items, ...(result.rows.length > options.limit ? { cursor: items.at(-1)!.id } : {}) }
  }
}

function resolveOptions(options: PostgresOptions): ResolvedPostgresOptions {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new CoreError('INVALID_CONFIG', 'PostgreSQL options must be an object.')
  const maxConnections = options.maxConnections ?? 8
  const lockTimeoutMs = options.lockTimeoutMs ?? 1500
  const statementTimeoutMs = options.statementTimeoutMs ?? 4000
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 64) throw new CoreError('INVALID_CONFIG', 'PostgreSQL maxConnections must be between 1 and 64.')
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > 60000) throw new CoreError('INVALID_CONFIG', 'PostgreSQL lockTimeoutMs must be between 1 and 60000.')
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 60000) throw new CoreError('INVALID_CONFIG', 'PostgreSQL statementTimeoutMs must be between 1 and 60000.')
  if (options.backupDirectory !== undefined && !isAbsolute(options.backupDirectory)) {
    throw new CoreError('INVALID_CONFIG', 'PostgreSQL backupDirectory must be an absolute path.')
  }
  const connectionString = options.connectionString
  if (!connectionString && (!options.host || !options.user || !options.database)) {
    throw new CoreError('INVALID_CONFIG', 'PostgreSQL needs a connectionString or host, user and database.')
  }
  return { ...(connectionString ? { connectionString } : {}), host: options.host ?? '127.0.0.1', port: options.port ?? 5432, user: options.user ?? 'postgres',
    password: options.password ?? '', database: options.database ?? 'postgres', ssl: options.ssl ?? false,
    maxConnections, lockTimeoutMs, statementTimeoutMs, ...(options.backupDirectory ? { backupDirectory: options.backupDirectory } : {}) }
}

async function initialiseSchema(pool: Pool, options: ResolvedPostgresOptions) {
  const client = await pool.connect().catch(error => { throw translateError(error) })
  try {
    await configureConnection(client, options)
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ds-superagent-schema'))")
    const raced = await client.query<{ exists: string | null }>("SELECT to_regclass('public." + metaTable + "')::text AS exists")
    if (raced.rows[0]?.exists) {
      await verifyCurrentSchema(client)
      await client.query('COMMIT')
      return
    }
    const orphaned = await client.query<{ records: string | null; instances: string | null }>(`SELECT to_regclass('public.${recordsTable}')::text AS records, to_regclass('public.${instancesTable}')::text AS instances`)
    if (orphaned.rows[0]?.records || orphaned.rows[0]?.instances) {
      throw new CoreError('UNSUPPORTED_SCHEMA', 'The PostgreSQL tables exist without a schema version and were left unchanged.')
    }
    const legacy = await legacyTableExists(client)
    if (legacy) {
      await client.query(`LOCK TABLE ${legacyRecordsTable} IN ACCESS EXCLUSIVE MODE`)
      await assertSupportedLegacySchema(client)
      await backupLegacy(client, options)
      await createSchema(client)
      await copyLegacy(client)
      await client.query(`ALTER TABLE ${legacyRecordsTable} RENAME TO ds_superagent_legacy_records`)
      await writeSchemaVersion(client, 1)
    } else {
      await createSchema(client)
      await writeSchemaVersion(client, 1)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw translateError(error)
  } finally { client.release() }
}

async function verifyCurrentSchema(client: PoolClient) {
  await verifyTable(client, metaTable, ['key:text:NO:', 'value:text:NO:'], ['key'])
  const versionRow = await client.query<{ value: string }>(`SELECT value FROM ${metaTable} WHERE key='schema_version'`)
  if (!versionRow.rows[0]) throw new CoreError('UNSUPPORTED_SCHEMA', 'The PostgreSQL schema has no version and was left unchanged.')
  const version = Number(versionRow.rows[0].value)
  if (!Number.isInteger(version) || version !== schemaVersion) {
    throw new CoreError('UNSUPPORTED_SCHEMA', 'This PostgreSQL schema version is not supported; no migration was attempted.')
  }
  await verifyTable(client, instancesTable, ['instance_id:text:NO:'], ['instance_id'])
  await verifyTable(client, recordsTable, ['instance_id:text:NO:', 'kind:text:NO:', 'id:text:NO:', 'body:jsonb:NO:', 'seq:bigint:NO:ALWAYS'], ['instance_id', 'kind', 'id'])
}

async function verifyTable(client: PoolClient, table: string, expectedColumns: string[], expectedKey: string[]) {
  const columns = await client.query<{ shape: string }>(`SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(identity_generation, '') AS shape
    FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])
  const key = await client.query<{ name: string }>(`SELECT attribute.attname AS name FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid=constraint_row.conrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS column_key(number, position)
    JOIN pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum=column_key.number
    WHERE namespace.nspname='public' AND relation.relname=$1 AND constraint_row.contype='p' ORDER BY column_key.position`, [table])
  if (JSON.stringify(columns.rows.map(row => row.shape)) !== JSON.stringify(expectedColumns) ||
    JSON.stringify(key.rows.map(row => row.name)) !== JSON.stringify(expectedKey)) {
    throw new CoreError('UNSUPPORTED_SCHEMA', 'The PostgreSQL table layout or primary key is not supported.')
  }
}

async function assertSupportedLegacySchema(client: PoolClient) {
  const columns = await client.query<{ shape: string }>(
    "SELECT column_name || ':' || data_type || ':' || is_nullable AS shape FROM information_schema.columns WHERE table_schema='public' AND table_name='records' ORDER BY ordinal_position")
  if (JSON.stringify(columns.rows.map(row => row.shape)) !== JSON.stringify(['instance_id:text:NO', 'kind:text:NO', 'id:text:NO', 'body:text:NO'])) {
    throw new CoreError('UNSUPPORTED_SCHEMA', 'The legacy PostgreSQL records table is not supported.')
  }
}

async function legacyTableExists(client: PoolClient) {
  const legacy = await client.query<{ exists: string | null }>("SELECT to_regclass('public.records')::text AS exists")
  return Boolean(legacy.rows[0]?.exists)
}

async function backupLegacy(client: PoolClient, options: ResolvedPostgresOptions) {
  if (!options.backupDirectory) throw new CoreError('BACKUP_REQUIRED', 'A PostgreSQL schema upgrade needs an explicit absolute backupDirectory.')
  await mkdir(options.backupDirectory, { recursive: true })
  const rows = await client.query<{ instance_id: string; kind: string; id: string; body: unknown }>(
    `SELECT instance_id, kind, id, body FROM ${legacyRecordsTable} ORDER BY instance_id, kind, id`)
  const backup = { version: 0, createdAt: new Date().toISOString(), records: rows.rows }
  const path = join(options.backupDirectory, `superagent-postgres-before-v${schemaVersion}-${randomUUID()}.json`)
  const contents = JSON.stringify(backup)
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(contents); await file.sync() }
  finally { await file.close() }
  if (await readFile(path, 'utf8') !== contents) {
    throw new CoreError('BACKUP_FAILED', 'The PostgreSQL pre-upgrade backup could not be verified.')
  }
}

async function createSchema(client: PoolClient) {
  await client.query(`CREATE TABLE ${metaTable}(key text PRIMARY KEY, value text NOT NULL)`)
  await client.query(`CREATE TABLE ${instancesTable}(instance_id text PRIMARY KEY)`)
  await client.query(`CREATE TABLE ${recordsTable}(
    instance_id text NOT NULL,
    kind text NOT NULL,
    id text NOT NULL,
    body jsonb NOT NULL,
    seq bigint GENERATED ALWAYS AS IDENTITY,
    PRIMARY KEY(instance_id, kind, id)
  )`)
}

async function copyLegacy(client: PoolClient) {
  await client.query(`INSERT INTO ${recordsTable}(instance_id, kind, id, body)
    SELECT instance_id, kind, id, body::jsonb FROM ${legacyRecordsTable}`)
  await client.query(`INSERT INTO ${instancesTable}(instance_id) SELECT DISTINCT instance_id FROM ${legacyRecordsTable}`)
}

async function writeSchemaVersion(client: PoolClient, version: number) {
  await client.query(`INSERT INTO ${metaTable}(key, value) VALUES('schema_version', $1)`, [String(version)])
}

function assertKind(kind: RecordKind) {
  if (!recordKinds.includes(kind)) throw new CoreError('INVALID_INPUT', 'Unknown record kind.')
}

function recordBody(value: unknown) {
  return validateStoredRecord(value)
}

function translateError(error: unknown) {
  if (error instanceof CoreError) return error
  const code = (error as { code?: string }).code
  if (code === '40001') return new CoreError('SERIALIZATION_FAILURE', 'The PostgreSQL transaction was rolled back for serialization failure.')
  if (code === '40P01') return new CoreError('DEADLOCK', 'The PostgreSQL transaction was chosen as a deadlock victim.')
  if (code === '55P03') return new CoreError('LOCK_TIMEOUT', 'The PostgreSQL Instance lock was not acquired within the declared budget.')
  if (code === '57014') return new CoreError('STATEMENT_TIMEOUT', 'The PostgreSQL statement exceeded the declared budget.')
  if (code === '23505') return new CoreError('RECORD_EXISTS', 'The PostgreSQL record already exists.')
  if (connectionFailure(error)) return new CoreError('STORAGE_UNAVAILABLE', 'The PostgreSQL connection failed.')
  return new CoreError('STORAGE_ERROR', error instanceof Error ? error.message : 'The PostgreSQL storage operation failed.')
}

function connectionFailure(error: unknown) {
  const code = (error as { code?: string }).code
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(code ?? '')) return true
  return error instanceof Error && /connection terminated|connection error|client has encountered a connection error|connection closed|timeout exceeded when trying to connect|connection timeout/iu.test(error.message)
}

function isServerError(error: unknown) {
  return /^[0-9A-Z]{5}$/u.test((error as { code?: string }).code ?? '')
}

async function configureConnection(client: PoolClient, options: ResolvedPostgresOptions) {
  await client.query(`SET search_path=public; SET lock_timeout='${options.lockTimeoutMs}ms'; SET statement_timeout='${options.statementTimeoutMs}ms'`)
}
