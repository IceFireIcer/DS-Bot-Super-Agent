import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-ownership-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 500, allowedRequesterIds: ['alice'], allowedBotActorIds: options.inferBots ? ['bot'] : [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' },
        ...(options.inferBots ? [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }] : [])],
      ...(options.inferBots ? { assess: async (events, _signal, onDelivered) => { await onDelivered(); return events.map(event => ({ eventId: event.eventId, outcome: 'accept', reason: 'Actionable bot report.' })) } } : {}) },
  })
  return { engine, storage }
}

async function accept(engine, threadId, objectId) {
  const sourceEvent = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text: `Request ${objectId}.`, authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const evaluation = await engine.assessSourceBatch({ commandId: `evaluate-${objectId}`, threadId, eventIds: [sourceEvent.eventId] })
  return { sourceEvent, ticketId: evaluation.receipts[0].ticketId }
}

test('an added Thread subscription applies only to later events and a Thread fans out to every owning Ticket', async t => {
  const { engine } = await fixture(t)
  const first = await accept(engine, 'alpha', 'alpha-1')
  const second = await accept(engine, 'beta', 'beta-3')
  const before = await engine.receiveSource({ commandId: 'before-subscription', threadId: 'beta', objectId: 'beta-1', type: 'created', version: '1', text: 'Before subscription.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await engine.addThreadSubscription({ commandId: 'subscribe-beta', ticketId: first.ticketId, threadId: 'beta', reason: 'Track the beta discussion.' })
  let firstDirection = await engine.getTicketDirection(first.ticketId)
  assert.equal(firstDirection.subscriptions.some(subscription => subscription.threadId === 'beta'), true)
  assert.equal(firstDirection.inputs.some(input => input.sourceEventId === before.eventId), false)

  const after = await engine.receiveSource({ commandId: 'after-subscription', threadId: 'beta', objectId: 'beta-2', type: 'created', version: '1', text: 'After subscription.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const attached = await engine.attachSourceEvent({ commandId: 'attach-before', eventId: before.eventId, ticketId: first.ticketId, reason: 'The user explicitly attached the earlier message.' })
  firstDirection = await engine.getTicketDirection(first.ticketId)
  assert.equal(firstDirection.inputs.some(input => input.sourceEventId === after.eventId), true)
  assert.equal(firstDirection.inputs.some(input => input.sourceEventId === attached.sourceEventId), true)

  const shared = await engine.receiveSource({ commandId: 'shared-event', threadId: 'beta', objectId: 'beta-4', type: 'created', version: '1', text: 'Shared direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const firstAfterShared = await engine.getTicketDirection(first.ticketId)
  const secondAfterShared = await engine.getTicketDirection(second.ticketId)
  for (const direction of [firstAfterShared, secondAfterShared]) {
    assert.equal(direction.inputs.some(input => input.sourceEventId === shared.eventId), true)
    assert.equal(direction.ownerships.find(ownership => ownership.sourceEventId === shared.eventId)?.state, 'owned')
  }
})

test('all owners must hand back before manual requeue creates a new evaluation instead of reattaching the old Tickets', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-handback-'))
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
      if (text === 'Shared direction.') {
        if (!completed) yield* toolResponse('handback_input', { reason: 'The shared direction belongs to a different work item.' })
        else yield* textResponse('Handed back.')
      } else if (!completed) yield* toolResponse('report_ready', { result: `Ready: ${text}`, evidence: `Processed ${text}` })
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
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const first = await accept(engine, 'alpha', 'alpha-1')
  const second = await accept(engine, 'beta', 'beta-1')
  await engine.addThreadSubscription({ commandId: 'first-on-beta', ticketId: first.ticketId, threadId: 'beta', reason: 'The first work follows beta.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const shared = await engine.receiveSource({ commandId: 'handback-shared', threadId: 'beta', objectId: 'beta-shared', type: 'created', version: '1', text: 'Shared direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await assert.rejects(engine.requeueSourceEvent({ commandId: 'early-requeue', eventId: shared.eventId }), { code: 'OWNERSHIP_ACTIVE' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  for (const ticketId of [first.ticketId, second.ticketId]) {
    const direction = await engine.getTicketDirection(ticketId)
    assert.equal(direction.ownerships.find(ownership => ownership.sourceEventId === shared.eventId)?.state, 'handed-back')
    assert.match(direction.ownerships.find(ownership => ownership.sourceEventId === shared.eventId)?.reason ?? '', /different work item/u)
  }
  const requeued = await engine.requeueSourceEvent({ commandId: 'requeue-shared', eventId: shared.eventId })
  assert.equal(requeued.items[0].outcome, 'accepted')
  const newTicketId = requeued.receipts[0].ticketId
  assert.notEqual(newTicketId, first.ticketId)
  assert.notEqual(newTicketId, second.ticketId)
  for (const ticketId of [first.ticketId, second.ticketId]) {
    const direction = await engine.getTicketDirection(ticketId)
    assert.equal(direction.ownerships.find(ownership => ownership.sourceEventId === shared.eventId)?.state, 'requeued')
    assert.equal(direction.inputs.find(input => input.sourceEventId === shared.eventId)?.directionVersion, 2)
    assert.equal(direction.requeues.find(decision => decision.eventId === shared.eventId)?.state, 'consumed')
    assert.equal(direction.requeues.find(decision => decision.eventId === shared.eventId)?.evaluationId, requeued.id)
  }
  assert.equal((await engine.listTickets()).items.length, 3)
})

test('context-only subscriptions never own or recover work even for an authorized human follow-up', async t => {
  const { engine, storage } = await fixture(t)
  const work = await accept(engine, 'alpha', 'context-owner')
  await storage.transaction('private', async tx => {
    const ticket = await tx.get('ticket', work.ticketId)
    await tx.replace('ticket', work.ticketId, { ...ticket, state: 'ended' })
  })
  await engine.addThreadSubscription({ commandId: 'context-beta', ticketId: work.ticketId, threadId: 'beta', mode: 'context', reason: 'Use beta only as background.' })
  const background = await engine.receiveSource({ commandId: 'context-message', threadId: 'beta', objectId: 'beta-context', type: 'created', version: '1', text: 'Only background.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const direction = await engine.getTicketDirection(work.ticketId)
  assert.equal(direction.state, 'ended')
  assert.equal(direction.directionVersion, 1)
  assert.deepEqual(direction.inputs, [])
  assert.deepEqual(direction.recoveries, [])
  assert.equal(direction.fanouts.find(fanout => fanout.eventId === background.eventId)?.reason, 'CONTEXT_ONLY')
})

test('robot context fan-out and independent inferred candidates do not duplicate or borrow human ownership', async t => {
  const { engine } = await fixture(t, { inferBots: true })
  const human = await accept(engine, 'alpha', 'bot-context-human')
  await engine.addThreadSubscription({ commandId: 'bot-beta', ticketId: human.ticketId, threadId: 'beta', reason: 'Follow CI in beta.' })
  const report = await engine.receiveSource({ commandId: 'bot-report', threadId: 'beta', objectId: 'bot-report', type: 'created', version: '1', text: 'CI says the branch is failing.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const humanDirection = await engine.getTicketDirection(human.ticketId)
  assert.equal(humanDirection.fanouts.find(fanout => fanout.eventId === report.eventId)?.reason, 'CONTEXT_ONLY')
  assert.equal(humanDirection.inputs.some(input => input.sourceEventId === report.eventId), false)
  const evaluated = await engine.assessSourceBatch({ commandId: 'bot-candidate', threadId: 'beta', eventIds: [report.eventId] })
  assert.equal(evaluated.items[0].outcome, 'accepted')
  assert.notEqual(evaluated.receipts[0].ticketId, human.ticketId)
  assert.equal((await engine.listTickets()).items.length, 2)
})

test('unsubscribe keeps received ownership, required Threads stay bound, and cross-task notes grant no execution authority', async t => {
  const { engine, storage } = await fixture(t)
  const first = await accept(engine, 'alpha', 'manage-alpha')
  const second = await accept(engine, 'beta', 'manage-beta')
  await engine.addThreadSubscription({ commandId: 'owned-beta', ticketId: first.ticketId, threadId: 'beta', reason: 'Track beta for this Ticket.' })
  const shared = await engine.receiveSource({ commandId: 'managed-event', threadId: 'beta', objectId: 'managed-shared', type: 'created', version: '1', text: 'Keep this owned after unsubscribe.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const before = await engine.getTicketDirection(first.ticketId)
  assert.equal(before.subscriptions.find(subscription => subscription.threadId === 'beta')?.required, false)
  assert.equal(before.ownerships.find(ownership => ownership.sourceEventId === shared.eventId)?.state, 'owned')

  const after = await engine.removeThreadSubscription({ commandId: 'remove-beta', ticketId: first.ticketId, threadId: 'beta', reason: 'No more direct beta follow-ups.' })
  assert.equal(after.subscriptions.some(subscription => subscription.threadId === 'beta'), false)
  assert.equal(after.subscriptionDecisions[0].threadId, 'beta')
  assert.equal(after.subscriptionDecisions[0].reason, 'No more direct beta follow-ups.')
  assert.equal(after.ownerships.find(ownership => ownership.sourceEventId === shared.eventId)?.state, 'owned')
  await assert.rejects(engine.removeThreadSubscription({ commandId: 'remove-original', ticketId: first.ticketId, threadId: 'alpha', reason: 'Unsafe removal.' }), { code: 'REQUIRED_THREAD' })

  await storage.transaction('private', async tx => {
    const ticket = await tx.get('ticket', first.ticketId)
    await tx.replace('ticket', first.ticketId, { ...ticket, state: 'ended' })
  })
  const note = await engine.addTicketNote({ commandId: 'cross-note', ticketId: first.ticketId, sourceTicketId: second.ticketId, text: 'The beta report is related background only.' })
  assert.equal(note.sourceTicketId, second.ticketId)
  const noted = await engine.getTicketDirection(first.ticketId)
  assert.equal(noted.state, 'ended')
  assert.equal(noted.directionVersion, before.directionVersion)
  assert.equal(noted.notes[0].text, 'The beta report is related background only.')
  assert.deepEqual(noted.ownerships, after.ownerships)
})

test('a Worker can add and later remove only its own non-required Thread subscription', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-worker-subscriptions-'))
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
      if (text.startsWith('Request manage-worker.') && !completed) yield* toolResponse('add_thread_subscription', { threadId: 'beta', mode: 'context', reason: 'Read beta as background.' })
      else if (text.startsWith('Request manage-worker.') && completed === 1) yield* toolResponse('report_ready', { result: 'Threads managed.', evidence: 'Added beta as context.' })
      else if (text === 'Remove optional Thread.' && !completed) yield* toolResponse('remove_thread_subscription', { threadId: 'beta', reason: 'Beta is no longer needed.' })
      else yield* textResponse('Done.')
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
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const work = await accept(engine, 'alpha', 'manage-worker')
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  let direction = await engine.getTicketDirection(work.ticketId)
  const optional = direction.subscriptions.find(subscription => subscription.threadId === 'beta')
  assert.equal(optional?.basis, 'worker', JSON.stringify({ direction, effects: await engine.effects.list(), conversation: await engine.conversation(work.ticketId) }))
  assert.equal(optional?.mode, 'context')
  assert.equal(optional?.required, false)
  await engine.receiveSource({ commandId: 'remove-through-worker', threadId: 'alpha', objectId: 'worker-remove', type: 'created', version: '1', text: 'Remove optional Thread.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  direction = await engine.getTicketDirection(work.ticketId)
  assert.equal(direction.subscriptions.some(subscription => subscription.threadId === 'beta'), false)
  assert.equal(direction.subscriptions.find(subscription => subscription.threadId === 'alpha')?.required, true)
  assert.equal(direction.subscriptionDecisions.some(decision => decision.threadId === 'beta' && decision.removedBy === optional?.addedBy), true)
})

test('management commands cannot attach, subscribe or note a Ticket from another source instance', async t => {
  const { engine, storage } = await fixture(t)
  const work = await accept(engine, 'alpha', 'source-owned')
  const other = new Engine(storage, 'private', {
    sourceInstanceId: 'other', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 500, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  })
  const foreignEvent = await other.receiveSource({ commandId: 'other-event', threadId: 'beta', objectId: 'other-1', type: 'created', version: '1', text: 'Foreign direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await assert.rejects(other.addThreadSubscription({ commandId: 'cross-subscribe', ticketId: work.ticketId, threadId: 'beta', reason: 'Cross source.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(other.attachSourceEvent({ commandId: 'cross-attach', eventId: foreignEvent.eventId, ticketId: work.ticketId, reason: 'Cross source.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(other.addTicketNote({ commandId: 'cross-note', ticketId: work.ticketId, text: 'Cross source fact.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(other.removeThreadSubscription({ commandId: 'cross-remove', ticketId: work.ticketId, threadId: 'beta', reason: 'Cross source.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(other.requeueSourceEvent({ commandId: 'cross-requeue', eventId: work.sourceEvent.eventId }), { code: 'SOURCE_NOT_AUTHORIZED' })
  const otherActor = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'other-actor', allowedActorIds: ['other-actor'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
  })
  await engine.addTicketNote({ commandId: 'actor-scoped-command', ticketId: work.ticketId, text: 'First actor note.' })
  await otherActor.addTicketNote({ commandId: 'actor-scoped-command', ticketId: work.ticketId, text: 'Second actor note.' })
  assert.deepEqual((await engine.getTicketDirection(work.ticketId)).notes.map(note => note.text), ['First actor note.', 'Second actor note.'])
})

test('an authorized operator can dismiss an unavailable Eval while preserving its history', async t => {
  const { storage } = await fixture(t, { inferBots: true })
  const unavailableEngine = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 500, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
      rules: [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
      assess: async (_events, _signal, onDelivered) => { await onDelivered(); return [] } },
  })
  const report = await unavailableEngine.receiveSource({ commandId: 'unavailable-event', threadId: 'beta', objectId: 'unavailable-1', type: 'created', version: '1', text: 'CI report.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const evaluated = await unavailableEngine.assessSourceBatch({ commandId: 'unavailable-eval', threadId: 'beta', eventIds: [report.eventId] })
  assert.equal(evaluated.status, 'unavailable')
  const dismissed = await unavailableEngine.dismissEvaluation({ commandId: 'dismiss-unavailable', evaluationId: evaluated.id, reason: 'The report has been reviewed.' })
  assert.equal(dismissed.status, 'unavailable')
  assert.equal(dismissed.dismissalReason, 'The report has been reviewed.')
  const listed = await unavailableEngine.listEvaluations('beta')
  assert.equal(listed.items.find(evaluation => evaluation.id === evaluated.id)?.dismissedBy, 'user')
  assert.deepEqual(await unavailableEngine.dismissEvaluation({ commandId: 'dismiss-unavailable', evaluationId: evaluated.id, reason: 'The report has been reviewed.' }), dismissed)
  await assert.rejects(unavailableEngine.dismissEvaluation({ commandId: 'dismiss-unavailable-again', evaluationId: evaluated.id, reason: 'A second overwrite.' }), { code: 'EVAL_ALREADY_DISMISSED' })
  const otherSource = new Engine(storage, 'private', {
    sourceInstanceId: 'other', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 500, allowedRequesterIds: [], allowedBotActorIds: [], rules: [] },
  })
  await assert.rejects(otherSource.dismissEvaluation({ commandId: 'cross-dismiss', evaluationId: evaluated.id, reason: 'Cross source.' }), { code: 'SOURCE_NOT_AUTHORIZED' })
})

test('manual requeue overrides only the prior automatic decision for the requested event', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-prior-requeue-'))
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
      if (text === 'Prior evaluated direction.') {
        if (!completed) yield* toolResponse('handback_input', { reason: 'This message needs a fresh routing decision.' })
        else yield* textResponse('Handed back.')
      } else if (!completed) yield* toolResponse('report_ready', { result: `Ready: ${text}`, evidence: `Processed ${text}` })
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
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['alpha', 'beta'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }, {}, sessions)
  const prior = await engine.receiveSource({ commandId: 'prior-source', threadId: 'alpha', objectId: 'prior-source', type: 'created', version: '1', text: 'Prior evaluated direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const firstEval = await engine.assessSourceBatch({ commandId: 'prior-eval', threadId: 'alpha', eventIds: [prior.eventId] })
  const second = await accept(engine, 'beta', 'attach-target')
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  await engine.attachSourceEvent({ commandId: 'attach-prior', eventId: prior.eventId, ticketId: second.ticketId, reason: 'Reconsider this direction under the second Ticket.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const requeued = await engine.requeueSourceEvent({ commandId: 'manual-prior-requeue', eventId: prior.eventId })
  assert.equal(requeued.items[0].outcome, 'accepted')
  assert.notEqual(requeued.receipts[0].ticketId, firstEval.receipts[0].ticketId)
  assert.notEqual(requeued.receipts[0].ticketId, second.ticketId)
  const secondDirection = await engine.getTicketDirection(second.ticketId)
  const ownership = secondDirection.ownerships.find(item => item.sourceEventId === prior.eventId)
  assert.equal(ownership?.state, 'requeued')
  assert.equal(ownership?.requeueCommandId, 'manual-prior-requeue')
  assert.equal(secondDirection.requeues.find(decision => decision.eventId === prior.eventId)?.state, 'consumed')
  assert.equal(secondDirection.requeues.find(decision => decision.eventId === prior.eventId)?.evaluationId, requeued.id)
})

test('stale recovery releases a claimed explicit requeue that has no acceptance receipt', async t => {
  const { engine, storage } = await fixture(t)
  const prior = await engine.receiveSource({ commandId: 'crash-prior', threadId: 'alpha', objectId: 'crash-prior', type: 'created', version: '1', text: 'Prior evaluated direction.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await engine.assessSourceBatch({ commandId: 'crash-prior-eval', threadId: 'alpha', eventIds: [prior.eventId] })
  const target = await accept(engine, 'beta', 'crash-target')
  await engine.attachSourceEvent({ commandId: 'crash-attach', eventId: prior.eventId, ticketId: target.ticketId, reason: 'Attach before the crash.' })
  const threadKey = JSON.stringify(['desktop', 'desktop', 'alpha'])
  const crashedEvalId = `${threadKey}:0000000000000099`
  await storage.transaction('private', async tx => {
    await tx.insert('work-requeue', JSON.stringify(['work-requeue', prior.eventId]), {
      id: JSON.stringify(['work-requeue', prior.eventId]), instanceId: 'private', eventId: prior.eventId,
      commandId: 'crashed-requeue', commandKey: 'crashed-key', requesterId: 'user', state: 'claimed', evaluationId: crashedEvalId, createdAt: 1, claimedAt: 1,
    })
    await tx.insert('eval', crashedEvalId, {
      id: crashedEvalId, threadId: 'alpha', commandId: 'requeue:crashed', batchId: 'crashed', state: 'running', status: 'running', attempt: 0,
      candidateEventIds: [prior.eventId], items: [{ eventId: prior.eventId, outcome: 'accepted', strength: 'explicit', reason: 'EXPLICIT_RULE',
        matchedRules: ['human-direct'], ruleResults: [{ ruleId: 'human-direct', matched: true }], semanticCalled: false, reevaluation: true }],
      receipts: [], createdAt: 1,
    })
    await tx.insert('eval', `head:${threadKey}`, { evaluationId: crashedEvalId })
  })
  await engine.assessSourceBatch({ commandId: 'recover-crash', threadId: 'alpha', eventIds: [prior.eventId] })
  let direction = await engine.getTicketDirection(target.ticketId)
  const released = direction.requeues.find(decision => decision.eventId === prior.eventId)
  assert.equal(released?.state, 'pending')
  assert.equal(released?.evaluationId, undefined)
  assert.equal((await engine.listEvaluations('alpha')).items.find(evaluation => evaluation.id === crashedEvalId)?.items[0].outcome, 'unavailable')

  await storage.transaction('private', async tx => {
    for (const kind of ['work-ownership', 'event-work-ownership']) {
      let cursor
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await tx.scan(kind, { limit: 100, ...(cursor ? { after: cursor } : {}) })
        for (const item of page.items) if (item.value.sourceEventId === prior.eventId) await tx.replace(kind, item.id, { ...item.value, state: 'handed-back', reason: 'Crash recovery.' })
        if (!page.cursor) break
        cursor = page.cursor
      }
    }
  })
  const requeued = await engine.requeueSourceEvent({ commandId: 'retry-after-crash', eventId: prior.eventId })
  assert.equal(requeued.items[0].outcome, 'accepted')
  direction = await engine.getTicketDirection(target.ticketId)
  assert.equal(direction.requeues.find(decision => decision.eventId === prior.eventId)?.state, 'consumed')
})
