// A real Host process for the T47 Watchdog rehearsal. It is not the product entry point: it
// mounts the public Engine on an isolated database, waits for a dead Host's lease to expire,
// writes an atomic status file, seeds one running Assignment when asked, and stops only on the
// Watchdog's IPC shutdown message.
import { randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Engine, NativeSessions, StorageSessionPersistence } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { PostgresStorage } from '../dist/postgres-storage.js'
import { nativeContext, textResponse } from './native-mock.mjs'

const args = process.argv.slice(2)
const argument = (name) => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const flag = (name) => args.includes(`--${name}`)
const statusPath = argument('status')
const instanceId = argument('instance') ?? 'private'
const hostId = argument('host-id') ?? 't47-host'
const databasePath = argument('database')
const postgres = argument('postgres')
const leaseMs = Number(argument('lease-ms') ?? '2000')
const acquireTimeoutMs = Number(argument('acquire-timeout-ms') ?? '60000')
const sessionsDirectory = argument('sessions') ?? join(tmpdir(), `ds-superagent-t47-sessions-${hostId}-${String(process.pid)}`)
if (statusPath === undefined || (databasePath === undefined && postgres === undefined)) {
  console.error('usage: node dev/t47-host.mjs (--database <path> | --postgres <json>) --status <path> --instance <id> --host-id <id> [--seed] [--lease-ms 2000]')
  process.exit(2)
}

const writeStatus = (status) => {
  writeFileSync(`${statusPath}.tmp`, `${JSON.stringify(status)}\n`)
  renameSync(`${statusPath}.tmp`, statusPath)
}
const failed = (detail) => writeStatus({ pid: process.pid, at: Date.now(), service: 'failed', sources: [], setups: [], normalWaits: 0, detail })

const storage = postgres === undefined ? await SqliteStorage.open(databasePath) : await PostgresStorage.open(JSON.parse(postgres))
const native = await nativeContext(sessionsDirectory, () => textResponse('Idle.'))
const sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
const engine = new Engine(storage, instanceId,
  { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
  {}, sessions, [], {}, {}, {}, {}, { hostId, leaseMs })

let acquired = false
const deadline = Date.now() + acquireTimeoutMs
while (!acquired) {
  try {
    await engine.acquireHost()
    acquired = true
  } catch (error) {
    // A killed Host's lease is fenced until it expires; a replacement waits for that, never
    // takes the lease from a live process.
    if (error?.code === 'HOST_LEASED' && Date.now() < deadline) { await sleep(250); continue }
    failed(error instanceof Error ? error.message : String(error))
    await engine.shutdown().catch(() => {})
    await sessions.close().catch(() => {})
    await native.fiber.dispose().catch(() => {})
    await storage.close().catch(() => {})
    process.exit(1)
  }
}
let seededTicket
if (flag('seed')) {
  const receipt = await engine.submit({ commandId: `t47-seed-${hostId}`, eventId: `t47-seed-event-${hostId}`, text: 'Seed a running Assignment for the Watchdog takeover drill.' })
  seededTicket = receipt.ticketId
  const assignmentId = randomUUID()
  const generation = randomUUID()
  const sessionId = SessionId(`t47-session-${assignmentId}`)
  await storage.transaction(instanceId, async transaction => {
    // A restarted Host replays the same seed command; the Assignment is already there.
    if (await transaction.get('assignment', receipt.ticketId) !== undefined) return
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.insert('assignment', receipt.ticketId, {
      id: assignmentId, generation, ticketId: receipt.ticketId, sessionId,
      state: 'running', createdAt: Date.now(), runtimeToken: 'prior-host-runtime',
    })
    if (intent !== undefined) await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-running' })
  })
  const persistence = new StorageSessionPersistence(new Context(), storage)
  const handle = await persistence.create({ version: 4, id: sessionId, createdAt: Date.now(), isSeeded: false })
  await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: { fromHost: hostId } }])
}

let stopping
let timer
const stop = () => stopping ??= (async () => {
  clearInterval(timer)
  try {
    await engine.effects.stop().catch(() => {})
    await engine.shutdown().catch(() => {})
    await sessions.close().catch(() => {})
    await native.fiber.dispose().catch(() => {})
  } finally {
    await storage.close().catch(() => {})
    process.exit(0)
  }
})()

const write = async () => {
  try {
    const supervision = await engine.getSupervision()
    const lease = await engine.getHostLease()
    const takeover = await engine.getHostTakeover()
    writeStatus({
      pid: process.pid, at: Date.now(), hostId: lease?.hostId, epoch: lease?.epoch,
      service: 'healthy', sources: [], setups: [], components: [],
      normalWaits: supervision.items.filter(item => item.bucket === 'needsHuman' || item.reason === 'environment-waiting').length,
      takeoverPending: takeover?.state === 'pending',
      paused: supervision.processingPaused,
      unknownEffects: supervision.items.reduce((count, item) => count + (item.health?.effectsUnknown ?? 0), 0),
      takeover: takeover === undefined ? null : { state: takeover.state, epoch: takeover.epoch, tickets: takeover.tickets.length, outcomes: takeover.tickets.map(ticket => ticket.outcome) },
      seededTicket: seededTicket ?? null,
    })
  } catch (error) {
    failed(error instanceof Error ? error.message : String(error))
  }
}

process.on('message', (message) => { if (message?.type === 'shutdown') void stop() })
process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
await write()
timer = setInterval(() => { void write() }, 200)
