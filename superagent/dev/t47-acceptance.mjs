// T47 native rehearsal: a real Host process is killed, the independent Watchdog classifies the
// service failure, restarts it with the Host lease/takeover, and records the action. Run once on
// SQLite (local) and once on PostgreSQL (hosted/shared backend), on Windows.
// Usage: node dev/t47-acceptance.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { SqliteStorage } from '../dist/storage.js'
import { PostgresStorage } from '../dist/postgres-storage.js'
import { Watchdog } from '../dist/watchdog.js'
import { ProcessWatchdogHost } from '../dist/watchdog-process.js'
import { startPostgres } from '../test/fixtures/postgres-harness.mjs'

const hostEntry = fileURLToPath(new URL('./t47-host.mjs', import.meta.url))
const signal = new AbortController().signal

async function gone(host) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!host.isRunning()) return
    await sleep(50)
  }
  throw new Error('the Host did not exit')
}

async function rehearse(name, { status, database, storageArguments, openStorage }) {
  const host = new ProcessWatchdogHost({
    command: process.execPath,
    args: [hostEntry, ...storageArguments, '--instance', 'private', '--host-id', `t47-${name}`, '--status', status, '--seed'],
    statusPath: status, startTimeoutMs: 30000, staleMs: 5000,
  })
  await host.start({ signal })
  const before = await host.probe({ signal })
  if (before.service !== 'healthy') throw new Error(`${name}: the Host did not become healthy`)
  const storage = await openStorage()
  const notifications = []
  const watchdog = new Watchdog({
    instanceId: 'private', storage, host, intervalMs: 3_600_000, graceMs: 5000, probeTimeoutMs: 2000, startTimeoutMs: 30000,
    maxRestarts: 2, restartWindowMs: 21_600_000, version: `t47-${name}-1`,
    notify: notification => { notifications.push(notification) }, log: { warn: () => {}, error: () => {} },
  })
  const healthy = await watchdog.inspectOnce()
  process.kill(host.pid(), 'SIGKILL')
  await gone(host)
  const recovered = await watchdog.inspectOnce()
  const after = JSON.parse(await readFile(status, 'utf8'))
  const state = await watchdog.getState()
  const report = {
    recipe: name, database, version: recovered.version,
    before: { kind: healthy.kind, service: healthy.service, epoch: before.epoch },
    after: { kind: recovered.kind, service: recovered.service, action: recovered.action, result: recovered.result,
      epoch: recovered.epoch, budget: recovered.budget },
    takeover: after.takeover,
    notifications: notifications.map(notification => ({ kind: notification.kind, escalate: notification.escalate })),
    history: state.history.map(item => ({ kind: item.kind, action: item.action, result: item.result, version: item.version, budget: item.budget })),
  }
  await host.dispose()
  await storage.close()
  return report
}

const reports = []
const localDirectory = await mkdtemp(join(tmpdir(), 'ds-superagent-t47-local-'))
try {
  const database = join(localDirectory, 'state.sqlite')
  const status = join(localDirectory, 'status.json')
  reports.push(await rehearse('local-sqlite', {
    status, database,
    storageArguments: ['--database', database],
    openStorage: () => SqliteStorage.open(database),
  }))
} finally {
  await rm(localDirectory, { recursive: true, force: true })
}

const postgres = await startPostgres('ds-superagent-t47-hosted-')
const hostedDirectory = await mkdtemp(join(tmpdir(), 'ds-superagent-t47-hosted-'))
try {
  const database = await postgres.createDatabase()
  const configuration = { ...postgres.configuration, database }
  const status = join(hostedDirectory, 'status.json')
  reports.push(await rehearse('hosted-postgres', {
    status, database,
    storageArguments: ['--postgres', JSON.stringify(configuration)],
    openStorage: () => PostgresStorage.open(configuration),
  }))
} finally {
  await postgres.close()
  await rm(hostedDirectory, { recursive: true, force: true })
}

console.log(JSON.stringify({ platform: process.platform, node: process.version, reports }, null, 2))
