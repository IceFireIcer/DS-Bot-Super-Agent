import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse } from '../dev/native-mock.mjs'

test('the loopback chat accepts an explicit request, queries its pending state and rejects foreign origins', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-chat-'))
  let storage
  let native
  let sessions
  let chat
  context.after(async () => {
    await chat?.close(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(join(directory, 'sessions'), () => textResponse('Waiting.'))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  chat = await core.createChatServer(engine)
  assert.match(await (await fetch(chat.url)).text(), /<label for="request">/u)
  assert.match(await (await fetch(chat.url)).text(), /Capability locations/u)
  assert.match(await (await fetch(chat.url)).text(), /Execution handoff/u)
  assert.match(await (await fetch(chat.url)).text(), /next: /u)
  const locations = await (await fetch(`${chat.url}/capabilities`)).json()
  assert.deepEqual(locations.map(item => item.id), ['browser', 'mcp', 'office'])
  const request = { commandId: 'chat', eventId: 'message', text: 'An explicit local request.' }
  const send = (body, origin = chat.url) => fetch(`${chat.url}/request`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
  assert.equal((await send(request, 'https://example.com')).status, 403)
  assert.equal((await send({ ...request, source: 'forged' })).status, 400)
  const response = await send(request)
  assert.equal(response.status, 200)
  const receipt = await response.json()
  const conversation = await (await fetch(`${chat.url}/conversation?ticket=${receipt.ticketId}`)).json()
  assert.equal(conversation.request, request.text)
  assert.equal(conversation.status, 'pending')
  const contextCard = await (await fetch(`${chat.url}/context?ticket=${receipt.ticketId}&kind=trigger`)).json()
  assert.equal(contextCard.ref.kind, 'trigger')
  assert.equal(contextCard.text, request.text)
  assert.match(await (await fetch(chat.url)).text(), /Read original request/u)
  assert.match(await (await fetch(chat.url)).text(), /Retry Assignment/u)
  assert.equal((await fetch(`${chat.url}/conversation?ticket=other`)).status, 404)

  const capable = await send({ commandId: 'chat-capability', eventId: 'capability-message',
    text: 'Edit the office document.', capabilities: ['office'] })
  assert.equal(capable.status, 200)
  const capableReceipt = await capable.json()
  const capableConversation = await (await fetch(`${chat.url}/conversation?ticket=${capableReceipt.ticketId}`)).json()
  assert.deepEqual(capableConversation.capabilityPlan.required, ['office'])
  assert.equal(capableConversation.capabilityPlan.status, 'pending')
  assert.equal(capableConversation.capabilityPlan.items[0].location, 'environment')
})
