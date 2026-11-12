import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../index.js'

function fixture(overrides = {}) {
  const routes = new Map()
  const calls = []
  const conversation = overrides.conversation ?? {
    ticketId: 'ticket-1', request: 'Read this work.', status: 'waiting-human', stage: 'waiting-human',
    messages: [{ id: 'm1', purpose: 'acknowledgement', text: 'Accepted.' }],
    attention: { id: 'attention-1', status: 'waiting', question: 'Pick one.', options: ['A', 'B'] },
    reports: [],
  }
  const adapter = {
    async conversation(request) { calls.push(['conversation', request]); return conversation },
    async prompt(request) { calls.push(['prompt', request]); return { ticketId: 'ticket-1' } },
    async answer(request) { calls.push(['answer', request]); return { ticketId: 'ticket-1' } },
    async stop(request) { calls.push(['stop', request]); return { ticketId: 'ticket-1' } },
    async resume(request) { calls.push(['resume', request]); return { ticketId: 'ticket-1' } },
  }
  const provided = {}
  const ctx = {
    get: name => name === 'botExecutionAdapter' ? adapter
      : name === 'connection' ? { fetch: { register: route => { routes.set(route.path, route); return () => {} } } } : undefined,
    effect: fn => fn(),
    provide: (name, value) => { provided[name] = value },
  }
  apply(ctx)
  return { routes, calls, provided }
}

async function post(routes, body) {
  const request = new Request('http://local/api/superagent', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return routes.get('/api/superagent').fetch(request)
}

test('state returns the current conversation', async () => {
  const { routes, provided } = fixture()
  assert.deepEqual(provided.superagentUi, { sessionId: 'superagent-desktop', botId: 'superagent' })
  const response = await post(routes, { endpoint: 'state' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.ok, true)
  assert.equal(result.value.conversation.ticketId, 'ticket-1')
})

test('request, answer, stop and resume use the fixed UI binding', async () => {
  const { routes, calls } = fixture()
  const request = await (await post(routes, { endpoint: 'request', payload: { requestId: 'r1', text: 'Build it.' } })).json()
  assert.equal(request.value.ticketId, 'ticket-1')
  assert.equal(calls.find(([name]) => name === 'prompt')[1].content[0].text, 'Build it.')
  assert.equal(calls.find(([name]) => name === 'prompt')[1].sessionId, 'superagent-desktop')

  await post(routes, { endpoint: 'answer', payload: { requestId: 'a1', attentionId: 'attention-1', text: 'A' } })
  await post(routes, { endpoint: 'stop', payload: { requestId: 's1' } })
  await post(routes, { endpoint: 'resume', payload: { requestId: 'r2' } })
  assert.deepEqual(calls.map(([name]) => name), ['prompt', 'answer', 'stop', 'resume'])
  assert.equal(calls[1][1].attentionId, 'attention-1')
  assert.equal(calls[1][1].text, 'A')
})

test('an empty request and an unknown endpoint fail without calling the adapter', async () => {
  const { routes, calls } = fixture()
  const empty = await (await post(routes, { endpoint: 'request', payload: { text: '  ' } })).json()
  assert.equal(empty.ok, false)
  assert.match(empty.error.message, /needs text/u)
  const unknown = await (await post(routes, { endpoint: 'nope' })).json()
  assert.equal(unknown.ok, false)
  assert.match(unknown.error.message, /Unknown endpoint/u)
  assert.deepEqual(calls, [])
})

test('the page route serves the chat surface', async () => {
  const { routes } = fixture()
  const response = await routes.get('/api/superagent/page').fetch(new Request('http://local/api/superagent/page'))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/u)
  assert.match(await response.text(), /Super-agent/u)
})
