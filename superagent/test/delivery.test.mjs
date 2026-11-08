import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function fixture(t, channel, effects = {}, versioned = false) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-delivery-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    ...(versioned ? { allowedThreadIds: ['room'], versionOrder: 'sequence' } : {}),
  }, effects, undefined, [], {}, {}, {}, { channel })
  return { engine, storage, directory }
}

test('acknowledgement is queryable before delivery and retries reuse one channel message', async t => {
  const calls = []
  const { engine } = await fixture(t, {
    deliver: async (delivery, context) => {
      calls.push({ purpose: delivery.purpose, text: delivery.text, key: context.idempotencyKey })
      return { type: 'success' }
    },
  })
  const command = { commandId: 'request', eventId: 'message', text: 'Inspect the project.' }
  const receipt = await engine.submit(command)
  const pending = await engine.getTicketDeliveries(receipt.ticketId)
  assert.deepEqual(pending.map(delivery => [delivery.purpose, delivery.state]), [['acknowledgement', 'pending']])
  await engine.effects.drain()
  await engine.effects.drain()
  const delivered = await engine.getTicketDeliveries(receipt.ticketId)
  assert.deepEqual(delivered.map(delivery => [delivery.purpose, delivery.state, delivery.attempts]), [['acknowledgement', 'sent', 1]])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].purpose, 'acknowledgement')
  assert.equal(calls[0].text, 'Request accepted.')

  await engine.submit({ ...command, commandId: 'transport-retry' })
  await engine.effects.drain()
  assert.equal(calls.length, 1)
  assert.equal((await engine.getTicketDeliveries(receipt.ticketId)).length, 1)
})

test('a temporarily unavailable destination waits with its reason and a permanent failure drops the delivery', async t => {
  let now = 100
  let attempts = 0
  const transient = await fixture(t, {
    deliver: async () => {
      attempts++
      return attempts === 1 ? { type: 'transient', reason: 'SOURCE_TEMPORARILY_CLOSED' } : { type: 'success' }
    },
  }, { now: () => now, retryDelayMs: 1 })
  const transientReceipt = await transient.engine.submit({ commandId: 'transient', eventId: 'transient-message', text: 'Try the source.' })
  await transient.engine.effects.drain()
  let waiting = (await transient.engine.getTicketDeliveries(transientReceipt.ticketId))[0]
  assert.equal(waiting.state, 'pending')
  assert.equal(waiting.reason, 'SOURCE_TEMPORARILY_CLOSED')
  now += 10
  await transient.engine.effects.drain()
  const delivered = (await transient.engine.getTicketDeliveries(transientReceipt.ticketId))[0]
  assert.equal(delivered.state, 'sent')
  assert.equal(delivered.attempts, 2)

  const permanent = await fixture(t, { deliver: async () => ({ type: 'permanent', reason: 'DESTINATION_UNREACHABLE' }) })
  const permanentReceipt = await permanent.engine.submit({ commandId: 'permanent', eventId: 'permanent-message', text: 'Send once.' })
  await permanent.engine.effects.drain()
  const dropped = (await permanent.engine.getTicketDeliveries(permanentReceipt.ticketId))[0]
  assert.equal(dropped.state, 'dropped')
  assert.equal(dropped.reason, 'DESTINATION_UNREACHABLE')
})

test('an answer requires a current human question and returns to that exact message', async t => {
  const calls = []
  const { engine } = await fixture(t, {
    deliver: async delivery => { calls.push(delivery); return { type: 'success' } },
  }, {}, true)
  const question = await engine.receiveSource({ commandId: 'question', threadId: 'room', objectId: 'question-1', type: 'created',
    version: '1', text: 'What is the current status?', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const receipt = await engine.acceptSource({ commandId: 'accept-question', threadId: 'room', objectId: 'question-1', expectedEventId: question.eventId })
  const queued = await engine.queueAnswer({ commandId: 'answer', ticketId: receipt.ticketId, questionEventId: question.eventId,
    text: 'The work is ready for review.', fact: 'The ready report names the verified artifact.' })
  assert.equal(queued.state, 'pending')
  await engine.effects.drain()
  const answer = (await engine.getTicketDeliveries(receipt.ticketId)).find(delivery => delivery.purpose === 'answer')
  assert.equal(answer.state, 'sent')
  assert.deepEqual(answer.destination, { sourceInstanceId: 'desktop', actorId: 'alice', eventId: 'question-1', threadId: 'room' })
  assert.deepEqual(calls.map(delivery => delivery.purpose), ['acknowledgement', 'answer'])

  await assert.rejects(engine.queueAnswer({ commandId: 'missing-question', ticketId: receipt.ticketId, questionEventId: 'missing',
    text: 'No answer.', fact: 'No fact.' }), { code: 'NOT_FOUND' })
  await engine.receiveSource({ commandId: 'delete-question', threadId: 'room', objectId: 'question-1', type: 'deleted',
    version: '2', deletionEvidence: 'Removed in the source.' })
  await assert.rejects(engine.queueAnswer({ commandId: 'stale-question', ticketId: receipt.ticketId, questionEventId: question.eventId,
    text: 'Too late.', fact: 'The question was deleted.' }), { code: 'SOURCE_NOT_CURRENT' })
})

test('a native result is delivered after its acknowledgement with a current-report receipt', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-delivery-runtime-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const calls = []
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (!completed) yield* toolResponse('report_ready', { result: 'The answer is 4.', evidence: 'Computed 2 + 2 = 4.' })
      else yield* textResponse('Recorded.')
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
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {},
    sessions, [], {}, {}, {}, { channel: { deliver: async delivery => { calls.push(delivery); return { type: 'success' } } } })
  const receipt = await engine.submit({ commandId: 'runtime', eventId: 'runtime-message', text: 'What is 2 + 2?' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.deepEqual(calls.map(delivery => delivery.purpose), ['acknowledgement', 'result'])
  const deliveries = await engine.getTicketDeliveries(receipt.ticketId)
  assert.deepEqual(deliveries.map(delivery => [delivery.purpose, delivery.state]), [['acknowledgement', 'sent'], ['result', 'sent']])
  const result = deliveries.find(delivery => delivery.purpose === 'result')
  assert.equal(result.reportId, (await engine.conversation(receipt.ticketId)).reports[0].id)
  assert.equal(result.text, 'The answer is 4.')
})
