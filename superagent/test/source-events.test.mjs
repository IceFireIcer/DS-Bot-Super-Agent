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
