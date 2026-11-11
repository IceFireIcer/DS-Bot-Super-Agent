import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Activation } from '../dist/index.js'
import { prepareLegacyArchive, publishLegacyArchive, verifyLegacyArchive } from '../dist/legacy-archive.js'
import { SqliteStorage } from '../dist/storage.js'

const receiverFixture = fileURLToPath(new URL('./fixtures/legacy-receiver.mjs', import.meta.url))
const entryFixture = fileURLToPath(new URL('./fixtures/legacy-entry.mjs', import.meta.url))
const activationFixture = fileURLToPath(new URL('./fixtures/activation-crash.mjs', import.meta.url))

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

test('a real activation process exits after commit and external acceptance, leaving one current manifest and no replay', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-activation-process-'))
  const source = join(root, 'legacy')
  const target = join(root, 'archive')
  mkdirSync(join(source, 'bot'), { recursive: true })
  writeFileSync(join(source, 'bot', 'state.json'), JSON.stringify({ version: 1, revision: 7, mainBotIds: [], bots: {}, rooms: {}, works: { old: { state: 'running' } }, requests: {}, questions: {}, agents: {} }))
  writeFileSync(join(source, 'bot', 'state.lock'), '{}')
  await prepareLegacyArchive({ source, target, batchId: 'batch-1', mapping: { roles: [], sharedMemory: [] } })
  await verifyLegacyArchive(target, 'batch-1')
  await publishLegacyArchive(target, 'batch-1')

  const intakePort = await freePort()
  const adminPort = await freePort()
  const legacyEntry = join(root, 'legacy-entry.mjs')
  const statusFile = join(root, 'old-status.json')
  const receiptsFile = join(root, 'old-receipts.json')
  const marker = join(root, 'released.jsonl')
  const databasePath = join(root, 'core.sqlite')
  writeFileSync(legacyEntry, readFileSync(entryFixture, 'utf8'))
  const oldConfig = { home: source, intake: { host: '127.0.0.1', port: intakePort }, admin: { host: '127.0.0.1', port: adminPort },
    statusFile, receiptsFile, activeTurns: ['turn-1'], activeJobs: [], pendingOutbound: ['out-1'], receiver: receiverFixture }
  const old = spawn(process.execPath, [legacyEntry, JSON.stringify(oldConfig)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let child
  const oldExited = new Promise(resolve => old.once('exit', (code, signal) => resolve({ code, signal })))
  const oldLines = createInterface({ input: old.stdout })
  const oldErrors = []
  old.stderr.setEncoding('utf8')
  old.stderr.on('data', chunk => oldErrors.push(chunk))
  const oldReady = new Promise((resolve, reject) => {
    oldLines.once('line', line => resolve(JSON.parse(line)))
    old.once('exit', code => reject(new Error(`old receiver exited before ready (${code}): ${oldErrors.join('')}`)))
  })
  assert.equal((await oldReady).ready, true)

  child = spawn(process.execPath, [activationFixture, JSON.stringify({ databasePath, batchId: 'batch-1', commandId: 'activate-crash',
    archiveTarget: target, oldHome: source, entry: { host: '127.0.0.1', port: intakePort }, admin: { host: '127.0.0.1', port: adminPort },
    statusFile, legacyEntry, marker })], { stdio: ['ignore', 'pipe', 'pipe'] })
  const childExitPromise = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const childErrors = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => childErrors.push(chunk))
  const childExit = await childExitPromise
  assert.equal(childExit.code, 0, childErrors.join(''))
  const oldExit = await oldExited
  assert.equal(oldExit.code, 0)
  const firstMarker = readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean)
  assert.equal(firstMarker.length, 1)

  const storage = await SqliteStorage.open(databasePath)
  t.after(async () => {
    if (old.exitCode === null && old.signalCode === null) old.kill('SIGKILL')
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await storage.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const activation = new Activation(storage, 'private', {})
  const observed = await activation.status()
  assert.equal(observed.state, 'active')
  assert.equal(observed.releases[0].state, 'releasing')
  await assert.rejects(activation.releasePending('batch-1', { release: async () => ({}) }), { code: 'CORE_NOT_ACTIVE' })
  const finalMarker = readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean)
  assert.equal(finalMarker.length, 1)
  assert.equal(JSON.parse(finalMarker[0]).ticketId, 'crash-child-ticket')
})
