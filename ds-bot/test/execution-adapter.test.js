import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const TEAM = { version: 1, mainBotIds: ['chief'], bots: {
  chief: { id: 'chief', sessionId: 'chat-chief', name: 'Chief', role: 'Chief of Staff', instructions: '', createdAt: 1 },
}, rooms: {}, exchanges: [], exchangeTurns: {}, questions: {}, revision: 1 }

function fixture(t, adapter) {
  const home = mkdtempSync(join(tmpdir(), 'dsbot-execution-adapter-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  const ctx = fakeContext(), routes = {}, legacy = []
  ctx.connection.fetch.register = route => { routes[route.path] = route; return () => {} }
  ctx.sessionController = {
    prompt: async request => { legacy.push(request) },
    resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup: message => legacy.push(message) } }),
    page: async () => ({ records: [], hasMore: false }),
  }
  ctx.sessions = { flush: async () => true }
  const rt = createRuntime(ctx, { home, ...(adapter ? { executionAdapter: adapter } : {}) })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  const call = async (endpoint, payload) => {
    const response = await routes['/api/bot'].fetch(new Request('http://localhost/api/bot', {
      method: 'POST', body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json()
  }
  return { ctx, rt, routes, call, legacy }
}

test('the original send route dispatches once to the optional backend and never wakes legacy execution', async t => {
  const calls = []
  const adapter = { version: 1, supports: () => true, prompt: async request => {
    calls.push(request)
    return { durable: true, sessionId: request.sessionId }
  } }
  const { call, legacy, routes } = fixture(t, adapter)
  const result = await call('send', { sessionId: 'chief', text: 'Keep the current chat identity.', requestId: 'stable-ui-request' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, 'chat-chief')
  assert.equal(calls[0].requestId, 'stable-ui-request')
  assert.equal(calls[0].owner.botId, 'chief')
  assert.deepEqual(calls[0].content, [{ type: 'text', text: 'Keep the current chat identity.' }])
  assert.equal(legacy.length, 0)
  assert.deepEqual(Object.keys(routes).sort(), ['/api/bot', '/api/bot/feed'])
})

test('an unsupported backend scope or unconfirmed durable delivery refuses the original request without fallback', async t => {
  const adapter = { version: 1, supports: () => false, prompt: async () => { throw new Error('Unsupported work must never dispatch.') } }
  const { call, legacy } = fixture(t, adapter)
  const rejected = await call('send', { sessionId: 'chief', text: 'Refuse unsupported work.' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'bot/execution-unsupported')
  adapter.supports = () => true
  adapter.prompt = async request => ({ durable: false, sessionId: request.sessionId })
  const unconfirmed = await call('send', { sessionId: 'chief', text: 'Do not acknowledge an uncommitted input.' })
  assert.equal(unconfirmed.ok, false)
  assert.equal(unconfirmed.error.code, 'bot/execution-unconfirmed')
  assert.equal(legacy.length, 0)
})

test('projected Worker chat pages retain the original identity and reach legacy history after a JSON cursor roundtrip', async t => {
  const adapter = { version: 1, supports: () => true,
    chatPage: async ({ sessionId }) => ({ sessionId, items: [{ kind: 'bot', text: 'Real Worker result', time: 2 }], cursor: null }) }
  const { rt, call, legacy } = fixture(t, adapter)
  let historyCalls = 0
  rt.chatPage = async botId => {
    historyCalls++
    assert.equal(botId, 'chief')
    return { sessionId: 'chat-chief', items: [{ kind: 'user', text: 'Earlier request', time: 1 }], cursor: null }
  }
  const current = await call('chat', { botId: 'chief' })
  assert.equal(current.ok, true)
  assert.equal(current.value.sessionId, 'chat-chief')
  const earlier = await call('chat', { botId: 'chief', cursor: JSON.parse(JSON.stringify(current.value.cursor)) })
  assert.equal(historyCalls, 1)
  assert.equal(earlier.value.items[0].text, 'Earlier request')
  assert.equal(earlier.value.cursor, null)
  assert.equal(legacy.length, 0)
})

test('an active backend without projection support fails closed instead of reading legacy chat or live data', async t => {
  const adapter = { version: 1, supports: operation => operation === 'prompt' }
  const { rt, call } = fixture(t, adapter)
  let legacyReads = 0
  rt.chatPage = async () => {
    legacyReads++
    return { sessionId: 'chat-chief', items: [], cursor: null }
  }
  const chat = await call('chat', { botId: 'chief' })
  assert.equal(chat.ok, false)
  assert.equal(chat.error.code, 'bot/execution-unsupported')
  const state = await call('state')
  assert.equal(state.ok, false)
  assert.equal(state.error.code, 'bot/execution-unsupported')
  assert.equal(legacyReads, 0)
})

test('a backend answer failure restores the original question without legacy followup or duplicate recovery ledger', async t => {
  const adapter = { version: 1, supports: () => true, answer: async () => { throw new Error('Durable answer was not accepted.') },
    deliver: async request => ({ durable: true, sessionId: request.sessionId }) }
  const { rt, call, legacy } = fixture(t, adapter)
  await rt.load()
  const question = { id: 'attention-1', question: 'Which greeting?', options: [{ label: 'Hello' }] }
  rt.state.questions['chat-chief'] = question
  const result = await call('answer-question', { sessionId: 'chief', questionId: question.id, answer: { selected: ['Hello'] } })
  assert.equal(result.ok, false)
  assert.deepEqual(rt.state.questions['chat-chief'], question)
  assert.equal(legacy.length, 0)
  await rt.deliver({ toId: 'chief', role: 'request', text: 'A backend-owned input.', exchangeId: 'stable-relay' })
  const { existsSync } = await import('node:fs')
  assert.equal(existsSync(join(rt.home, 'inflight.json')), false)
})

test('live projections preserve settings and approval state; hidden Session mappings cannot escape chat ownership', async t => {
  const adapter = { version: 1, supports: () => true,
    live: async () => ({ activity: { chief: 'thinking' }, work: { bots: { chief: { since: 123 } }, approvals: ['must-not-replace'] } }),
    projectSession: async () => ({ botId: 'chief', sessionId: 'another-private-chat' }) }
  const { rt, call } = fixture(t, adapter)
  const response = await call('state')
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.equal(response.value.activity.chief, 'thinking')
  assert.deepEqual(response.value.work.bots.chief, { since: 123 })
  assert.notDeepEqual(response.value.work.approvals, ['must-not-replace'])
  assert.equal(response.value.bots[0].id, 'chief')
  await assert.rejects(rt.projectExecutionSession('hidden-worker'), { code: 'bot/execution-unsupported' })
})

test('without an adapter the existing send path remains the controller path', async t => {
  const { call, legacy } = fixture(t)
  assert.equal((await call('send', { sessionId: 'chief', text: 'Legacy request.' })).ok, true)
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].sessionId, 'chat-chief')
})

test('hidden native Session events and async stream mappings use the existing SSE identity in order', { timeout: 5000 }, async t => {
  const adapter = { version: 1, supports: () => true, projectSession: async ({ sessionId }) => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return sessionId === 'hidden-worker' ? { botId: 'chief', sessionId: 'chat-chief' } : undefined
  } }
  const { rt, ctx, routes } = fixture(t, adapter)
  await rt.load()
  const abort = new AbortController()
  t.after(() => abort.abort())
  const response = await routes['/api/bot/feed'].fetch(new Request('http://localhost/api/bot/feed', { signal: abort.signal }))
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  const next = async () => {
    while (!buffer.includes('\n\n')) {
      const { value } = await reader.read()
      buffer += decoder.decode(value)
    }
    const index = buffer.indexOf('\n\n'), block = buffer.slice(0, index)
    buffer = buffer.slice(index + 2)
    const lines = block.split('\n')
    return { event: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) }
  }
  assert.equal((await next()).event, 'hello')
  const onEvent = ctx.listeners.get('session/event').at(-1)
  onEvent({ id: 'hidden-worker' }, { type: 'user/message', time: 12,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Actual Session event' }] } })
  assert.deepEqual(await next(), { event: 'message', data: { botId: 'chief', sessionId: 'chat-chief',
    item: { kind: 'user', text: 'Actual Session event', time: 12 } } })
  const onStream = ctx.listeners.get('agent/assistant-stream').at(-1), agent = { id: 'hidden-worker' }
  onStream({ agent, frame: { type: 'start', attemptId: 'attempt', turn: 1 } })
  onStream({ agent, frame: { type: 'chunk', attemptId: 'attempt', chunk: { type: 'text-delta', text: 'Native stream' } } })
  onStream({ agent, frame: { type: 'end', attemptId: 'attempt' } })
  const target = { botId: 'chief', sessionId: 'chat-chief', attemptId: 'attempt' }
  assert.deepEqual(await next(), { event: 'stream', data: { ...target, phase: 'start' } })
  assert.deepEqual(await next(), { event: 'stream', data: { ...target, text: 'Native stream' } })
  assert.deepEqual(await next(), { event: 'stream', data: { ...target, phase: 'end' } })
  assert.equal((await rt.projectExecutionSession('unowned-hidden-session')), undefined)
})

test('the unchanged question UI reads the backend Attention and sends plain answer text without persisting a second question', async t => {
  let waiting = true
  const answers = []
  const question = { id: 'core-attention', question: 'Which greeting?', options: [{ label: 'Hello' }], multiSelect: false }
  const adapter = { version: 1, supports: () => true,
    live: async () => ({ questions: waiting ? { 'chat-chief': question } : {} }),
    answer: async request => { answers.push(request); waiting = false; return { durable: true, sessionId: request.sessionId } } }
  const { rt, call, legacy } = fixture(t, adapter)
  assert.deepEqual((await call('state')).value.questions['chat-chief'], question)
  assert.equal(rt.state.questions['chat-chief'], undefined)
  const answered = await call('answer-question', { sessionId: 'chief', questionId: question.id, answer: { selected: ['Hello'], custom: 'Use this greeting.' } })
  assert.equal(answered.ok, true, JSON.stringify(answered))
  assert.equal(answers[0].questionId, question.id)
  assert.equal(answers[0].text, 'Hello\nUse this greeting.')
  assert.equal((await call('state')).value.questions['chat-chief'], undefined)
  assert.equal(legacy.length, 0)
})
