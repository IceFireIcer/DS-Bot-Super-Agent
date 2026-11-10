import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import { PostgresStorage } from '../dist/postgres-storage.js'
import { StorageSessionPersistence } from '../dist/session-persistence.js'
import { startPostgres } from './fixtures/postgres-harness.mjs'

const fixture = fileURLToPath(new URL('./fixtures/host-takeover.mjs', import.meta.url))
const postgres = await startPostgres('ds-superagent-host-takeover-')
const opened = []

after(async () => {
  await Promise.allSettled(opened.map(storage => storage.close()))
  await postgres.close()
})

function start(configuration, hostId, mode, ticketId) {
  const child = spawn(process.execPath, [fixture, JSON.stringify(configuration), hostId, mode, '1500', ticketId ?? ''],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout })
  const errors = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => errors.push(chunk))
  const first = new Promise((resolve, reject) => {
    lines.once('line', line => resolve(JSON.parse(line)))
    child.once('exit', code => reject(new Error(`Host process exited before reporting (${code}): ${errors.join('')}`)))
  })
  return { child, lines, errors, first, exited: new Promise(resolve => child.once('exit', resolve)) }
}

async function waitForLeaseExpiry() {
  await new Promise(resolve => setTimeout(resolve, 2200))
}

test('two real processes share one PostgreSQL Instance; the replacement reconciles before accepting work and the old process stays fenced', { timeout: 120000 }, async t => {
  const database = await postgres.createDatabase()
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-process-'))
  const configuration = { ...postgres.configuration, database, sessionDirectory: join(directory, 'sessions') }
  const parentStorage = await PostgresStorage.open({ ...postgres.configuration, database })
  opened.push(parentStorage)
  const persistence = new StorageSessionPersistence(new Context(), parentStorage)
  const children = []
  t.after(async () => {
    for (const child of children) if (child.child.exitCode === null && child.child.signalCode === null) child.child.kill()
    await persistence.close().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })

  const holder = start(configuration, 'process-host-a', 'hold')
  children.push(holder)
  const held = await holder.first
  assert.equal(held.ok, true, JSON.stringify(held))
  assert.equal(held.epoch, 1)
  assert.equal(typeof held.ticketId, 'string')
  assert.equal(typeof held.assignmentId, 'string')
  assert.equal(typeof held.sessionId, 'string')

  const contender = start(configuration, 'process-host-b', 'try')
  children.push(contender)
  assert.deepEqual(await contender.first, { ok: false, hostId: 'process-host-b', code: 'HOST_LEASED' })
  await contender.exited

  await assert.rejects(persistence.open(SessionId(held.sessionId), 'write'), SessionAlreadyOwnedError)
  const readable = await persistence.open(SessionId(held.sessionId), 'read')
  assert.deepEqual((await readable.read()).events.map(event => event.seq), [0])
  await readable.close()

  holder.child.kill('SIGKILL')
  await holder.exited
  await waitForLeaseExpiry()

  const replacement = start(configuration, 'process-host-b', 'takeover')
  children.push(replacement)
  const taken = await replacement.first
  assert.equal(taken.ok, true, JSON.stringify(taken))
  assert.equal(taken.epoch, 2)
  assert.equal(taken.takeover.state, 'completed')
  assert.equal(taken.takeover.epoch, 2)
  assert.equal(taken.takeover.tickets.length, 1)
  assert.equal(taken.takeover.tickets[0].outcome, 'resumed')
  assert.equal(taken.assignments.length, 1)
  const successor = taken.assignments[0]
  assert.equal(successor.ticketId, held.ticketId)
  assert.notEqual(successor.assignmentId, held.assignmentId)
  assert.equal(successor.state, 'pending')
  assert.equal(successor.recovery.reason, 'HOST_REPLACED')
  assert.equal(successor.history, 2)

  const writer = await persistence.open(SessionId(held.sessionId), 'write')
  const shared = await writer.read()
  assert.deepEqual(shared.events.map(event => event.seq), [0])
  await writer.append([{ type: 'session/end-seed', seq: 1, time: Date.now(), data: { fromHost: 'process-host-b' } }])
  await writer.close()
  assert.equal((await persistence.stat(SessionId(held.sessionId))).eventCount, 2)

  const resurrected = start(configuration, 'process-host-a', 'resurrect', held.ticketId)
  children.push(resurrected)
  const fenced = await resurrected.first
  assert.equal(fenced.ok, false)
  assert.equal(fenced.code, 'HOST_LEASED')
  await resurrected.exited
  replacement.child.kill('SIGKILL')
  await replacement.exited
})
