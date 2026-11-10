import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionOwnershipLostError,
  SessionReadOnlyError,
} from '@deepseek-ai/dsh-session-persistence'
import * as core from '../dist/index.js'
import { PostgresStorage } from '../dist/postgres-storage.js'
import { StorageSessionPersistence } from '../dist/session-persistence.js'
import * as PostgresPersistence from '../dist/session-persistence-postgres.js'
import { commitProxy } from '../dev/postgres-commit-proxy.mjs'
import { nativeContext, textResponse } from '../dev/native-mock.mjs'
import { startPostgres } from './fixtures/postgres-harness.mjs'

const postgres = await startPostgres('ds-superagent-session-postgres-')

after(async () => { await postgres.close() })

function header(id, overrides = {}) {
  return { version: 4, id: SessionId(id), createdAt: Date.now(), isSeeded: false, ...overrides }
}

function event(seq, data = {}) {
  return { type: 'session/end-seed', seq, time: Date.now(), data }
}

async function newDatabase() {
  return postgres.createDatabase()
}

async function directProvider(t, database) {
  const context = new Context()
  const storage = await PostgresStorage.open({ ...postgres.configuration, database })
  const persistence = new StorageSessionPersistence(context, storage)
  t.after(async () => {
    await persistence.close().catch(() => {})
    await storage.close()
    await context.fiber.dispose()
  })
  return { context, storage, persistence }
}

async function readEvents(persistence, id) {
  const handle = await persistence.open(id, 'read')
  try { return (await handle.read()).events }
  finally { await handle.close() }
}

async function openWriteEventually(persistence, id, timeoutMs = 15000) {
  const started = Date.now()
  for (;;) {
    try { return await persistence.open(id, 'write') }
    catch (error) {
      if (!(error instanceof SessionAlreadyOwnedError) || Date.now() - started > timeoutMs) throw error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

function startChildSession(t, scriptPath, config) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, DS_SESSION_PG: JSON.stringify(config) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const waiters = []
  const errors = []
  let buffer = ''
  let exited = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      const waiter = waiters.shift()
      if (waiter) waiter(JSON.parse(line))
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { errors.push(chunk) })
  child.on('exit', () => { exited = true })
  t.after(() => { if (!exited) child.kill() })
  return {
    ask(command) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`child did not answer "${command}": ${errors.join('')}`)), 20000)
        waiters.push(value => { clearTimeout(timer); resolve(value) })
        child.stdin.write(`${command}\n`)
      })
    },
    command(text) { child.stdin.write(`${text}\n`) },
    async waitForExit() {
      if (exited) return
      await new Promise(resolve => child.once('exit', resolve))
    },
    kill() { if (!exited) child.kill() },
  }
}

const childScript = `
import { createInterface } from 'node:readline'
import { Context } from ${JSON.stringify(import.meta.resolve('@deepseek-ai/cordis'))}
import { PostgresStorage } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist', 'postgres-storage.js')).href)}
import { StorageSessionPersistence } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist', 'session-persistence.js')).href)}
const storage = await PostgresStorage.open(JSON.parse(process.env.DS_SESSION_PG))
const provider = new StorageSessionPersistence(new Context(), storage)
let handle
const reply = value => process.stdout.write(JSON.stringify(value) + '\\n')
for await (const line of createInterface({ input: process.stdin })) {
  const [command, id, seq] = line.trim().split(/\\s+/u)
  try {
    if (command === 'create') {
      handle = await provider.create({ version: 4, id, createdAt: Date.now(), isSeeded: false })
      if (seq !== undefined) await handle.append([{ type: 'session/end-seed', seq: Number(seq), time: Date.now(), data: { fromChild: true } }])
      reply({ ok: true, count: seq === undefined ? 0 : 1 })
    } else if (command === 'open') {
      handle = await provider.open(id, 'write')
      reply({ ok: true, count: (await handle.read()).events.length })
    } else if (command === 'append') {
      await handle.append([{ type: 'session/end-seed', seq: Number(seq), time: Date.now(), data: { fromChild: true } }])
      reply({ ok: true })
    } else if (command === 'close') {
      await handle.close()
      handle = undefined
      reply({ ok: true })
    } else if (command === 'crash') {
      process.exit(0)
    } else if (command === 'exit') {
      break
    } else {
      reply({ ok: false, name: 'UnknownCommand' })
    }
  } catch (error) {
    reply({ ok: false, name: error?.name ?? 'Error', code: error?.code, message: String(error?.message ?? error) })
  }
}
if (handle) await handle.close().catch(() => {})
await storage.close()
`

test('a PostgreSQL Session provider keeps one contiguous durable log and serves the public handle contract', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const { persistence } = await directProvider(t, database)
  const id = SessionId('postgres-session-one')
  const created = await persistence.create(header(id))
  assert.equal(created.access, 'write')
  assert.deepEqual(await created.read(), { eventState: 'shared-frozen', events: [] })
  await assert.rejects(persistence.create(header(id)), SessionAlreadyExistsError)
  await assert.rejects(persistence.open(id, 'write'), SessionAlreadyOwnedError)
  const read = await persistence.open(id, 'read')
  await assert.rejects(read.append([event(0)]), SessionReadOnlyError)
  await read.close()

  const batch = [event(0, { a: true }), event(1), event(2)]
  await created.append(batch)
  const observed = await created.read()
  assert.deepEqual(observed.events.map(item => item.seq), [0, 1, 2])
  assert.deepEqual(observed.events.map(item => item.data), [{ a: true }, {}, {}])
  const stat = await persistence.stat(id)
  assert.equal(stat.header.id, id)
  assert.equal(stat.eventCount, 3)
  assert.equal((await persistence.list()).length, 1)

  await created.flush()
  await created.close()
  await assert.rejects(created.read(), SessionHandleClosedError)
  const reopened = await persistence.open(id, 'write')
  assert.deepEqual((await reopened.read()).events.map(item => item.seq), [0, 1, 2])
  await reopened.append([event(3)])
  await reopened.close()
  assert.equal((await persistence.stat(id)).eventCount, 4)
})

test('a seeded fork stores its parent lineage and inherited cut on PostgreSQL', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const { persistence } = await directProvider(t, database)
  const parent = SessionId('postgres-parent')
  const child = SessionId('postgres-child')
  const handle = await persistence.create(header(child, { isSeeded: true, parentSession: parent }), { inheritedEventCount: 1 })
  await handle.append([event(0, { inherited: true })])
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

test('two operating-system processes contend for one writer and recover an abandoned Session', { timeout: 120000 }, async t => {
  const database = await newDatabase()
  const { persistence } = await directProvider(t, database)
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-session-postgres-child-'))
  const scriptPath = join(directory, 'child.mjs')
  await writeFile(scriptPath, childScript)
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })

  const id = 'contended-session'
  const handle = await persistence.create(header(id))
  await handle.append([event(0, { fromParent: true })])
  const child = startChildSession(t, scriptPath, { ...postgres.configuration, database })

  assert.equal((await child.ask(`open ${id}`)).name, 'SessionAlreadyOwnedError')
  assert.equal((await child.ask(`create ${id}`)).name, 'SessionAlreadyExistsError')

  await handle.close()
  assert.deepEqual(await child.ask(`open ${id}`), { ok: true, count: 1 })
  assert.deepEqual(await child.ask(`append ${id} 1`), { ok: true })
  await assert.rejects(persistence.open(id, 'write'), SessionAlreadyOwnedError)
  assert.deepEqual((await readEvents(persistence, id)).map(item => item.seq), [0, 1])
  assert.deepEqual(await child.ask('close'), { ok: true })

  const reopened = await persistence.open(id, 'write')
  assert.deepEqual((await reopened.read()).events.map(item => item.seq), [0, 1])
  await reopened.append([event(2)])
  await reopened.close()
  assert.equal((await persistence.stat(id)).eventCount, 3)

  assert.deepEqual(await child.ask(`create crashed-session 0`), { ok: true, count: 1 })
  await assert.rejects(persistence.open('crashed-session', 'write'), SessionAlreadyOwnedError)
  child.command('crash')
  await child.waitForExit()
  const recovered = await openWriteEventually(persistence, 'crashed-session')
  assert.deepEqual((await recovered.read()).events.map(item => item.seq), [0])
  await recovered.append([event(1)])
  await recovered.close()
  assert.equal((await persistence.stat('crashed-session')).eventCount, 2)
})

test('a terminated lease connection stops the old handle, and a moved epoch refuses append, flush and close', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const { storage, persistence } = await directProvider(t, database)

  const leased = await persistence.create(header('lease-lost'))
  await leased.append([event(0)])
  const writerKey = JSON.stringify(['session-writer', 'lease-lost'])
  const writer = await storage.transaction('session-store', transaction => transaction.get('session-writer', writerKey))
  assert.ok(Number.isSafeInteger(writer.leaseBackendPid) && writer.leaseBackendPid > 0)
  await postgres.client(database).then(async inspector => {
    await inspector.query('SELECT pg_terminate_backend($1)', [writer.leaseBackendPid])
  })
  await new Promise(resolve => setTimeout(resolve, 500))
  await assert.rejects(leased.append([event(1)]), SessionOwnershipLostError)
  assert.deepEqual((await readEvents(persistence, 'lease-lost')).map(item => item.seq), [0])
  await assert.rejects(leased.close(), SessionOwnershipLostError)

  const moved = await persistence.create(header('epoch-moved'))
  await moved.append([event(0)])
  await storage.transaction('session-store', async transaction => {
    const key = JSON.stringify(['session-writer', 'epoch-moved'])
    const current = await transaction.get('session-writer', key)
    await transaction.replace('session-writer', key, { ...current, epoch: current.epoch + 1 })
  })
  await assert.rejects(moved.append([event(1)]), SessionOwnershipLostError)
  await assert.rejects(moved.flush(), SessionOwnershipLostError)
  await assert.rejects(moved.close(), SessionOwnershipLostError)
  assert.deepEqual((await readEvents(persistence, 'epoch-moved')).map(item => item.seq), [0])
})

test('a real server-side failure keeps PostgreSQL write ownership until the failure is removed', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const { persistence } = await directProvider(t, database)
  const inspector = await postgres.client(database)
  const id = 'server-failure-session'
  const handle = await persistence.create(header(id))
  await handle.append([event(0)])
  const arm = () => inspector.query(`CREATE OR REPLACE FUNCTION reject_session_meta() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected session meta failure'; END $$;
      CREATE TRIGGER reject_session_meta BEFORE UPDATE ON ds_superagent_records
        FOR EACH ROW WHEN (OLD.instance_id = 'session-store' AND OLD.kind = 'session-meta')
        EXECUTE FUNCTION reject_session_meta()`)
  const disarm = () => inspector.query('DROP TRIGGER reject_session_meta ON ds_superagent_records; DROP FUNCTION reject_session_meta()')

  await arm()
  await assert.rejects(handle.flush(), /injected session meta failure/u)
  await assert.rejects(persistence.open(id, 'write'), SessionAlreadyOwnedError)
  await disarm()
  await handle.append([event(1)])
  await arm()
  await assert.rejects(handle.close(), /injected session meta failure/u)
  await disarm()
  await handle.append([event(2)])
  await handle.close()
  assert.deepEqual((await readEvents(persistence, id)).map(item => item.seq), [0, 1, 2])
})

test('a lost COMMIT acknowledgement does not orphan a newly created PostgreSQL Session', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const direct = await PostgresStorage.open({ ...postgres.configuration, database })
  const proxy = await commitProxy(postgres.port, 'after-commit')
  t.after(async () => { await proxy.close(); await direct.close() })
  const context = new Context()
  const storage = await PostgresStorage.open({ ...postgres.configuration, database, port: proxy.port })
  const persistence = new StorageSessionPersistence(context, storage)
  t.after(async () => {
    await persistence.close().catch(() => {})
    await storage.close()
    await context.fiber.dispose()
  })
  const id = 'unknown-commit-session'
  const handle = await persistence.create(header(id))
  proxy.arm()
  await assert.rejects(handle.append([event(0)]), { code: 'COMMIT_UNKNOWN' })
  assert.equal(proxy.evidence.suppressedCommit, true)
  await handle.close()
  await persistence.close()

  const reader = new StorageSessionPersistence(new Context(), direct)
  const read = await reader.open(id, 'read')
  const stored = await read.read()
  assert.deepEqual(stored.events.map(item => item.seq), [0])
  assert.equal((await reader.stat(id)).header.id, id)
  await read.close()
  await reader.close()
})

test('a failed business transaction on the shared backend leaves the Session log untouched', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const { storage, persistence } = await directProvider(t, database)
  await assert.rejects(storage.transaction('business', async transaction => {
    await transaction.insert('command', 'rolled-back', { accepted: true })
    throw new core.CoreError('ROLLBACK_TEST', 'The business transaction chose to roll back.')
  }), { code: 'ROLLBACK_TEST' })
  assert.equal(await storage.transaction('business', transaction => transaction.get('command', 'rolled-back')), undefined)

  const handle = await persistence.create(header('business-independent'))
  await handle.append([event(0)])
  await handle.close()
  assert.deepEqual((await readEvents(persistence, 'business-independent')).map(item => item.seq), [0])
})

test('a failed flush or close keeps PostgreSQL write ownership instead of pretending the handle is gone', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const base = await PostgresStorage.open({ ...postgres.configuration, database })
  const state = { failNext: false }
  const storage = {
    transaction: async (id, operation) => {
      if (state.failNext) { state.failNext = false; throw new Error('injected storage failure') }
      return base.transaction(id, operation)
    },
    acquireWriterLease: key => base.acquireWriterLease(key),
    reconnect: () => base.reconnect(),
    close: () => base.close(),
  }
  const context = new Context()
  const persistence = new StorageSessionPersistence(context, storage)
  t.after(async () => {
    await persistence.close().catch(() => {})
    await base.close()
    await context.fiber.dispose()
  })

  const handle = await persistence.create(header('postgres-failure-session'))
  await handle.append([event(0)])
  state.failNext = true
  await assert.rejects(handle.flush(), /injected storage failure/u)
  await assert.rejects(persistence.open('postgres-failure-session', 'write'), SessionAlreadyOwnedError)
  await handle.append([event(1)])
  state.failNext = true
  await assert.rejects(handle.close(), /injected storage failure/u)
  await handle.append([event(2)])
  await handle.close()

  const reopened = await persistence.open('postgres-failure-session', 'write')
  assert.deepEqual((await reopened.read()).events.map(item => item.seq), [0, 1, 2])
  await reopened.close()
})

test('a replaced provider reads the complete history and the old handle never regains write access', { timeout: 60000 }, async t => {
  const database = await newDatabase()
  const firstContext = new Context()
  const firstStorage = await PostgresStorage.open({ ...postgres.configuration, database })
  const first = new StorageSessionPersistence(firstContext, firstStorage)
  const id = 'replacement-session'
  const handle = await first.create(header(id))
  await handle.append([event(0, { kept: true }), event(1)])
  await first.flush()

  const secondContext = new Context()
  const secondStorage = await PostgresStorage.open({ ...postgres.configuration, database })
  const second = new StorageSessionPersistence(secondContext, secondStorage)
  t.after(async () => {
    await second.close().catch(() => {})
    await secondStorage.close()
    await secondContext.fiber.dispose()
    await first.close().catch(() => {})
    await firstStorage.close()
    await firstContext.fiber.dispose()
  })
  await assert.rejects(second.open(id, 'write'), SessionAlreadyOwnedError)

  await handle.close()
  await assert.rejects(handle.append([event(2)]), SessionHandleClosedError)

  const replacement = await second.open(id, 'write')
  const stored = await replacement.read()
  assert.deepEqual(stored.events.map(item => item.seq), [0, 1])
  assert.equal(stored.events[0].data.kept, true)
  await replacement.append([event(2)])
  await replacement.close()
  assert.deepEqual((await readEvents(second, id)).map(item => item.seq), [0, 1, 2])
})

test('the public DSH loop stores construction records before session/created over PostgreSQL', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-postgres-announce-'))
  const database = await newDatabase()
  let native
  t.after(async () => { await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Announcement turn complete.'), {
    persistence: PostgresPersistence,
    persistenceConfig: { ...postgres.configuration, database },
  })

  const forkContext = new Context()
  await forkContext.plugin(SessionStore)
  const liveParent = forkContext.sessions.create('postgres-announce-parent', { cwd: directory })
  liveParent.append('session/end-seed', {})
  const child = forkContext.sessions.fork(liveParent, undefined, 'postgres-announced-session')
  const seed = child.snapshotEvents()
  const childHeader = child.header
  const inheritedEventCount = child.inheritedEventCount
  await forkContext.fiber.dispose()

  const persistence = native.get('sessionPersistence')
  let observed
  native.on('session/created', session => {
    if (session.id !== childHeader.id) return
    observed = persistence.open(session.id, 'read').then(async handle => {
      const result = await handle.read()
      await handle.close()
      return result.events
    })
  })
  const handle = await native.agents.create({
    sessionId: childHeader.id, seed, inheritedEventCount,
    meta: { cwd: directory, parentSession: childHeader.parentSession, isSeeded: true },
    agentOptions: { provider: 'mock', model: 'worker' },
  })
  const announced = await observed
  await handle.dispose()
  assert.equal(announced.length, seed.length)
  assert.equal(announced.at(-1)?.type, 'session/end-seed')
  assert.deepEqual(announced.map(item => item.seq), seed.map(item => item.seq))
})

test('a durability failure while storing the pre-publication suffix prevents session/created over PostgreSQL', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-postgres-rollback-'))
  const database = await newDatabase()
  let native
  t.after(async () => { await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Unused.'), {
    persistence: PostgresPersistence,
    persistenceConfig: { ...postgres.configuration, database },
  })
  const persistence = native.get('sessionPersistence')
  const create = persistence.create.bind(persistence)
  let failNext = true
  persistence.create = async (value, options) => {
    const handle = await create(value, options)
    if (!failNext) return handle
    failNext = false
    handle.append = async () => { throw new Error('injected pre-publication durability failure') }
    return handle
  }
  let announced = 0
  native.on('session/created', () => { announced++ })
  await assert.rejects(native.agents.create({
    sessionId: 'unannounced-postgres-session',
    seed: [],
    agentOptions: { provider: 'mock', model: 'worker' },
  }), /injected pre-publication durability failure/u)
  assert.equal(announced, 0)
  assert.equal(await persistence.stat('unannounced-postgres-session'), undefined)
  assert.deepEqual(await persistence.list(), [])
})

test('a Worker Session resumes its full history after the PostgreSQL adapter is replaced', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-postgres-resume-'))
  const database = await newDatabase()
  let firstNative
  let secondNative
  let first
  let second
  t.after(async () => {
    await first?.close(); await second?.close()
    await firstNative?.fiber.dispose(); await secondNative?.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const prompts = []
  const persist = {
    persistence: PostgresPersistence,
    persistenceConfig: { ...postgres.configuration, database },
  }
  firstNative = await nativeContext(directory, options => {
    prompts.push(options.messages.filter(message => message.role === 'user')
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')))
    return textResponse('Worker turn complete.')
  }, persist)
  first = new core.NativeSessions(firstNative, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await first.run({ sessionId: 'postgres-worker', role: 'worker', text: 'First persistent turn.', tools: [] })
  await first.close()
  first = undefined
  const before = await readEvents(firstNative.get('sessionPersistence'), 'postgres-worker')
  await firstNative.fiber.dispose()
  firstNative = undefined

  secondNative = await nativeContext(directory, options => {
    prompts.push(options.messages.filter(message => message.role === 'user')
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')))
    return textResponse('Worker turn complete.')
  }, persist)
  second = new core.NativeSessions(secondNative, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await second.run({ sessionId: 'postgres-worker', role: 'worker', text: 'Second persistent turn.', tools: [] })
  await second.close()
  const after = await readEvents(secondNative.get('sessionPersistence'), 'postgres-worker')
  assert.deepEqual(prompts[1], ['First persistent turn.', 'Second persistent turn.'])
  assert.ok(after.length > before.length)
  assert.deepEqual(after.slice(0, before.length), before)
  assert.ok(after.some(item => item.type === 'session/end-seed'))
  assert.ok(after.some(item => item.type === 'assistant/message'))
})
