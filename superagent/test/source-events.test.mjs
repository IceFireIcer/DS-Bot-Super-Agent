import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CoreError, Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const source = { sourceInstanceId: 'desktop-one', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence' }
const ref = { threadId: 'room', objectId: '7' }
const event = { commandId: 'receive-1', ...ref, type: 'created', version: '1', text: 'Original request.' }
const sourceFixture = () => ({ sourceInstanceId: 'desktop-one', actorId: 'user', allowedActorIds: ['user'] })

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-source-events-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  return { storage, engine: new Engine(storage, 'private', source) }
}

test('versioned source events preserve history and only a newer native sequence advances current content', async t => {
  const { engine, storage } = await fixture(t)
  const receipt = await engine.receiveSource(event)
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(await engine.receiveSource({ ...event, commandId: 'transport-retry' }), receipt)
  await engine.receiveSource({ ...event, commandId: 'newest', type: 'edited', version: '3', text: 'Newest content.' })
  await engine.receiveSource({ ...event, commandId: 'late-edit', type: 'edited', version: '2', text: 'Older content.' })
  const current = await engine.getSourceObject(ref)
  assert.equal(current.state, 'current')
  assert.equal(current.text, 'Newest content.')
  assert.equal(current.version.value, '3')
  assert.equal(current.source.sourceInstanceId, 'desktop-one')
  const history = await engine.getSourceHistory(ref)
  assert.deepEqual(history.items.map(item => item.text).sort(), ['Newest content.', 'Older content.', 'Original request.'])
  assert.equal(history.cursor, undefined)
  assert.equal((await engine.listTickets()).items.length, 0)
  const connection = await storage.reconnect()
  const reopened = new Engine(connection, 'private', source)
  try { assert.deepEqual(await reopened.getSourceObject(ref), current) }
  finally { await connection.close() }
})

test('same-version differences remain visible conflicts until a provably newer version arrives', async t => {
  const { engine } = await fixture(t)
  await engine.receiveSource(event)
  await engine.receiveSource({ ...event, commandId: 'conflicting', text: 'Different content at the same version.' })
  const conflict = await engine.getSourceObject(ref)
  assert.equal(conflict.state, 'conflict')
  assert.equal(conflict.text, undefined)
  assert.equal((await engine.getSourceHistory(ref)).items.length, 2)
  await engine.receiveSource({ ...event, commandId: 'older', version: '0', text: 'Older.' })
  assert.equal((await engine.getSourceObject(ref)).state, 'conflict')
  await engine.receiveSource({ ...event, commandId: 'resolved', version: '2', type: 'edited', text: 'Verified newer content.' })
  assert.equal((await engine.getSourceObject(ref)).text, 'Verified newer content.')
})

test('opaque native versions and changed ordering contracts stay unknown rather than guessing a current body', async t => {
  const { storage, engine } = await fixture(t)
  const opaque = new Engine(storage, 'private', { ...source, sourceInstanceId: 'opaque', versionOrder: 'opaque' })
  await opaque.receiveSource({ ...event, version: 'etag-b' })
  await opaque.receiveSource({ ...event, commandId: 'opaque-next', type: 'edited', version: 'etag-a', text: 'Incomparable.' })
  assert.equal((await opaque.getSourceObject(ref)).state, 'unknown')
  assert.equal((await opaque.getSourceObject(ref)).text, undefined)
  await opaque.receiveSource({ ...event, commandId: 'opaque-third', version: 'etag-z' })
  assert.equal((await opaque.getSourceObject(ref)).state, 'unknown')
  await engine.receiveSource(event)
  const changed = new Engine(storage, 'private', { ...source, versionOrder: 'opaque' })
  await changed.receiveSource({ ...event, commandId: 'changed-config', type: 'edited', version: '2' })
  assert.equal((await changed.getSourceObject(ref)).state, 'unknown')
})

test('evidenced deletion leaves a permanent tombstone while preserving immutable event history', async t => {
  const { engine } = await fixture(t)
  await engine.receiveSource(event)
  const unproven = await engine.receiveSource({ commandId: 'delete-unverified', ...ref, type: 'deleted', version: '3' })
  assert.deepEqual(unproven, { status: 'filtered', reason: 'DELETE_UNVERIFIED' })
  assert.equal((await engine.getSourceObject(ref)).text, 'Original request.')
  await engine.receiveSource({ commandId: 'deleted', ...ref, type: 'deleted', version: '3', deletionEvidence: 'native-removal:7:3' })
  await engine.receiveSource({ ...event, commandId: 'late', type: 'edited', version: '2', text: 'Late edit.' })
  await engine.receiveSource({ ...event, commandId: 'newer-after-delete', type: 'edited', version: '4', text: 'Cannot revive.' })
  const deleted = await engine.getSourceObject(ref)
  assert.equal(deleted.state, 'deleted')
  assert.equal(deleted.text, undefined)
  const history = await engine.getSourceHistory(ref)
  assert.equal(history.items.length, 4)
  assert.equal(history.items.find(item => item.type === 'deleted').deletionEvidence, 'native-removal:7:3')
})

test('only the checked current source event can authorize new work and deletion preserves prior mandates', async t => {
  const { engine } = await fixture(t)
  const received = await engine.receiveSource(event)
  const accept = { commandId: 'accept-1', ...ref, expectedEventId: received.eventId }
  const receipt = await engine.acceptSource(accept)
  assert.equal((await engine.getTicket(receipt.ticketId)).mandate.scope, 'Original request.')
  assert.deepEqual(await engine.acceptSource({ ...accept, commandId: 'accept-retry' }), receipt)
  await engine.receiveSource({ ...event, commandId: 'edit', type: 'edited', version: '2', text: 'Changed scope.' })
  await assert.rejects(engine.acceptSource({ ...accept, commandId: 'stale-accept' }), { code: 'SOURCE_NOT_CURRENT' })
  assert.equal((await engine.getSourceCandidate(ref)).text, 'Changed scope.')
  await engine.receiveSource({ commandId: 'delete', ...ref, type: 'deleted', version: '3', deletionEvidence: 'native-deleted:7:3' })
  assert.equal(await engine.getSourceCandidate(ref), undefined)
  await assert.rejects(engine.acceptSource({ ...accept, commandId: 'deleted-accept' }), { code: 'SOURCE_NOT_CURRENT' })
  assert.deepEqual(await engine.acceptSource(accept), receipt)
  assert.equal((await engine.getTicket(receipt.ticketId)).ticket.state, 'open')
  assert.equal((await engine.getTicket(receipt.ticketId)).mandate.scope, 'Original request.')
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('trusted reception records filter reasons and keeps equal native identities isolated across sources and instances', async t => {
  const { engine, storage } = await fixture(t)
  const first = await engine.receiveSource(event)
  for (const key of ['source', 'actorId', 'instanceId', 'allowedActorIds', 'versionOrder']) {
    const commandId = `forged-${key}`
    const filtered = await engine.receiveSource({ ...event, commandId, [key]: 'forged' })
    assert.deepEqual(filtered, { status: 'filtered', reason: 'INVALID_INPUT' })
    assert.deepEqual(await engine.getSourceReceipt(commandId), filtered)
  }
  const denied = new Engine(storage, 'private', { ...source, sourceInstanceId: 'denied', allowedActorIds: [] })
  assert.deepEqual(await denied.receiveSource(event), { status: 'filtered', reason: 'SOURCE_NOT_AUTHORIZED' })
  assert.deepEqual(await engine.receiveSource({ ...event, commandId: 'foreign-thread', threadId: 'outside' }), { status: 'filtered', reason: 'SOURCE_SCOPE_DENIED' })
  const second = new Engine(storage, 'private', { ...source, sourceInstanceId: 'desktop-two' })
  assert.equal(await second.getSourceObject(ref), undefined)
  assert.equal(await second.getSourceReceipt(event.commandId), undefined)
  const sameNumber = await second.receiveSource({ ...event, text: 'Other source.' })
  assert.notEqual(sameNumber.eventId, first.eventId)
  const team = new Engine(storage, 'team', source)
  assert.equal(await team.getSourceObject(ref), undefined)
  assert.equal(await team.getSourceReceipt(event.commandId), undefined)
  await team.receiveSource({ ...event, text: 'Other instance.' })
  assert.equal((await engine.getSourceObject(ref)).text, 'Original request.')
  assert.equal((await second.getSourceObject(ref)).text, 'Other source.')
  assert.equal((await team.getSourceObject(ref)).text, 'Other instance.')
  const borrowed = new Engine(storage, 'private', { ...source, actorId: 'other', allowedActorIds: ['other'] })
  await assert.rejects(borrowed.acceptSource({ commandId: 'borrowed', ...ref, expectedEventId: first.eventId }), { code: 'SOURCE_NOT_AUTHORIZED' })
  assert.equal((await engine.listTickets()).items.length, 0)
})

test('source history uses bounded object-scoped cursors and command conflicts do not overwrite facts', async t => {
  const { engine } = await fixture(t)
  await engine.receiveSource(event)
  await assert.rejects(engine.receiveSource({ ...event, text: 'Mutated on the same command.' }), { code: 'IDENTITY_CONFLICT' })
  for (let index = 2; index <= 7; index++) await engine.receiveSource({ ...event, commandId: `edit-${index}`, type: 'edited', version: String(index), text: `Revision ${index}.` })
  await engine.receiveSource({ ...event, commandId: 'other-object', objectId: '8' })
  const seen = new Set()
  let after
  do {
    const page = await engine.getSourceHistory(ref, { limit: 2, ...(after ? { after } : {}) })
    assert.ok(page.items.length <= 2)
    for (const item of page.items) { assert.equal(item.objectId, '7'); assert.ok(!seen.has(item.id)); seen.add(item.id) }
    after = page.cursor
  } while (after)
  assert.equal(seen.size, 7)
  const foreign = await engine.getSourceHistory({ ...ref, objectId: '8' }, { limit: 1 })
  await assert.rejects(async () => engine.getSourceHistory(ref, { after: foreign.items[0].id }), { code: 'INVALID_INPUT' })
  for (const limit of [0, 101, -1, 1.5]) await assert.rejects(async () => engine.getSourceHistory(ref, { limit }), { code: 'INVALID_INPUT' })
})

test('conflict and unknown projections cannot be new acceptance or association candidates', async t => {
  const { storage, engine } = await fixture(t)
  const original = await engine.receiveSource(event)
  await engine.receiveSource({ ...event, commandId: 'conflict', text: 'Conflicting body.' })
  assert.equal(await engine.getSourceCandidate(ref), undefined)
  await assert.rejects(engine.acceptSource({ ...ref, commandId: 'accept-conflict', expectedEventId: original.eventId }), { code: 'SOURCE_NOT_CURRENT' })
  const opaque = new Engine(storage, 'private', { ...source, sourceInstanceId: 'opaque', versionOrder: 'opaque' })
  const first = await opaque.receiveSource({ ...event, version: 'a' })
  await opaque.receiveSource({ ...event, commandId: 'unknown', version: 'b' })
  assert.equal(await opaque.getSourceCandidate(ref), undefined)
  await assert.rejects(opaque.acceptSource({ ...ref, commandId: 'accept-unknown', expectedEventId: first.eventId }), { code: 'SOURCE_NOT_CURRENT' })
  assert.equal((await engine.listTickets()).items.length, 0)
})

test('event, projection and receiving receipt roll back together and reconcile an unknown commit', async t => {
  const { engine, storage } = await fixture(t)
  const failing = { ...storage, transaction: (instance, operation) => storage.transaction(instance, async tx => {
    await operation(tx)
    throw new Error('Injected before commit')
  }) }
  await assert.rejects(new Engine(failing, 'private', source).receiveSource(event), /Injected before commit/u)
  assert.equal(await engine.getSourceObject(ref), undefined)
  assert.equal(await engine.getSourceReceipt(event.commandId), undefined)
  assert.equal((await engine.getSourceHistory(ref)).items.length, 0)
  let unknown = true
  const uncertain = {
    transaction: async (instance, operation) => {
      const result = await storage.transaction(instance, operation)
      if (unknown) { unknown = false; throw new CoreError('COMMIT_UNKNOWN', 'Injected after commit') }
      return result
    },
    reconnect: () => storage.reconnect(), close: () => {},
  }
  const receipt = await new Engine(uncertain, 'private', source).receiveSource(event)
  assert.deepEqual(await engine.getSourceReceipt(event.commandId), receipt)
  assert.equal((await engine.getSourceHistory(ref)).items.length, 1)
})

test('a versioned source cannot bypass its reception scope or tombstone through legacy submit', async t => {
  const { engine, storage } = await fixture(t)
  const received = await engine.receiveSource(event)
  const accepted = await engine.acceptSource({ ...ref, commandId: 'accepted', expectedEventId: received.eventId })
  await engine.receiveSource({ commandId: 'delete', ...ref, type: 'deleted', version: '2', deletionEvidence: 'native-delete:7:2' })
  await assert.rejects(engine.submit({ commandId: 'bypass-deleted', eventId: ref.objectId, text: event.text }), { code: 'UNSUPPORTED_CAPABILITY' })
  await assert.rejects(engine.submit({ commandId: 'bypass-scope', eventId: 'outside-room', text: 'Bypass source scope.' }), { code: 'UNSUPPORTED_CAPABILITY' })
  const partial = new Engine(storage, 'private', { ...source, allowedThreadIds: undefined })
  await assert.rejects(partial.submit({ commandId: 'partial', eventId: '7', text: event.text }), { code: 'UNSUPPORTED_CAPABILITY' })
  const downgraded = new Engine(storage, 'private', { sourceInstanceId: source.sourceInstanceId, actorId: 'user', allowedActorIds: ['user'] })
  await assert.rejects(downgraded.submit({ commandId: 'downgraded', eventId: '7', text: event.text }), { code: 'UNSUPPORTED_CAPABILITY' })
  assert.equal((await engine.listTickets()).items.length, 1)
  assert.equal((await engine.getTicket(accepted.ticketId)).mandate.scope, event.text)
})

test('a source identity cannot switch from accepted direct requests to versioned reception', async t => {
  const { storage } = await fixture(t)
  const direct = new Engine(storage, 'private', { sourceInstanceId: 'direct-desktop', actorId: 'user', allowedActorIds: ['user'] })
  await direct.submit({ commandId: 'direct', eventId: '7', text: event.text })
  const switched = new Engine(storage, 'private', { ...source, sourceInstanceId: 'direct-desktop' })
  assert.deepEqual(await switched.receiveSource(event), { status: 'filtered', reason: 'SOURCE_MODE_CONFLICT' })
  assert.equal(await switched.getSourceObject(ref), undefined)
  assert.equal((await direct.listTickets()).items.length, 1)
})

test('pre-T04 direct receipts keep their source mode even when a different native object arrives first', async t => {
  const { storage } = await fixture(t)
  const binding = { sourceInstanceId: 'legacy-desktop', actorId: 'user', allowedActorIds: ['user'] }
  const direct = new Engine(storage, 'private', binding)
  const request = { commandId: 'legacy-command', eventId: '7', text: 'Original direct request.' }
  const receipt = await direct.submit(request)
  // Pre-T04 databases have accepted triggers but no source-mode record.
  await storage.transaction('private', tx => tx.remove('source-mode', JSON.stringify(['desktop', 'legacy-desktop'])))
  const versioned = new Engine(storage, 'private', { ...source, sourceInstanceId: 'legacy-desktop' })
  assert.deepEqual(await versioned.receiveSource({ ...event, objectId: '8' }), { status: 'filtered', reason: 'SOURCE_MODE_CONFLICT' })
  assert.deepEqual(await direct.submit(request), receipt)
  assert.equal((await direct.listTickets()).items.length, 1)
})

test('source batches gate noise before semantic assessment and accept explicit requests with traceable rules', async t => {
  const { storage } = await fixture(t)
  const assessed = []
  const policy = {
    mode: 'auto',
    maxBatchSize: 10,
    maxAttempts: 2,
    timeoutMs: 200,
    allowedRequesterIds: ['alice'],
    allowedBotActorIds: ['ci-bot'],
    rules: [
      { id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' },
      { id: 'bot-mention', actorKinds: ['bot', 'ci'], addressing: ['mention'], mode: 'inferred' },
    ],
    assess: async (items, _signal, onDelivered) => { await onDelivered(); assessed.push(items); return items.map(item => ({ eventId: item.eventId, outcome: 'accept', reason: 'matched-task-rule', evidence: 'The bot report asks for a bounded implementation.' })) },
  }
  const source = { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy }
  const engine = new Engine(storage, 'private', source)
  const receive = async (input) => engine.receiveSource({ ...input, commandId: `receive-${input.objectId}`, threadId: 'room', type: 'created', version: '1' })
  const explicit = await receive({ objectId: 'human', text: 'Please fix the failing test.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const noise = await receive({ objectId: 'noise', text: 'Status update.', authorId: 'mallory', authorKind: 'human', addressing: 'ambient' })
  const bot = await receive({ objectId: 'bot', text: 'Please implement the fix.', authorId: 'ci-bot', authorKind: 'ci', addressing: 'mention' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-1', threadId: 'room', eventIds: [explicit.eventId, noise.eventId, bot.eventId] })
  assert.equal(result.status, 'completed')
  assert.equal(result.items.length, 3)
  assert.equal(result.items.find(item => item.eventId === explicit.eventId).outcome, 'accepted')
  assert.equal(result.items.find(item => item.eventId === noise.eventId).reason, 'ACTOR_NOT_ALLOWED')
  assert.equal(result.items.find(item => item.eventId === bot.eventId).outcome, 'accepted')
  assert.equal(assessed.length, 1)
  assert.deepEqual(assessed[0].map(item => item.eventId), [bot.eventId])
  assert.equal(result.items.find(item => item.eventId === bot.eventId).matchedRules[0], 'bot-mention')
  assert.equal((await engine.listTickets()).items.length, 2)
  assert.equal(result.items.find(item => item.eventId === noise.eventId).semanticCalled, false)
})

test('one Thread has one running Eval, arrivals queue for the next batch, and other Threads stay independent', async t => {
  const { storage } = await fixture(t)
  let release, signalHead
  const waiting = new Promise(resolve => { release = resolve })
  const reachedHead = new Promise(resolve => { signalHead = resolve })
  const source = { ...sourceFixture(), allowedThreadIds: ['room-a', 'room-b'], versionOrder: 'sequence', intake: {
    mode: 'auto', maxBatchSize: 2, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'], rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (items, _signal, onDelivered) => { await onDelivered(); if (items[0].threadId === 'room-a' && items[0].objectId === 'one') { signalHead(); await waiting } return items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'No actionable request.' })) },
  } }
  const engine = new Engine(storage, 'private', source)
  const receive = (threadId, objectId) => engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text: 'A bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const first = await receive('room-a', 'one')
  const second = await receive('room-a', 'two')
  const other = await receive('room-b', 'other')
  const running = engine.assessSourceBatch({ commandId: 'eval-a', threadId: 'room-a', eventIds: [first.eventId] })
  await reachedHead
  const queued = await engine.assessSourceBatch({ commandId: 'eval-a-queued', threadId: 'room-a', eventIds: [second.eventId] })
  const independent = engine.assessSourceBatch({ commandId: 'eval-b', threadId: 'room-b', eventIds: [other.eventId] })
  assert.equal(queued.status, 'queued')
  const independentResult = await independent
  assert.notEqual(independentResult.status, 'queued', JSON.stringify(independentResult))
  release()
  assert.notEqual((await running).status, 'queued')
  let roomA
  for (let attempt = 0; attempt < 100; attempt++) {
    roomA = await engine.listEvaluations('room-a')
    if (roomA.queued === 0 && roomA.items.every(item => item.state === 'completed')) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(roomA.items.length, 2)
  assert.equal(roomA.queued, 0)
  assert.ok(roomA.items.every(item => item.state !== 'queued'))
  assert.equal((await engine.listEvaluations('room-b')).items.length, 1)
  await new Promise(resolve => setTimeout(resolve, 20))
})

test('observe and disabled modes never invoke the assessor, while exhausted timeout is visible and re-evaluable', async t => {
  const { storage } = await fixture(t)
  let calls = 0, abortedCalls = 0
  const policy = { mode: 'observe', maxBatchSize: 5, maxAttempts: 2, timeoutMs: 100, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
    rules: [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }], assess: async (_events, _signal, onDelivered) => { await onDelivered(); calls++; return [] } }
  const source = { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy }
  const engine = new Engine(storage, 'private', source)
  const request = { commandId: 'bot-event', threadId: 'room', objectId: 'bot-event', type: 'created', version: '1', text: 'Implement this improvement.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' }
  const observed = await engine.receiveSource(request)
  const observation = await engine.assessSourceBatch({ commandId: 'observe', threadId: 'room', eventIds: [observed.eventId] })
  assert.equal(observation.items[0].reason, 'WOULD_ACCEPT')
  assert.equal(observation.items[0].semanticCalled, false)
  assert.equal(calls, 0)
  assert.equal((await engine.listTickets()).items.length, 0)
  const auto = new Engine(storage, 'private', { ...source, intake: { ...policy, mode: 'auto', assess: async (_events, signal, onDelivered) => {
    await onDelivered()
    calls++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve([]), 1000)
      signal.addEventListener('abort', () => { abortedCalls++; clearTimeout(timer); reject(new Error('assessment cancelled')) }, { once: true })
    })
  } } })
  const first = await auto.assessSourceBatch({ commandId: 'timeout-one', threadId: 'room', eventIds: [observed.eventId] })
  assert.equal(first.status, 'unavailable')
  assert.equal(first.attempt, 2)
  assert.match(first.items[0].reason, /^EVAL_TIMEOUT:/u)
  assert.equal(calls, 2)
  assert.equal(abortedCalls, 2)
  const retry = await auto.assessSourceBatch({ commandId: 'timeout-recheck', threadId: 'room', eventIds: [observed.eventId] })
  assert.equal(retry.status, 'unavailable')
  assert.equal(retry.items[0].semanticCalled, true)
})

test('an event with no matched rule is rejected without a semantic assessor call', async t => {
  const { storage } = await fixture(t)
  let calls = 0
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
    rules: [{ id: 'direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }], assess: async (_events, _signal, onDelivered) => { await onDelivered(); calls++; return [] } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const received = await engine.receiveSource({ commandId: 'ambient', threadId: 'room', objectId: 'ambient', type: 'created', version: '1', text: 'Conversation context.', authorId: 'alice', authorKind: 'human', addressing: 'ambient' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-ambient', threadId: 'room', eventIds: [received.eventId] })
  assert.equal(result.items[0].reason, 'NO_MATCHED_RULE')
  assert.equal(result.items[0].semanticCalled, false)
  assert.equal(calls, 0)
})

test('rule matches remain recorded when the actor allowlist rejects the candidate', async t => {
  const { storage } = await fixture(t)
  let calls = 0
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
    rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }], assess: async (_events, _signal, onDelivered) => { await onDelivered(); calls++; return [] } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const event = await engine.receiveSource({ commandId: 'unlisted-human', threadId: 'room', objectId: 'unlisted-human', type: 'created', version: '1', text: 'Please do this.', authorId: 'mallory', authorKind: 'human', addressing: 'direct' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-unlisted', threadId: 'room', eventIds: [event.eventId] })
  assert.equal(result.items[0].reason, 'ACTOR_NOT_ALLOWED')
  assert.deepEqual(result.items[0].ruleResults, [{ ruleId: 'human-direct', matched: true }])
  assert.equal(calls, 0)
})

test('the Engine snapshots intake rules while retaining the configured assessor adapter', async t => {
  const { storage } = await fixture(t)
  let calls = 0
  const intake = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: [], allowedBotActorIds: ['bot'], selfActorIds: [],
    rules: [{ id: 'bot-mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (items, _signal, onDelivered) => { await onDelivered(); calls++; return items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'Snapshot policy.' })) } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake })
  intake.mode = 'off'; intake.rules[0].addressing.length = 0; intake.allowedBotActorIds.length = 0
  const event = await engine.receiveSource({ commandId: 'snapshot', threadId: 'room', objectId: 'snapshot', type: 'created', version: '1', text: 'Request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-snapshot', threadId: 'room', eventIds: [event.eventId] })
  assert.equal(result.items[0].reason, 'Snapshot policy.')
  assert.equal(calls, 1)
})

test('explicit-only batches create their Ticket and reject source-self messages by default', async t => {
  const { storage } = await fixture(t)
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['alice', 'user'], allowedBotActorIds: [],
    rules: [{ id: 'direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const user = await engine.receiveSource({ commandId: 'user-event', threadId: 'room', objectId: 'user-event', type: 'created', version: '1', text: 'Please fix it.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const self = await engine.receiveSource({ commandId: 'self-event', threadId: 'room', objectId: 'self-event', type: 'created', version: '1', text: 'Internal update.', authorKind: 'bot', addressing: 'direct' })
  const result = await engine.assessSourceBatch({ commandId: 'explicit-batch', threadId: 'room', eventIds: [user.eventId, self.eventId] })
  assert.equal(result.status, 'completed')
  assert.equal(result.items.find(item => item.eventId === user.eventId).outcome, 'accepted', JSON.stringify(result))
  assert.equal(result.items.find(item => item.eventId === self.eventId).reason, 'SOURCE_SELF_MESSAGE')
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('a human equal to the configured desktop actor may still make an explicit request', async t => {
  const { storage } = await fixture(t)
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['user'], allowedBotActorIds: [], rules: [{ id: 'direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const received = await engine.receiveSource({ commandId: 'same-human', threadId: 'room', objectId: 'same-human', type: 'created', version: '1', text: 'Please fix this.', authorKind: 'human', addressing: 'direct' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-same-human', threadId: 'room', eventIds: [received.eventId] })
  assert.equal(result.items[0].outcome, 'accepted')
})

test('an explicit batch queued behind an inferred Eval is accepted when its turn runs', async t => {
  const { storage } = await fixture(t)
  let release
  const gate = new Promise(resolve => { release = resolve })
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
    rules: [{ id: 'direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }, { id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (items, _signal, onDelivered) => { await onDelivered(); await gate; return items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'No action.' })) } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const inferred = await engine.receiveSource({ commandId: 'queued-bot', threadId: 'room', objectId: 'queued-bot', type: 'created', version: '1', text: 'Bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const explicit = await engine.receiveSource({ commandId: 'queued-human', threadId: 'room', objectId: 'queued-human', type: 'created', version: '1', text: 'Please fix it.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const running = engine.assessSourceBatch({ commandId: 'running', threadId: 'room', eventIds: [inferred.eventId] })
  await new Promise(resolve => setTimeout(resolve, 10))
  const queued = await engine.assessSourceBatch({ commandId: 'queued-explicit', threadId: 'room', eventIds: [explicit.eventId] })
  assert.equal(queued.status, 'queued')
  release()
  await running
  for (let i = 0; i < 100; i++) { if ((await engine.listEvaluations('room')).queued === 0 && (await engine.listTickets()).items.length === 1) break; await new Promise(resolve => setTimeout(resolve, 5)) }
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('a persisted expired Eval head is recovered before a later batch runs', async t => {
  const { storage } = await fixture(t)
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'], rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }], assess: async (_events, _signal, onDelivered) => { await onDelivered(); return [] } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const event = await engine.receiveSource({ commandId: 'stale', threadId: 'room', objectId: 'stale', type: 'created', version: '1', text: 'Bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const staleId = JSON.stringify(['desktop', 'desktop-one', 'room']) + ':0000000000000099'
  const headKey = 'head:' + JSON.stringify(['desktop', 'desktop-one', 'room'])
  await storage.transaction('private', async tx => {
    await tx.insert('eval', staleId, { id: staleId, threadId: 'room', commandId: 'crashed', batchId: 'batch', state: 'running', status: 'running', attempt: 1, candidateEventIds: [event.eventId], items: [{ eventId: event.eventId, outcome: 'pending', reason: 'AWAITING_ASSESSMENT', matchedRules: [], ruleResults: [], semanticCalled: true }], receipts: [], createdAt: 1, deliveredAt: 1 })
    if (!await tx.replace('eval', headKey, { evaluationId: staleId })) await tx.insert('eval', headKey, { evaluationId: staleId })
  })
  const fresh = await engine.assessSourceBatch({ commandId: 'fresh', threadId: 'room', eventIds: [event.eventId] })
  assert.equal(fresh.status, 'unavailable')
  const evaluations = await engine.listEvaluations('room')
  assert.equal(evaluations.items.find(item => item.id === staleId).status, 'unavailable')
})

test('an Eval reservation that crashes before delivery is recoverable', async t => {
  const { storage } = await fixture(t)
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'], rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }], assess: async (items, _signal, onDelivered) => { await onDelivered(); return items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'No action.' })) } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const received = await engine.receiveSource({ commandId: 'before-delivery', threadId: 'room', objectId: 'before-delivery', type: 'created', version: '1', text: 'Bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const prefix = JSON.stringify(['desktop', 'desktop-one', 'room'])
  const oldId = `${prefix}:0000000000000099`
  await storage.transaction('private', async tx => {
    await tx.insert('eval', oldId, { id: oldId, threadId: 'room', commandId: 'crashed-before-delivery', batchId: 'old', state: 'running', status: 'running', attempt: 0, candidateEventIds: [received.eventId], items: [{ eventId: received.eventId, outcome: 'pending', reason: 'AWAITING_ASSESSMENT', matchedRules: ['mention'], ruleResults: [{ ruleId: 'mention', matched: true }], semanticCalled: true }], receipts: [], createdAt: 1 })
    await tx.insert('eval', `head:${prefix}`, { evaluationId: oldId })
  })
  const next = await engine.assessSourceBatch({ commandId: 'after-crash', threadId: 'room', eventIds: [received.eventId] })
  assert.notEqual(next.status, 'queued', JSON.stringify(next))
  const evaluations = await engine.listEvaluations('room')
  assert.equal(evaluations.items.find(item => item.id === oldId).items[0].reason, 'EVAL_RECOVERED_BEFORE_DELIVERY')
})

test('Router queue wait does not consume the semantic assessment delivery deadline', async t => {
  const { storage } = await fixture(t)
  let delivered = false
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 1000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'], rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (items, _signal, onDelivered) => { await new Promise(resolve => setTimeout(resolve, 150)); await onDelivered(); delivered = true; return items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'No action.' })) } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const received = await engine.receiveSource({ commandId: 'queued-router', threadId: 'room', objectId: 'queued-router', type: 'created', version: '1', text: 'Bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-after-queue', threadId: 'room', eventIds: [received.eventId] })
  assert.equal(delivered, true)
  assert.notEqual(result.status, 'queued', JSON.stringify(result))
  assert.ok(result.items[0].outcome === 'rejected' || result.items[0].outcome === 'unavailable')
})

test('a per-item queue-full rejection cannot strand the Eval head or lose sibling decisions', async t => {
  const { storage } = await fixture(t)
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['alice'], allowedBotActorIds: [], rules: [{ id: 'direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy }, { maxQueuedEffects: 2 })
  const first = await engine.receiveSource({ commandId: 'first', threadId: 'room', objectId: 'first', type: 'created', version: '1', text: 'First.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  const second = await engine.receiveSource({ commandId: 'second', threadId: 'room', objectId: 'second', type: 'created', version: '1', text: 'Second.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await storage.transaction('private', tx => engine.effects.enqueue(tx, { key: 'fill', stream: 'notice', scope: 'router', payload: { type: 'filler' } }))
  const result = await engine.assessSourceBatch({ commandId: 'eval-fill', threadId: 'room', eventIds: [first.eventId, second.eventId] })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.items.length, 2)
  assert.ok(result.items.every(item => item.reason === 'QUEUE_FULL' && item.outcome === 'unavailable'))
  assert.equal((await engine.listTickets()).items.length, 0)
  await storage.transaction('private', tx => engine.effects.cancel(tx, { key: 'fill', stream: 'notice', scope: 'router' }))
  const retried = await engine.assessSourceBatch({ commandId: 'eval-next', threadId: 'room', eventIds: [first.eventId] })
  assert.equal(retried.items[0].outcome, 'accepted', JSON.stringify(retried))
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('oversized aggregate rule facts are rejected before an Eval is persisted', async t => {
  const { storage } = await fixture(t)
  const ruleIds = Array.from({ length: 32 }, (_, index) => `${String(index).padStart(2, '0')}${'r'.repeat(510)}`)
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
    rules: ruleIds.map(id => ({ id, actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' })) }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const received = []
  for (let index = 0; index < 5; index++) received.push(await engine.receiveSource({ commandId: `large-${index}`, threadId: 'room', objectId: `large-${index}`, type: 'created', version: '1', text: 'Request.', authorId: 'alice', authorKind: 'human', addressing: 'direct' }))
  await assert.rejects(engine.assessSourceBatch({ commandId: 'large-batch', threadId: 'room', eventIds: received.map(item => item.eventId) }), { code: 'EVAL_BATCH_LIMIT' })
  assert.equal((await engine.listEvaluations('room')).items.length, 0)
})

test('aggregate evidence and receipts are included in the persisted Eval budget', async t => {
  const { storage } = await fixture(t)
  const threadId = 't'.repeat(180)
  let assessorCalls = 0
  const policy = { mode: 'auto', maxBatchSize: 20, maxAttempts: 1, timeoutMs: 100, allowedRequesterIds: [], allowedBotActorIds: ['bot'],
    rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (items, _signal, onDelivered) => { await onDelivered(); assessorCalls++; return items.map(item => ({ eventId: item.eventId, outcome: 'accept', reason: '\0'.repeat(512), evidence: '\0'.repeat(4096) })) } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: [threadId], versionOrder: 'sequence', intake: policy })
  const received = []
  for (let index = 0; index < 20; index++) received.push(await engine.receiveSource({ commandId: `large-result-${index}`, threadId, objectId: `${String(index).padStart(2, '0')}${'o'.repeat(178)}`, type: 'created', version: '1', text: 'Request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' }))
  await assert.rejects(engine.assessSourceBatch({ commandId: 'large-result-batch', threadId, eventIds: received.map(item => item.eventId) }), { code: 'EVAL_BATCH_LIMIT' })
  assert.equal(assessorCalls, 0)
  assert.equal((await engine.listEvaluations(threadId)).items.length, 0)
})

test('approved batches persist complete maximum-size assessments and oversized batches leave no Eval reservation', async t => {
  const { storage } = await fixture(t)
  for (const [scenario, evidence] of ['e'.repeat(4096), '\0'.repeat(4096), '界'.repeat(1365)].entries()) {
    const threadId = `room-${scenario}${'"\\'.repeat(80)}`
    const intake = { mode: 'auto', maxBatchSize: 20, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: [], allowedBotActorIds: ['bot'],
      rules: [{ id: `mention${'"\\'.repeat(100)}`, actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
      assess: async (items, _signal, onDelivered) => { await onDelivered(); return items.map(item => ({ eventId: item.eventId, outcome: 'accept', reason: `r${'\0'.repeat(511)}`, evidence })) } }
    const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: [threadId], versionOrder: 'sequence', intake })
    let accepted = 0, rejected = 0
    for (const size of [1, 3, 5]) {
      const received = []
      for (let index = 0; index < size; index++) received.push(await engine.receiveSource({ commandId: `budget-${scenario}-${size}-${index}`, threadId, objectId: `${size}-${index}${'"\\'.repeat(80)}`, type: 'created', version: '1', text: 'Request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' }))
      const before = (await engine.listEvaluations(threadId)).items.length
      try {
        const result = await engine.assessSourceBatch({ commandId: `eval-budget-${scenario}-${size}`, threadId, eventIds: received.map(item => item.eventId) })
        assert.equal(result.state, 'completed')
        assert.equal(result.receipts.length, size)
        assert.ok(result.items.every(item => item.outcome === 'accepted' && item.evidence === evidence))
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 131072)
        accepted++
      } catch (error) {
        assert.equal(error.code, 'EVAL_BATCH_LIMIT')
        assert.equal((await engine.listEvaluations(threadId)).items.length, before)
        rejected++
      }
    }
    assert.ok(accepted > 0 && rejected > 0)
    assert.ok((await engine.listEvaluations(threadId)).items.every(item => item.state === 'completed'))
  }
})

test('a superseded assessor cannot create a Ticket after its Thread head expires and is replaced', async t => {
  const { storage } = await fixture(t)
  let release, delivered
  const gate = new Promise(resolve => { release = resolve })
  const reachedRouter = new Promise(resolve => { delivered = resolve })
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 10000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
    rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (_items, _signal, onDelivered) => { await onDelivered(); delivered(); await gate; return [{ eventId: eventIdForOld, outcome: 'accept', reason: 'Old assessment.' }] } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const received = await engine.receiveSource({ commandId: 'old-event', threadId: 'room', objectId: 'old', type: 'created', version: '1', text: 'Bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const eventIdForOld = received.eventId
  const running = engine.assessSourceBatch({ commandId: 'old-eval', threadId: 'room', eventIds: [received.eventId] })
  await reachedRouter
  const threadKey = JSON.stringify(['desktop', 'desktop-one', 'room'])
  const oldId = `${threadKey}:0000000000000001`
  await storage.transaction('private', async tx => {
    const expired = await tx.get('eval', oldId)
    assert.ok(expired)
    await tx.replace('eval', oldId, { ...expired, state: 'unavailable', status: 'unavailable' })
    await tx.replace('eval', `head:${threadKey}`, { evaluationId: `${threadKey}:replacement` })
  })
  release()
  const result = await running
  assert.equal(result.status, 'unavailable')
  assert.equal((await engine.listTickets()).items.length, 0)
})

test('invalidated first queued Eval drains through to the next runnable batch', async t => {
  const { storage } = await fixture(t)
  let release
  const calls = []
  const gate = new Promise(resolve => { release = resolve })
  const policy = { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 10000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['bot'],
    rules: [{ id: 'mention', actorKinds: ['bot'], addressing: ['mention'], mode: 'inferred' }],
    assess: async (items, _signal, onDelivered) => { await onDelivered(); if (items[0].objectId === 'first') await gate; const result = items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'No action.' })); calls.push({ objects: items.map(item => item.objectId), result }); return result } }
  const engine = new Engine(storage, 'private', { ...sourceFixture(), allowedThreadIds: ['room'], versionOrder: 'sequence', intake: policy })
  const receive = objectId => engine.receiveSource({ commandId: `receive-${objectId}`, threadId: 'room', objectId, type: 'created', version: '1', text: 'Bot request.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  const first = await receive('first'), stale = await receive('stale'), last = await receive('last')
  const running = engine.assessSourceBatch({ commandId: 'run-first', threadId: 'room', eventIds: [first.eventId] })
  while ((await engine.listEvaluations('room')).items[0]?.deliveredAt === undefined) await new Promise(resolve => setTimeout(resolve, 1))
  await engine.assessSourceBatch({ commandId: 'queue-stale', threadId: 'room', eventIds: [stale.eventId] })
  await engine.assessSourceBatch({ commandId: 'queue-last', threadId: 'room', eventIds: [last.eventId] })
  await engine.receiveSource({ commandId: 'supersede-stale', threadId: 'room', objectId: 'stale', type: 'edited', version: '2', text: 'Changed.', authorId: 'bot', authorKind: 'bot', addressing: 'mention' })
  release()
  await running
  let listed
  for (let attempt = 0; attempt < 100; attempt++) {
    listed = await engine.listEvaluations('room')
    if (listed.queued === 0 && listed.items.at(-1)?.state === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(listed.queued, 0)
  assert.ok(listed.items.every(item => item.state !== 'queued'), JSON.stringify({ calls, items: listed.items.map(item => ({ state: item.state, items: item.items })) }))
  assert.ok(calls.some(call => call.objects.includes('last')))
  assert.equal(listed.items[1].items[0].reason, 'SOURCE_EVENT_NOT_CURRENT')
})
