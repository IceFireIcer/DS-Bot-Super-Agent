import { dirname } from 'node:path'
import { appendFileSync } from 'node:fs'
import * as core from '../../dist/index.js'
import { Engine } from '../../dist/index.js'
import { SqliteStorage } from '../../dist/storage.js'
import * as SqlitePersistence from '../../dist/session-persistence.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../../dev/native-mock.mjs'
import { completedToolCount, lastUserText, sourceConfig } from '../input-support.mjs'

const [databasePath, sessionDatabasePath, phase, markerPath] = process.argv.slice(2)
const directory = dirname(databasePath)
let engine
let native
let ticketId
let flushFailed = false
let failingFlush = false
let exitOnWrite = false
const log = message => {
  try { appendFileSync(markerPath, `${message}\n`) } catch { /* diagnostics are best effort */ }
}
process.on('exit', code => log(`exit ${code}`))
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { log(`signal ${signal}`); process.exit(92) })
process.on('beforeExit', () => {
  console.error(`T16 unexpected beforeExit in ${phase}`)
  process.exit(90)
})
const watchdog = setTimeout(() => {
  console.error(`T16 watchdog in ${phase}`)
  process.exit(91)
}, 25000)
watchdog.unref()

class FailingPersistence extends SqlitePersistence.SqliteSessionPersistence {
  async stat(id, options) {
    try { return await super.stat(id, options) }
    catch (error) { await log(`stat error ${String(error)}`); throw error }
  }

  failFlush(handle, access) {
    if (!failingFlush || access !== 'write') return handle
    handle.flush = async () => {
      flushFailed = true
      throw new Error('injected flush failure')
    }
    return handle
  }

  async create(header, options) {
    try { return this.failFlush(await super.create(header, options), 'write') }
    catch (error) { await log(`create error ${String(error)}`); throw error }
  }
  async open(id, access, options) {
    if (exitOnWrite && access === 'write') process.exit(22)
    try { return this.failFlush(await super.open(id, access, options), access) }
    catch (error) { await log(`open error ${access} ${String(error)}`); throw error }
  }
}

const failingPlugin = {
  name: 'session-persistence-sqlite-failing',
  async apply(ctx, config) {
    const storage = await SqliteStorage.open(config.databasePath)
    let provider
    let fiber
    try {
      ctx.effect(function* () {
        yield async () => { try { await provider?.close() } finally { await storage.close() } }
        fiber = ctx.plugin({
          name: 'session-persistence-sqlite-failing-service',
          apply(serviceCtx) { provider = new FailingPersistence(serviceCtx, storage) },
        })
        yield ctx.on('session/event', (session, event) => provider?.enqueueLive(session.id, event))
        yield ctx.on('session/flush', session => provider?.flushSession(session.id))
        yield ctx.on('session/disposed', session => provider?.disposeSession(session.id))
        yield fiber.dispose
      }, 'failing session persistence resources')
      if (!fiber) throw new Error('the failing Session persistence service did not start')
      await fiber.await()
    } catch (error) {
      await storage.close().catch(() => {})
      throw error
    }
  },
}

async function waitForReceipt() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const delivery = (await engine.getTicketDirection(ticketId))?.inputs[0]?.delivery
    if (delivery?.persistedAt !== undefined) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('the persisted receipt was never recorded')
}

async function waitForMessage() {
  const current = (await engine.getTicketDirection(ticketId))?.inputs[0]?.delivery
  if (!current) throw new Error('the follow-up delivery claim is missing')
  const persistence = native.get('sessionPersistence')
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await persistence.stat(current.sessionId)) {
      const handle = await persistence.open(current.sessionId, 'read')
      try {
        const events = (await handle.read()).events
        if (events.some(event => event.type === 'user/message' && event.data.id === current.messageId)) return
      } finally { await handle.close() }
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('the user message never reached durable history')
}

async function settle(predicate) {
  for (let attempt = 0; attempt < 750; attempt++) {
    await engine.effects.drain()
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('the expected durable boundary was never reached')
}

async function* respond(options) {
  if (options.model === 'router') { yield* routerResponse(options); return }
  if (completedToolCount(options)) { yield* textResponse('Recorded.'); return }
  const text = lastUserText(options)
  if (text.includes('Follow-up change.')) {
    if (phase === 'after-append') { await waitForMessage(); process.exit(23) }
    if (phase === 'after-receipt') { await waitForReceipt(); process.exit(25) }
    yield* toolResponse('report_ready', { result: 'Follow-up complete.', evidence: 'Recovered the follow-up.' })
    return
  }
  if (text === 'Initial request.') {
    yield* toolResponse('report_ready', { result: 'Initial complete.', evidence: 'Completed the initial request.' })
    return
  }
  yield* textResponse('Continue.')
}

const storage = await SqliteStorage.open(databasePath)
const transaction = storage.transaction.bind(storage)
storage.transaction = async (instanceId, operation) => {
  try { return await transaction(instanceId, operation) }
  catch (error) { await log(`tx-error ${instanceId} ${String(error)}\n${error instanceof Error ? error.stack : ''}`); throw error }
}
native = await nativeContext(directory, respond, { persistence: failingPlugin, persistenceConfig: { databasePath: sessionDatabasePath } })
const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
const run = sessions.run.bind(sessions)
sessions.run = async request => { await log(`run ${request.role}`); return run(request) }
const hasMessage = sessions.hasMessage.bind(sessions)
sessions.hasMessage = async (...args) => { await log('hasMessage'); return hasMessage(...args) }
engine = new Engine(storage, 'private', sourceConfig(), {}, sessions)
const initial = await engine.receiveSource({ commandId: 'initial', threadId: 'room', objectId: 'message-1', type: 'created', version: '1',
  text: 'Initial request.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
const accepted = await engine.assessSourceBatch({ commandId: 'eval-initial', threadId: 'room', eventIds: [initial.eventId] })
ticketId = accepted.receipts[0].ticketId
engine.effects.wake()
await settle(async () => (await engine.getTicketDirection(ticketId))?.state === 'ended')
await log('initial-done')
if (phase === 'before-claim') {
  await engine.effects.stop()
  await engine.receiveSource({ commandId: 'followup', threadId: 'room', objectId: 'message-2', type: 'created', version: '1',
    text: 'Follow-up change.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  process.exit(21)
}
exitOnWrite = phase === 'after-claim'
failingFlush = phase === 'flush-failure'
await log(`receiving ${phase}`)
await engine.receiveSource({ commandId: 'followup', threadId: 'room', objectId: 'message-2', type: 'created', version: '1',
  text: 'Follow-up change.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
await log('received')
const delivery = async () => (await engine.getTicketDirection(ticketId))?.inputs[0]?.delivery
if (phase === 'after-claim') {
  engine.effects.wake()
  await settle(async () => {
    const claimed = (await delivery())?.claimedAt !== undefined
    if (claimed) await log('claimed')
    return claimed
  })
}
if (phase === 'flush-failure') {
  engine.effects.wake()
  await settle(async () => flushFailed)
  await waitForMessage()
  process.exit(24)
}
if (phase === 'after-append' || phase === 'after-receipt') {
  engine.effects.wake()
  await new Promise(() => {})
}
await log('exit-0')
process.exit(0)
