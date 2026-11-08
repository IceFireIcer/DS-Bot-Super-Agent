import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import * as SqlitePersistence from '../dist/session-persistence.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'
import { completedToolCount, lastUserText, sourceConfig } from './input-support.mjs'

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL('./fixtures/input-crash.mjs', import.meta.url))
const phases = [
  ['before-claim', 21],
  ['after-claim', 22],
  ['after-append', 23],
  ['flush-failure', 24],
  ['after-receipt', 25],
]

function respond(options) {
  const text = lastUserText(options)
  if (completedToolCount(options)) return textResponse('Recorded.')
  if (text.includes('Follow-up change.') || text.includes('persisted follow-up')) {
    return toolResponse('report_ready', { result: 'Recovered follow-up complete.', evidence: 'Inspected retained state and completed the request.' })
  }
  if (text === 'Initial request.') return toolResponse('report_ready', { result: 'Initial complete.', evidence: 'Completed the initial request.' })
  return textResponse('Continue.')
}

const messageText = event => event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')

async function reopen(directory, databasePath, sessionDatabasePath, t) {
  const storage = await SqliteStorage.open(databasePath)
  const native = await nativeContext(directory, respond,
    { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabasePath } })
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new Engine(storage, 'private', sourceConfig(), { now: () => Date.now() + 600000 }, sessions)
  t.after(async () => { await engine.effects.stop(); await sessions.close(); await native.fiber.dispose(); await storage.close(); await rm(directory, { recursive: true, force: true }) })
  return { engine, native }
}

for (const [phase, code] of phases) {
  test(`a real process exit at ${phase} reopens to the right unread boundary without re-appending the user message`, { timeout: 40000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), `ds-bot-input-crash-${phase}-`))
    const databasePath = join(directory, 'state.sqlite')
    const sessionDatabasePath = join(directory, 'sessions.sqlite')
    const markerPath = join(directory, 'marker.txt')
    let child
    try {
      child = await execute(process.execPath, [fixture, databasePath, sessionDatabasePath, phase, markerPath], { timeout: 30000 })
    } catch (error) {
      assert.equal(error.code, code, `${phase}: ${error.stderr ?? ''}`)
    }
    if (child) assert.fail(`${phase} exited 0; marker=${await readFile(markerPath, 'utf8').catch(() => '')} stdout=${child.stdout} stderr=${child.stderr}`)

    const { engine, native } = await reopen(directory, databasePath, sessionDatabasePath, t)
    const ticketId = (await engine.listTickets()).items[0].ticket.id
    const before = (await engine.getTicketDirection(ticketId)).inputs[0]
    if (phase === 'before-claim') assert.equal(before.delivery, undefined)
    else if (phase === 'after-receipt') assert.ok(before.delivery.persistedAt, JSON.stringify(before))
    else if (phase === 'after-append' || phase === 'flush-failure') {
      assert.ok(before.delivery?.sentAt, JSON.stringify(before))
      const preHandle = await native.get('sessionPersistence').open(before.delivery.sessionId, 'read')
      const preEvents = (await preHandle.read()).events
      await preHandle.close()
      assert.ok(preEvents.some(event => event.type === 'user/message' && event.data.id === before.delivery.messageId))
    }
    else if (phase === 'after-claim') {
      assert.ok(before.delivery?.claimedAt, JSON.stringify(before))
      assert.equal(before.delivery.persistedAt, undefined, `${phase} must not confirm history before the flush barrier`)
    }
    assert.equal(before.state, 'pending')
    const beforeOwnership = (await engine.getTicketDirection(ticketId)).ownerships.find(ownership => ownership.inputId === before.id)
    assert.equal(beforeOwnership?.state, 'owned')

    engine.effects.start()
    let after = (await engine.getTicketDirection(ticketId)).inputs[0]
    for (let attempt = 0; attempt < 750; attempt++) {
      const delivery = after.delivery
      const expected = phase === 'before-claim' || phase === 'after-claim' ? delivery?.messageId : delivery?.recoveryMessageId
      if (after.state === 'delivered' && delivery?.persistedAt && delivery.completedAt && delivery.persistedMessageId === expected) break
      await engine.effects.drain()
      await new Promise(resolve => setTimeout(resolve, 20))
      after = (await engine.getTicketDirection(ticketId)).inputs[0]
    }
    assert.equal(after.state, 'delivered', JSON.stringify(after))
    assert.ok(after.delivery.claimedAt)
    assert.ok(after.delivery.sentAt)
    assert.ok(after.delivery.persistedAt)
    assert.ok(after.delivery.persistedSeq >= 0)
    assert.ok(after.delivery.completedAt)
    assert.equal(after.delivery.outcome, 'ready')
    const afterOwnership = (await engine.getTicketDirection(ticketId)).ownerships.find(ownership => ownership.inputId === after.id)
    assert.equal(afterOwnership?.state, 'owned')
    const persistence = native.get('sessionPersistence')
    const handle = await persistence.open(after.delivery.sessionId, 'read')
    const events = (await handle.read()).events
    await handle.close()
    const originals = events.filter(event => event.type === 'user/message' && messageText(event) === 'Follow-up change.')
    assert.equal(originals.length, 1, `the original user message must appear exactly once for ${phase}`)
    assert.equal(originals[0].data.id, after.delivery.messageId)
    const recoveries = events.filter(event => event.type === 'user/message' && messageText(event).includes('persisted follow-up'))
    if (phase === 'before-claim' || phase === 'after-claim') {
      assert.equal(recoveries.length, 0)
      assert.equal(after.delivery.persistedMessageId, after.delivery.messageId)
    } else {
      assert.equal(recoveries.length, 1, `the persisted boundary must continue with one recovery note for ${phase}`)
      assert.equal(after.delivery.persistedMessageId, after.delivery.recoveryMessageId)
    }
  })
}

test('an idle turn keeps the Input unworked and a restart continues with a recovery note', { timeout: 40000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-input-idle-'))
  const databasePath = join(directory, 'state.sqlite')
  const sessionDatabasePath = join(directory, 'sessions.sqlite')
  const storage = await SqliteStorage.open(databasePath)
  const native = await nativeContext(directory, options => {
    const text = lastUserText(options)
    if (completedToolCount(options)) return textResponse('Recorded.')
    if (text === 'Initial request.') return toolResponse('report_ready', { result: 'Initial complete.', evidence: 'Completed the initial request.' })
    return textResponse('Only an idle response, not a result.')
  }, { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabasePath } })
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new Engine(storage, 'private', sourceConfig(), {}, sessions)
  let firstClosed = false
  t.after(async () => {
    if (firstClosed) return
    await engine.effects.stop().catch(() => {}); await sessions.close(); await native.fiber.dispose(); await storage.close()
  })
  const initial = await engine.receiveSource({ commandId: 'initial-idle', threadId: 'room', objectId: 'idle-1', type: 'created', version: '1',
    text: 'Initial request.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.assessSourceBatch({ commandId: 'eval-idle', threadId: 'room', eventIds: [initial.eventId] })
  const ticketId = accepted.receipts[0].ticketId
  for (let attempt = 0; attempt < 300 && (await engine.getTicketDirection(ticketId))?.state !== 'ended'; attempt++) {
    await engine.effects.drain()
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await engine.receiveSource({ commandId: 'followup-idle', threadId: 'room', objectId: 'idle-2', type: 'created', version: '1',
    text: 'Follow-up change.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  let input
  for (let attempt = 0; attempt < 300; attempt++) {
    await engine.effects.drain()
    input = (await engine.getTicketDirection(ticketId)).inputs[0]
    if (input?.delivery?.persistedAt !== undefined) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await engine.effects.drain()
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(input.delivery.persistedAt)
  assert.equal(input.delivery.completedAt, undefined)
  assert.equal(input.state, 'pending')

  await engine.effects.stop()
  await sessions.close()
  await native.fiber.dispose()
  await storage.close()
  firstClosed = true

  const reopened = await reopen(directory, databasePath, sessionDatabasePath, t)
  reopened.engine.effects.start()
  let after = (await reopened.engine.getTicketDirection(ticketId)).inputs[0]
  for (let attempt = 0; attempt < 300; attempt++) {
    if (after.state === 'delivered' && after.delivery?.persistedAt && after.delivery.completedAt
      && after.delivery.persistedMessageId === after.delivery.recoveryMessageId) break
    await reopened.engine.effects.drain()
    await new Promise(resolve => setTimeout(resolve, 20))
    after = (await reopened.engine.getTicketDirection(ticketId)).inputs[0]
  }
  assert.equal(after.state, 'delivered')
  assert.equal(after.delivery.outcome, 'ready')
  assert.ok(after.delivery.persistedSeq >= 0)
  const handle = await reopened.native.get('sessionPersistence').open(after.delivery.sessionId, 'read')
  const events = (await handle.read()).events
  await handle.close()
  assert.equal(after.delivery.persistedMessageId, after.delivery.recoveryMessageId, JSON.stringify(after.delivery))
  assert.equal(events.filter(event => event.type === 'user/message' && messageText(event) === 'Follow-up change.').length, 1)
  assert.equal(events.filter(event => event.type === 'user/message' && messageText(event).includes('persisted follow-up')).length, 1)
})

test('a handed-back Input stays unowned across a restart and is never re-attached to the same Ticket', { timeout: 40000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-input-handback-'))
  const databasePath = join(directory, 'state.sqlite')
  const sessionDatabasePath = join(directory, 'sessions.sqlite')
  const storage = await SqliteStorage.open(databasePath)
  const native = await nativeContext(directory, options => {
    const text = lastUserText(options)
    if (completedToolCount(options)) return textResponse('Recorded.')
    if (text === 'Initial request.') return toolResponse('report_ready', { result: 'Initial complete.', evidence: 'Completed the initial request.' })
    return toolResponse('handback_input', { reason: 'This follow-up is outside the original Ticket scope.' })
  }, { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabasePath } })
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new Engine(storage, 'private', sourceConfig(), {}, sessions)
  let firstClosed = false
  t.after(async () => {
    if (firstClosed) return
    await engine.effects.stop().catch(() => {}); await sessions.close(); await native.fiber.dispose(); await storage.close()
  })
  const initial = await engine.receiveSource({ commandId: 'initial-handback', threadId: 'room', objectId: 'handback-1', type: 'created', version: '1',
    text: 'Initial request.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.assessSourceBatch({ commandId: 'eval-handback', threadId: 'room', eventIds: [initial.eventId] })
  const ticketId = accepted.receipts[0].ticketId
  for (let attempt = 0; attempt < 300 && (await engine.getTicketDirection(ticketId))?.state !== 'ended'; attempt++) {
    await engine.effects.drain()
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await engine.receiveSource({ commandId: 'followup-handback', threadId: 'room', objectId: 'handback-2', type: 'created', version: '1',
    text: 'Follow-up change.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  let input
  for (let attempt = 0; attempt < 300; attempt++) {
    await engine.effects.drain()
    input = (await engine.getTicketDirection(ticketId)).inputs[0]
    if (input?.delivery?.completedAt !== undefined) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(input.delivery.outcome, 'handback')
  assert.equal(input.state, 'delivered')
  assert.equal((await engine.getTicketDirection(ticketId)).ownerships.find(ownership => ownership.inputId === input.id)?.state, 'handed-back')
  await engine.effects.stop()
  await sessions.close()
  await native.fiber.dispose()
  await storage.close()
  firstClosed = true

  const reopened = await reopen(directory, databasePath, sessionDatabasePath, t)
  reopened.engine.effects.start()
  for (let attempt = 0; attempt < 20; attempt++) {
    await reopened.engine.effects.drain()
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal((await reopened.engine.effects.list()).items.some(effect => effect.key === `followup:${input.id}`), false)
  assert.equal((await reopened.engine.getTicketDirection(ticketId)).ownerships.find(ownership => ownership.inputId === input.id)?.state, 'handed-back')
  const handle = await reopened.native.get('sessionPersistence').open(input.delivery.sessionId, 'read')
  const events = (await handle.read()).events
  await handle.close()
  assert.equal(events.filter(event => event.type === 'user/message' && messageText(event) === 'Follow-up change.').length, 1)
  assert.equal(events.filter(event => event.type === 'user/message' && messageText(event).includes('persisted follow-up')).length, 0)
})
