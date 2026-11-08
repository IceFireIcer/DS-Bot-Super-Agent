import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function runtime(t, { slots, respond, source = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-concurrency-'))
  let native, storage, sessions, engine
  // A Worker turn that waits must never hold the run open, so every gate is released at cleanup.
  const gates = []
  t.after(async () => {
    for (const release of gates) release()
    await engine?.effects.stop()
    await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(join(directory, 'sessions'), respond)
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], ...source }, {}, sessions, [], slots ?? {})
  const accept = async (threadId, objectId, text) => {
    const received = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text })
    return (await engine.acceptSource({ commandId: `accept-${objectId}`, threadId, objectId, expectedEventId: received.eventId })).ticketId
  }
  const until = async (check, label) => {
    const deadline = Date.now() + 8000
    while (!await check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`)
      await sleep(20)
    }
  }
  return { engine, accept, until, gates }
}

function routed(handlers) {
  return async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'router') {
      const tool = options.tools[results.length]
      if (!tool) { yield* textResponse('Routed.'); return }
      if (tool.name.startsWith('deliver_result')) yield* toolResponse(tool.name, { reportId: JSON.parse(text.slice('Ready report:'.length)).id })
      else yield* toolResponse(tool.name, {})
      return
    }
    if (results.length) { yield* textResponse('Recorded.'); return }
    yield* handlers.worker(text)
  }
}

test('two independent Tickets make progress at the same time; a slow one never blocks the other', { timeout: 30000 }, async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const workerTurns = []
  let runtimeContext
  runtimeContext = await runtime(t, {
    slots: { maxSlots: 2 },
    respond: routed({ worker: async function* (text) {
      workerTurns.push(text)
      if (text.startsWith('Slow work')) { entered(); await gate }
      yield* toolResponse('report_ready', { result: `Finished ${text}`, evidence: `Verified ${text}` })
    } }),
  })
  const { engine, until, gates } = runtimeContext
  gates.push(release)
  engine.effects.start()
  const slow = await engine.submit({ commandId: 'slow', eventId: 'slow', text: 'Slow work.' })
  const fast = await engine.submit({ commandId: 'fast', eventId: 'fast', text: 'Fast work.' })
  await started
  await until(async () => (await engine.conversation(fast.ticketId)).status === 'ready', 'the fast Ticket result')
  // The slow Assignment is still inside its turn while the independent Ticket already delivered.
  assert.equal((await engine.conversation(slow.ticketId)).status, 'running')
  assert.deepEqual((await engine.listSlots()).holding.map(slot => slot.ticketId), [slow.ticketId])
  release()
  await until(async () => (await engine.conversation(slow.ticketId)).status === 'ready', 'the slow Ticket result')
  assert.deepEqual(new Set(workerTurns), new Set(['Slow work.', 'Fast work.']))
  assert.deepEqual((await engine.listSlots()).holding, [])
})

test('a full normal budget queues a new launch while a human follow-up uses the bounded extra slot', { timeout: 30000 }, async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const workerTurns = []
  let notePriority
  const prioritySlot = new Promise(resolve => { notePriority = resolve })
  const { engine, accept, until, gates } = await runtime(t, {
    slots: { maxSlots: 1, maxPrioritySlots: 1 },
    source: { allowedThreadIds: ['room', 'lab', 'docs'], versionOrder: 'sequence' },
    respond: routed({ worker: async function* (text) {
      workerTurns.push(text)
      if (text.startsWith('Wait here.')) { entered(); await gate }
      if (text.startsWith('Idle once.')) { yield* textResponse('Nothing to report yet.'); return }
      // Capture the live budget at the moment the person's follow-up turn actually starts.
      if (text.startsWith('Please also fix the title.')) notePriority(await engine.listSlots())
      yield* toolResponse('report_ready', { result: `Finished ${text}`, evidence: `Verified ${text}` })
    } }),
  })
  gates.push(release)
  engine.effects.start()
  const idle = await accept('lab', 'lab-1', 'Idle once.')
  await until(async () => (await engine.conversation(idle)).reason === 'worker-idle', 'the idle Worker turn')
  const holder = await accept('room', 'room-1', 'Wait here.')
  await started

  await engine.receiveSource({ commandId: 'receive-followup', threadId: 'lab', objectId: 'lab-2', type: 'created', version: '1', text: 'Please also fix the title.' })
  const blocked = await accept('docs', 'docs-1', 'Unrelated new launch.')
  await until(async () => (await engine.conversation(blocked)).reason === 'slot-queued', 'the queued launch')
  // The person's follow-up ran while the new launch was queued, on the one bounded extra slot.
  const duringFollowup = await prioritySlot
  assert.deepEqual(duringFollowup.holding.map(slot => [slot.ticketId, slot.priority, slot.activation]),
    [[holder, false, 'launch'], [idle, true, 'followup']], JSON.stringify(duringFollowup))
  assert.deepEqual((await engine.listSlots()).waiting.map(slot => [slot.ticketId, slot.waitingReason]), [[blocked, 'SLOTS_FULL']])

  release()
  await until(async () => (await engine.conversation(holder)).status === 'ready', 'the holder result')
  await until(async () => (await engine.conversation(blocked)).status === 'ready', 'the queued launch result')
  assert.equal((await engine.listSlots()).holding.length, 0)
  assert.deepEqual((await engine.listSlots()).waiting, [])
  assert.equal((await engine.conversation(idle)).status, 'ready')
})

test('a slow Ticket does not starve a person: the queued launch waits, the follow-up does not', { timeout: 30000 }, async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const workerTurns = []
  let notePriority
  const prioritySlot = new Promise(resolve => { notePriority = resolve })
  const { engine, accept, until, gates } = await runtime(t, {
    slots: { maxSlots: 1, maxPrioritySlots: 1 },
    source: { allowedThreadIds: ['room', 'lab', 'docs'], versionOrder: 'sequence' },
    respond: routed({ worker: async function* (text) {
      workerTurns.push(text)
      if (text.startsWith('Wait here.')) { entered(); await gate }
      if (text.startsWith('Idle once.')) { yield* textResponse('Nothing to report yet.'); return }
      if (text.startsWith('Urgent correction from a person.')) notePriority(await engine.listSlots())
      yield* toolResponse('report_ready', { result: `Finished ${text}`, evidence: `Verified ${text}` })
    } }),
  })
  gates.push(release)
  engine.effects.start()
  const idle = await accept('lab', 'lab-1', 'Idle once.')
  await until(async () => (await engine.conversation(idle)).reason === 'worker-idle', 'the idle Worker turn')
  await accept('room', 'room-1', 'Wait here.')
  await started
  // A burst of automatic-looking new work cannot take the person's slot.
  const launches = await Promise.all(['docs-1', 'docs-2', 'docs-3'].map(objectId => accept('docs', objectId, `Automatic launch ${objectId}.`)))
  await engine.receiveSource({ commandId: 'receive-followup', threadId: 'lab', objectId: 'lab-2', type: 'created', version: '1', text: 'Urgent correction from a person.' })
  await until(async () => workerTurns.includes('Urgent correction from a person.'), 'the person follow-up')
  const duringFollowup = await prioritySlot
  assert.equal(duringFollowup.holding.filter(slot => slot.priority).length, 1, JSON.stringify(duringFollowup))
  await until(async () => (await engine.listSlots()).waiting.length === launches.length, 'every launch to queue')
  const snapshot = await engine.listSlots()
  assert.deepEqual(snapshot.waiting.map(slot => slot.ticketId).sort(), [...launches].sort())
  assert.ok(snapshot.waiting.every(slot => slot.waitingReason === 'SLOTS_FULL'))
  // The extra slot is an overflow, never a second pool: priority holds stay at their declared bound.
  assert.equal(snapshot.holding.filter(slot => slot.priority).length <= 1, true, JSON.stringify(snapshot))
  for (const ticketId of launches) assert.equal((await engine.conversation(ticketId)).reason, 'slot-queued')
  release()
  await until(async () => (await engine.listSlots()).holding.length === 0 && (await engine.listSlots()).waiting.length === 0, 'the drained budget')
  for (const ticketId of launches) await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'each queued launch to finish')
  assert.equal((await engine.conversation(idle)).status, 'ready')
})

test('a status request only runs for an idle Ticket and never clears a stop or a waiting question', { timeout: 30000 }, async t => {
  const workerTurns = []
  const toolsByTurn = new Map()
  let currentTurn = ''
  const { engine, accept, until } = await runtime(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    respond: options => {
      if (options.model === 'worker') {
        const user = options.messages.filter(message => message.role === 'user').at(-1)
        const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
        const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
        if (!results.length) { currentTurn = text; workerTurns.push(text); toolsByTurn.set(text, options.tools.map(tool => tool.name)) }
        if (results.length) return textResponse('Recorded.')
        if (text.startsWith('Idle once.')) return textResponse('Still investigating.')
        if (text.startsWith('Report the current status')) return textResponse('Halfway through.')
        return toolResponse('report_ready', { result: 'Done.', evidence: 'Checked.' })
      }
      return routerResponse(options)
    },
  })
  engine.effects.start()
  const ticketId = await accept('room', 'room-1', 'Idle once.')
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-idle', 'the idle Worker turn')
  await engine.requestStatus({ commandId: 'status-1', ticketId })
  await until(async () => workerTurns.some(text => text.startsWith('Report the current status')), 'the status turn')
  // The status turn sees one fact-only tool and none of the delivery tools.
  const statusTurn = workerTurns.find(text => text.startsWith('Report the current status'))
  assert.deepEqual(toolsByTurn.get(statusTurn), ['report_status'])
  // A status request cannot turn an idle Worker into a result or bypass the reason a Ticket is waiting.
  await until(async () => (await engine.listSlots()).holding.length === 0, 'the status turn to finish')
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
  assert.equal((await engine.conversation(ticketId)).reason, 'worker-idle')
  assert.equal((await engine.conversation(ticketId)).statusReport, undefined, 'plain text alone records no status fact')
  // The mock that ignores the prompt proves delivery tools are absent: it cannot fabricate a result.
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
  await engine.stopTicket({ commandId: 'stop-1', ticketId, reason: 'Pause this work.' })
  await assert.rejects(engine.requestStatus({ commandId: 'status-2', ticketId }), { code: 'STATUS_UNAVAILABLE' })
  assert.equal(currentTurn.length > 0, true)
})

test('a status turn that reports a fact records it without completing the Ticket', { timeout: 30000 }, async t => {
  let statusCalls = 0
  const { engine, accept, until } = await runtime(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    respond: options => {
      if (options.model === 'router') return routerResponse(options)
      const user = options.messages.filter(message => message.role === 'user').at(-1)
      const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
      if (results.length) return textResponse('Recorded.')
      if (text.startsWith('Idle once.')) return textResponse('Still investigating.')
      if (text.startsWith('Report the current status')) {
        statusCalls++
        return toolResponse('report_status', { text: 'Halfway through the investigation.' })
      }
      return toolResponse('report_ready', { result: 'Done.', evidence: 'Checked.' })
    },
  })
  engine.effects.start()
  const ticketId = await accept('room', 'room-1', 'Idle once.')
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-idle', 'the idle Worker turn')
  await engine.requestStatus({ commandId: 'status-record', ticketId })
  await until(async () => (await engine.conversation(ticketId)).statusReport !== undefined, 'the recorded status fact')
  const conversation = await engine.conversation(ticketId)
  assert.equal(statusCalls, 1)
  assert.equal(conversation.statusReport.text, 'Halfway through the investigation.')
  assert.equal(conversation.statusReport.ticketId, ticketId)
  // The fact is not a result: the Ticket is still idle and unanswered.
  assert.deepEqual(conversation.reports, [])
  assert.equal(conversation.reason, 'worker-idle')
  assert.equal(conversation.status, 'running')
})

test('the same-process loopback preview exposes slot budgets and the status command', { timeout: 30000 }, async t => {
  const { engine, accept, until } = await runtime(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    respond: routed({ worker: async function* (text) {
      if (text.startsWith('Idle once.')) { yield* textResponse('Still investigating.'); return }
      if (text.startsWith('Report the current status')) { yield* textResponse('Halfway.'); return }
      yield* toolResponse('report_ready', { result: 'Done.', evidence: 'Checked.' })
    } }),
  })
  engine.effects.start()
  const chat = await core.createChatServer(engine)
  t.after(() => chat.close())
  const ticketId = await accept('room', 'room-1', 'Idle once.')
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-idle', 'the idle Worker turn')
  const slots = await (await fetch(`${chat.url}/slots`, { headers: { origin: chat.url } })).json()
  assert.deepEqual(slots.limits, { normal: 2, priority: 1 })
  assert.deepEqual(slots.holding, [])
  const response = await fetch(`${chat.url}/status`, { method: 'POST', headers: { 'content-type': 'application/json', origin: chat.url },
    body: JSON.stringify({ commandId: 'chat-status', ticketId }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ticketId, ticketId)
})

test('slots belong to one Assignment, survive a query and do not leak across runtimes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-slots-'))
  let storage
  t.after(async () => { await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const first = new core.Slots(storage, 'private', 'runtime-one', { maxSlots: 1, maxPrioritySlots: 1 })
  const second = new core.Slots(storage, 'private', 'runtime-two', { maxSlots: 1, maxPrioritySlots: 1 })
  const acquire = (slots, ticketId, activation) => storage.transaction('private', tx => slots.acquire(tx, { ticketId, assignmentId: `${ticketId}-assignment`, activation }))
  assert.equal((await acquire(first, 'alpha', 'launch')).acquired, true)
  assert.deepEqual(await acquire(first, 'beta', 'launch'), { acquired: false, reason: 'SLOTS_FULL' })
  const followup = await acquire(first, 'alpha', 'followup')
  assert.equal(followup.acquired, true)
  assert.equal(followup.slot.priority, false)
  // While a normal slot stays free, a follow-up still takes a normal slot and the extra slot stays unused.
  assert.equal((await acquire(first, 'delta', 'followup')).acquired, true)
  const snapshot = await first.list()
  assert.deepEqual(snapshot.holding.map(slot => [slot.ticketId, slot.priority]), [['alpha', false], ['delta', true]])
  assert.deepEqual(snapshot.waiting.map(slot => slot.ticketId), ['beta'])
  // A hold from an earlier runtime cannot be proven live, so a new runtime may admit its own work.
  const gamma = await acquire(second, 'gamma', 'launch')
  assert.equal(gamma.acquired, true)
  assert.equal(await storage.transaction('private', tx => second.release(tx, { ticketId: 'gamma', assignmentId: 'other-assignment' })), false)
  assert.equal(await storage.transaction('private', tx => second.release(tx, { ticketId: 'gamma', assignmentId: 'gamma-assignment' })), true)
  assert.throws(() => new core.Slots(storage, 'private', 'runtime-three', { maxSlots: 0 }), { code: 'INVALID_CONFIG' })
})

test('a background job wake is automatic input and never takes the extra slot reserved for a person', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-slots-job-'))
  let storage
  t.after(async () => { await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const slots = new core.Slots(storage, 'private', 'runtime-job', { maxSlots: 1, maxPrioritySlots: 1 })
  const acquire = (ticketId, activation) => storage.transaction('private', tx => slots.acquire(tx, { ticketId, assignmentId: `${ticketId}-assignment`, activation }))
  assert.equal((await acquire('holder', 'launch')).acquired, true)
  // The completion of a background job is automatic input: with the normal budget full it waits.
  assert.deepEqual(await acquire('builder', 'background'), { acquired: false, reason: 'SLOTS_FULL' })
  assert.equal((await slots.list()).holding.filter(slot => slot.priority).length, 0)
  // A person's follow-up still uses the bounded extra slot on the same budget.
  const followup = await acquire('person', 'followup')
  assert.equal(followup.acquired, true)
  assert.equal(followup.slot.priority, true)
})
