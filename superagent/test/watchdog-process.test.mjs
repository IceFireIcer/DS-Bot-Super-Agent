import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SqliteStorage } from '../dist/storage.js'
import { Watchdog } from '../dist/watchdog.js'
import { ProcessWatchdogHost } from '../dist/watchdog-process.js'

const hostEntry = fileURLToPath(new URL('../dev/t47-host.mjs', import.meta.url))
const signal = new AbortController().signal

async function gone(host) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!host.isRunning()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('the Host did not exit')
}

test('a real Windows Host is replaced after it dies, and the replacement reconciles the seeded work', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-watchdog-process-'))
  const databasePath = join(directory, 'state.sqlite')
  const statusPath = join(directory, 'status.json')
  const host = new ProcessWatchdogHost({
    command: process.execPath,
    args: [hostEntry, '--database', databasePath, '--instance', 'private', '--host-id', 't47-local', '--status', statusPath, '--seed'],
    statusPath, startTimeoutMs: 30000, staleMs: 5000,
  })
  let storage
  t.after(async () => {
    await host.dispose()
    await storage?.close().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  await host.start({ signal })
  const before = await host.probe({ signal })
  assert.equal(before.service, 'healthy')
  assert.equal(typeof before.epoch, 'number')
  const firstEpoch = before.epoch
  const firstStatus = JSON.parse(await readFile(statusPath, 'utf8'))
  assert.equal(firstStatus.takeover, null, 'the first Host did not replace anyone')
  assert.equal(typeof firstStatus.seededTicket, 'string')

  storage = await SqliteStorage.open(databasePath)
  const notifications = []
  const watchdog = new Watchdog({
    instanceId: 'private', storage, host, intervalMs: 50, graceMs: 5000, probeTimeoutMs: 2000, startTimeoutMs: 30000,
    maxRestarts: 2, restartWindowMs: 60000, version: 't47-process', notify: notification => { notifications.push(notification) },
    log: { warn: () => {}, error: () => {} },
  })
  assert.equal((await watchdog.inspectOnce()).kind, 'healthy')

  process.kill(host.pid(), 'SIGKILL')
  await gone(host)
  const recovered = await watchdog.inspectOnce()
  assert.equal(recovered.kind, 'recovered', JSON.stringify(recovered))
  assert.equal(recovered.action, 'restart')
  assert.equal(recovered.result, 'recovered')
  assert.equal(recovered.budget.used, 1)

  const after = JSON.parse(await readFile(statusPath, 'utf8'))
  assert.ok(after.epoch > firstEpoch, 'the replacement took a later Host epoch')
  assert.equal(after.takeover.state, 'completed')
  assert.ok(after.takeover.tickets >= 1, 'the seeded Assignment went through takeover reconciliation')
  assert.equal(after.seededTicket, firstStatus.seededTicket)
  assert.deepEqual(notifications, [], 'a successful recovery is silent')

  const state = await watchdog.getState()
  assert.equal(state.last.kind, 'recovered')
  assert.deepEqual(state.history.map(item => item.kind), ['recovered', 'healthy'])
})

test('a Host the adapter did not start is never reported stopped while its process is alive', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-watchdog-adopt-'))
  const statusPath = join(directory, 'status.json')
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  await writeFile(statusPath, JSON.stringify({ pid: process.pid, at: Date.now(), service: 'healthy', sources: [], setups: [], normalWaits: 0 }))
  const host = new ProcessWatchdogHost({ command: process.execPath, args: ['-e', ''], statusPath })
  assert.equal(await host.stop({ graceMs: 100, signal }), 'timeout', 'a live process without the IPC channel is not claimed stopped')
  await writeFile(statusPath, JSON.stringify({ pid: 999999, at: Date.now(), service: 'healthy', sources: [], setups: [], normalWaits: 0 }))
  assert.equal(await host.stop({ graceMs: 100, signal }), 'stopped', 'a dead PID can be replaced')
})

test('the process adapter asks a running Host to stop and observes the exit', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-watchdog-stop-'))
  const databasePath = join(directory, 'state.sqlite')
  const statusPath = join(directory, 'status.json')
  const host = new ProcessWatchdogHost({
    command: process.execPath,
    args: [hostEntry, '--database', databasePath, '--instance', 'private', '--host-id', 't47-stop', '--status', statusPath],
    statusPath, startTimeoutMs: 30000, staleMs: 5000,
  })
  t.after(async () => {
    await host.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await host.start({ signal })
  const before = Date.now()
  assert.equal(await host.stop({ graceMs: 5000, signal }), 'stopped')
  assert.ok(Date.now() - before < 3000, 'the Host stopped without waiting for the grace period')
})
