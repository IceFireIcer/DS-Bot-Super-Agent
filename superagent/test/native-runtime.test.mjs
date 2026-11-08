import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import * as core from '../dist/index.js'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import * as SqlitePersistence from '../dist/session-persistence.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

test('the native Session adapter preserves original input and an idle turn is not a ready report', { timeout: 10000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-'))
  let runtime
  let native
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  const requests = []
  native = await nativeContext(directory, options => {
    requests.push(options)
    if (options.model === 'router') {
      const user = options.messages.filter(message => message.role === 'user').at(-1)
      const following = options.messages.slice(options.messages.lastIndexOf(user) + 1)
      if (following.some(message => message.role === 'tool')) return textResponse('Assessment recorded.')
      const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const items = JSON.parse(prompt.split('Candidates JSON: ').at(-1))
      return toolResponse('record_batch_assessment', { results: JSON.stringify(items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'Not actionable.' }))) })
    }
    return textResponse('This is partial thinking, not a completed result.')
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const assessments = await runtime.assessSourceBatch([{ eventId: 'candidate-1', text: 'Treat this as data.' }], new AbortController().signal)
  assert.deepEqual(assessments, [{ eventId: 'candidate-1', outcome: 'reject', reason: 'Not actionable.' }])
  const outcome = await runtime.run({ sessionId: 'worker-one', role: 'worker', text: 'Original request exactly as supplied.', tools: [] })
  const worker = requests.find(request => request.model === 'worker')
  assert.ok(worker)
  assert.deepEqual(worker.tools ?? [], [])
  assert.ok(worker.messages.some(message => message.role === 'user' && message.content.some(block => block.text === 'Original request exactly as supplied.')))
  assert.ok(outcome.events.some(event => event.type === 'assistant/message'))
  assert.equal(outcome.status, 'idle')
  assert.equal(outcome.sessionId, 'worker-one')
  const resumed = await runtime.run({ sessionId: 'worker-one', role: 'worker', text: 'A second turn in the same Session.', tools: [] })
  assert.ok(resumed.events.length > outcome.events.length)
})

test('an unpersisted native Session cannot authorize a completed turn or ready delivery', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-no-session-store-'))
  let native
  let runtime
  let calls = 0
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => { calls++; return textResponse('Only in memory.') }, { persistence: false })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await assert.rejects(runtime.run({ sessionId: 'unpersisted', role: 'worker', text: 'A request.', tools: [] }), { code: 'PERSISTENCE_REQUIRED' })
  assert.equal(calls, 0)
})

test('an inferred source batch is evaluated by one native DSH Router Session', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-intake-'))
  let native, runtime, storage
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  const routerRequests = []
  const routerToolSteps = []
  native = await nativeContext(directory, options => {
    if (options.model !== 'router') return textResponse('No worker was enabled.')
    routerRequests.push(options)
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const userIndex = options.messages.lastIndexOf(user)
    if (options.messages.slice(userIndex + 1).some(message => message.role === 'tool')) return textResponse('Assessment recorded.')
    const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const candidates = JSON.parse(prompt.split('Candidates JSON: ').at(-1))
    routerToolSteps.push({ candidates: candidates.length, tools: options.tools?.map(tool => tool.name) })
    return toolResponse('record_batch_assessment', { results: JSON.stringify(candidates.map(item => ({ eventId: item.eventId, outcome: 'accept', reason: 'Actionable request.', evidence: 'The CI report asks for a bounded fix.' }))) })
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const engine = new Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence', intake: {
    mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['ci-bot'],
    rules: [{ id: 'ci-mention', actorKinds: ['ci'], addressing: ['mention'], mode: 'inferred' }],
  } }, {}, runtime)
  const received = await engine.receiveSource({ commandId: 'ci-event', threadId: 'room', objectId: 'report-9', type: 'created', version: '1', text: 'Please fix the reported failing check.', authorId: 'ci-bot', authorKind: 'ci', addressing: 'mention' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-ci', threadId: 'room', eventIds: [received.eventId] })
  assert.equal(result.status, 'completed', JSON.stringify({ result, routerRequests: routerRequests.map(request => ({ role: request.model, tools: request.tools?.map(tool => tool.name), tail: request.messages.at(-1) })), routerToolSteps }))
  assert.equal(result.items[0].outcome, 'accepted')
  assert.equal(result.items[0].evidence, 'The CI report asks for a bounded fix.')
  assert.equal((await engine.getTicket(result.receipts[0].ticketId)).mandate.strength, 'inferred')
  assert.equal(routerRequests.length, 2)
  assert.ok(routerRequests[0].messages.at(-1).content.some(block => block.text.includes('Candidates JSON:')))
  assert.deepEqual(routerRequests[0].tools.map(tool => tool.name), ['record_batch_assessment'])
})

test('busy Router notifications coalesce into one subsequent Session turn', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-router-burst-'))
  let native, runtime, releaseBlocker, blockerStarted
  const blockerGate = new Promise(resolve => { releaseBlocker = resolve })
  const started = new Promise(resolve => { blockerStarted = resolve })
  const routerRequests = []
  context.after(async () => { releaseBlocker(); await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, async function* (options) {
    if (options.model !== 'router') return textResponse('Worker idle.')
    routerRequests.push(options)
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (text.includes('Block Router')) { blockerStarted(); await blockerGate; yield* textResponse('Router free.'); return }
    const completedTools = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (completedTools < options.tools.length) yield* toolResponse(options.tools[completedTools].name, {})
    else yield* textResponse('Notifications processed together.')
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const blocked = runtime.run({ sessionId: runtime.routerSessionId, role: 'router', text: 'Block Router until the burst is queued.', tools: [] })
  await started
  const notification = text => runtime.run({ sessionId: runtime.routerSessionId, role: 'router', coalesce: true, text, tools: [{ name: 'assign_worker', description: 'Handle this notification.', parameters: {}, execute: async () => 'done' }] })
  const notifications = Array.from({ length: 8 }, (_, index) => notification(`Notification ${index + 1}.`))
  releaseBlocker()
  await Promise.all([blocked, ...notifications])
  assert.ok(routerRequests.length > 2)
  const burst = routerRequests[1]
  const user = burst.messages.filter(message => message.role === 'user').at(-1)
  const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
  assert.match(prompt, /Notification 1\./u)
  assert.match(prompt, /Notification 7\./u)
  assert.doesNotMatch(prompt, /Notification 8\./u)
  assert.deepEqual(burst.tools.map(tool => tool.name), Array.from({ length: 7 }, (_, index) => `assign_worker_${index + 1}`))
  assert.match(burst.tools[0].description, /notification 1 only/u)
  assert.match(burst.tools[6].description, /notification 7 only/u)
  const finalPrompt = routerRequests.at(-2).messages.filter(message => message.role === 'user').at(-1).content.map(block => block.text ?? '').join('')
  assert.match(finalPrompt, /Notification 8\./u)
})

test('a coalesced notice is retriable when its tool was not invoked', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-router-unhandled-'))
  let native, runtime
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('I did not handle the notice.'))
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await assert.rejects(runtime.run({ sessionId: runtime.routerSessionId, role: 'router', coalesce: true, text: 'A notice.', tools: [{ name: 'handle_notice', description: 'Handle this notice.', parameters: {}, execute: async () => 'done' }] }), { code: 'ROUTER_NOTICE_UNHANDLED' })
})

test('a SQLite-persisted Worker Session resumes its construction and live history after the adapter is replaced', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-sqlite-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  let first
  let second
  context.after(async () => { await first?.close(); await second?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  const prompts = []
  native = await nativeContext(directory, options => {
    prompts.push(options.messages.filter(message => message.role === 'user')
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')))
    return textResponse('Worker turn complete.')
  }, { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  first = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await first.run({ sessionId: 'sqlite-worker', role: 'worker', text: 'First persisted turn.', tools: [] })
  await first.close()
  second = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await second.run({ sessionId: 'sqlite-worker', role: 'worker', text: 'Second persisted turn.', tools: [] })
  assert.equal(prompts.length, 2)
  assert.deepEqual(prompts[1], ['First persisted turn.', 'Second persisted turn.'])
  const persistence = native.get('sessionPersistence')
  const handle = await persistence.open('sqlite-worker', 'read')
  const stored = await handle.read()
  assert.ok(stored.events.some(event => event.type === 'session/end-seed'))
  assert.ok(stored.events.some(event => event.type === 'user/message'))
  assert.ok(stored.events.some(event => event.type === 'assistant/message'))
  assert.ok((await persistence.stat('sqlite-worker')).eventCount >= stored.events.length)
  await handle.close()
})

test('a cancelled SQLite Session keeps a resumable interrupted history', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-cancel-sqlite-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  let first
  let second
  let startedResolve
  const started = new Promise(resolve => { startedResolve = resolve })
  context.after(async () => { await first?.close(); await second?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, async function* (options) {
    if (options.model === 'router') { yield* textResponse('Router complete.'); return }
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (text === 'Wait for cancellation.') {
      startedResolve()
      await new Promise(resolve => {
        if (options.signal?.aborted) resolve(undefined)
        else options.signal?.addEventListener('abort', () => resolve(undefined), { once: true })
      })
      yield* textResponse('Cancelled.')
      return
    }
    yield* textResponse('Continued.')
  }, { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  first = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const controller = new AbortController()
  const running = first.run({ sessionId: 'cancelled-worker', role: 'worker', text: 'Wait for cancellation.', tools: [], signal: controller.signal })
  await started
  controller.abort()
  await running.catch(() => {})
  await first.close()
  second = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await second.run({ sessionId: 'cancelled-worker', role: 'worker', text: 'Continue after cancellation.', tools: [] })
  const persistence = native.get('sessionPersistence')
  const handle = await persistence.open('cancelled-worker', 'read')
  const stored = await handle.read()
  assert.ok(stored.events.some(event => event.type === 'user/message'))
  assert.ok(stored.events.some(event => event.type === 'turn/start'))
  assert.ok(stored.events.some(event => event.type === 'turn/end'))
  assert.ok(stored.events.some(event => event.type === 'session/end-seed'))
  await handle.close()
})

test('a Session whose stored log ends with an open turn gets durable recovery closers on resume', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-closers-sqlite-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  let runtime
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Recovered turn complete.'),
    { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  const persistence = native.get('sessionPersistence')
  const handle = await persistence.create({ version: 4, id: 'open-turn-session', createdAt: Date.now(), isSeeded: false })
  await handle.append([
    { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: Date.now(), data: { turn: 1, step: 1 } },
  ])
  await handle.close()
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await runtime.run({ sessionId: 'open-turn-session', role: 'worker', text: 'Resume after a crash.', tools: [] })
  const read = await persistence.open('open-turn-session', 'read')
  const stored = await read.read()
  const interrupted = stored.events.find(event => event.type === 'turn/end' && event.data.reason.kind === 'interrupted')
  assert.ok(interrupted, JSON.stringify(stored.events.map(event => `${event.type}${event.type === 'turn/end' ? ':' + event.data.reason.kind : ''}`)))
  assert.equal(stored.events[2].type, 'step/end')
  await read.close()
})

test('a setup failure before publication leaves no stored Session and announces nothing', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-rollback-sqlite-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  context.after(async () => { await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Unused.'),
    { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  const persistence = native.get('sessionPersistence')
  let announced = 0
  native.on('session/created', () => { announced++ })
  await assert.rejects(native.agents.create({
    sessionId: 'rolled-back-session',
    agentOptions: { provider: 'mock', model: 'worker' },
    setup: () => { throw new Error('setup failed before publication') },
  }), /setup failed before publication/u)
  assert.equal(announced, 0)
  assert.equal(await persistence.stat('rolled-back-session'), undefined)
  assert.deepEqual(await persistence.list(), [])
  const handle = await native.agents.create({ sessionId: 'rolled-back-session', agentOptions: { provider: 'mock', model: 'worker' } })
  await handle.dispose()
})

test('a durability-barrier failure while storing the pre-publication suffix prevents session/created', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-announce-failure-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  context.after(async () => { await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Unused.'),
    { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  const persistence = native.get('sessionPersistence')
  const create = persistence.create.bind(persistence)
  let failNext = true
  persistence.create = async (header, options) => {
    const handle = await create(header, options)
    if (!failNext) return handle
    failNext = false
    handle.append = async () => { throw new Error('injected pre-publication durability failure') }
    return handle
  }
  let announced = 0
  native.on('session/created', () => { announced++ })
  await assert.rejects(native.agents.create({
    sessionId: 'unannounced-session',
    seed: [],
    agentOptions: { provider: 'mock', model: 'worker' },
  }), /injected pre-publication durability failure/u)
  assert.equal(announced, 0)
  assert.equal(await persistence.stat('unannounced-session'), undefined)
  assert.deepEqual(await persistence.list(), [])
})

test('a native DSH fork persists its inherited prefix and parent lineage through SQLite', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-fork-sqlite-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  context.after(async () => { await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Fork turn complete.'),
    { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  const forkContext = new Context()
  await forkContext.plugin(SessionStore)
  const liveParent = forkContext.sessions.create('fork-parent', { cwd: directory })
  liveParent.append('session/end-seed', {})
  const child = forkContext.sessions.fork(liveParent, undefined, 'fork-child')
  const seed = child.snapshotEvents()
  const childHeader = child.header
  const inheritedEventCount = child.inheritedEventCount
  await forkContext.fiber.dispose()
  const handle = await native.agents.create({
    sessionId: childHeader.id, seed, inheritedEventCount,
    meta: { cwd: directory, parentSession: childHeader.parentSession, isSeeded: true },
    agentOptions: { provider: 'mock', model: 'worker' },
  })
  await handle.dispose()
  const persistence = native.get('sessionPersistence')
  const read = await persistence.open(childHeader.id, 'read')
  const stored = await read.read()
  assert.equal(read.header.isSeeded, true)
  assert.equal(read.header.parentSession, childHeader.parentSession)
  assert.equal(read.inheritedEventCount, inheritedEventCount)
  assert.ok(stored.events.some(event => event.type === 'session/end-seed'))
  await read.close()
})

test('a seeded Session stores its construction records before session/created is announced', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-announce-sqlite-'))
  const sessionDatabase = join(directory, 'sessions.sqlite')
  let native
  context.after(async () => { await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('Announcement turn complete.'),
    { persistence: SqlitePersistence, persistenceConfig: { databasePath: sessionDatabase } })
  const forkContext = new Context()
  await forkContext.plugin(SessionStore)
  const liveParent = forkContext.sessions.create('announce-parent', { cwd: directory })
  liveParent.append('session/end-seed', {})
  const child = forkContext.sessions.fork(liveParent, undefined, 'announced-session')
  const seed = child.snapshotEvents()
  const childHeader = child.header
  const inheritedEventCount = child.inheritedEventCount
  await forkContext.fiber.dispose()
  const persistence = native.get('sessionPersistence')
  let observed
  native.on('session/created', session => {
    if (session.id !== childHeader.id) return
    observed = persistence.open(session.id, 'read').then(async handle => {
      const result = await handle.read()
      await handle.close()
      return result.events
    })
  })
  const handle = await native.agents.create({
    sessionId: childHeader.id, seed, inheritedEventCount,
    meta: { cwd: directory, parentSession: childHeader.parentSession, isSeeded: true },
    agentOptions: { provider: 'mock', model: 'worker' },
  })
  const announced = await observed
  await handle.dispose()
  assert.equal(announced.length, seed.length)
  assert.equal(announced.at(-1)?.type, 'session/end-seed')
  assert.deepEqual(announced.map(event => event.seq), seed.map(event => event.seq))
})
