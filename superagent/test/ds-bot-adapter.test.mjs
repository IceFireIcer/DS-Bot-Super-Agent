import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DsBotExecutionAdapter, NativeSessions, Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'

function* maxTokensResponse(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'max-tokens' } }
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-adapter-'))
  let native, storage, sessions
  const sessionId = options.sessionId ?? 'ui-chat-chief'
  const engineFactory = async ({ sessionId: requestedSession }) => {
    assert.equal(requestedSession, sessionId)
    return { engine, sessions, actorId: 'ui-user' }
  }
  native = await nativeContext(join(directory, 'sessions'), async function* (request) {
    const user = request.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = request.messages.slice(request.messages.lastIndexOf(user) + 1).some(message => message.role === 'tool')
    if (request.model === 'worker') {
      if (options.rollover) {
        if (text.startsWith('Continue in a new Session after a context handoff.')) {
          yield* toolResponse('report_ready', { result: 'Completed after rollover.', evidence: 'The current Assignment used the forked Session.' })
        } else yield* maxTokensResponse('The context is full.')
        return
      }
      if (completed) { yield* textResponse('Recorded.'); return }
      if (options.hold) await options.hold()
      if (text === 'Ask me.') yield* toolResponse('ask_human', { question: 'Choose a color.', options: 'Blue\nGreen' })
      else yield* toolResponse('report_ready', { result: `Completed: ${text}`, evidence: 'The public Engine worker completed the request.' })
      return
    }
    yield* routerResponse(request)
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new Engine(storage, 'private', {
    kind: 'desktop', sourceInstanceId: 'ds-bot-ui', actorId: 'ui-user', allowedActorIds: ['ui-user'], allowedThreadIds: [sessionId], versionOrder: 'sequence',
  }, {}, sessions)
  const adapter = new DsBotExecutionAdapter({
    factory: engineFactory,
    authorize: ({ owner, sessionId: requested }) => owner.kind === 'bot' && owner.botId === 'chief' && requested === sessionId,
  })
  const context = { ctx: {}, rt: { chatOwners: new Map([[sessionId, 'chief']]), displayItems: (_id, events) => events.map(event => ({ seq: event.seq, type: event.type })) } }
  t.after(async () => { await engine.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  return { adapter, context, engine, sessionId, sessions, newAdapter: () => new DsBotExecutionAdapter({ factory: engineFactory }) }
}

async function settle(engine, ticketId) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    await engine.effects.drain()
    const conversation = await engine.conversation(ticketId)
    if (conversation.status === 'ready' || conversation.status === 'waiting-human' || conversation.status === 'stopped') return conversation
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return engine.conversation(ticketId)
}

test('prompt creates one durable UI binding and deliver follows the original Ticket and Session', { timeout: 20000 }, async t => {
  const { adapter, context, engine, sessionId, newAdapter } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  const first = await adapter.prompt({ requestId: 'prompt-1', sessionId, owner,
    content: [{ type: 'text', text: 'Build the' }, { type: 'text', text: 'first result.' }] }, context)
  assert.equal((await engine.getTicket(first.ticketId)).trigger.text, 'Build the\nfirst result.')
  const conversation = await settle(engine, first.ticketId)
  assert.equal(conversation.status, 'ready')
  const restarted = newAdapter()
  const replay = await restarted.prompt({ requestId: 'prompt-1', sessionId, owner,
    content: [{ type: 'text', text: 'Build the' }, { type: 'text', text: 'first result.' }] }, context)
  assert.equal(replay.ticketId, first.ticketId)
  assert.equal((await settle(engine, first.ticketId)).reportHistory.length, 1)
  assert.equal(first.durable, true)
  assert.equal(conversation.assignmentHistory.length, 1)
  const second = await adapter.deliver({ requestId: 'deliver-1', sessionId, owner, text: 'Continue the same result.' }, context)
  const after = await settle(engine, first.ticketId)
  const replayed = await newAdapter().deliver({ requestId: 'deliver-1', sessionId, owner, text: 'Continue the same result.' }, context)
  const settledReplay = await settle(engine, first.ticketId)
  assert.equal(second.ticketId, first.ticketId)
  assert.equal(replayed.ticketId, first.ticketId)
  assert.equal(after.assignmentHistory[0].sessionId, conversation.assignmentHistory[0].sessionId)
  assert.equal(settledReplay.reportHistory.length, 2)
  assert.equal((await engine.listTickets()).items.length, 1)
  await assert.rejects(restarted.prompt({ requestId: 'prompt-1', sessionId, owner, content: 'Changed replay text.' }, context), { code: 'IDENTITY_CONFLICT' })
  assert.deepEqual(await restarted.projectSession({ sessionId: conversation.assignments[0].sessionId }, context), { botId: 'chief', sessionId })
  const page = await restarted.chatPage({ botId: 'chief', sessionId }, context)
  assert.ok(page.items.some(item => item.type === 'assistant/message'))
  assert.equal(page.sessionId, sessionId)
  await assert.rejects(adapter.prompt({ requestId: 'bad-scope', sessionId, owner: { kind: 'group', botId: 'chief' }, content: 'No fallback.' }, context), { code: 'bot/execution-unsupported' })
})

test('answer routes a real Attention through Engine and preserves the UI binding', { timeout: 20000 }, async t => {
  const { adapter, context, engine, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  const started = await adapter.prompt({ requestId: 'question-1', sessionId, owner, content: 'Ask me.' }, context)
  const waiting = await settle(engine, started.ticketId)
  assert.equal(waiting.status, 'waiting-human')
  assert.deepEqual((await adapter.live({}, context)).questions[sessionId], { id: waiting.attention.id, callId: waiting.attention.id,
    question: 'Choose a color.', options: [{ label: 'Blue' }, { label: 'Green' }], multiSelect: false })
  const answered = await adapter.answer({ requestId: 'answer-1', sessionId, owner, questionId: waiting.attention.id, answer: 'Blue' }, context)
  const complete = await settle(engine, started.ticketId)
  assert.equal(answered.ticketId, started.ticketId)
  assert.equal(complete.status, 'ready')
  assert.equal((await adapter.live({}, context)).questions[sessionId], undefined)
  assert.equal((await adapter.answer({ requestId: 'answer-1', sessionId, owner, questionId: waiting.attention.id, answer: 'Blue' }, context)).ticketId, started.ticketId)
  await assert.rejects(adapter.answer({ requestId: 'answer-stale', sessionId, owner, questionId: waiting.attention.id, answer: 'Green' }, context), { code: 'bot/stale' })
})

test('stop routes a real durable stop and resolveAgent fails closed for hidden Sessions', async t => {
  const { adapter, context, engine, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  const started = await adapter.prompt({ requestId: 'stop-1', sessionId, owner, content: 'Long work.' }, context)
  const stopped = await adapter.stop({ requestId: 'stop-command', sessionId, owner, reason: 'User stopped this work.' }, context)
  const conversation = await settle(engine, started.ticketId)
  assert.equal(stopped.ticketId, started.ticketId)
  assert.ok(['stopping', 'stopped'].includes(conversation.status))
  await assert.rejects(adapter.resolveAgent({ sessionId: 'hidden-worker' }, context), { code: 'bot/execution-unsupported' })
})

test('durable prompt acknowledgement returns before a blocked native Worker and its active Session projects to the original UI', { timeout: 15000 }, async t => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  t.after(() => release())
  let entered
  const running = new Promise(resolve => { entered = resolve })
  const { adapter, context, engine, sessionId } = await fixture(t, { hold: async () => { entered(); await blocked } })
  const owner = { kind: 'bot', botId: 'chief' }
  let timer
  let acknowledged
  try {
    acknowledged = await Promise.race([
      adapter.prompt({ requestId: 'blocked-worker', sessionId, owner, content: [{ type: 'text', text: 'Wait for the gated operation.' }] }, context),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Acknowledgement waited for the Worker')), 2000) }),
    ])
  } finally { clearTimeout(timer) }
  assert.equal(acknowledged.durable, true)
  await running
  try {
    const active = await engine.conversation(acknowledged.ticketId)
    assert.deepEqual(await adapter.projectSession({ sessionId: active.assignments[0].sessionId }, context), { botId: 'chief', sessionId })
    assert.equal((await adapter.live({}, context)).activity.chief, 'thinking')
    context.rt.chatOwners.delete(sessionId)
    await assert.rejects(adapter.stop({ requestId: 'revoked-stop', sessionId, owner }, context), { code: 'bot/execution-unsupported' })
  } finally { context.rt.chatOwners.set(sessionId, 'chief'); release() }
  await settle(engine, acknowledged.ticketId)
})

test('chat pages preserve the old item renderer contract and page every real native event once', { timeout: 20000 }, async t => {
  const { adapter, context, engine, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  let ticketId
  for (let index = 0; index < 3; index++) {
    const result = await adapter.prompt({ requestId: `history-${index}`, sessionId, owner, content: `History turn ${index}.` }, context)
    ticketId = result.ticketId
    await settle(engine, ticketId)
  }
  const current = await engine.conversation(ticketId)
  const currentSessionId = current.assignments[0].sessionId
  assert.ok(current.assignmentHistory.some(assignment => assignment.sessionId === currentSessionId))
  const items = []
  let cursor
  let pages = 0
  do {
    const page = await adapter.chatPage({ botId: 'chief', sessionId, ...(cursor ? { cursor } : {}) }, context)
    assert.equal(page.sessionId, sessionId)
    assert.ok(page.items.length <= 20)
    items.push(...page.items)
    cursor = page.cursor
    if (++pages > 10) assert.fail('History pagination did not terminate')
  } while (cursor)
  assert.ok(pages >= 2)
  assert.equal(new Set(items.map(item => item.seq)).size, items.length)
  assert.equal(items.filter(item => item.type === 'user/message').length, 3)
  await assert.rejects(adapter.chatPage({ botId: 'chief', sessionId, cursor: { sessionId: 'another-worker' } }, context), { code: 'bot/invalid' })
})

test('unsupported group, browser, view, attachment and steer paths fail safely without hidden data', async t => {
  const { adapter, context, engine, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  assert.deepEqual(await adapter.chatPage({ botId: 'chief', sessionId }, context), { sessionId, items: [], cursor: null })
  await assert.rejects(adapter.prompt({ requestId: 'group', sessionId: 'room-session', owner: { kind: 'group', botId: 'chief', roomId: 'room' }, content: 'Group work.' }, context), { code: 'bot/execution-unsupported' })
  await assert.rejects(adapter.answer({ requestId: 'browser', sessionId, owner, browserHold: { callId: 'handoff' }, message: 'Handoff complete.' }, context), { code: 'bot/execution-unsupported' })
  await assert.rejects(adapter.answer({ requestId: 'view', sessionId, owner, viewId: 'view-1', values: { accepted: true } }, context), { code: 'bot/execution-unsupported' })
  await assert.rejects(adapter.deliver({ requestId: 'steer', sessionId, owner, text: 'Cut in now.', steer: true }, context), { code: 'bot/execution-unsupported' })
  await assert.rejects(adapter.prompt({ requestId: 'image', sessionId, owner,
    content: [{ type: 'text', text: 'Read this.' }, { type: 'file', attachment: 'opaque' }] }, context), { code: 'bot/execution-unsupported' })
  assert.equal((await engine.listTickets()).items.length, 0)
  assert.equal(await adapter.supports({ operation: 'resolveAgent', sessionId, owner }, context), true)
  assert.equal(await adapter.supports({ operation: 'resolveAgent', sessionId, owner: { kind: 'group', botId: 'chief', roomId: 'room' } }, context), false)
})

test('chat projection reads the current Assignment Session after a real context rollover', { timeout: 25000 }, async t => {
  const { adapter, context, engine, sessionId, sessions } = await fixture(t, { rollover: true })
  const owner = { kind: 'bot', botId: 'chief' }
  const started = await adapter.prompt({ requestId: 'rollover-1', sessionId, owner, content: 'Roll this history into a new Session.' }, context)
  const conversation = await settle(engine, started.ticketId)
  assert.equal(conversation.status, 'ready', JSON.stringify(conversation))
  assert.equal(conversation.assignmentHistory.length, 2)
  const previous = conversation.assignmentHistory[0].sessionId
  const current = conversation.assignments[0].sessionId
  assert.notEqual(current, previous)
  assert.equal(await adapter.projectSession({ sessionId: previous }, context), undefined)
  assert.deepEqual(await adapter.projectSession({ sessionId: current }, context), { botId: 'chief', sessionId })
  const reads = []
  const readSession = sessions.readSession.bind(sessions)
  sessions.readSession = async (requested, options) => {
    reads.push(requested)
    return readSession(requested, options)
  }
  const page = await adapter.chatPage({ botId: 'chief', sessionId }, context)
  assert.equal(reads[0], current)
  assert.equal(page.sessionId, sessionId)
  assert.ok(page.items.length > 0)
})

test('closing an adapter releases its scopes and refuses new work', { timeout: 20000 }, async t => {
  const { adapter, context, engine, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  const first = await adapter.prompt({ requestId: 'close-1', sessionId, owner, content: 'Close this scope.' }, context)
  await settle(engine, first.ticketId)
  await adapter.close()
  await adapter.close()
  await assert.rejects(adapter.prompt({ requestId: 'close-2', sessionId, owner, content: 'No new work.' }, context), { code: 'bot/execution-unsupported' })
  assert.equal(await adapter.supports({ operation: 'prompt', sessionId, owner }, context), false)
})

test('resolveAgent returns the existing UI Session facade and maps followup and cancel', { timeout: 20000 }, async t => {
  const { adapter, context, engine, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  const started = await adapter.prompt({ requestId: 'facade-1', sessionId, owner, content: 'Start facade work.' }, context)
  const agent = await adapter.resolveAgent({ sessionId }, context)
  assert.equal(agent.session.id, sessionId)
  assert.ok(['running', 'idle'].includes(agent.status))
  const followed = await agent.followup({ id: 'facade-followup', content: [{ type: 'text', text: 'Follow up through the facade.' }] })
  assert.equal(followed.ticketId, started.ticketId)
  const cancelled = await agent.cancel({ reason: 'The host cancelled through the facade.' })
  assert.equal(cancelled.ticketId, started.ticketId)
  assert.equal((await agent.inbox.remove('missing')), false)
  await settle(engine, started.ticketId)
  assert.throws(() => agent.steer({ id: 'steer' }), { code: 'bot/execution-unsupported' })
})
