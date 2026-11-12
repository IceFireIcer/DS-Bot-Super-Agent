import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { install } from '../../ds-bot/src/host/execution-adapter.js'
import * as DsBotHost from '../dist/ds-bot-host.js'
import { nativeContext, routerResponse, toolResponse } from '../dev/native-mock.mjs'

test('the ds-bot Host consumes the production factory through the Cordis service', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-profile-'))
  const native = await nativeContext(join(directory, 'sessions'), async function* (request) {
    const user = request.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (request.model === 'router') { yield* routerResponse(request); return }
    yield* toolResponse('report_ready', { result: `Completed: ${text}`, evidence: 'The ds-bot profile adapter completed the request.' })
  })
  t.after(async () => {
    await native.fiber.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  await native.plugin(DsBotHost, {
    databasePath: join(directory, 'state.sqlite'),
    router: { provider: 'mock', model: 'router' },
    worker: { provider: 'mock', model: 'worker' },
    hostId: 't56-profile',
  })
  const sessionId = 'ui-chat-chief'
  const rt = {
    ctx: native,
    config: {},
    chatOwners: new Map([[sessionId, 'chief']]),
    groupOwners: new Map(),
    roomOf: () => undefined,
    state: { questions: {} },
    chatOf: () => sessionId,
    chatPage: async () => ({ items: [], cursor: null }),
    displayItems: (_id, events) => events.map(event => ({ seq: event.seq, type: event.type })),
  }
  install(rt)
  const signal = new AbortController().signal
  const prompt = await rt.executionDispatch('prompt', { requestId: 'profile-prompt', sessionId, content: [{ type: 'text', text: 'Run through the profile.' }] }, signal)
  assert.equal(prompt.durable, true)
  const agent = await rt.executionDispatch('resolveAgent', { sessionId }, signal)
  assert.equal(agent.session.id, sessionId)
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const page = await rt.executionChatPage('chief')
    if (page.items.some(item => item.type === 'assistant/message')) break
    await sleep(10)
  }
  const stopped = await rt.executionDispatch('stop', { requestId: 'profile-stop', sessionId, reason: 'The profile stopped the work.' }, signal)
  assert.equal(stopped.durable, true)
})
