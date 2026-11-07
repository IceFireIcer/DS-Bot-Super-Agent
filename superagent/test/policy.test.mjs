import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

function policy(overrides = {}) {
  return { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
    rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' },
      { id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (events, _signal, onDelivered) => { await onDelivered(); return events.map(event => ({ eventId: event.eventId, outcome: 'reject', reason: 'No new action.' })) },
    ...overrides }
}

async function fixture(t, overrides) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-policy-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy(overrides) })
  return { engine, storage, directory }
}

test('Policy updates are revisioned, reject stale writes and survive restart', async t => {
  const { engine, storage } = await fixture(t)
  const initial = await engine.updateIntakePolicy({ commandId: 'initial-policy', expectedRevision: 2, policy: policy({ mode: 'observe' }) })
  assert.equal(initial.revision, 3)
  await assert.rejects(engine.updateIntakePolicy({ commandId: 'stale-policy', expectedRevision: 2, policy: policy({ mode: 'off' }) }), { code: 'POLICY_REVISION_CONFLICT' })
  const sync = await engine.updateIntakePolicy({ commandId: 'sync-policy', expectedRevision: 3, origin: 'sync', sourceRevision: 'members-9', policy: policy({ mode: 'auto', allowedBotActorIds: ['bot', 'ci'] }) })
  assert.equal(sync.revision, 4)
  await assert.rejects(engine.updateIntakePolicy({ commandId: 'sync-replay-new-id', expectedRevision: 4, origin: 'sync', sourceRevision: 'members-9', policy: policy({ mode: 'auto' }) }), { code: 'STALE_POLICY_SYNC' })
  const reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy({ mode: 'observe' }) })
  const resumed = await reopened.updateIntakePolicy({ commandId: 'reopened-check', expectedRevision: 4, policy: policy({ mode: 'auto', allowedBotActorIds: ['bot', 'ci'] }) })
  assert.equal(resumed.revision, 5)
})

test('replayed Policy and pause commands return the current result without rewinding runtime state', async t => {
  const { engine } = await fixture(t)
  const firstPolicy = await engine.updateIntakePolicy({ commandId: 'policy-replay', expectedRevision: 2, policy: policy({ mode: 'observe' }) })
  const paused = await engine.setProcessingPaused({ commandId: 'pause-replay', paused: true })
  await engine.setProcessingPaused({ commandId: 'resume-replay', paused: false })
  assert.equal((await engine.setProcessingPaused({ commandId: 'pause-replay', paused: true })).revision, paused.revision)
  assert.equal((await engine.setProcessingPaused({ commandId: 'still-paused-check', paused: false })).paused, false)
  const latest = await engine.updateIntakePolicy({ commandId: 'policy-latest', expectedRevision: firstPolicy.revision, policy: policy({ mode: 'off' }) })
  const replay = await engine.updateIntakePolicy({ commandId: 'policy-replay', expectedRevision: 2, policy: policy({ mode: 'observe' }) })
  assert.equal(replay.revision, latest.revision)
  assert.equal(replay.policy.mode, 'off')
})

test('pausing records source events without dispatching and resumes queued work without aborting an active turn', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-policy-pause-'))
  let native, storage, sessions, engine, release, entered
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(async () => {
    release?.()
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
      if (text === 'Hold while pausing.') { entered(); await gate }
      if (!completed) yield* toolResponse('report_ready', { result: `Ready: ${text}`, evidence: `Processed ${text}` })
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
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: policy({ allowedRequesterIds: ['alice'], allowedBotActorIds: [] }) }, { scanIntervalMs: 100 }, sessions)
  const firstEvent = await engine.receiveSource({ commandId: 'pause-hold', threadId: 'room', objectId: 'pause-hold', type: 'created', version: '1', text: 'Hold while pausing.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const first = await engine.assessSourceBatch({ commandId: 'pause-hold-eval', threadId: 'room', eventIds: [firstEvent.eventId] })
  const running = (async () => { for (let index = 0; index < 5; index++) await engine.effects.drain() })()
  await started
  const paused = await engine.setProcessingPaused({ commandId: 'pause-all', paused: true })
  assert.equal(paused.paused, true)
  const queued = await engine.receiveSource({ commandId: 'paused-event', threadId: 'room', objectId: 'paused-event', type: 'created', version: '1', text: 'Queued while paused.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  assert.equal(queued.status, 'recorded')
  await assert.rejects(engine.assessSourceBatch({ commandId: 'paused-eval', threadId: 'room', eventIds: [queued.eventId] }), { code: 'PROCESSING_PAUSED' })
  assert.equal(workerTurns.filter(text => text === 'Queued while paused.').length, 0)
  release()
  await running
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(first.receipts[0].ticketId)).status, 'ready')
  const pendingEffects = await engine.effects.listByScope(first.receipts[0].ticketId)
  assert.ok(pendingEffects.some(effect => effect.stream === 'notice' && effect.payload.type === 'report-ready'))
  await engine.setProcessingPaused({ commandId: 'resume-all', paused: false })
  for (let index = 0; index < 12; index++) await engine.effects.drain()
  assert.ok(workerTurns.includes('Hold while pausing.'))
})

test('Policy and pause controls preserve waiting-human and stopped Ticket constraints', async t => {
  const { engine, storage } = await fixture(t)
  const received = await engine.receiveSource({ commandId: 'constraint-policy', threadId: 'room', objectId: 'constraint-policy', type: 'created', version: '1', text: 'Initial request.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const accepted = await engine.assessSourceBatch({ commandId: 'constraint-policy-eval', threadId: 'room', eventIds: [received.eventId] })
  const ticketId = accepted.receipts[0].ticketId
  const work = await engine.getTicket(ticketId)
  assert.ok(work)
  await storage.transaction('private', async tx => {
    await tx.replace('ticket', ticketId, { ...work.ticket, constraint: { kind: 'stopped', reason: 'Keep stopped.' } })
  })
  await engine.setProcessingPaused({ commandId: 'pause-constraint', paused: true })
  await engine.updateIntakePolicy({ commandId: 'policy-constraint', expectedRevision: 2, policy: policy({ mode: 'auto', allowedRequesterIds: ['alice'] }) })
  assert.equal((await engine.getTicketDirection(ticketId))?.constraint?.kind, 'stopped')
  await engine.setProcessingPaused({ commandId: 'resume-constraint', paused: false })
  assert.equal((await engine.getTicketDirection(ticketId))?.constraint?.kind, 'stopped')
})

test('a Policy change interrupts an in-flight Eval, requeues it under the new revision, and leaves another source instance alone', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-policy-requeue-'))
  let storage, first, second
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(async () => {
    release?.()
    await first?.effects.stop(); await second?.effects.stop()
    await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const calls = []
  const assess = label => async (events, _signal, onDelivered) => {
    calls.push(label)
    await onDelivered()
    if (label === 'first') {
      entered()
      await gate
    }
    return events.map(event => ({ eventId: event.eventId, outcome: 'reject', reason: 'No action.' }))
  }
  const intake = label => policy({ mode: 'auto', maxAttempts: 1, timeoutMs: 5000, allowedBotActorIds: ['review-bot'], assess: assess(label),
    rules: [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }] })
  first = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop-a', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence', intake: intake('first') })
  second = new core.Engine(storage, 'second', { sourceInstanceId: 'desktop-b', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence', intake: intake('second') })
  const receive = (engine, commandId, objectId) => engine.receiveSource({ commandId, threadId: 'room', objectId, type: 'created', version: '1',
    text: `Candidate ${objectId}.`, authorId: 'review-bot', authorKind: 'bot', addressing: 'mention' })
  const firstEvent = await receive(first, 'first-receive', 'first')
  const firstEval = first.assessSourceBatch({ commandId: 'first-eval', threadId: 'room', eventIds: [firstEvent.eventId] })
  await started
  const secondEvent = await receive(second, 'second-receive', 'second')
  const secondEval = await second.assessSourceBatch({ commandId: 'second-eval', threadId: 'room', eventIds: [secondEvent.eventId] })
  assert.equal(secondEval.state, 'completed')
  assert.equal(secondEval.items[0].reason, 'No action.')
  const updated = await first.updateIntakePolicy({ commandId: 'policy-a', expectedRevision: 2,
    policy: policy({ mode: 'off', maxAttempts: 1, timeoutMs: 5000, allowedBotActorIds: ['review-bot'], rules: [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }] }) })
  assert.equal(updated.revision, 3)
  const interrupted = await firstEval
  assert.equal(interrupted.state, 'unavailable')
  assert.equal(interrupted.items[0].reason, 'POLICY_CHANGED')
  release()
  const list = await first.listEvaluations('room')
  assert.ok(list.items.some(item => item.state === 'unavailable' && item.items[0].reason === 'POLICY_CHANGED'), JSON.stringify(list))
  assert.deepEqual(calls, ['first', 'second'])
  const secondList = await second.listEvaluations('room')
  assert.equal(secondList.items.filter(item => item.state === 'unavailable').length, 0)
})

test('pausing after an Eval reaches its assessor survives the old deadline and records the paused Eval', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-policy-eval-pause-'))
  let engine, release, entered
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(async () => {
    release?.()
    await engine?.effects.stop()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: policy({ mode: 'auto', maxAttempts: 1, timeoutMs: 300, allowedBotActorIds: ['bot'],
      rules: [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
      assess: async (events, _signal, onDelivered) => {
        await onDelivered()
        entered()
        await gate
        return events.map(event => ({ eventId: event.eventId, outcome: 'reject', reason: 'Late result.' }))
      } }) })
  const received = await engine.receiveSource({ commandId: 'paused-eval-receive', threadId: 'room', objectId: 'paused-eval', type: 'created', version: '1',
    text: 'Assess while paused.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const running = engine.assessSourceBatch({ commandId: 'paused-eval', threadId: 'room', eventIds: [received.eventId] })
  await started
  await engine.setProcessingPaused({ commandId: 'pause-eval', paused: true })
  await new Promise(resolve => setTimeout(resolve, 400))
  let listed = await engine.listEvaluations('room')
  assert.equal(listed.items.find(item => item.commandId === 'paused-eval')?.state, 'unavailable')
  assert.equal(listed.items.find(item => item.commandId === 'paused-eval')?.items[0].reason, 'EVAL_PAUSED')
  release()
  const result = await running
  assert.equal(result.state, 'unavailable')
  assert.equal(result.items[0].reason, 'EVAL_PAUSED')
  await engine.setProcessingPaused({ commandId: 'resume-eval', paused: false })
  listed = await engine.listEvaluations('room')
  assert.equal(listed.items.find(item => item.commandId === 'paused-eval')?.state, 'unavailable')
})
