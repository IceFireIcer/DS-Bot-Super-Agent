import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Activation, CoreError, Engine, NativeSessions, Switchover } from '../dist/index.js'
import * as plugin from '../dist/index.js'
import { prepareLegacyArchive, publishLegacyArchive, readLegacyObject, verifyLegacyArchive } from '../dist/legacy-archive.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse } from '../dev/native-mock.mjs'

const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen({ host: '127.0.0.1', port }, () => { server.off('error', reject); resolve() })
})
const closeServer = server => new Promise(resolve => server.close(() => resolve()))
const freePort = async () => {
  const server = createServer()
  await listen(server, 0)
  const port = server.address().port
  await closeServer(server)
  return port
}
const snapshot = (overrides = {}) => ({
  capturedAt: Date.now(), stateRevision: 7, activeTurns: [], activeJobs: [], pendingOutbound: [],
  increments: { inputs: 0, receipts: 0, events: 0, outbound: 0 },
  cursors: [{ sourceInstanceId: 'legacy', value: '0', complete: true }], receipts: [], ...overrides,
})

async function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-activation-'))
  const legacyHome = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(legacyHome, 'bot'), { recursive: true })
  writeFileSync(join(legacyHome, 'bot', 'state.json'), JSON.stringify({
    version: 1, revision: 7, mainBotIds: [], bots: {}, rooms: {}, works: { old: { state: 'running' } }, requests: {}, questions: {}, agents: {},
  }))
  writeFileSync(join(legacyHome, 'bot', 'state.lock'), '{}')
  await prepareLegacyArchive({ source: legacyHome, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')

  const storage = await SqliteStorage.open(join(root, 'core.sqlite'))
  let native, sessions
  if (options.sessions) {
    native = await nativeContext(root, request => request.model === 'worker' ? textResponse('Worker idle after activation.') : routerResponse(request))
    sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  }
  const engine = new Engine(storage, 'private', source, {}, sessions, [], {}, {}, {}, {}, { hostId: 'activation-test', leaseMs: 600_000 })
  const lease = await engine.acquireHost()
  const port = await freePort()
  const old = createServer(socket => socket.end())
  await listen(old, port)
  let oldSnapshot = snapshot()
  const legacy = {
    stop: async () => { await closeServer(old) },
    disableRestart: async () => ({ evidence: 'old launcher renamed' }),
    restartDisabled: async () => true,
    snapshot: async () => oldSnapshot,
  }
  const switchover = new Switchover(storage, 'private')
  const begin = await switchover.begin({ batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: legacyHome,
    entry: { host: '127.0.0.1', port }, legacy, settleMs: 5, entryWaitMs: 250, heartbeatMs: 200 })
  assert.equal(begin.state, 'quiesced')
  t.after(async () => {
    await engine.effects.stop().catch(() => {})
    await sessions?.close()
    await native?.fiber.dispose()
    await switchover.close().catch(() => {})
    await storage.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, target, storage, engine, lease, port, switchover, legacy, setSnapshot: value => { oldSnapshot = value } }
}

const heldInput = {
  sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'held-object', version: { order: 'sequence', value: '2' },
  text: 'held gap request', cursor: { sourceInstanceId: 'legacy', value: '2' },
  receipt: { commandId: 'held-command', state: 'not-accepted', cursor: '2' },
}
const acceptedInput = {
  sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'accepted-object', version: { order: 'sequence', value: '1' },
  text: 'accepted by old', cursor: { sourceInstanceId: 'legacy', value: '1' },
  receipt: { commandId: 'accepted-command', state: 'accepted', cursor: '1' },
}
const quarantineInput = {
  sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'quarantine-object', version: { order: 'sequence', value: '3' },
  text: 'no reliable receipt', cursor: { sourceInstanceId: 'legacy', value: '3' },
}

test('activation publishes one manifest, gates the new entry and releases only held gap input', async t => {
  const { target, storage, engine, lease, switchover, legacy, setSnapshot } = await fixture(t)
  await switchover.ingestGapInput('batch-1', heldInput)
  await switchover.ingestGapInput('batch-1', acceptedInput)
  await switchover.ingestGapInput('batch-1', quarantineInput)
  setSnapshot(snapshot({
    cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'held-command', eventId: 'held-object', state: 'not-accepted', cursor: '2' },
      { commandId: 'accepted-command', eventId: 'accepted-object', state: 'accepted', cursor: '1' }],
  }))
  const rechecked = await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  assert.deepEqual(rechecked.gap, { held: 1, legacyAccepted: 1, quarantined: 1, released: 0 })

  const activation = new Activation(storage, 'private', switchover)
  engine.setActivationGate(activation.gate())
  await assert.rejects(engine.submit({ commandId: 'before', eventId: 'before', text: 'Must wait for activation.' }), { code: 'CORE_NOT_ACTIVE' })
  await assert.rejects(engine.receiveSource({ commandId: 'before-source', threadId: 'thread-1', objectId: 'source-1', type: 'created', version: '1',
    text: 'Must not be consumed before activation.', authorId: 'user', authorKind: 'human', addressing: 'direct' }), { code: 'CORE_NOT_ACTIVE' })
  await assert.rejects(storage.transaction('private', tx => engine.effects.enqueue(tx, { key: 'before-effect', stream: 'notice', scope: 'scope', payload: {} })),
    { code: 'CORE_NOT_ACTIVE' })

  const released = new Map()
  let releaseCalls = 0
  const release = {
    release: async (input, context) => {
      releaseCalls++
      if (released.has(context.commandId)) return released.get(context.commandId)
      const receipt = await engine.submit({ commandId: context.commandId, eventId: input.id, text: input.text ?? 'Gap input.' })
      const result = { ticketId: receipt.ticketId, receiptId: receipt.acceptedCommandId }
      released.set(context.commandId, result)
      return result
    },
  }
  const active = await activation.activate({ batchId: 'batch-1', commandId: 'activate-1', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  assert.equal(active.state, 'active')
  assert.equal(active.currentCore, 'ds-superagent')
  assert.equal(active.manifest.currentCore, 'ds-superagent')
  assert.equal(active.manifest.epoch, lease.epoch)
  assert.equal(active.manifest.checkpoints.length, 2)
  assert.equal(active.manifest.oldReview.some(item => item.id === 'old'), true)
  assert.deepEqual(active.release, { planned: 3, released: 1, pending: 0, unknown: 0, failed: 0, skipped: 2, legacyAccepted: 1, quarantined: 1 })
  const releasedGap = active.releases.find(item => item.state === 'released')
  assert.equal(releasedGap.input.state, 'held')
  assert.equal((await switchover.listGapInputs('batch-1', { state: 'released' })).items.length, 1)
  assert.equal((await switchover.listGapInputs('batch-1', { state: 'released' })).items[0].dispatch, 'released-to-current-entry')
  assert.equal(active.releases.filter(item => item.state === 'skipped').length, 2)
  assert.equal(releaseCalls, 1)
  assert.equal((await switchover.status('batch-1')).state, 'active')
  await assert.rejects(switchover.ingestGapInput('batch-1', heldInput), { code: 'CORE_NOT_ACTIVE' })

  const after = await engine.submit({ commandId: 'after', eventId: 'after', text: 'New work after activation.' })
  assert.equal((await engine.getTicket(after.ticketId)).trigger.text, 'New work after activation.')
  assert.equal((await engine.effects.list()).items.some(effect => effect.stream === 'outbox'), true)
  assert.equal((await readLegacyObject({ target, batchId: 'batch-1', ref: 'work:old' })).data.state, 'running')

  const replay = await activation.activate({ batchId: 'batch-1', commandId: 'activate-1', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  assert.equal(replay.id, active.id)
  assert.equal(releaseCalls, 1)
  const secondCommand = await activation.activate({ batchId: 'batch-1', commandId: 'activate-2', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  assert.equal(secondCommand.id, active.id)
  assert.equal((await storage.transaction('private', tx => tx.get('activation-command', JSON.stringify(['activation-command', 'private', 'activate-2'])))).activationId,
    active.manifest.activationId)
  assert.equal(releaseCalls, 1)
  await assert.rejects(activation.activate({ batchId: 'batch-1', commandId: 'activate-other', newEpoch: lease.epoch + 1, legacy, release, settleMs: 5 }),
    { code: 'ACTIVATION_CONFLICT' })
})

test('activation refuses a batch whose final old-core snapshot is not quiesced', async t => {
  const { storage, lease, switchover, legacy, setSnapshot } = await fixture(t)
  setSnapshot(snapshot({ activeJobs: ['job-1'] }))
  const blocked = await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  assert.equal(blocked.state, 'quiescing')
  const activation = new Activation(storage, 'private', switchover)
  await assert.rejects(activation.activate({ batchId: 'batch-1', commandId: 'activate-blocked', newEpoch: lease.epoch, legacy,
    release: { release: async () => ({}) }, settleMs: 5 }), { code: 'NOT_QUIESCED' })
})

test('a lost release acknowledgement is reconciled by the original release command with no duplicate work', async t => {
  const { storage, engine, lease, switchover, legacy, setSnapshot } = await fixture(t)
  await switchover.ingestGapInput('batch-1', heldInput)
  setSnapshot(snapshot({
    cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'held-command', eventId: 'held-object', state: 'not-accepted', cursor: '2' }],
  }))
  await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  const activation = new Activation(storage, 'private', switchover)
  engine.setActivationGate(activation.gate())
  const receipts = new Map()
  let calls = 0
  const release = {
    release: async (input, context) => {
      calls++
      if (receipts.has(context.commandId)) return receipts.get(context.commandId)
      const receipt = await engine.submit({ commandId: context.commandId, eventId: input.id, text: input.text ?? 'Gap input.' })
      const result = { ticketId: receipt.ticketId, receiptId: receipt.acceptedCommandId }
      receipts.set(context.commandId, result)
      if (calls === 1) throw new CoreError('COMMIT_UNKNOWN', 'Release response lost.')
      return result
    },
  }
  const active = await activation.activate({ batchId: 'batch-1', commandId: 'activate-lost', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  assert.equal(active.release.unknown, 1)
  assert.equal(active.release.released, 0)
  assert.equal((await engine.listTickets()).items.length, 1)
  const retried = await activation.releasePending('batch-1', release)
  assert.equal(retried.release.released, 1)
  assert.equal(retried.release.unknown, 0)
  assert.equal(calls, 2)
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('an activation commit with a lost response is reconciled on the original command ID', async t => {
  const { storage, engine, lease, switchover, legacy, setSnapshot } = await fixture(t)
  await switchover.ingestGapInput('batch-1', heldInput)
  setSnapshot(snapshot({
    cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'held-command', eventId: 'held-object', state: 'not-accepted', cursor: '2' }],
  }))
  await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  let loseReply = true
  const uncertain = {
    transaction: async (instanceId, operation) => {
      const result = await storage.transaction(instanceId, operation)
      if (loseReply) { loseReply = false; throw new CoreError('COMMIT_UNKNOWN', 'Activation response lost.') }
      return result
    },
    reconnect: () => storage.reconnect(),
    close: () => storage.close(),
  }
  const activation = new Activation(uncertain, 'private', switchover)
  engine.setActivationGate(activation.gate())
  const release = {
    release: async (input, context) => {
      const receipt = await engine.submit({ commandId: context.commandId, eventId: input.id, text: input.text ?? 'Gap input.' })
      return { ticketId: receipt.ticketId, receiptId: receipt.acceptedCommandId }
    },
  }
  const active = await activation.activate({ batchId: 'batch-1', commandId: 'activate-unknown', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  assert.equal(active.state, 'active')
  assert.equal(active.release.released, 1)
  const replay = await activation.activate({ batchId: 'batch-1', commandId: 'activate-unknown', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  assert.equal(replay.id, active.id)
  assert.equal((await engine.listTickets()).items.length, 1)
})

test('activation leaves old review readable, starts a new Session and keeps a manual stop', { timeout: 20000 }, async t => {
  const { target, storage, engine, lease, switchover, legacy, setSnapshot } = await fixture(t, { sessions: true })
  await switchover.ingestGapInput('batch-1', heldInput)
  setSnapshot(snapshot({
    cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'held-command', eventId: 'held-object', state: 'not-accepted', cursor: '2' }],
  }))
  await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  const activation = new Activation(storage, 'private', switchover)
  engine.setActivationGate(activation.gate())
  const release = {
    release: async (input, context) => {
      const receipt = await engine.submit({ commandId: context.commandId, eventId: input.id, text: input.text ?? 'Gap input.' })
      return { ticketId: receipt.ticketId, receiptId: receipt.acceptedCommandId }
    },
  }
  const active = await activation.activate({ batchId: 'batch-1', commandId: 'activate-session', newEpoch: lease.epoch, legacy, release, settleMs: 5 })
  const ticketId = active.releases.find(item => item.state === 'released')?.ticketId
  assert.equal(typeof ticketId, 'string')
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const conversation = await engine.conversation(ticketId)
  assert.ok(conversation.assignments.length > 0)
  assert.equal(typeof conversation.assignments[0].sessionId, 'string')
  const stop = await engine.stopTicket({ commandId: 'stop-activated', ticketId, reason: 'Stop after activation.' })
  assert.ok(stop.stop.state === 'stopped' || stop.stop.state === 'stopping')
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  assert.equal((await engine.getTicket(ticketId)).ticket.constraint.kind, 'stopped')
  assert.equal((await readLegacyObject({ target, batchId: 'batch-1', ref: 'work:old' })).data.state, 'running')
})

test('the plugin installs its configured activation gate', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ds-superagent-plugin-gate-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); rmSync(directory, { recursive: true, force: true }) })
  await ctx.plugin(plugin, { databasePath: join(directory, 'state.sqlite'), instanceId: 'private', source,
    activationGate: { active: async () => false } })
  const engine = ctx.get('superagent')
  await assert.rejects(engine.submit({ commandId: 'gated', eventId: 'gated', text: 'Must be rejected.' }), { code: 'CORE_NOT_ACTIVE' })
})
