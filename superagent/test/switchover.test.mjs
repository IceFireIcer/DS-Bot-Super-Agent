import assert from 'node:assert/strict'
import { createConnection, createServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareLegacyArchive, publishLegacyArchive, verifyLegacyArchive } from '../dist/legacy-archive.js'
import { HostLease } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { Switchover } from '../dist/switchover.js'

const clearSnapshot = (revision = 7) => ({
  capturedAt: Date.now(), stateRevision: revision, activeTurns: [], activeJobs: [], pendingOutbound: [],
  increments: { inputs: 0, receipts: 0, events: 0, outbound: 0 },
  cursors: [{ sourceInstanceId: 'legacy', value: '0', complete: true }],
  receipts: [],
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

async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-switchover-'))
  const source = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(source, 'bot'), { recursive: true })
  writeFileSync(join(source, 'bot', 'state.json'), JSON.stringify({
    version: 1, revision: 7, mainBotIds: [], bots: {}, rooms: {},
    works: { old: { state: 'running' } }, requests: {}, questions: {}, agents: {},
  }))
  writeFileSync(join(source, 'bot', 'state.lock'), '{}')
  await prepareLegacyArchive({ source, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')
  const storage = await SqliteStorage.open(join(root, 'core.sqlite'))
  const lease = await new HostLease(storage, 'private', { hostId: 'switchover-test', leaseMs: 600_000 }).acquire()
  t.after(async () => {
    await storage.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, source, target, storage, lease }
}

const netSend = (port, value) => new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port })
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('error', reject)
  socket.on('data', chunk => {
    buffer += chunk
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    socket.setTimeout(0)
    socket.destroy()
    try { resolve(JSON.parse(buffer.slice(0, newline))) } catch (error) { reject(error) }
  })
  socket.on('connect', () => socket.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`))
})

test('quiescing verifies drained turns, jobs and outbound and actually holds the intake entry', async t => {
  const { source, target, storage, lease } = await setup(t)
  const port = await freePort()
  const old = createServer(socket => socket.end())
  await listen(old, port)
  let snapshot = { ...clearSnapshot(), activeTurns: ['turn-1'], activeJobs: ['job-1'], pendingOutbound: ['out-1'],
    cursors: [{ sourceInstanceId: 'legacy', value: '0', complete: false, reason: 'behind' }],
    receipts: [{ commandId: 'old-command', state: 'pending' }],
    increments: { inputs: 1, receipts: 1, events: 1, outbound: 1 } }
  let stops = 0
  const legacy = {
    stop: async () => { stops++; await closeServer(old); return { evidence: 'old receiver exited' } },
    disableRestart: async () => ({ evidence: 'old launcher renamed', entry: '/fictional/old-entry' }),
    restartDisabled: async () => true,
    snapshot: async () => snapshot,
  }
  const switchover = new Switchover(storage, 'private')
  t.after(() => switchover.close().catch(() => {}))
  const options = { batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: source, entry: { host: '127.0.0.1', port },
    legacy, settleMs: 10, entryWaitMs: 250 }

  const blocked = await switchover.begin(options)
  assert.equal(stops, 1)
  assert.equal(blocked.state, 'quiescing')
  assert.deepEqual(new Set(blocked.blockers.map(blocker => blocker.code)), new Set(['ACTIVE_TURNS', 'ACTIVE_JOBS', 'PENDING_OUTBOUND', 'PENDING_INCREMENT', 'INCOMPLETE_CURSOR', 'PENDING_RECEIPT']))
  assert.equal(blocked.checkpoints.some(item => item.receipts.some(receipt => receipt.state === 'pending')), true)
  assert.equal(blocked.oldHome.lockExists, true)
  assert.equal(blocked.oldHome.usedAsFence, false)
  assert.equal(blocked.entry.isolated, true)
  assert.equal(blocked.stop.confirmedAt > 0, true)

  snapshot = clearSnapshot()
  const quiesced = await switchover.begin(options)
  assert.equal(stops, 1, 'a confirmed stop is not repeated')
  assert.equal(quiesced.state, 'quiesced')
  assert.deepEqual(quiesced.blockers, [])
  assert.equal(quiesced.quiescedAt > 0, true)

  const intruder = createServer()
  await assert.rejects(listen(intruder, port), { code: 'EADDRINUSE' })
  const status = await switchover.status('batch-1')
  assert.equal(status.isolation, 'held-by-this-process')
  assert.equal(status.buffer.held, 0)

  const duplicateHolder = new Switchover(storage, 'private')
  const duplicateRecord = await duplicateHolder.begin(options)
  assert.equal(duplicateRecord.state, 'quiesced')
  await duplicateHolder.close()
  assert.equal((await switchover.status('batch-1')).state, 'quiesced', 'a duplicate holder cannot release the live holder')
})

test('the gap intake keeps reliable ownership apart and quarantines unreliable boundaries without dispatch', async t => {
  const { source, target, storage, lease } = await setup(t)
  const port = await freePort()
  const old = createServer(socket => socket.end())
  await listen(old, port)
  let snapshot = { ...clearSnapshot(), cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }] }
  const legacy = { stop: async () => { await closeServer(old) }, disableRestart: async () => ({ evidence: 'old launcher renamed' }),
    restartDisabled: async () => true, snapshot: async () => snapshot }
  const switchover = new Switchover(storage, 'private')
  t.after(() => switchover.close().catch(() => {}))
  const record = await switchover.begin({ batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: source,
    entry: { host: '127.0.0.1', port }, legacy, settleMs: 5, entryWaitMs: 250 })
  assert.equal(record.state, 'quiesced')

  const base = { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'object-1', version: { order: 'sequence', value: '1' }, text: 'window input' }
  const held = await netSend(port, { ...base, cursor: { sourceInstanceId: 'legacy', value: '2' }, receipt: { commandId: 'command-1', state: 'not-accepted', cursor: '2' } })
  assert.equal(held.ok, true)
  assert.equal(held.state, 'held')
  const accepted = await netSend(port, { ...base, objectId: 'object-2', version: { order: 'sequence', value: '2' }, cursor: { sourceInstanceId: 'legacy', value: '1' },
    receipt: { commandId: 'command-2', state: 'accepted', ticketId: 'old-ticket', cursor: '1' } })
  assert.equal(accepted.state, 'legacy-accepted')
  const missingReceipt = await netSend(port, { ...base, objectId: 'object-3', version: { order: 'sequence', value: '3' }, cursor: { sourceInstanceId: 'legacy', value: '3' } })
  assert.equal(missingReceipt.state, 'quarantined')
  const missingCursor = await netSend(port, { ...base, objectId: 'object-4', version: { order: 'sequence', value: '4' }, receipt: { commandId: 'command-4', state: 'not-accepted', cursor: '4' } })
  assert.equal(missingCursor.state, 'quarantined')
  const malformed = await netSend(port, '{not json')
  assert.equal(malformed.ok, true)
  assert.equal(malformed.state, 'quarantined')

  const fakeAccepted = await netSend(port, { ...base, objectId: 'object-5', version: { order: 'sequence', value: '5' }, cursor: { sourceInstanceId: 'legacy', value: '5' },
    receipt: { commandId: 'command-5', state: 'accepted', cursor: '5' } })
  assert.equal(fakeAccepted.state, 'legacy-accepted')
  const duplicate = await netSend(port, { ...base, cursor: { sourceInstanceId: 'legacy', value: '2' }, receipt: { commandId: 'command-1', state: 'not-accepted', cursor: '2' } })
  assert.equal(duplicate.id, held.id)
  const reordered = await netSend(port, { receipt: { state: 'not-accepted', commandId: 'command-1', cursor: '2' },
    cursor: { value: '2', sourceInstanceId: 'legacy' }, text: base.text, version: { value: '1', order: 'sequence' },
    objectId: base.objectId, threadId: base.threadId, sourceInstanceId: base.sourceInstanceId })
  assert.equal(reordered.id, held.id)
  const conflict = await netSend(port, { ...base, text: 'different body', cursor: { sourceInstanceId: 'legacy', value: '2' }, receipt: { commandId: 'command-1', state: 'not-accepted', cursor: '2' } })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.code, 'GAP_INPUT_CONFLICT')

  snapshot = { ...clearSnapshot(), cursors: [{ sourceInstanceId: 'legacy', value: '1', complete: true }],
    receipts: [{ commandId: 'command-1', state: 'not-accepted', eventId: 'object-1', cursor: '2' },
      { commandId: 'command-2', state: 'accepted', eventId: 'object-2', cursor: '1' }] }
  const checked = await switchover.recheck('batch-1', { legacy, settleMs: 5 })
  assert.equal(checked.state, 'quiesced')
  assert.deepEqual(checked.gap, { held: 1, legacyAccepted: 1, quarantined: 4 })
  const heldPage = await switchover.listGapInputs('batch-1', { state: 'held' })
  assert.equal(heldPage.items.length, 1)
  assert.equal(heldPage.items[0].id, held.id)
  assert.equal(heldPage.items[0].dispatch, 'not-dispatched')
  assert.equal(heldPage.items[0].receipt.commandId, 'command-1')
  const quarantined = await switchover.listGapInputs('batch-1', { state: 'quarantined' })
  assert.deepEqual(new Set(quarantined.items.map(item => item.reason)), new Set(['MISSING_ACCEPT_RECEIPT', 'MISSING_CURSOR', 'GAP_INPUT_INVALID', 'RECEIPT_NOT_CONFIRMED']))
  const status = await switchover.status('batch-1')
  assert.deepEqual(status.buffer, { held: 1, legacyAccepted: 1, quarantined: 4 })
  assert.equal(status.isolation, 'held-by-this-process')
})

test('a restarted holder recovers quiesced and buffered facts, then a new increment downgrades it', async t => {
  const { source, target, storage, lease } = await setup(t)
  const port = await freePort()
  const old = createServer(socket => socket.end())
  await listen(old, port)
  let snapshot = clearSnapshot()
  let stops = 0
  const legacy = { stop: async () => { stops++; await closeServer(old) }, disableRestart: async () => ({ evidence: 'old launcher renamed' }),
    restartDisabled: async () => true, snapshot: async () => snapshot }
  const first = new Switchover(storage, 'private')
  const options = { batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: source, entry: { host: '127.0.0.1', port },
    legacy, settleMs: 5, entryWaitMs: 250 }
  assert.equal((await first.begin(options)).state, 'quiesced')
  const buffered = await netSend(port, { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'object-9', version: { order: 'sequence', value: '9' },
    text: 'kept through restart', cursor: { sourceInstanceId: 'legacy', value: '9' }, receipt: { commandId: 'command-9', state: 'not-accepted', cursor: '9' } })
  await first.close()
  assert.equal((await first.status('batch-1')).state, 'quiescing')

  const second = new Switchover(storage, 'private')
  t.after(() => second.close().catch(() => {}))
  snapshot = { ...clearSnapshot(), cursors: [{ sourceInstanceId: 'legacy', value: '9', complete: true }],
    receipts: [{ commandId: 'command-9', state: 'not-accepted', eventId: 'object-9', cursor: '9' }] }
  const recovered = await second.begin(options)
  assert.equal(stops, 1, 'the confirmed old-core stop survives the holder restart')
  assert.equal(recovered.state, 'quiesced')
  assert.equal((await second.getGapInput('batch-1', buffered.id)).state, 'held')

  snapshot = { ...clearSnapshot(), cursors: [{ sourceInstanceId: 'legacy', value: '9', complete: true }],
    receipts: [{ commandId: 'command-9', state: 'not-accepted', eventId: 'object-9', cursor: '9' }],
    increments: { inputs: 1, receipts: 0, events: 0, outbound: 0 } }
  const downgraded = await second.recheck('batch-1', { legacy, settleMs: 5 })
  assert.equal(downgraded.state, 'quiescing')
  assert.equal(downgraded.blockers.some(blocker => blocker.code === 'PENDING_INCREMENT'), true)

  snapshot = { ...clearSnapshot(8), cursors: [{ sourceInstanceId: 'legacy', value: '9', complete: true }],
    receipts: [{ commandId: 'command-9', state: 'not-accepted', eventId: 'object-9', cursor: '9' }] }
  const changed = await second.recheck('batch-1', { legacy, settleMs: 5 })
  assert.equal(changed.state, 'quiescing')
  assert.equal(changed.blockers.some(blocker => blocker.code === 'SOURCE_CHANGED'), true)
})

test('an unpublished archive is refused and the old home lock never substitutes for entry isolation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-switchover-refuse-'))
  const source = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(source, 'bot'), { recursive: true })
  writeFileSync(join(source, 'bot', 'state.json'), JSON.stringify({ version: 1, revision: 1, bots: {}, rooms: {}, works: {} }))
  writeFileSync(join(source, 'bot', 'state.lock'), '{}')
  await prepareLegacyArchive({ source, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  const storage = await SqliteStorage.open(join(root, 'core.sqlite'))
  const lease = await new HostLease(storage, 'private', { hostId: 'switchover-refuse', leaseMs: 600_000 }).acquire()
  t.after(async () => { await storage.close(); rmSync(root, { recursive: true, force: true }) })
  const port = await freePort()
  const old = createServer(socket => socket.end())
  await listen(old, port)
  t.after(() => closeServer(old).catch(() => {}))
  const legacy = { stop: async () => {}, disableRestart: async () => ({ evidence: 'old launcher renamed' }), restartDisabled: async () => true,
    snapshot: async () => clearSnapshot(1) }
  const switchover = new Switchover(storage, 'private')
  t.after(() => switchover.close().catch(() => {}))
  await assert.rejects(switchover.begin({ batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: source,
    entry: { host: '127.0.0.1', port }, legacy, settleMs: 5, entryWaitMs: 100 }), { code: 'SWITCHOVER_ARCHIVE_MISSING' })

  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')
  await assert.rejects(switchover.begin({ batchId: 'batch-1', newEpoch: lease.epoch + 1, archive: { target }, oldHome: source,
    entry: { host: '127.0.0.1', port }, legacy, settleMs: 5, entryWaitMs: 100 }), { code: 'SWITCHOVER_EPOCH_NOT_CURRENT' })
  const blocked = await switchover.begin({ batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: source,
    entry: { host: '127.0.0.1', port }, legacy, settleMs: 5, entryWaitMs: 100 })
  assert.equal(blocked.state, 'quiescing')
  assert.equal(blocked.blockers.some(blocker => blocker.code === 'ENTRY_STILL_HELD'), true)
  assert.equal(blocked.oldHome.lockExists, true)
  assert.equal(blocked.oldHome.usedAsFence, false)
})

