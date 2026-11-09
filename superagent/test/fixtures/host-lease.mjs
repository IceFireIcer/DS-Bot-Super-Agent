import * as core from '../../dist/index.js'
import { SqliteStorage } from '../../dist/storage.js'

const [databasePath, hostId, mode, leaseMs = '300'] = process.argv.slice(2)
const storage = await SqliteStorage.open(databasePath)
const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
  {}, undefined, [], {}, {}, {}, {}, { hostId, leaseMs: Number(leaseMs) })

try {
  const lease = await engine.acquireHost()
  process.stdout.write(`${JSON.stringify({ ok: true, hostId: lease.hostId, epoch: lease.epoch })}\n`)
  if (mode === 'hold') setInterval(() => { void engine.acquireHost().catch(() => {}) }, 100)
  else { await engine.shutdown(); await storage.close() }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error?.code ?? String(error) })}\n`)
  await storage.close()
  process.exitCode = mode === 'hold' ? 1 : 0
}
