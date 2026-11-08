import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SqliteStorage } from '../dist/storage.js'
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
  SessionHandleClosedError,
  SessionOwnershipLostError,
  SessionPersistenceCorruptionError,
  SessionReadOnlyError,
} from '@deepseek-ai/dsh-session-persistence'
import * as SqliteSessionPersistence from '../dist/session-persistence.js'

async function runtime(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-sqlite-'))
  const context = new Context()
  await context.plugin(SqliteSessionPersistence, { databasePath: join(directory, 'sessions.sqlite') })
  const persistence = context.get('sessionPersistence')
  t.after(async () => { await context.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { persistence, directory }
}

async function runtimeWithFailureInjection(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  const context = new Context()
  const base = await SqliteStorage.open(join(directory, 'sessions.sqlite'))
  const state = { failNext: false }
  const storage = {
    transaction: async (id, operation) => {
      if (state.failNext) { state.failNext = false; throw new Error('injected disk failure') }
      return base.transaction(id, operation)
    },
    reconnect: () => base.reconnect(),
    close: () => base.close(),
  }
  t.after(async () => { await context.fiber.dispose(); await base.close(); await rm(directory, { recursive: true, force: true }) })
  return { persistence: new SqliteSessionPersistence.SqliteSessionPersistence(context, storage), state }
}

function header(id, overrides = {}) {
  return { version: 4, id: SessionId(id), createdAt: Date.now(), isSeeded: false, ...overrides }
}

test('the SQLite Session provider stores one contiguous durable writer log and exposes it through the public handle contract', async t => {
  const { persistence } = await runtime(t)
  const id = SessionId('session-one')
  const created = await persistence.create(header(id))
  assert.equal(created.access, 'write')
  assert.deepEqual(await created.read(), { eventState: 'shared-frozen', events: [] })
  await assert.rejects(persistence.create(header(id)), SessionAlreadyExistsError)
  await assert.rejects(persistence.open(id, 'write'), SessionAlreadyOwnedError)
  const read = await persistence.open(id, 'read')
  await assert.rejects(read.append([]), SessionReadOnlyError)

  const event = { type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }
  await created.append([event])
  const observed = await created.read()
  assert.equal(observed.events.length, 1)
  assert.equal(observed.events[0].type, 'session/end-seed')
  const stat = await persistence.stat(id)
  assert.equal(stat.header.id, id)
  assert.equal(stat.eventCount, 1)
  assert.equal((await persistence.list()).length, 1)

  await created.flush()
  await created.close()
  await assert.rejects(created.read(), SessionHandleClosedError)
  const reopened = await persistence.open(id, 'write')
  assert.equal((await reopened.read()).events[0].type, 'session/end-seed')
  await reopened.close()
})

test('a failed flush or close retains write ownership instead of pretending the handle is gone', async t => {
  const { persistence, state } = await runtimeWithFailureInjection(t, 'ds-bot-session-failure-')
  const handle = await persistence.create(header('failure-session'))
  const first = { type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }
  await handle.append([first])
  state.failNext = true
  await assert.rejects(handle.flush(), /injected disk failure/u)
  await handle.append([{ type: 'session/end-seed', seq: 1, time: Date.now(), data: {} }])
  state.failNext = true
  await assert.rejects(handle.close(), /injected disk failure/u)
  await handle.append([{ type: 'session/end-seed', seq: 2, time: Date.now(), data: {} }])
  await handle.close()
})

test('a replacement backend honors the durable writer epoch and cannot silently take an active session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-replacement-'))
  const databasePath = join(directory, 'sessions.sqlite')
  const firstContext = new Context()
  const secondContext = new Context()
  t.after(async () => {
    await firstContext.fiber.dispose(); await secondContext.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await firstContext.plugin(SqliteSessionPersistence, { databasePath })
  const first = firstContext.get('sessionPersistence')
  const id = SessionId('replacement-session')
  const handle = await first.create(header(id))
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: { kept: true } }])
  await secondContext.plugin(SqliteSessionPersistence, { databasePath })
  const second = secondContext.get('sessionPersistence')
  await assert.rejects(second.open(id, 'write'), SessionAlreadyOwnedError)
  await firstContext.fiber.dispose()
  await assert.rejects(handle.append([{ type: 'session/end-seed', seq: 1, time: Date.now(), data: {} }]), SessionHandleClosedError)
  const replacement = await second.open(id, 'write')
  assert.equal((await replacement.read()).events[0].data.kept, true)
  await replacement.append([{ type: 'session/end-seed', seq: 1, time: Date.now(), data: {} }])
  await replacement.close()
})

test('a seeded fork keeps its parent lineage, inherited cut and sealed child record', async t => {
  const { persistence } = await runtime(t)
  const parent = SessionId('parent-session')
  const child = SessionId('child-session')
  const handle = await persistence.create(header(child, { isSeeded: true, parentSession: parent }), { inheritedEventCount: 1 })
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: { inherited: true } }])
  const read = await persistence.open(child, 'read')
  const stored = await read.read()
  assert.equal(read.header.isSeeded, true)
  assert.equal(read.header.parentSession, parent)
  assert.equal(read.inheritedEventCount, 1)
  assert.equal(stored.events[0].data.inherited, true)
  assert.equal((await persistence.stat(child)).eventCount, 1)
  await read.close()
  await handle.close()
})

test('interleaved writers on different Sessions keep their own contiguous sequence', async t => {
  const { persistence } = await runtime(t)
  const left = await persistence.create(header('interleave-left'))
  const right = await persistence.create(header('interleave-right'))
  const batches = [0, 1, 2, 3].map(index => [
    left.append([{ type: 'session/end-seed', seq: index, time: Date.now(), data: { index } }]),
    right.append([{ type: 'session/end-seed', seq: index, time: Date.now(), data: { index } }]),
  ])
  await Promise.all(batches.flat())
  for (const [id, handle] of [['interleave-left', left], ['interleave-right', right]]) {
    const stored = await handle.read()
    assert.deepEqual(stored.events.map(event => event.seq), [0, 1, 2, 3], id)
    assert.equal((await persistence.stat(id)).eventCount, 4, id)
  }
  await left.close()
  await right.close()
})

test('the service flush drains every open write handle and reports a failed drain without releasing ownership', async t => {
  const { persistence, state } = await runtimeWithFailureInjection(t, 'ds-bot-session-service-flush-')
  const first = await persistence.create(header('flush-one'))
  const second = await persistence.create(header('flush-two'))
  const revisions = async () => [(await persistence.stat('flush-one')).revision, (await persistence.stat('flush-two')).revision]
  const before = await revisions()
  await persistence.flush()
  const after = await revisions()
  assert.notEqual(after[0], before[0])
  assert.notEqual(after[1], before[1])
  state.failNext = true
  await assert.rejects(persistence.flush(), error => error instanceof AggregateError
    && error.errors.some(reason => /injected disk failure/u.test(String(reason))))
  await assert.rejects(persistence.open('flush-one', 'write'), SessionAlreadyOwnedError)
  await first.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }])
  await first.close()
  await second.close()
})

test('a handle whose durable epoch moved on refuses to append or flush instead of silently taking the session back', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-epoch-'))
  const context = new Context()
  const base = await SqliteStorage.open(join(directory, 'sessions.sqlite'))
  t.after(async () => { await context.fiber.dispose(); await base.close(); await rm(directory, { recursive: true, force: true }) })
  const persistence = new SqliteSessionPersistence.SqliteSessionPersistence(context, base)
  const handle = await persistence.create(header('epoch-session'))
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }])
  // Another owner taking the row is what a crash-recovered backend leaves behind.
  await base.transaction('session-store', async transaction => {
    const key = JSON.stringify(['session-writer', 'epoch-session'])
    const writer = await transaction.get('session-writer', key)
    await transaction.replace('session-writer', key, { ...writer, epoch: writer.epoch + 1 })
  })
  await assert.rejects(handle.append([{ type: 'session/end-seed', seq: 1, time: Date.now(), data: {} }]), SessionOwnershipLostError)
  await assert.rejects(handle.flush(), SessionOwnershipLostError)
  await assert.rejects(handle.close(), SessionOwnershipLostError)
  await assert.rejects(persistence.open('epoch-session', 'write'), SessionAlreadyOwnedError)
})

test('a created Session that never receives an event leaves no stored residue when it closes', async t => {
  const { persistence } = await runtime(t)
  const handle = await persistence.create(header('empty-session'))
  assert.ok(await persistence.stat('empty-session'))
  await handle.close()
  assert.equal(await persistence.stat('empty-session'), undefined)
  assert.deepEqual(await persistence.list(), [])
  const recreated = await persistence.create(header('empty-session'))
  await recreated.close()
})

test('an explicitly flushed empty Session survives close', async t => {
  const { persistence } = await runtime(t)
  const handle = await persistence.create(header('flushed-empty'))
  await handle.flush()
  await handle.close()
  const stat = await persistence.stat('flushed-empty')
  assert.ok(stat)
  assert.equal(stat.eventCount, 0)
  const reopened = await persistence.open('flushed-empty', 'write')
  assert.deepEqual((await reopened.read()).events, [])
  await reopened.close()
})

test('a corrupt stored log is refused before write ownership is granted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-corrupt-'))
  const context = new Context()
  const base = await SqliteStorage.open(join(directory, 'sessions.sqlite'))
  t.after(async () => { await context.fiber.dispose(); await base.close(); await rm(directory, { recursive: true, force: true }) })
  const persistence = new SqliteSessionPersistence.SqliteSessionPersistence(context, base)
  const handle = await persistence.create(header('corrupt-session'))
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }])
  await handle.close()
  await base.transaction('session-store', async transaction => {
    const id = 'corrupt-session'
    const metaKey = JSON.stringify(['session-meta', id])
    const meta = await transaction.get('session-meta', metaKey)
    await transaction.insert('session-event', `${JSON.stringify(['session-event', id])}:000000000001`,
      { type: 'unknown/newer-event', seq: 1, time: Date.now(), data: {} })
    await transaction.replace('session-meta', metaKey, { ...meta, nextSeq: 2 })
  })
  await assert.rejects(persistence.open('corrupt-session', 'write'), SessionFormatUnsupportedError)
  await assert.rejects(persistence.open('corrupt-session', 'read').then(opened => opened.read()), SessionFormatUnsupportedError)
})

test('a stored log with a sequence gap is refused before write ownership is granted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-gap-'))
  const context = new Context()
  const base = await SqliteStorage.open(join(directory, 'sessions.sqlite'))
  t.after(async () => { await context.fiber.dispose(); await base.close(); await rm(directory, { recursive: true, force: true }) })
  const persistence = new SqliteSessionPersistence.SqliteSessionPersistence(context, base)
  const handle = await persistence.create(header('gap-session'))
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }])
  await handle.close()
  await base.transaction('session-store', async transaction => {
    const id = 'gap-session'
    const metaKey = JSON.stringify(['session-meta', id])
    const meta = await transaction.get('session-meta', metaKey)
    await transaction.insert('session-event', `${JSON.stringify(['session-event', id])}:000000000002`,
      { type: 'session/end-seed', seq: 2, time: Date.now(), data: {} })
    await transaction.replace('session-meta', metaKey, { ...meta, nextSeq: 3 })
  })
  await assert.rejects(persistence.open('gap-session', 'write'), SessionPersistenceCorruptionError)
})

test('a failed live append stops the handle and reports the original error instead of dropping later events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-live-failure-'))
  const context = new Context()
  const base = await SqliteStorage.open(join(directory, 'sessions.sqlite'))
  t.after(async () => { await context.fiber.dispose().catch(() => {}); await base.close(); await rm(directory, { recursive: true, force: true }) })
  const persistence = new SqliteSessionPersistence.SqliteSessionPersistence(context, base)
  const handle = await persistence.create(header('live-failure'))
  persistence.enqueueLive('live-failure', { type: 'session/end-seed', seq: 5, time: Date.now(), data: {} })
  persistence.enqueueLive('live-failure', { type: 'session/end-seed', seq: 0, time: Date.now(), data: {} })
  await assert.rejects(persistence.flush(), error => error instanceof AggregateError
    && error.errors.some(reason => /seq mismatch/u.test(String(reason))))
  assert.deepEqual((await handle.read()).events, [])
  await assert.rejects(handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }]), /seq mismatch/u)
  await assert.rejects(handle.close(), /seq mismatch/u)
})

test('an append that fails midway leaves no partial events and can be retried as one batch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-atomic-'))
  const context = new Context()
  const base = await SqliteStorage.open(join(directory, 'sessions.sqlite'))
  let failInsertAt = 0
  const storage = {
    transaction: (id, operation) => base.transaction(id, async transaction => {
      let inserts = 0
      const guarded = {
        instanceId: transaction.instanceId,
        get: transaction.get.bind(transaction),
        list: transaction.list.bind(transaction),
        remove: transaction.remove.bind(transaction),
        replace: transaction.replace.bind(transaction),
        scan: transaction.scan.bind(transaction),
        insert: async (kind, key, value) => {
          if (++inserts === failInsertAt) throw new Error('injected mid-batch failure')
          return transaction.insert(kind, key, value)
        },
      }
      return operation(guarded)
    }),
    reconnect: () => base.reconnect(),
    close: () => base.close(),
  }
  t.after(async () => { await context.fiber.dispose(); await base.close(); await rm(directory, { recursive: true, force: true }) })
  const persistence = new SqliteSessionPersistence.SqliteSessionPersistence(context, storage)
  const handle = await persistence.create(header('atomic-session'))
  failInsertAt = 2
  const batch = [
    { type: 'session/end-seed', seq: 0, time: Date.now(), data: { first: true } },
    { type: 'session/end-seed', seq: 1, time: Date.now(), data: { second: true } },
  ]
  await assert.rejects(handle.append(batch), /injected mid-batch failure/u)
  assert.equal((await persistence.stat('atomic-session')).eventCount, 0)
  assert.deepEqual((await handle.read()).events, [])
  failInsertAt = 0
  await handle.append(batch)
  assert.deepEqual((await handle.read()).events.map(event => event.seq), [0, 1])
  await handle.close()
})

test('concurrent close calls settle once without a second ownership failure', async t => {
  const { persistence } = await runtime(t)
  const handle = await persistence.create(header('closing-session'))
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: {} }])
  await Promise.all([handle.close(), handle.close(), handle.close()])
  assert.equal((await persistence.stat('closing-session')).eventCount, 1)
})

test('a Session abandoned by a crashed process can be recovered without a graceful close', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-crash-'))
  const databasePath = join(directory, 'sessions.sqlite')
  const storageModule = pathToFileURL(join(process.cwd(), 'dist', 'storage.js')).href
  const persistenceModule = pathToFileURL(join(process.cwd(), 'dist', 'session-persistence.js')).href
  const cordisModule = import.meta.resolve('@deepseek-ai/cordis')
  const scriptPath = join(directory, 'crash.mjs')
  await writeFile(scriptPath, `
import { Context } from ${JSON.stringify(cordisModule)}
import { SqliteStorage } from ${JSON.stringify(storageModule)}
import { SqliteSessionPersistence } from ${JSON.stringify(persistenceModule)}
const storage = await SqliteStorage.open(${JSON.stringify(databasePath)})
const provider = new SqliteSessionPersistence(new Context(), storage)
const handle = await provider.create({ version: 4, id: 'crashed-session', createdAt: Date.now(), isSeeded: false })
await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: { beforeCrash: true } }])
process.exit(0)
`)
  const child = spawnSync(process.execPath, [scriptPath], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  const context = new Context()
  const base = await SqliteStorage.open(databasePath)
  t.after(async () => { await context.fiber.dispose(); await base.close(); await rm(directory, { recursive: true, force: true }) })
  const persistence = new SqliteSessionPersistence.SqliteSessionPersistence(context, base)
  const recovered = await persistence.open('crashed-session', 'write')
  assert.equal((await recovered.read()).events[0].data.beforeCrash, true)
  await recovered.append([{ type: 'session/end-seed', seq: 1, time: Date.now(), data: {} }])
  await recovered.close()
})
