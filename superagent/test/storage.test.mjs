import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { CoreError } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

test('the public storage entry uses the same exported CoreError identity', async () => {
  await assert.rejects(SqliteStorage.open('relative.sqlite'), error => error instanceof CoreError && error.code === 'INVALID_CONFIG')
})

test('an unsupported schema is rejected without altering the database', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-schema-'))
  let unexpectedStorage
  t.after(async () => { try { await unexpectedStorage?.close() } finally { await rm(directory, { recursive: true, force: true }) } })
  const path = join(directory, 'future.sqlite')
  const fixture = new DatabaseSync(path)
  fixture.exec('CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES (\'keep\'); PRAGMA user_version=99;')
  fixture.close()
  const before = createHash('sha256').update(await readFile(path)).digest('hex')
  await assert.rejects(async () => { unexpectedStorage = await SqliteStorage.open(path) }, { code: 'UNSUPPORTED_SCHEMA' })
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), before)
})

test('an existing unversioned database is not mistaken for a fresh Super-agent database', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-unversioned-'))
  let unexpectedStorage
  t.after(async () => { try { await unexpectedStorage?.close() } finally { await rm(directory, { recursive: true, force: true }) } })
  const path = join(directory, 'other.sqlite')
  const fixture = new DatabaseSync(path)
  fixture.exec('CREATE TABLE sqliteXdata(value TEXT);')
  fixture.close()
  const before = await readFile(path)
  await assert.rejects(async () => { unexpectedStorage = await SqliteStorage.open(path) }, { code: 'UNSUPPORTED_SCHEMA' })
  assert.deepEqual(await readFile(path), before)
})

test('the bounded transaction queue rejects excess work and releases its slot before resolution', { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-queue-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'), { maxQueuedTransactions: 1 })
  let release
  let entered
  let capability
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  t.after(async () => { release(); try { await storage.close() } finally { await rm(directory, { recursive: true, force: true }) } })
  const accepted = storage.transaction('private', async tx => {
    capability = tx
    entered()
    await gate
    await tx.insert('command', 'accepted', { accepted: true })
  })
  await started
  await assert.rejects(storage.transaction('private', tx => tx.insert('command', 'excess', { accepted: true })), { code: 'QUEUE_FULL' })
  release()
  await accepted
  await assert.rejects(capability.get('command', 'accepted'), { code: 'TRANSACTION_CLOSED' })
  assert.deepEqual(await storage.transaction('private', tx => tx.get('command', 'accepted')), { accepted: true })
  assert.equal(await storage.transaction('private', tx => tx.get('command', 'excess')), undefined)
})

test('an independent SQLite writer times out within the declared lock budget without accepting work', { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-lock-'))
  const path = join(directory, 'state.sqlite')
  const storage = await SqliteStorage.open(path)
  const writer = new DatabaseSync(path)
  let locked = false
  t.after(async () => {
    if (locked) writer.exec('ROLLBACK')
    writer.close()
    try { await storage.close() } finally { await rm(directory, { recursive: true, force: true }) }
  })
  writer.exec('BEGIN IMMEDIATE')
  locked = true
  const started = performance.now()
  await assert.rejects(storage.transaction('private', tx => tx.insert('command', 'lock-request', { accepted: true })), { code: 'LOCK_TIMEOUT' })
  const elapsed = performance.now() - started
  assert.ok(elapsed >= 150 && elapsed < 2000, `Lock rejection took ${elapsed.toFixed(1)} ms.`)
  writer.exec('ROLLBACK')
  locked = false
  assert.equal(await storage.transaction('private', tx => tx.get('command', 'lock-request')), undefined)
})
