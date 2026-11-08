import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

test('a running Worker is stopped with explicit cancellation confirmation and resumes only by command', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-stop-'))
  let native, storage, sessions, engine, release
  let started
  let startedOnce = false
  const workerStarted = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(async () => {
    release?.()
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (text === 'Long task.') {
        if (!startedOnce) {
          startedOnce = true
          started()
          // Simulate a Host that stops responding before it can record cancellation confirmation.
          await gate
        }
        yield* textResponse('Incomplete.')
      } else if (text.startsWith('Continue after resume.') && !completed) yield* toolResponse('report_ready', { result: 'Resumed safely.', evidence: 'Created a new Assignment.' })
      else yield* textResponse('Worker idle.')
      return
    }
    const tool = options.tools[completed]
    if (!tool) { yield* textResponse('Router complete.'); return }
    if (tool.name.startsWith('deliver_result')) {
      const ready = JSON.parse(text.slice('Ready report:'.length))
      yield* toolResponse(tool.name, { reportId: ready.id }, `router-${completed}`)
    } else yield* toolResponse(tool.name, {}, `router-${completed}`)
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const receipt = await engine.submit({ commandId: 'long', eventId: 'long-message', text: 'Long task.' })
  const draining = (async () => { for (let index = 0; index < 5; index++) await engine.effects.drain() })()
  await workerStarted
  const initial = await engine.conversation(receipt.ticketId)
  const firstAssignment = initial.assignments[0]
  const otherSource = new core.Engine(storage, 'private', { sourceInstanceId: 'other', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  await assert.rejects(otherSource.stopTicket({ commandId: 'foreign-stop', ticketId: receipt.ticketId, reason: 'Foreign source.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
  const stopping = await engine.stopTicket({ commandId: 'stop-long', ticketId: receipt.ticketId, reason: 'The direction is wrong.' })
  assert.equal(stopping.status, 'stopping')
  assert.equal(stopping.stop.state, 'stopping')
  await assert.rejects(engine.resumeTicket({ commandId: 'too-early', ticketId: receipt.ticketId }), { code: 'STOPPING' })
  const interrupted = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const recovered = await interrupted.conversation(receipt.ticketId)
  assert.equal(recovered.status, 'stopped')
  assert.equal(recovered.stop?.recoveryReason, 'ENGINE_RESTARTED')
  assert.equal(recovered.stop?.cancellationConfirmedAt, undefined)
  await assert.rejects(interrupted.resumeTicket({ commandId: 'resume-unconfirmed', ticketId: receipt.ticketId }), { code: 'CANCELLATION_UNCONFIRMED' })
  release()
  await draining
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  const stopped = await engine.conversation(receipt.ticketId)
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.stop.state, 'stopped')
  assert.ok(stopped.stop.cancellationConfirmedAt)
  assert.equal(stopped.assignments[0].state, 'ended')
  const reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const persisted = await reopened.conversation(receipt.ticketId)
  assert.equal(persisted.status, 'stopped')
  assert.equal(persisted.stop?.state, 'stopped')
  await storage.transaction('private', tx => tx.insert('effect', 'unknown-stop-probe', {
    key: 'unknown-stop-probe', stream: 'relay', scope: receipt.ticketId, payload: { ticketId: receipt.ticketId },
    id: 'unknown-stop-probe', generation: 'unknown-stop-probe', queueKey: '9999999999999999', state: 'unknown', attempts: 1, availableAt: Date.now(),
  }))
  await assert.rejects(engine.resumeTicket({ commandId: 'resume-with-unknown', ticketId: receipt.ticketId }), { code: 'UNKNOWN_OUTCOME' })
  await storage.transaction('private', tx => tx.remove('effect', 'unknown-stop-probe'))

  const resumed = await engine.resumeTicket({ commandId: 'resume-long', ticketId: receipt.ticketId })
  assert.equal(resumed.status, 'pending')
  const resumedConversation = await engine.conversation(receipt.ticketId)
  assert.notEqual(resumedConversation.assignments[0].id, firstAssignment.id)
  assert.notEqual(resumedConversation.assignments[0].generation, firstAssignment.generation)
  assert.equal(resumedConversation.assignments[0].sessionId, firstAssignment.sessionId)
  assert.equal(resumedConversation.assignmentHistory.some(assignment => assignment.id === firstAssignment.id), true)
  assert.equal(resumedConversation.assignmentHistory.some(assignment => assignment.id === resumedConversation.assignments[0].id), true)
  assert.equal(resumedConversation.stopHistory.some(stop => stop.id === stopped.stop?.id), true)
  assert.equal(resumedConversation.resumeHistory.length, 1)
  const replay = await engine.stopTicket({ commandId: 'stop-long', ticketId: receipt.ticketId, reason: 'The direction is wrong.' })
  assert.equal(replay.status, 'pending')
  await assert.rejects(engine.stopTicket({ commandId: 'stop-long', ticketId: receipt.ticketId, reason: 'Different reason.' }), { code: 'IDENTITY_CONFLICT' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.getTicket(receipt.ticketId)).ticket.constraint, undefined)
})

test('opening an interrupted Engine cannot race an unconfirmed stop past the resume barrier', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-stop-recovery-race-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, () => textResponse('Idle.'))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const receipt = await engine.submit({ commandId: 'race-request', eventId: 'race-message', text: 'Slow task.' })
  await engine.stopTicket({ commandId: 'race-stop', ticketId: receipt.ticketId, reason: 'Stop before restart.' })
  await storage.transaction('private', async transaction => {
    const head = await transaction.get('stop-head', JSON.stringify(['stop-head', receipt.ticketId]))
    const stop = await transaction.get('stop-state', head.stopId)
    await transaction.replace('stop-state', stop.id, { ...stop, state: 'stopping', runtimeToken: 'previous-engine', cancellationConfirmedAt: undefined })
  })
  const reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  await reopened.conversation(receipt.ticketId)
  await assert.rejects(reopened.resumeTicket({ commandId: 'race-resume', ticketId: receipt.ticketId }), { code: 'CANCELLATION_UNCONFIRMED' })
})

test('ordinary follow-ups and restart cannot clear a stopped Ticket', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-stop-followup-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, () => textResponse('Idle.'))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] } }
  engine = new core.Engine(storage, 'private', source, {}, sessions)
  const received = await engine.receiveSource({ commandId: 'stop-follow-initial', threadId: 'room', objectId: 'stop-follow-1', type: 'created', version: '1', text: 'Initial request.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.assessSourceBatch({ commandId: 'stop-follow-eval', threadId: 'room', eventIds: [received.eventId] })
  const ticketId = accepted.receipts[0].ticketId
  await engine.stopTicket({ commandId: 'stop-before-dispatch', ticketId, reason: 'No dispatch.' })
  const followup = await engine.receiveSource({ commandId: 'stopped-followup', threadId: 'room', objectId: 'stop-follow-2', type: 'created', version: '1', text: 'More direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const direction = await engine.getTicketDirection(ticketId)
  assert.equal(direction.fanouts.find(fanout => fanout.eventId === followup.eventId)?.reason, 'BLOCKED_STOPPED')
  assert.deepEqual(direction.inputs, [])
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  assert.deepEqual((await engine.conversation(ticketId)).assignments, [])
  const reopened = new core.Engine(storage, 'private', source, {}, sessions)
  const persisted = await reopened.conversation(ticketId)
  assert.equal(persisted.status, 'stopped')
  assert.equal(persisted.stop?.state, 'stopped')
})

test('the chat preview exposes stop and resume controls through same-origin routes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-stop-chat-'))
  let native, storage, sessions, engine, chat
  t.after(async () => {
    await chat?.close(); await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, () => textResponse('Idle.'))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  chat = await core.createChatServer(engine)
  assert.match(await (await fetch(chat.url)).text(), /mountControls/u)
  const receipt = await (await fetch(`${chat.url}/request`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'chat-stop-request', eventId: 'chat-stop-message', text: 'Stop from preview.' }) })).json()
  const stopped = await (await fetch(`${chat.url}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'chat-stop', ticketId: receipt.ticketId, reason: 'User stopped it.' }) })).json()
  assert.equal(stopped.status, 'stopped')
  const resumed = await (await fetch(`${chat.url}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'chat-resume', ticketId: receipt.ticketId }) })).json()
  assert.equal(resumed.status, 'pending')
})
