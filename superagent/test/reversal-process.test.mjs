import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Activation, HostLease, Reversal, Switchover } from '../dist/index.js'
import { prepareLegacyArchive, publishLegacyArchive, verifyLegacyArchive } from '../dist/legacy-archive.js'
import { SqliteStorage } from '../dist/storage.js'

const receiverFixture = fileURLToPath(new URL('./fixtures/legacy-receiver.mjs', import.meta.url))
const entryFixture = fileURLToPath(new URL('./fixtures/legacy-entry.mjs', import.meta.url))
const reversalFixture = fileURLToPath(new URL('./fixtures/reversal-crash.mjs', import.meta.url))

const clearEvidence = () => ({ activeTurns: [], activeJobs: [], pendingOutbound: [], unknownEffects: [], unknownJobs: [],
  pendingReceipts: [], manualStops: [], compatibility: { canReopen: true, blockers: [] } })
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

const stopOld = port => new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port })
  socket.setEncoding('utf8')
  socket.on('error', reject)
  socket.on('data', chunk => { if (chunk.includes('"stopped"')) { socket.destroy(); resolve(undefined) } })
  socket.on('connect', () => socket.write(`${JSON.stringify({ command: 'stop' })}\n`))
})

test('a real reverse child exits after stopping the new entry; a newer Host resumes the same reverse and reopens the old launcher without replay', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-reversal-process-'))
  const legacyHome = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(legacyHome, 'bot'), { recursive: true })
  const state = JSON.stringify({ version: 1, revision: 7, mainBotIds: [], bots: {}, rooms: {}, works: { old: { state: 'running' } }, requests: {}, questions: {}, agents: {} })
  writeFileSync(join(legacyHome, 'bot', 'state.json'), state)
  writeFileSync(join(legacyHome, 'bot', 'state.lock'), '{}')
  await prepareLegacyArchive({ source: legacyHome, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')

  const intakePort = await freePort()
  const adminPort = await freePort()
  const statusFile = join(root, 'old-status.json')
  const receiptsFile = join(root, 'old-receipts.json')
  const legacyEntry = join(root, 'legacy-entry.mjs')
  const marker = join(root, 'reverse-marker.jsonl')
  const newcoreMarker = join(root, 'newcore-release.jsonl')
  const databasePath = join(root, 'core.sqlite')
  writeFileSync(legacyEntry, readFileSync(entryFixture, 'utf8'))
  const oldConfig = { home: legacyHome, intake: { host: '127.0.0.1', port: intakePort }, admin: { host: '127.0.0.1', port: adminPort },
    statusFile, receiptsFile, activeTurns: ['turn-1'], activeJobs: [], pendingOutbound: ['out-1'], receiver: receiverFixture }
  let old = spawn(process.execPath, [legacyEntry, JSON.stringify(oldConfig)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let oldExited = new Promise(resolve => old.once('exit', (code, signal) => resolve({ code, signal })))
  const storage = await SqliteStorage.open(databasePath)
  t.after(async () => {
    if (old.exitCode === null && old.signalCode === null) old.kill('SIGKILL')
    await storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const oldLines = createInterface({ input: old.stdout })
  const ready = await new Promise((resolve, reject) => {
    oldLines.once('line', line => resolve(JSON.parse(line)))
    old.once('exit', code => reject(new Error(`old receiver exited early: ${code}`)))
  })
  assert.equal(ready.ready, true)

  const host = new HostLease(storage, 'private', { hostId: 'reverse-parent', leaseMs: 600_000 })
  const lease = await host.acquire()
  const recovery = {
    stop: () => stopOld(adminPort),
    disableRestart: async () => { await import('node:fs/promises').then(({ rename }) => rename(legacyEntry, `${legacyEntry}.disabled`)); return { evidence: 'launcher renamed' } },
    restartDisabled: async () => !existsSync(legacyEntry) && existsSync(`${legacyEntry}.disabled`),
    snapshot: async () => JSON.parse(readFileSync(statusFile, 'utf8')),
    enableRestart: async () => { await import('node:fs/promises').then(({ rename }) => rename(`${legacyEntry}.disabled`, legacyEntry)); return { evidence: 'launcher restored', entry: legacyEntry } },
    restartEnabled: async () => existsSync(legacyEntry) && !existsSync(`${legacyEntry}.disabled`),
  }
  const switchover = new Switchover(storage, 'private')
  const quiesced = await switchover.begin({ batchId: 'batch-1', newEpoch: lease.epoch, archive: { target }, oldHome: legacyHome,
    entry: { host: '127.0.0.1', port: intakePort }, legacy: recovery, settleMs: 50, entryWaitMs: 3_000, heartbeatMs: 200 })
  assert.equal(quiesced.state, 'quiesced')
  const heldInput = { sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'held-process', version: { order: 'sequence', value: '1' },
    text: 'Held input across the reverse.', cursor: { sourceInstanceId: 'legacy', value: '1' },
    receipt: { commandId: 'held-process-command', state: 'not-accepted', cursor: '1' } }
  await switchover.ingestGapInput('batch-1', heldInput)
  const oldFacts = JSON.parse(readFileSync(statusFile, 'utf8'))
  oldFacts.receipts = [...(oldFacts.receipts ?? []), { commandId: 'held-process-command', eventId: 'held-process', state: 'not-accepted', cursor: '1' }]
  writeFileSync(statusFile, JSON.stringify(oldFacts))
  await switchover.recheck('batch-1', { legacy: recovery, settleMs: 50 })
  await oldExited
  const activation = new Activation(storage, 'private', switchover)
  const active = await activation.activate({ batchId: 'batch-1', commandId: 'activate-process', newEpoch: lease.epoch, legacy: recovery, settleMs: 50,
    release: { release: async (input, context) => {
      appendFileSync(newcoreMarker, `${JSON.stringify({ commandId: context.commandId, inputId: input.id })}\n`)
      return { ticketId: 'newcore-ticket', receiptId: 'newcore-receipt' }
    } } })
  assert.equal(active.release.released, 1)
  await host.release()

  const child = spawn(process.execPath, [reversalFixture, JSON.stringify({ databasePath, batchId: 'batch-1', commandId: 'reverse-process',
    marker, legacyEntry, leaseMs: 500 })], { stdio: ['ignore', 'pipe', 'pipe'] })
  const childExit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  assert.equal(childExit.code, 0)
  await new Promise(resolve => setTimeout(resolve, 700))
  const next = await new HostLease(storage, 'private', { hostId: 'reverse-parent-next', leaseMs: 600_000 }).acquire()
  const reversal = new Reversal(storage, 'private', switchover)
  const readyReverse = await reversal.reverse({ batchId: 'batch-1', commandId: 'reverse-process', reason: 'Interrupted reverse drill.',
    control: { stopAndSnapshot: async () => {
      const lines = readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean)
      if (!lines.some(line => JSON.parse(line).commandId === 'reverse-process')) writeFileSync(marker, `${lines.join('\n')}\n`)
      return clearEvidence()
    } } })
  assert.equal(readyReverse.state, 'ready')
  assert.equal(readyReverse.reverseEpoch, next.epoch)
  const completed = await reversal.completeReverse({ batchId: 'batch-1', commandId: 'reverse-process', legacy: recovery,
    compatibility: async () => ({ canReopen: true, blockers: [] }) })
  assert.equal(completed.state, 'completed')
  assert.equal(existsSync(legacyEntry), true)
  assert.equal(readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).length, 1)
  assert.equal(readFileSync(newcoreMarker, 'utf8').trim().split('\n').filter(Boolean).length, 1)
  assert.equal(readFileSync(join(legacyHome, 'bot', 'state.json'), 'utf8'), state)
  assert.equal(readFileSync(receiptsFile, 'utf8').trim(), '[]')

  old = spawn(process.execPath, [legacyEntry, JSON.stringify(oldConfig)], { stdio: ['ignore', 'pipe', 'pipe'] })
  oldExited = new Promise(resolve => old.once('exit', (code, signal) => resolve({ code, signal })))
  const reopenedLines = createInterface({ input: old.stdout })
  const reopened = await new Promise((resolve, reject) => {
    reopenedLines.once('line', line => resolve(JSON.parse(line)))
    old.once('exit', code => reject(new Error(`old receiver failed to reopen: ${code}`)))
  })
  assert.equal(reopened.ready, true)
  await stopOld(adminPort)
  await oldExited
})
