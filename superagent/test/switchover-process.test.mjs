import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { prepareLegacyArchive, publishLegacyArchive, verifyLegacyArchive } from '../dist/legacy-archive.js'
import { HostLease } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const receiverFixture = fileURLToPath(new URL('./fixtures/legacy-receiver.mjs', import.meta.url))
const switchoverFixture = fileURLToPath(new URL('./fixtures/switchover-runner.mjs', import.meta.url))
const entryFixture = fileURLToPath(new URL('./fixtures/legacy-entry.mjs', import.meta.url))

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
const netSend = (port, value) => new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port })
  let buffer = ''
  socket.setEncoding('utf8')
  socket.setTimeout(5_000, () => { socket.destroy(); reject(new Error('intake timeout')) })
  socket.on('error', reject)
  socket.on('data', chunk => {
    buffer += chunk
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    socket.destroy()
    try { resolve(JSON.parse(buffer.slice(0, newline))) } catch (error) { reject(error) }
  })
  socket.on('connect', () => socket.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`))
})

function startChild(fixture, configuration) {
  const child = spawn(process.execPath, [fixture, JSON.stringify(configuration)], { stdio: ['ignore', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout })
  const errors = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => errors.push(chunk))
  const first = new Promise((resolve, reject) => {
    lines.once('line', line => resolve(JSON.parse(line)))
    child.once('exit', (code, signal) => reject(new Error(`process exited before reporting (${code ?? signal}): ${errors.join('')}`)))
  })
  const exited = child.exitCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  return { child, first, exited, errors }
}

test('a fictional old receiver and a new switchover process prove stopped old work, isolated entry and durable gap ownership', { timeout: 120_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-switchover-process-'))
  const source = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(source, 'bot'), { recursive: true })
  writeFileSync(join(source, 'bot', 'state.json'), JSON.stringify({
    version: 1, revision: 7, mainBotIds: [], bots: {}, rooms: {}, works: { old: { state: 'running' } },
    requests: {}, questions: {}, agents: {},
  }))
  writeFileSync(join(source, 'bot', 'state.lock'), '{}')
  await prepareLegacyArchive({ source, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')

  const intakePort = await freePort()
  const adminPort = await freePort()
  const controlPort = await freePort()
  const statusFile = join(root, 'old-status.json')
  const receiptsFile = join(root, 'old-receipts.json')
  const databasePath = join(root, 'core.sqlite')
  const legacyEntry = join(root, 'legacy-entry.mjs')
  writeFileSync(legacyEntry, readFileSync(entryFixture, 'utf8'))
  const bootstrap = await SqliteStorage.open(databasePath)
  const lease = await new HostLease(bootstrap, 'private', { hostId: 'switchover-drill', leaseMs: 600_000 }).acquire()
  await bootstrap.close()
  const children = []
  t.after(async () => {
    for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  })

  const oldConfiguration = {
    home: source, intake: { host: '127.0.0.1', port: intakePort }, admin: { host: '127.0.0.1', port: adminPort },
    statusFile, receiptsFile, activeTurns: ['turn-1'], activeJobs: [], pendingOutbound: ['out-1'],
  }
  const old = startChild(legacyEntry, { ...oldConfiguration, receiver: receiverFixture })
  children.push(old)
  assert.equal((await old.first).ready, true)

  const acceptedByOld = await netSend(intakePort, { objectId: 'old-object-1', eventId: 'old-event-1', text: 'old accepted input' })
  assert.equal(acceptedByOld.accepted, true)
  assert.equal(acceptedByOld.receipt.state, 'accepted')
  assert.equal(JSON.parse(readFileSync(receiptsFile, 'utf8')).length, 1)

  const runnerConfiguration = {
    mode: 'begin', databasePath, batchId: 'batch-1', newEpoch: lease.epoch, archiveTarget: target, oldHome: source, legacyEntry,
    entry: { host: '127.0.0.1', port: intakePort }, admin: { host: '127.0.0.1', port: adminPort }, statusFile,
    control: { host: '127.0.0.1', port: controlPort }, settleMs: 50, entryWaitMs: 3_000, heartbeatMs: 200,
  }
  const first = startChild(switchoverFixture, runnerConfiguration)
  children.push(first)
  const prepared = await first.first
  assert.equal(prepared.ok, true, JSON.stringify(prepared))
  assert.equal(prepared.record.state, 'quiesced')
  assert.equal(prepared.record.stop.confirmedAt > 0, true)
  assert.equal(prepared.record.restart.disabledAt > 0, true)
  assert.equal(prepared.record.restart.entry, `${legacyEntry}.disabled`)
  assert.equal(prepared.record.entry.isolated, true)
  assert.equal(prepared.record.oldHome.lockExists, true)
  assert.equal(prepared.record.oldHome.usedAsFence, false)
  assert.equal((await old.exited).code, 0)
  const restartCode = await new Promise(resolve => {
    const restart = spawn(process.execPath, [legacyEntry, JSON.stringify({ ...oldConfiguration, receiver: receiverFixture })], { stdio: 'ignore' })
    restart.once('error', () => resolve(-1))
    restart.once('exit', code => resolve(code ?? -1))
  })
  assert.notEqual(restartCode, 0, 'the disabled launcher cannot start the old receiver')

  const held = await netSend(intakePort, { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'gap-object-1',
    version: { order: 'sequence', value: '1' }, text: 'held gap input', cursor: { sourceInstanceId: 'legacy', value: '2' },
    receipt: { commandId: 'gap-command-1', state: 'not-accepted', cursor: '2' } })
  assert.equal(held.ok, true)
  assert.equal(held.state, 'held')
  const acceptedReplay = await netSend(intakePort, { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'gap-object-2',
    version: { order: 'sequence', value: '2' }, text: 'already accepted by old', cursor: { sourceInstanceId: 'legacy', value: '1' },
    receipt: { commandId: 'old-old-object-1', state: 'accepted', ticketId: 'old-ticket', cursor: '1' } })
  assert.equal(acceptedReplay.state, 'legacy-accepted')
  const quarantined = await netSend(intakePort, { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'gap-object-3',
    version: { order: 'sequence', value: '3' }, text: 'no reliable receipt', cursor: { sourceInstanceId: 'legacy', value: '3' } })
  assert.equal(quarantined.state, 'quarantined')
  const fakeAccepted = await netSend(intakePort, { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'gap-object-5',
    version: { order: 'sequence', value: '5' }, text: 'accepted receipt with no old fact', cursor: { sourceInstanceId: 'legacy', value: '5' },
    receipt: { commandId: 'missing-old-command', state: 'accepted', cursor: '5' } })
  assert.equal(fakeAccepted.state, 'legacy-accepted')

  const oldStatus = JSON.parse(readFileSync(statusFile, 'utf8'))
  oldStatus.receipts.push({ commandId: 'gap-command-1', eventId: 'gap-object-1', state: 'not-accepted', cursor: '2' })
  writeFileSync(statusFile, JSON.stringify(oldStatus))
  const recheckChild = startChild(switchoverFixture, { ...runnerConfiguration, mode: 'recheck' })
  children.push(recheckChild)
  const rechecked = await recheckChild.first
  assert.equal(rechecked.ok, true, JSON.stringify(rechecked))
  assert.deepEqual(rechecked.record.gap, { held: 1, legacyAccepted: 1, quarantined: 2 })
  await recheckChild.exited

  const statusChild = startChild(switchoverFixture, { ...runnerConfiguration, mode: 'status' })
  children.push(statusChild)
  const observed = await statusChild.first
  assert.equal(observed.ok, true, JSON.stringify(observed))
  assert.deepEqual(observed.status.buffer, { held: 1, legacyAccepted: 1, quarantined: 2 })
  assert.equal(observed.status.isolation, 'held-elsewhere')
  await statusChild.exited

  first.child.kill('SIGKILL')
  await first.exited
  assert.equal(JSON.parse(readFileSync(receiptsFile, 'utf8')).length, 1, 'the old receiver consumed no gap input')

  const storage = await SqliteStorage.open(databasePath)
  try {
    assert.equal((await storage.transaction('private', tx => tx.scan('ticket', { limit: 10 }))).items.length, 0)
    assert.equal((await storage.transaction('private', tx => tx.scan('effect', { limit: 10 }))).items.length, 0)
  } finally {
    await storage.close()
  }

  const second = startChild(switchoverFixture, runnerConfiguration)
  children.push(second)
  const recovered = await second.first
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
  assert.equal(recovered.record.state, 'quiesced')
  const another = await netSend(intakePort, { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'gap-object-4',
    version: { order: 'sequence', value: '4' }, text: 'after restart', cursor: { sourceInstanceId: 'legacy', value: '4' },
    receipt: { commandId: 'gap-command-4', state: 'not-accepted', cursor: '4' } })
  assert.equal(another.state, 'held')

  const closed = await netSend(controlPort, { command: 'close' })
  assert.equal(closed.ok, true)
  await second.exited
  const final = startChild(switchoverFixture, { ...runnerConfiguration, mode: 'status' })
  children.push(final)
  const finalStatus = await final.first
  assert.equal(finalStatus.status.state, 'quiescing')
  assert.deepEqual(finalStatus.status.buffer, { held: 2, legacyAccepted: 1, quarantined: 2 })
  await final.exited
  assert.equal(JSON.parse(readFileSync(receiptsFile, 'utf8')).length, 1)
})
