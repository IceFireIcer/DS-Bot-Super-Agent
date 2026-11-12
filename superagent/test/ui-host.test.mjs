import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import * as Profile from '../dist/profile.js'
import * as Host from '../host/index.js'
import { nativeContext, routerResponse, toolResponse, textResponse } from '../dev/native-mock.mjs'

async function fixture(t, home) {
  const directory = home ?? await mkdtemp(join(tmpdir(), 'ds-superagent-ui-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = directory
  const native = await nativeContext(join(directory, 'sessions'), async function* (options) {
    if (options.model === 'router') {
      const callId = randomUUID()
      for (const chunk of routerResponse(options)) {
        yield { ...chunk, ...(chunk.id ? { id: callId } : {}),
          ...(chunk.block?.type === 'tool-call' ? { block: { ...chunk.block, id: callId } } : {}) }
      }
      return
    }
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (options.messages.slice(options.messages.lastIndexOf(user) + 1).some(message => message.role === 'tool')) {
      yield* textResponse('Recorded.'); return
    }
    if (text === 'Ask for a color.') yield* toolResponse('ask_human', { question: 'Which color?', options: 'Blue\nGreen' }, randomUUID())
    else if (text === 'Wait for stop.') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000)
        options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason) }, { once: true })
      })
      yield* toolResponse('report_ready', { result: 'Resumed work.', evidence: 'The user explicitly resumed.' }, randomUUID())
    } else yield* toolResponse('report_ready', { result: `Completed: ${text}`, evidence: 'Checked the original request.' }, randomUUID())
  })
  let route
  native.provide('connection', { fetch: { register(value) { route = value; return () => { route = undefined } } } })
  try {
    await native.plugin(Profile, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
    await native.plugin(Host)
  } catch (error) { await native.fiber.dispose(); throw error }
  t.after(async () => {
    await native.fiber.dispose()
    if (!home) await rm(directory, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const call = async (endpoint, payload = {}) => {
    assert.equal(route.path, '/api/superagent')
    return (await route.fetch(new Request('http://localhost/api/superagent', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  }
  const wait = async predicate => {
    const deadline = Date.now() + 12000
    let last
    while (Date.now() < deadline) {
      const page = await call('state')
      last = page
      assert.equal(page.ok, true, JSON.stringify(page))
      if (predicate(page.value)) return page.value
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail(`The UI did not reach the expected state: ${JSON.stringify(last)}`)
  }
  return { call, wait, native, directory }
}

test('v1 submission is durable, idempotent and readable with evidence after a Host restart', { timeout: 20000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'ds-superagent-ui-restart-'))
  const runtimes = []
  t.after(async () => {
    for (const runtime of runtimes) await runtime.native.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const first = await fixture(t, home)
  runtimes.push(first)
  const sent = await first.call('send', { requestId: 'hello', text: 'Build a result.' })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  assert.deepEqual(await first.call('send', { requestId: 'hello', text: 'Build a result.' }), sent)
  const page = await first.wait(value => value.items.some(item => item.purpose === 'result'))
  assert.equal(page.items.filter(item => item.purpose === 'request').length, 1)
  assert.ok(page.items.some(item => item.purpose === 'acknowledgement'))
  const result = page.items.find(item => item.purpose === 'result')
  const evidence = await first.call('evidence', { ticketId: result.ticketId, ref: result.evidence })
  assert.match(evidence.value.text, /Checked the original request/u)
  assert.deepEqual((await first.call('state', { cursor: page.cursor })).value.items, [])
  assert.equal((await first.call('state', { cursor: 'broken' })).ok, false)
  assert.equal((await first.call('team/create')).error.code, 'superagent/unsupported')
  await first.native.fiber.dispose()
  const restarted = await fixture(t, home)
  runtimes.push(restarted)
  assert.deepEqual((await restarted.call('state', { cursor: page.cursor })).value.items, [])
  assert.deepEqual((await restarted.call('state')).value.items.map(item => item.id), page.items.map(item => item.id))
})

test('a v1 Attention can be answered inline and the answer remains in the conversation', { timeout: 20000 }, async t => {
  const { call, wait } = await fixture(t)
  await call('send', { requestId: 'question', text: 'Ask for a color.' })
  const waiting = await wait(value => value.tickets.some(ticket => ticket.attention))
  const ticket = waiting.tickets[0]
  const answer = { requestId: 'answer', ticketId: ticket.ticketId, attentionId: ticket.attention.id, text: 'Blue' }
  assert.equal((await call('answer', answer)).ok, true)
  assert.equal((await call('answer', answer)).ok, true)
  const done = await wait(value => value.items.some(item => item.purpose === 'result'))
  assert.ok(done.items.some(item => item.purpose === 'answer' && item.text === 'Blue'))
  assert.equal(done.tickets[0].attention, null)
})

test('a v1 human stop persists until an explicit resume', { timeout: 25000 }, async t => {
  const { call, wait } = await fixture(t)
  const sent = await call('send', { requestId: 'stop-request', text: 'Wait for stop.' })
  const ticketId = sent.value.ticketId
  await wait(value => value.tickets.some(ticket => ticket.canStop))
  assert.equal((await call('stop', { requestId: 'stop', ticketId })).ok, true)
  const stopped = await wait(value => value.tickets.some(ticket => ticket.canResume))
  assert.ok(!stopped.items.some(item => item.purpose === 'result'))
  assert.equal((await call('resume', { requestId: 'resume', ticketId })).ok, true)
  await wait(value => value.items.some(item => item.purpose === 'result'))
})
