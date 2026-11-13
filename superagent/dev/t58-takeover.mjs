// T58 Host replacement rehearsal: a real Watchdog starts the hosted Host, kills it, and
// restarts it on the same PostgreSQL lease. No same-process runtime is reused.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { PostgresStorage } from '../dist/postgres-storage.js'
import { Watchdog } from '../dist/watchdog.js'
import { ProcessWatchdogHost } from '../dist/watchdog-process.js'

const hostEntry = fileURLToPath(new URL('./t58-host.mjs', import.meta.url))
if (process.platform === 'win32') throw new Error('The T58 hosted Host rehearsal runs on Linux.')
const gatewayPort = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('No free port was allocated.'))
    const port = address.port
    server.close(error => error ? reject(error) : resolve(port))
  })
})
const modelKeyFile = process.env.SUPERAGENT_MODEL_KEY_FILE
const pg = {
  host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'ds58', password: process.env.PGPASSWORD ?? '',
  database: process.env.PGDATABASE ?? 'ds58', ssl: false,
}
if (!pg.password) throw new Error('PGPASSWORD is required.')
const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-t58-takeover-'))
const status = join(directory, 'status.json')
const token = join(directory, 'client.token')
const clientId = join(directory, 'client.id')
const workspace = join(directory, 'workspace')
await mkdir(workspace, { recursive: true })
const host = new ProcessWatchdogHost({
  command: process.execPath,
  args: [hostEntry, '--status', status, '--token-out', token, '--client-id-out', clientId,
    '--workspace', workspace, '--instance', 't58-takeover', '--host-id', 't58-takeover-host',
    '--gateway-port', String(gatewayPort), '--lease-ms', '2000', ...(modelKeyFile ? ['--model-key-file', modelKeyFile] : [])],
  statusPath: status, startTimeoutMs: 60000, staleMs: 5000,
})
let storage
try {
  const signal = new AbortController().signal
  await host.start({ signal })
  const beforeProbe = await host.probe({ signal })
  if (beforeProbe.service !== 'healthy') throw new Error('The first Host did not become healthy.')
  storage = await PostgresStorage.open(pg)
  const notifications = []
  const watchdog = new Watchdog({
    instanceId: 't58-takeover', storage, host, intervalMs: 3_600_000, graceMs: 5000, probeTimeoutMs: 5000,
    startTimeoutMs: 60000, maxRestarts: 2, restartWindowMs: 21_600_000, version: 't58-takeover-1',
    notify: notification => { notifications.push({ kind: notification.kind, escalate: notification.escalate }) },
    log: { warn: () => {}, error: () => {} },
  })
  const healthy = await watchdog.inspectOnce()
  const before = JSON.parse(await readFile(status, 'utf8'))
  process.kill(host.pid(), 'SIGKILL')
  for (let attempt = 0; attempt < 100 && host.isRunning(); attempt++) await sleep(50)
  const recovered = await watchdog.inspectOnce()
  const after = JSON.parse(await readFile(status, 'utf8'))
  const state = await watchdog.getState()
  console.log(JSON.stringify({
    platform: process.platform, node: process.version, database: 'PostgreSQL',
    before: { service: healthy.service, epoch: before.epoch, pid: before.pid },
    recovery: { kind: recovered.kind, service: recovered.service, action: recovered.action,
      result: recovered.result, epoch: recovered.epoch, budget: recovered.budget },
    after: { service: after.service, epoch: after.epoch, pid: after.pid },
    notifications,
    history: state.history.map(item => ({ kind: item.kind, action: item.action, result: item.result,
      version: item.version, budget: item.budget })),
  }, null, 2))
  if (after.epoch <= before.epoch || after.pid === before.pid || after.service !== 'healthy') {
    throw new Error('The replacement Host did not advance the epoch and become healthy.')
  }
} finally {
  await host.dispose().catch(() => {})
  await storage?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true }).catch(() => {})
}
