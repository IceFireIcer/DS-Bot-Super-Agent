import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as core from '../../dist/index.js'
import { PostgresStorage } from '../../dist/postgres-storage.js'
import { StorageSessionPersistence } from '../../dist/session-persistence.js'
import { nativeContext, textResponse } from '../../dev/native-mock.mjs'

const [configuration, hostId, mode, leaseMs = '1500', ticketId] = process.argv.slice(2)
const config = JSON.parse(configuration)
const storage = await PostgresStorage.open(config)
const native = await nativeContext(config.sessionDirectory, () => textResponse('Idle.'))
const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
  {}, sessions, [], {}, {}, {}, {}, { hostId, leaseMs: Number(leaseMs) })
const report = value => process.stdout.write(`${JSON.stringify(value)}\n`)

async function close(exitCode = 0) {
  await engine.effects.stop().catch(() => {})
  await engine.shutdown().catch(() => {})
  await sessions.close().catch(() => {})
  await native.fiber.dispose().catch(() => {})
  await storage.close().catch(() => {})
  process.exitCode = exitCode
}

try {
  if (mode === 'hold') {
    const lease = await engine.acquireHost()
    const receipt = await engine.submit({ commandId: `hold-${hostId}`, eventId: `hold-${hostId}`, text: 'Hold this Instance for the replacement drill.' })
    const assignmentId = randomUUID()
    const generation = randomUUID()
    await storage.transaction('private', async transaction => {
      const intent = await transaction.get('intent', receipt.ticketId)
      await transaction.insert('assignment', receipt.ticketId, { id: assignmentId, generation, ticketId: receipt.ticketId,
        sessionId: `worker-${assignmentId}`, state: 'running', createdAt: Date.now(), runtimeToken: 'prior-host-runtime' })
      await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-running' })
    })
    const persistence = new StorageSessionPersistence(new Context(), storage)
    const sessionId = SessionId(`host-session-${randomUUID()}`)
    const handle = await persistence.create({ version: 4, id: sessionId, createdAt: Date.now(), isSeeded: false })
    await handle.append([{ type: 'session/end-seed', seq: 0, time: Date.now(), data: { fromHost: hostId } }])
    report({ ok: true, hostId, epoch: lease.epoch, ticketId: receipt.ticketId, assignmentId, sessionId })
    setInterval(() => { void engine.acquireHost().catch(() => {}) }, 100)
  } else if (mode === 'try') {
    try {
      const lease = await engine.acquireHost()
      report({ ok: true, hostId, epoch: lease.epoch })
    } catch (error) {
      report({ ok: false, hostId, code: error?.code ?? String(error) })
    }
    await close()
  } else if (mode === 'takeover') {
    const lease = await engine.acquireHost()
    const takeover = await engine.getHostTakeover()
    const assignments = []
    for (const item of takeover?.tickets ?? []) {
      const conversation = await engine.conversation(item.ticketId)
      assignments.push({ ticketId: item.ticketId, outcome: item.outcome, blockers: item.blockers,
        assignmentId: conversation.assignments[0]?.id, state: conversation.assignments[0]?.state,
        recovery: conversation.assignments[0]?.recovery, history: conversation.assignmentHistory.length })
    }
    report({ ok: true, hostId, epoch: lease.epoch, takeover: { state: takeover?.state, epoch: takeover?.epoch, tickets: takeover?.tickets }, assignments })
    setInterval(() => { void engine.acquireHost().catch(() => {}) }, 100)
  } else if (mode === 'resurrect') {
    try {
      await engine.getTicket(ticketId)
      report({ ok: true, hostId, wrote: true })
    } catch (error) {
      report({ ok: false, hostId, code: error?.code ?? String(error) })
    }
    await close()
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }
} catch (error) {
  report({ ok: false, hostId, mode, code: error?.code ?? String(error), message: String(error?.message ?? error) })
  await close(1)
}
