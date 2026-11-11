import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Activation, Engine, Reversal, Switchover } from '../dist/index.js'
import { getLegacyArchive, prepareLegacyArchive, publishLegacyArchive, readLegacyObject, verifyLegacyArchive } from '../dist/legacy-archive.js'
import { SqliteStorage } from '../dist/storage.js'

const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }
const clearEvidence = () => ({
  activeTurns: [], activeJobs: [], pendingOutbound: [], unknownEffects: [], unknownJobs: [], pendingReceipts: [],
  manualStops: ['ticket-stop'], compatibility: { canReopen: true, blockers: [] },
})
const heldInput = {
  sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'held-object', version: { order: 'sequence', value: '1' },
  text: 'held gap request', cursor: { sourceInstanceId: 'legacy', value: '1' },
  receipt: { commandId: 'held-command', state: 'not-accepted', cursor: '1' },
}
const snapshot = (overrides = {}) => ({
  capturedAt: Date.now(), stateRevision: 7, activeTurns: [], activeJobs: [], pendingOutbound: [],
  increments: { inputs: 0, receipts: 0, events: 0, outbound: 0 },
  cursors: [{ sourceInstanceId: 'legacy', value: '0', complete: true }], receipts: [], ...overrides,
})

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

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-reversal-'))
  const legacyHome = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(legacyHome, 'bot'), { recursive: true })
  writeFileSync(join(legacyHome, 'bot', 'state.json'), JSON.stringify({
    version: 1, revision: 7, mainBotIds: [], bots: {}, rooms: {}, works: { old: { state: 'running' } }, requests: {}, questions: {}, agents: {},
  }))
  writeFileSync(join(legacyHome, 'bot', 'state.lock'), '{}')
  const sourceBefore = readFileSync(join(legacyHome, 'bot', 'state.json'), 'utf8')
  await prepareLegacyArchive({ source: legacyHome, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')

  const storage = await SqliteStorage.open(join(root, 'core.sqlite'))
  const engine = new Engine(storage, 'private', source, {}, undefined, [], {}, {}, {}, {}, { hostId: 'reversal-test', leaseMs: 600_000 })
  await engine.acquireHost()
  const port = await freePort()
  const old = createServer(socket => socket.end())
  await listen(old, port)
  let oldSnapshot = snapshot()
  let restartEnabled = false
  let restartCalls = 0
  const legacy = {
    stop: async () => { await closeServer(old) },
    disableRestart: async () => ({ evidence: 'old launcher renamed' }),
    restartDisabled: async () => true,
    enableRestart: async () => { restartCalls++; restartEnabled = true; return { evidence: 'old launcher restored', entry: join(root, 'legacy-entry.mjs') } },
    restartEnabled: async () => restartEnabled,
    snapshot: async () => oldSnapshot,
  }
  const switchover = new Switchover(storage, 'private')
  const quiesced = await switchover.begin({ batchId: 'batch-1', newEpoch: (await engine.getHostLease()).epoch, archive: { target }, oldHome: legacyHome,
    entry: { host: '127.0.0.1', port }, legacy, settleMs: 5, entryWaitMs: 250, heartbeatMs: 200 })
  assert.equal(quiesced.state, 'quiesced')
  const activation = new Activation(storage, 'private', switchover)
  engine.setActivationGate(activation.gate())
  t.after(async () => {
    await engine.effects.stop().catch(() => {})
    await switchover.close().catch(() => {})
    await storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { root, target, storage, engine, switchover, activation, legacy, sourceBefore,
    setSnapshot: value => { oldSnapshot = value }, restart: () => ({ enabled: restartEnabled, calls: restartCalls }) }
}

async function prepareHeld(switchover, setSnapshot) {
  await switchover.ingestGapInput('batch-1', heldInput)
  setSnapshot(snapshot({
    cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'held-command', eventId: 'held-object', state: 'not-accepted', cursor: '1' }],
  }))
  await switchover.recheck('batch-1', { legacy: { stop: async () => {}, disableRestart: async () => ({ evidence: '' }), restartDisabled: async () => true, snapshot: async () => snapshot() }, settleMs: 5 })
}

async function activateHeld(context) {
  const { switchover, activation, engine, legacy, setSnapshot } = context
  await switchover.ingestGapInput('batch-1', heldInput)
  setSnapshot(snapshot({
    cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'held-command', eventId: 'held-object', state: 'not-accepted', cursor: '1' }],
  }))
  await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  return activation.activate({ batchId: 'batch-1', commandId: 'activate-reversal', newEpoch: (await engine.getHostLease()).epoch, legacy, settleMs: 5,
    release: { release: async (input, releaseContext) => {
      const receipt = await engine.submit({ commandId: releaseContext.commandId, eventId: input.id, text: input.text ?? 'Gap input.' })
      return { ticketId: receipt.ticketId, receiptId: receipt.acceptedCommandId }
    } } })
}

test('abandoning before activation rechecks ownership, leaves history and only reopens an empty gap', async t => {
  const context = await fixture(t)
  await prepareLegacyArchive({ source: join(context.root, 'legacy'), target: context.target, batchId: 'batch-2', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(context.target, 'batch-2')
  await publishLegacyArchive(context.target, 'batch-2')
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  const abandoned = await reversal.abandon({ batchId: 'batch-1', commandId: 'abandon-1', reason: 'Switch cancelled.', legacy: context.legacy, settleMs: 5 })
  assert.equal(abandoned.state, 'abandoned')
  assert.equal(abandoned.restart.enabledAt > 0, true)
  assert.equal(context.restart().enabled, true)
  assert.equal((await context.switchover.status('batch-1')).state, 'abandoned')
  assert.equal((await readLegacyObject({ target: context.target, batchId: 'batch-1', ref: 'work:old' })).data.state, 'running')
  assert.equal(getLegacyArchive(context.target, 'batch-2').status, 'published')
  assert.equal(readFileSync(join(context.root, 'legacy', 'bot', 'state.json'), 'utf8'), context.sourceBefore)
  const replay = await reversal.abandon({ batchId: 'batch-1', commandId: 'abandon-1', reason: 'Switch cancelled.', legacy: context.legacy, settleMs: 5 })
  assert.equal(replay.id, abandoned.id)
  assert.equal(context.restart().calls, 1)
})

test('an abandoned batch with held or unknown gap ownership stays review-blocked and does not reopen the old entry', async t => {
  const context = await fixture(t)
  await prepareHeld(context.switchover, context.setSnapshot)
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  const blocked = await reversal.abandon({ batchId: 'batch-1', commandId: 'abandon-held', reason: 'Operator asked to stop.', legacy: context.legacy, settleMs: 5 })
  assert.equal(blocked.state, 'blocked')
  assert.deepEqual(blocked.blockers, ['GAP_OWNERSHIP_REVIEW'])
  assert.equal(context.restart().enabled, false)
  assert.equal((await context.switchover.status('batch-1')).state, 'quiesced')
})

test('reverse stops the new entry before it becomes ready and never replays old queue', async t => {
  const context = await fixture(t)
  await activateHeld(context)
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  let stopped = 0
  const reverse = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-1', reason: 'Use the old core again.',
    control: { stopAndSnapshot: async () => { stopped++; return clearEvidence() } } })
  assert.equal(reverse.state, 'ready')
  assert.equal(reverse.manifest.manualStops[0], 'ticket-stop')
  assert.equal((await context.activation.status()).state, 'reversing')
  await assert.rejects(context.engine.submit({ commandId: 'after-reverse', eventId: 'after-reverse', text: 'Must be blocked.' }), { code: 'CORE_NOT_ACTIVE' })
  assert.equal((await readLegacyObject({ target: context.target, batchId: 'batch-1', ref: 'work:old' })).data.state, 'running')
  const completed = await reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-1', legacy: context.legacy,
    compatibility: async () => ({ canReopen: true, blockers: [] }) })
  assert.equal(completed.state, 'completed')
  assert.equal(context.restart().enabled, true)
  assert.equal((await context.activation.status()).state, 'reversed')
  assert.equal((await context.switchover.status('batch-1')).state, 'abandoned')
  assert.equal(stopped, 1)
})

test('reverse preserves unknown effects and old-core incompatibility as visible blockers', async t => {
  const context = await fixture(t)
  await activateHeld(context)
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  const blocked = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-blocked', reason: 'Unknown effect.',
    control: { stopAndSnapshot: async () => ({ ...clearEvidence(), unknownEffects: ['effect-1'], compatibility: { canReopen: false, blockers: ['unknown-effect'] } }) } })
  assert.equal(blocked.state, 'blocked')
  assert.equal(blocked.blockers.includes('UNKNOWN_EFFECT: effect-1'), true)
  assert.equal(blocked.blockers.includes('OLD_CORE_INCOMPATIBLE'), true)
  await assert.rejects(reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-blocked', legacy: context.legacy,
    compatibility: async () => ({ canReopen: true, blockers: [] }) }), { code: 'REVERSE_NOT_READY' })
})

test('an interrupted reverse stop is recoverable by the same command without a second external stop', async t => {
  const context = await fixture(t)
  await activateHeld(context)
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  let attempts = 0
  const interrupted = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-interrupted', reason: 'Stop interrupted.',
    control: { stopAndSnapshot: async () => { attempts++; throw new Error('stop interrupted') } } })
  assert.equal(interrupted.state, 'blocked')
  assert.equal(interrupted.blockers.some(item => item.startsWith('NEW_CORE_STOP_FAILED')), true)
  const retry = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-interrupted', reason: 'Stop interrupted.',
    control: { stopAndSnapshot: async () => { attempts++; return clearEvidence() } } })
  assert.equal(retry.state, 'ready')
  assert.equal(attempts, 2)
  const completed = await reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-interrupted', legacy: context.legacy,
    compatibility: async () => ({ canReopen: true, blockers: [] }) })
  assert.equal(completed.state, 'completed')
})

test('reverse can run under a newer Host epoch after the active Host releases its lease', async t => {
  const context = await fixture(t)
  await activateHeld(context)
  await context.engine.shutdown()
  const next = await context.engine.acquireHost()
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  const reverse = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-new-epoch', reason: 'Host replaced.',
    control: { stopAndSnapshot: async () => clearEvidence() } })
  assert.equal(reverse.state, 'ready')
  assert.equal(reverse.reverseEpoch, next.epoch)
  assert.equal(reverse.reverseEpoch > reverse.activationEpoch, true)
  const completed = await reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-new-epoch', legacy: context.legacy,
    compatibility: async () => ({ canReopen: true, blockers: [] }) })
  assert.equal(completed.state, 'completed')
})

test('the final reverse gate rechecks old-core compatibility and does not reopen a changed old system', async t => {
  const context = await fixture(t)
  await activateHeld(context)
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  const ready = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-compat', reason: 'Compatibility changes.',
    control: { stopAndSnapshot: async () => clearEvidence() } })
  assert.equal(ready.state, 'ready')
  const blocked = await reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-compat', legacy: context.legacy,
    compatibility: async () => ({ canReopen: false, blockers: ['permission-or-format-changed'] }) })
  assert.equal(blocked.state, 'blocked')
  assert.equal(blocked.blockers.includes('COMPATIBILITY_CHANGED'), true)
  assert.equal(context.restart().enabled, false)
})

test('a real Engine outbound backlog is a reverse blocker, not a silent stop', async t => {
  const context = await fixture(t)
  await activateHeld(context)
  const reversal = new Reversal(context.storage, 'private', context.switchover)
  const blocked = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-outbound', reason: 'Outbound still pending.',
    control: { stopAndSnapshot: async () => {
      await context.engine.effects.stop()
      const effects = (await context.engine.effects.list()).items
      return { ...clearEvidence(), pendingOutbound: effects.filter(effect => effect.state === 'pending' || effect.state === 'running').map(effect => effect.scope) }
    } } })
  assert.equal(blocked.state, 'blocked')
  assert.equal(blocked.blockers[0], 'PENDING_OUTBOUND')
  await assert.rejects(reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-outbound', legacy: context.legacy,
    compatibility: async () => ({ canReopen: true, blockers: [] }) }), { code: 'REVERSE_NOT_READY' })
})
