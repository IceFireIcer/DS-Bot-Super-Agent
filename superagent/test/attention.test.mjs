import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function runtimeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-attention-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const workerTurns = []
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (!completed) workerTurns.push(text)
      if (text === 'Request a human decision.' && !completed) {
        yield* toolResponse('ask_human', { question: 'Which color should be used?', options: 'Blue\nGreen' })
      } else if (text === 'Use the blue option.' && !completed) {
        yield* toolResponse('report_ready', { result: 'Used the blue option.', evidence: 'Applied the answered color choice.' })
      } else yield* textResponse('Waiting or complete.')
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
  engine = new core.Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  return { engine, workerTurns }
}

test('a Worker question persists waiting-human and an authorized answer resumes the same Session', { timeout: 15000 }, async t => {
  const { engine, workerTurns } = await runtimeFixture(t)
  const receipt = await engine.submit({ commandId: 'question-request', eventId: 'question-message', text: 'Request a human decision.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  let conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'waiting-human', JSON.stringify({ conversation, effects: await engine.effects.list() }))
  assert.equal(conversation.attention.question, 'Which color should be used?')
  assert.deepEqual(conversation.attention.options, ['Blue', 'Green'])
  assert.equal(conversation.attention.destination.eventId, 'question-message')
  const assignment = conversation.assignments[0]
  assert.equal(assignment.state, 'ended')
  assert.deepEqual(conversation.messages.map(message => message.purpose), ['acknowledgement', 'attention'])
  assert.equal(conversation.messages.some(message => message.purpose === 'attention' && message.text === conversation.attention.question), true)
  let direction = await engine.getTicketDirection(receipt.ticketId)
  assert.deepEqual(direction.constraint, { kind: 'waiting-human', attentionId: conversation.attention.id, reason: 'Which color should be used?' })

  const answered = await engine.answerAttention({ commandId: 'answer-question', attentionId: conversation.attention.id, text: 'Use the blue option.' })
  assert.equal(answered.attention.status, 'answered')
  assert.equal(answered.attention.answerText, 'Use the blue option.')
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'ready')
  assert.equal(conversation.assignments[0].id, assignment.id)
  assert.equal(conversation.assignments[0].sessionId, assignment.sessionId)
  assert.equal(conversation.reports[0].result, 'Used the blue option.')
  assert.equal(conversation.attention.status, 'answered')
  direction = await engine.getTicketDirection(receipt.ticketId)
  assert.equal(direction.directionVersion, 2)
  assert.equal(direction.constraint, undefined)
  assert.deepEqual(workerTurns, ['Request a human decision.', 'Use the blue option.'])
  const replay = await engine.answerAttention({ commandId: 'answer-question', attentionId: conversation.attention.id, text: 'Use the blue option.' })
  assert.deepEqual(replay.attention, answered.attention)
  assert.equal(replay.input.id, answered.input.id)
  await assert.rejects(engine.answerAttention({ commandId: 'stale-answer', attentionId: conversation.attention.id, text: 'Use green.' }), { code: 'ATTENTION_STALE' })
})

test('the chat preview exposes and accepts an inline authorized Attention answer', { timeout: 15000 }, async t => {
  const { engine } = await runtimeFixture(t)
  const chat = await core.createChatServer(engine)
  t.after(() => chat.close())
  assert.match(await (await fetch(chat.url)).text(), /mountAttention/u)
  const request = { commandId: 'chat-attention', eventId: 'chat-attention-message', text: 'Request a human decision.' }
  const receipt = await (await fetch(`${chat.url}/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })).json()
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  let conversation = await (await fetch(`${chat.url}/conversation?ticket=${receipt.ticketId}`)).json()
  assert.equal(conversation.status, 'waiting-human')
  const answer = await fetch(`${chat.url}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'chat-answer', attentionId: conversation.attention.id, text: 'Use the blue option.' }) })
  assert.equal(answer.status, 200)
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  conversation = await (await fetch(`${chat.url}/conversation?ticket=${receipt.ticketId}`)).json()
  assert.equal(conversation.status, 'ready')
  assert.equal(conversation.reports[0].result, 'Used the blue option.')
})

test('waiting-human survives ordinary follow-ups, rejects unauthorized answers, and leaves unrelated work independent', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-attention-isolation-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const workerTurns = []
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (!completed) workerTurns.push(text)
      if (text === 'Ask alpha.' && !completed) yield* toolResponse('ask_human', { question: 'Approve alpha?', options: 'Yes\nNo' })
      else if (text === 'Approve alpha.' && !completed) yield* toolResponse('report_ready', { result: 'Alpha approved.', evidence: 'Used the authorized answer.' })
      else if (text === 'Independent beta.' && !completed) yield* toolResponse('report_ready', { result: 'Beta complete.', evidence: 'Beta did not depend on alpha.' })
      else yield* textResponse('Waiting or complete.')
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
  engine = new core.Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const alphaEvent = await engine.receiveSource({ commandId: 'alpha-question', threadId: 'alpha', objectId: 'alpha-1', type: 'created', version: '1', text: 'Ask alpha.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  const alpha = await engine.assessSourceBatch({ commandId: 'alpha-eval', threadId: 'alpha', eventIds: [alphaEvent.eventId] })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const waiting = await engine.conversation(alpha.receipts[0].ticketId)
  assert.equal(waiting.status, 'waiting-human')
  const followup = await engine.receiveSource({ commandId: 'alpha-followup', threadId: 'alpha', objectId: 'alpha-2', type: 'created', version: '1', text: 'Additional scope note.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  assert.equal((await engine.getTicketDirection(alpha.receipts[0].ticketId)).fanouts.find(fanout => fanout.eventId === followup.eventId)?.reason, 'BLOCKED_WAITING_HUMAN')
  assert.equal((await engine.conversation(alpha.receipts[0].ticketId)).status, 'waiting-human')
  assert.equal(workerTurns.filter(text => text === 'Additional scope note.').length, 0)

  const unauthorized = new core.Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'intruder', allowedActorIds: ['intruder'], allowedThreadIds: ['alpha'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 500, allowedRequesterIds: ['user'], allowedBotActorIds: [], rules: [] },
  })
  await assert.rejects(unauthorized.answerAttention({ commandId: 'intruder-answer', attentionId: waiting.attention.id, text: 'Approve alpha.' }), { code: 'SOURCE_NOT_AUTHORIZED' })

  const betaEvent = await engine.receiveSource({ commandId: 'beta-independent', threadId: 'beta', objectId: 'beta-1', type: 'created', version: '1', text: 'Independent beta.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  const beta = await engine.assessSourceBatch({ commandId: 'beta-eval', threadId: 'beta', eventIds: [betaEvent.eventId] })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(beta.receipts[0].ticketId)).status, 'ready')
  assert.equal((await engine.conversation(alpha.receipts[0].ticketId)).status, 'waiting-human')

  await engine.answerAttention({ commandId: 'authorized-alpha-answer', attentionId: waiting.attention.id, text: 'Approve alpha.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(alpha.receipts[0].ticketId)).status, 'ready')
})

test('a newer question supersedes the old one and rejects an answer intended for stale work', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-attention-supersede-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (text === 'Request a sequence of questions.' && !completed) yield* toolResponse('ask_human', { question: 'First question?', options: 'A\nB' })
      else if (text === 'Answer one.' && !completed) yield* toolResponse('ask_human', { question: 'Second question?', options: 'C\nD' })
      else if (text === 'Use second answer.' && !completed) yield* toolResponse('report_ready', { result: 'Second question answered.', evidence: 'Used the current question only.' })
      else yield* textResponse('Waiting or complete.')
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
  engine = new core.Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const receipt = await engine.submit({ commandId: 'sequence', eventId: 'sequence', text: 'Request a sequence of questions.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const first = (await engine.conversation(receipt.ticketId)).attention
  await engine.answerAttention({ commandId: 'first-answer', attentionId: first.id, text: 'Answer one.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const secondConversation = await engine.conversation(receipt.ticketId)
  assert.equal(secondConversation.status, 'waiting-human')
  assert.notEqual(secondConversation.attention.id, first.id)
  await assert.rejects(engine.answerAttention({ commandId: 'late-first-answer', attentionId: first.id, text: 'Use first answer.' }), { code: 'ATTENTION_STALE' })
  await engine.answerAttention({ commandId: 'second-answer', attentionId: secondConversation.attention.id, text: 'Use second answer.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const final = await engine.conversation(receipt.ticketId)
  assert.equal(final.status, 'ready')
  assert.deepEqual(final.attentionHistory.map(attention => attention.status), ['answered', 'answered'])
})

test('a source-event answer must come from the addressed human and current source', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-attention-actor-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (text === 'Ask addressed human.' && !completed) yield* toolResponse('ask_human', { question: 'Approve alpha?', options: 'Yes\nNo' })
      else if (text === 'Approve alpha from alice.' && !completed) yield* toolResponse('ask_human', { question: 'Confirm the next step?', options: 'Continue\nStop' })
      else if (text === 'Use second answer from alice.' && !completed) yield* toolResponse('report_ready', { result: 'Alice approved twice.', evidence: 'Used both addressed human answers.' })
      else yield* textResponse('Waiting or complete.')
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
  engine = new core.Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room', 'other'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice', 'user'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const initial = await engine.receiveSource({ commandId: 'addressed-initial', threadId: 'room', objectId: 'addressed-1', type: 'created', version: '1', text: 'Ask addressed human.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.assessSourceBatch({ commandId: 'addressed-eval', threadId: 'room', eventIds: [initial.eventId] })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const attention = (await engine.conversation(accepted.receipts[0].ticketId)).attention
  const unlisted = await engine.receiveSource({ commandId: 'bob-answer', threadId: 'room', objectId: 'answer-bob', type: 'created', version: '1', text: 'Approve alpha from bob.', authorId: 'bob', authorKind: 'human', addressing: 'direct' })
  await assert.rejects(engine.answerAttention({ commandId: 'answer-bob-command', attentionId: attention.id, text: 'Placeholder.', sourceEventId: unlisted.eventId }), { code: 'SOURCE_NOT_AUTHORIZED' })
  const other = await engine.receiveSource({ commandId: 'other-answer', threadId: 'room', objectId: 'answer-other', type: 'created', version: '1', text: 'Approve alpha from another user.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  await assert.rejects(engine.answerAttention({ commandId: 'answer-other-command', attentionId: attention.id, text: 'Placeholder.', sourceEventId: other.eventId }), { code: 'ANSWER_ACTOR_MISMATCH' })
  const alice = await engine.receiveSource({ commandId: 'alice-answer', threadId: 'room', objectId: 'answer-alice', type: 'created', version: '1', text: 'Approve alpha from alice.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const wrongThread = await engine.receiveSource({ commandId: 'wrong-thread-answer', threadId: 'other', objectId: 'answer-other-thread', type: 'created', version: '1', text: 'Approve from another thread.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await assert.rejects(engine.answerAttention({ commandId: 'wrong-thread-command', attentionId: attention.id, text: 'Placeholder.', sourceEventId: wrongThread.eventId }), { code: 'ANSWER_THREAD_MISMATCH' })
  const answered = await engine.answerAttention({ commandId: 'answer-alice-command', attentionId: attention.id, text: 'Ignored placeholder.', sourceEventId: alice.eventId })
  assert.equal(answered.attention.answeredBy, 'alice')
  assert.equal(answered.attention.answerText, 'Approve alpha from alice.')
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const second = await engine.conversation(accepted.receipts[0].ticketId)
  assert.equal(second.status, 'waiting-human')
  assert.equal(second.attention.destination.eventId, 'answer-alice')
  assert.equal(second.attention.questionSourceEventId, alice.eventId)
  const secondAnswerEvent = await engine.receiveSource({ commandId: 'alice-second-answer', threadId: 'room', objectId: 'answer-alice-2', type: 'created', version: '1', text: 'Use second answer from alice.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await engine.answerAttention({ commandId: 'answer-alice-second-command', attentionId: second.attention.id, text: 'Placeholder.', sourceEventId: secondAnswerEvent.eventId })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(accepted.receipts[0].ticketId)).reports[0].result, 'Alice approved twice.')
})

test('answering before a question Outbox is delivered records a confirmed stale no-op', { timeout: 15000 }, async t => {
  const { engine } = await runtimeFixture(t)
  const receipt = await engine.submit({ commandId: 'stale-outbox', eventId: 'stale-outbox-message', text: 'Request a human decision.' })
  await engine.effects.drain()
  await engine.effects.drain()
  const waiting = await engine.conversation(receipt.ticketId)
  assert.equal(waiting.status, 'waiting-human')
  const attentionEffect = (await engine.effects.list()).items.find(effect => effect.payload.purpose === 'attention')
  assert.ok(attentionEffect)
  await engine.answerAttention({ commandId: 'early-answer', attentionId: waiting.attention.id, text: 'Use the blue option.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const final = await engine.conversation(receipt.ticketId)
  assert.equal(final.status, 'ready')
  assert.equal(final.messageHistory.some(message => message.purpose === 'attention'), false)
  const dropped = await engine.effects.receipt(attentionEffect.id, attentionEffect.generation)
  assert.equal(dropped?.state, 'failed')
  assert.equal(dropped?.delivery, 'dropped')
})

test('a waiting-human question survives stop but cannot be bypassed by resume', { timeout: 15000 }, async t => {
  const { engine } = await runtimeFixture(t)
  const receipt = await engine.submit({ commandId: 'stopped-question', eventId: 'stopped-question-message', text: 'Request a human decision.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(receipt.ticketId)).status, 'waiting-human')
  const stopped = await engine.stopTicket({ commandId: 'stop-question', ticketId: receipt.ticketId, reason: 'Pause all work.' })
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.stop?.previousConstraint?.kind, 'waiting-human')
  await assert.rejects(engine.resumeTicket({ commandId: 'resume-question', ticketId: receipt.ticketId }), { code: 'WAITING_HUMAN' })
  const answered = await engine.answerAttention({ commandId: 'answer-stopped-question', attentionId: stopped.attention.id, text: 'Use the blue option.' })
  assert.equal(answered.attention.status, 'answered')
  assert.equal((await engine.getTicketDirection(receipt.ticketId)).constraint?.kind, 'stopped')
  await engine.resumeTicket({ commandId: 'resume-after-answer', ticketId: receipt.ticketId })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(receipt.ticketId)).status, 'ready')
})
