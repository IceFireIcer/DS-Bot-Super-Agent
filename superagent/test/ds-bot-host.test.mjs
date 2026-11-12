import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { createDsBotHostAdapter } from '../dist/ds-bot-host.js'
import * as DsBotHost from '../dist/ds-bot-host.js'
import { nativeContext, routerResponse, toolResponse } from '../dev/native-mock.mjs'

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-'))
  let release
  const held = new Promise(resolve => { release = resolve })
  const native = await nativeContext(join(directory, 'sessions'), async function* (request) {
    const user = request.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (request.model === 'router') { yield* routerResponse(request); return }
    if (options.hold && text.includes('Hold this work.')) await held
    yield* toolResponse('report_ready', { result: `Completed: ${text}`, evidence: 'The production factory completed the request.' })
  })
  const config = {
    databasePath: join(directory, 'state.sqlite'),
    sourceInstanceId: 'ds-bot-ui',
    actorId: 'ui-user',
    allowedActorIds: ['ui-user'],
    router: { provider: 'mock', model: 'router' },
    worker: { provider: 'mock', model: 'worker' },
    hostId: 't56-host',
  }
  const sessionId = 'ui-chat-chief'
  const runtime = { chatOwners: new Map([[sessionId, 'chief']]),
    displayItems: (_sessionId, events) => events.map(event => ({ seq: event.seq, type: event.type })) }
  const context = { ctx: native, rt: runtime }
  const adapter = await createDsBotHostAdapter(native, config)
  t.after(async () => {
    release()
    await adapter.close().catch(() => {})
    await native.fiber.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  return { adapter, config, context, native, sessionId, release }
}

async function settle(adapter, context, sessionId) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const page = await adapter.chatPage({ botId: 'chief', sessionId }, context)
    if (page.items.some(item => item.type === 'assistant/message')) return page
    await sleep(10)
  }
  throw new Error('The factory did not finish the mock request in time.')
}

test('the production factory owns one durable Engine per UI session and recovers it after close', { timeout: 30000 }, async t => {
  const { adapter, config, context, native, sessionId } = await fixture(t)
  const owner = { kind: 'bot', botId: 'chief' }
  const first = await adapter.prompt({ requestId: 'production-1', sessionId, owner, content: 'Build the first result.' }, context)
  assert.equal(first.durable, true)
  const page = await settle(adapter, context, sessionId)
  assert.ok(page.items.length > 0)

  const delivered = await adapter.deliver({ requestId: 'production-2', sessionId, owner, text: 'Continue the same result.' }, context)
  assert.equal(delivered.ticketId, first.ticketId)
  await settle(adapter, context, sessionId)

  await adapter.close()
  await adapter.close()
  await assert.rejects(adapter.prompt({ requestId: 'closed', sessionId, owner, content: 'No new work.' }, context), { code: 'bot/execution-unsupported' })

  const reopened = await createDsBotHostAdapter(native, config)
  try {
    const replay = await reopened.prompt({ requestId: 'production-1', sessionId, owner, content: 'Build the first result.' }, context)
    assert.equal(replay.ticketId, first.ticketId)
    const after = await settle(reopened, context, sessionId)
    assert.ok(after.items.length >= page.items.length)
  } finally {
    await reopened.close()
  }
})

test('the factory accepts a durable stop while a mock Worker is still running', { timeout: 30000 }, async t => {
  const { adapter, context, sessionId, release } = await fixture(t, { hold: true })
  const owner = { kind: 'bot', botId: 'chief' }
  const started = await adapter.prompt({ requestId: 'hold-1', sessionId, owner, content: 'Hold this work.' }, context)
  const stopped = await adapter.stop({ requestId: 'hold-stop', sessionId, owner, reason: 'The user stopped this work.' }, context)
  assert.equal(stopped.ticketId, started.ticketId)
  release()
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const live = await adapter.live({}, context)
    if (!live.activity.chief) break
    await sleep(10)
  }
  assert.equal((await adapter.live({}, context)).activity.chief, undefined)
})

test('the production factory fails closed without an explicit or profile model route', async t => {
  const native = await nativeContext(join(tmpdir(), `ds-bot-host-route-${process.pid}`), function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
  t.after(async () => native.fiber.dispose())
  await assert.rejects(createDsBotHostAdapter(native, { databasePath: join(tmpdir(), `ds-bot-host-route-${process.pid}.sqlite`) }), error => error?.code === 'INVALID_CONFIG')
})

test('the ds-bot-host plugin publishes the adapter through the Host service', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-plugin-'))
  const native = await nativeContext(join(directory, 'sessions'), function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
  t.after(async () => {
    await native.fiber.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  await native.plugin(DsBotHost, {
    databasePath: join(directory, 'state.sqlite'),
    router: { provider: 'mock', model: 'router' },
    worker: { provider: 'mock', model: 'worker' },
  })
  const adapter = native.get('botExecutionAdapter')
  assert.equal(adapter?.version, 1)
  assert.equal(typeof adapter?.supports, 'function')
  assert.equal(await adapter.supports({ operation: 'resolveAgent', sessionId: 'ui-chat-chief', owner: { kind: 'bot', botId: 'chief' } },
    { ctx: native, rt: { chatOwners: new Map([['ui-chat-chief', 'chief']]) } }), true)
  await adapter.close()
})
