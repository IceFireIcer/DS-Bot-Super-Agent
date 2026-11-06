import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function fixture(t, effectsOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-followup-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  let semanticCalls = 0
  const engine = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 500, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }],
      assess: async (events, _signal, onDelivered) => { await onDelivered(); semanticCalls++; return events.map(event => ({ eventId: event.eventId, outcome: 'reject', reason: 'Unexpected semantic call.' })) } },
  }, effectsOptions)
  return { engine, storage, semanticCalls: () => semanticCalls }
}

test('an accepted Thread fans out a stable human follow-up into the same Ticket with a new direction version', async t => {
  const { engine, storage, semanticCalls } = await fixture(t)
  const initial = await engine.receiveSource({ commandId: 'initial', threadId: 'room', objectId: 'message-1', type: 'created', version: '1', text: 'Build the first version.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const evaluated = await engine.assessSourceBatch({ commandId: 'eval-initial', threadId: 'room', eventIds: [initial.eventId] })
  assert.equal(evaluated.items[0].outcome, 'accepted')
  const ticketId = evaluated.receipts[0].ticketId
  const initialDirection = await engine.getTicketDirection(ticketId)
  assert.equal(initialDirection.state, 'open')
  assert.equal(initialDirection.directionVersion, 1)
  assert.equal(initialDirection.subscriptions.length, 1)
  assert.equal(initialDirection.subscriptions[0].threadId, 'room')

  const followup = await engine.receiveSource({ commandId: 'followup', threadId: 'room', objectId: 'message-2', type: 'created', version: '1', text: 'Also update the title.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const stable = await engine.receiveSource({ commandId: 'followup-transport-retry', threadId: 'room', objectId: 'message-2', type: 'created', version: '1', text: 'Also update the title.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  assert.deepEqual(stable, followup)
  const direction = await engine.getTicketDirection(ticketId)
  assert.equal(direction.directionVersion, 2)
  assert.equal(direction.inputs.length, 1)
  assert.equal(direction.inputs[0].sourceEventId, followup.eventId)
  assert.equal(direction.inputs[0].ticketId, ticketId)
  assert.equal(direction.inputs[0].text, 'Also update the title.')
  assert.equal(direction.inputs[0].ownership, 'worker')
  assert.equal(direction.fanouts.at(-1).ownership, 'worker')
  assert.deepEqual(direction.recoveries, [])
  const fanoutSummary = (await storage.transaction('private', tx => tx.list('work-fanout', 10))).find(fanout => fanout.eventId === followup.eventId)
  assert.deepEqual(fanoutSummary, { eventId: followup.eventId, targetCount: 1, owned: true })

  const duplicate = await engine.assessSourceBatch({ commandId: 'eval-followup', threadId: 'room', eventIds: [followup.eventId] })
  assert.equal(duplicate.items[0].outcome, 'rejected')
  assert.equal(duplicate.items[0].reason, 'ALREADY_OWNED')
  assert.equal(duplicate.items[0].semanticCalled, false)
  assert.equal(semanticCalls(), 0)
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('a naturally ended request resumes the same Ticket, Assignment and Worker Session for an authorized follow-up', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-followup-runtime-'))
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
      if (!completed) yield* toolResponse('report_ready', { result: `Handled: ${text}`, evidence: `Processed ${text}` })
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
  engine = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const initial = await engine.receiveSource({ commandId: 'initial-runtime', threadId: 'room', objectId: 'runtime-1', type: 'created', version: '1', text: 'Create the first result.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.assessSourceBatch({ commandId: 'eval-runtime', threadId: 'room', eventIds: [initial.eventId] })
  const ticketId = accepted.receipts[0].ticketId
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  const first = await engine.getTicketDirection(ticketId)
  assert.equal(first.state, 'ended')
  const firstConversation = await engine.conversation(ticketId)
  assert.equal(firstConversation.status, 'ready')
  const assignment = firstConversation.assignments[0]
  const mandate = (await engine.getTicket(ticketId)).mandate

  const followup = await engine.receiveSource({ commandId: 'followup-runtime', threadId: 'room', objectId: 'runtime-2', type: 'created', version: '1', text: 'Change the title and verify it.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const reopened = await engine.getTicketDirection(ticketId)
  assert.equal(reopened.state, 'open')
  assert.equal(reopened.directionVersion, 2)
  assert.equal(reopened.inputs[0].sourceEventId, followup.eventId)
  for (let index = 0; index < 5; index++) await engine.effects.drain()

  const final = await engine.getTicketDirection(ticketId)
  assert.equal(final.state, 'ended', JSON.stringify({ final, conversation: await engine.conversation(ticketId), effects: await engine.effects.list() }))
  assert.equal(final.inputs[0].state, 'delivered')
  const finalConversation = await engine.conversation(ticketId)
  assert.equal(finalConversation.assignments[0].id, assignment.id)
  assert.equal(finalConversation.assignments[0].sessionId, assignment.sessionId)
  assert.equal(finalConversation.reports[0].result, 'Handled: Change the title and verify it.')
  assert.deepEqual(finalConversation.reportHistory.map(report => report.result), ['Handled: Create the first result.', 'Handled: Change the title and verify it.'])
  assert.deepEqual(finalConversation.messageHistory.map(message => message.text), ['Request accepted.', 'Handled: Create the first result.', 'Handled: Change the title and verify it.'])
  assert.equal(final.recoveries.length, 1)
  assert.equal(final.recoveries[0].mandateId, mandate.id)
  assert.equal(final.recoveries[0].mandateDecisionId, mandate.decisionId)
  assert.equal(final.recoveries[0].policyVersion, (await engine.getTicket(ticketId)).decision.policyVersion)
  assert.deepEqual(workerTurns, ['Create the first result.', 'Change the title and verify it.'])
  assert.deepEqual((await engine.getTicket(ticketId)).mandate, mandate)
})

test('unlisted and ambient messages remain context and do not reopen or advance the Ticket', async t => {
  const { engine, storage } = await fixture(t)
  const initial = await engine.receiveSource({ commandId: 'context-initial', threadId: 'room', objectId: 'context-1', type: 'created', version: '1', text: 'Build the first version.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const evaluated = await engine.assessSourceBatch({ commandId: 'context-eval', threadId: 'room', eventIds: [initial.eventId] })
  const ticketId = evaluated.receipts[0].ticketId
  await storage.transaction('private', async tx => {
    const ticket = await tx.get('ticket', ticketId)
    await tx.replace('ticket', ticketId, { ...ticket, state: 'ended' })
  })
  await engine.receiveSource({ commandId: 'unlisted-followup', threadId: 'room', objectId: 'context-2', type: 'created', version: '1', text: 'Unauthorized change.', authorId: 'mallory', authorKind: 'human', addressing: 'direct' })
  let direction = await engine.getTicketDirection(ticketId)
  assert.equal(direction.state, 'ended')
  assert.equal(direction.directionVersion, 1)
  assert.deepEqual(direction.inputs, [])
  assert.equal(direction.fanouts[0].reason, 'ACTOR_NOT_ALLOWED')

  await engine.receiveSource({ commandId: 'ambient-followup', threadId: 'room', objectId: 'context-3', type: 'created', version: '1', text: 'Background discussion.', authorId: 'alice', authorKind: 'human', addressing: 'ambient' })
  direction = await engine.getTicketDirection(ticketId)
  assert.equal(direction.state, 'ended')
  assert.equal(direction.directionVersion, 1)
  assert.deepEqual(direction.inputs, [])
  assert.equal(direction.fanouts[1].reason, 'CONTEXT_ONLY')
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('follow-up ownership preserves an existing stop or waiting-human constraint', async t => {
  const { engine, storage } = await fixture(t)
  const initial = await engine.receiveSource({ commandId: 'constraint-initial', threadId: 'room', objectId: 'constraint-1', type: 'created', version: '1', text: 'Build the first version.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const evaluated = await engine.assessSourceBatch({ commandId: 'constraint-eval', threadId: 'room', eventIds: [initial.eventId] })
  const ticketId = evaluated.receipts[0].ticketId
  await storage.transaction('private', async tx => {
    const ticket = await tx.get('ticket', ticketId)
    await tx.replace('ticket', ticketId, { ...ticket, constraint: { kind: 'waiting-human', reason: 'Confirm the scope.' } })
  })
  await engine.receiveSource({ commandId: 'constraint-followup', threadId: 'room', objectId: 'constraint-2', type: 'created', version: '1', text: 'Here is more direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const direction = await engine.getTicketDirection(ticketId)
  assert.equal(direction.state, 'open')
  assert.deepEqual(direction.constraint, { kind: 'waiting-human', reason: 'Confirm the scope.' })
  assert.equal(direction.directionVersion, 1)
  assert.deepEqual(direction.inputs, [])
  assert.equal(direction.fanouts[0].reason, 'BLOCKED_WAITING_HUMAN')
})

test('source receipt, fan-out and follow-up ownership commit together and recover with the original command', async t => {
  const { engine, storage } = await fixture(t, { maxQueuedEffects: 2 })
  const initial = await engine.receiveSource({ commandId: 'atomic-initial', threadId: 'room', objectId: 'atomic-1', type: 'created', version: '1', text: 'Build the first version.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const evaluated = await engine.assessSourceBatch({ commandId: 'atomic-eval', threadId: 'room', eventIds: [initial.eventId] })
  const ticketId = evaluated.receipts[0].ticketId
  const followup = { commandId: 'atomic-followup', threadId: 'room', objectId: 'atomic-2', type: 'created', version: '1', text: 'Change the title.', authorId: 'alice', authorKind: 'human', addressing: 'direct' }
  await assert.rejects(engine.receiveSource(followup), { code: 'QUEUE_FULL' })
  assert.equal(await engine.getSourceReceipt(followup.commandId), undefined)
  assert.equal((await engine.getTicketDirection(ticketId)).directionVersion, 1)
  const acknowledgement = (await engine.effects.list()).items.find(effect => effect.stream === 'outbox')
  assert.ok(acknowledgement)
  await storage.transaction('private', tx => engine.effects.cancel(tx, acknowledgement))
  assert.equal((await engine.receiveSource(followup)).status, 'recorded')
  assert.equal((await engine.getTicketDirection(ticketId)).directionVersion, 2)
})
