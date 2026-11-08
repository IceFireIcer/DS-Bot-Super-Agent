import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function runtimeFixture(t, source, versioned = false) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-delivery-condition-'))
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
      if (!completed) yield* toolResponse('report_ready', { result: `Handled: ${text}`, evidence: `Verified ${text}` })
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
  engine = new core.Engine(storage, 'private', source, {}, sessions)
  const drain = async (count = 8) => { for (let index = 0; index < count; index++) await engine.effects.drain() }
  return { engine, storage, drain, versioned }
}

test('an outstanding P/R condition keeps a ready Ticket open until the condition is merged', { timeout: 20000 }, async t => {
  const { engine, drain } = await runtimeFixture(t, { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const receipt = await engine.submit({ commandId: 'condition', eventId: 'condition-message', text: 'Prepare a change.' })
  const condition = await engine.bindDeliveryCondition({ commandId: 'bind-pr', ticketId: receipt.ticketId, kind: 'pr', sourceInstanceId: 'github:acme/repo',
    repo: 'acme/repo', number: 12, basis: 'Worker created pull request 12 after explicit authorization.' })
  assert.equal(condition.state, 'open')
  await drain()
  let conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'ready')
  assert.equal(conversation.lifecycle, 'open')
  assert.equal(conversation.deliveryPending, true)
  assert.equal(conversation.deliveryConditions[0].state, 'open')
  assert.ok(conversation.messages.some(message => message.purpose === 'result'), 'the result is still delivered while the P/R remains open')
  const reconciled = await engine.reconcileDeliveryCondition({ commandId: 'merge-pr', ticketId: receipt.ticketId,
    sourceInstanceId: 'github:acme/repo', text: 'Pull request #12 was merged.' })
  assert.equal(reconciled[0].state, 'merged')
  assert.equal(reconciled[0].result, 'merged')
  conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.lifecycle, 'ended')
  assert.equal(conversation.deliveryPending, false)
})

test('two P/R conditions are checked separately and a pending follow-up delays final completion', { timeout: 25000 }, async t => {
  const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence' }
  const { engine, drain } = await runtimeFixture(t, source, true)
  const received = await engine.receiveSource({ commandId: 'multi-initial', threadId: 'room', objectId: 'multi-1', type: 'created', version: '1',
    text: 'Prepare two pull requests.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.acceptSource({ commandId: 'multi-accept', threadId: 'room', objectId: 'multi-1', expectedEventId: received.eventId })
  const ticketId = accepted.ticketId
  for (const number of [12, 13]) await engine.bindDeliveryCondition({ commandId: `bind-${number}`, ticketId, kind: 'pr', sourceInstanceId: 'github:acme/repo',
    repo: 'acme/repo', number, basis: `Worker created pull request ${number}.` })
  await drain()
  let conversation = await engine.conversation(ticketId)
  assert.equal(conversation.lifecycle, 'open')
  assert.equal(conversation.deliveryConditions.length, 2)
  await engine.reconcileDeliveryCondition({ commandId: 'merge-12', ticketId, sourceInstanceId: 'github:acme/repo', text: 'Pull request #12 merged.' })
  conversation = await engine.conversation(ticketId)
  assert.equal(conversation.lifecycle, 'open')
  assert.equal(conversation.deliveryConditions.find(condition => condition.number === 13).state, 'open')
  await engine.receiveSource({ commandId: 'multi-followup', threadId: 'room', objectId: 'multi-2', type: 'created', version: '1',
    text: 'Follow up before closing.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  const pendingDirection = await engine.getTicketDirection(ticketId)
  assert.equal(pendingDirection.inputs.filter(input => input.state === 'pending').length, 1, JSON.stringify(pendingDirection))
  await engine.reconcileDeliveryCondition({ commandId: 'close-13', ticketId, sourceInstanceId: 'github:acme/repo', text: 'Pull request #13 was closed.' })
  conversation = await engine.conversation(ticketId)
  assert.equal(conversation.lifecycle, 'open', 'a pending follow-up delays final completion')
  await drain(10)
  conversation = await engine.conversation(ticketId)
  assert.equal(conversation.lifecycle, 'ended')
})

test('an authorized delivery-target change redirects the result and is rejected across source instances', { timeout: 20000 }, async t => {
  const { engine, storage, drain } = await runtimeFixture(t, { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const receipt = await engine.submit({ commandId: 'retarget', eventId: 'retarget-message', text: 'Deliver this to GitHub.' })
  const target = await engine.setDeliveryTarget({ commandId: 'set-target', ticketId: receipt.ticketId, purpose: 'result', sourceInstanceId: 'github:acme/repo',
    threadId: 'github:acme/repo#12', objectId: 'pull-request-12', evidence: 'Authorized follow-up in the linked pull request.' })
  assert.equal(target.destination.objectId, 'pull-request-12')
  await drain()
  const conversation = await engine.conversation(receipt.ticketId)
  const result = conversation.messages.find(message => message.purpose === 'result')
  assert.deepEqual({ sourceInstanceId: result.destination.sourceInstanceId, eventId: result.destination.eventId, threadId: result.destination.threadId },
    { sourceInstanceId: 'github:acme/repo', eventId: 'pull-request-12', threadId: 'github:acme/repo#12' })
  const other = new core.Engine(storage, 'private', { sourceInstanceId: 'github:acme/repo', actorId: 'user', allowedActorIds: ['user'],
    allowedThreadPrefixes: ['github:acme/repo#'], versionOrder: 'sequence' })
  await assert.rejects(other.setDeliveryTarget({ commandId: 'foreign-target', ticketId: receipt.ticketId, purpose: 'result', sourceInstanceId: 'github:acme/repo',
    threadId: 'github:acme/repo#12', objectId: 'foreign', evidence: 'No right to retarget.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
})
