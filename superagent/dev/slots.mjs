import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from './native-mock.mjs'

// Declared workload for the T11 slot budget. Every figure below is measured in this run; none is
// copied from the reference prototype.
const workload = { normalSlots: 2, prioritySlots: 1, launchTickets: 6, workerTurnMs: 400, scanIntervalMs: 50 }
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const percentile = (samples, fraction) => [...samples].sort((left, right) => left - right)[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-slot-load-'))
let context, storage, sessions, engine
let running = 0
let peak = 0
let followupSnapshot
try {
  context = await nativeContext(join(directory, 'sessions'), async function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const latest = options.messages.filter(message => message.role === 'user').at(-1)
    const text = latest.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (options.messages.slice(options.messages.lastIndexOf(latest) + 1).some(message => message.role === 'tool')) { yield* textResponse('Recorded.'); return }
    // Capture the live budget exactly when the person's follow-up turn starts.
    if (text.startsWith('Person correction.')) followupSnapshot = await engine.listSlots()
    running++
    peak = Math.max(peak, running)
    try { await sleep(workload.workerTurnMs) } finally { running-- }
    if (text.startsWith('Idle first.')) { yield* textResponse('No result yet; still investigating.'); return }
    yield* toolResponse('report_ready', { result: 'Measured result.', evidence: 'Ran under the declared slot workload.' })
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const threads = Array.from({ length: workload.launchTickets }, (_, index) => `room-${index}`)
  // The person speaks in its own Thread, so the follow-up targets exactly one idle Ticket.
  const personThread = 'person-room'
  engine = new Engine(storage, 'slot-load', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: [...threads, personThread], versionOrder: 'sequence' },
    { retryDelayMs: 10, scanIntervalMs: workload.scanIntervalMs }, sessions, [], { maxSlots: workload.normalSlots, maxPrioritySlots: workload.prioritySlots })
  engine.effects.start()

  const accept = async (threadId, text, objectId = `${threadId}-1`) => {
    const event = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text })
    return engine.acceptSource({ commandId: `accept-${objectId}`, threadId, objectId, expectedEventId: event.eventId })
  }
  const startedAt = performance.now()
  // The person's own Thread starts first and ends idle, so its follow-up can run at once.
  const idle = await accept(personThread, 'Idle first.', 'person-idle')
  await waitUntil(async () => (await engine.conversation(idle.ticketId)).reason === 'worker-idle', 'the idle Worker turn')
  const receipts = []
  for (const threadId of threads) receipts.push(await accept(threadId, `Launched work on ${threadId}.`))
  const acceptanceMs = performance.now() - startedAt
  const acceptedAt = new Map(receipts.map((receipt, index) => [receipt.ticketId, startedAt + index]))

  // Wait until every launch has been admitted once and the surplus is queued.
  await waitUntil(async () => {
    const slots = await engine.listSlots()
    return slots.holding.filter(slot => !slot.priority && slot.activation === 'launch').length >= workload.normalSlots && slots.waiting.length === workload.launchTickets - workload.normalSlots
  }, 'every launch to be admitted or queued')
  const busy = await engine.listSlots()
  assert.equal(busy.limits.normal, workload.normalSlots)
  assert.equal(busy.holding.filter(slot => !slot.priority && slot.activation === 'launch').length, workload.normalSlots, JSON.stringify(busy))
  assert.equal(busy.waiting.length, workload.launchTickets - workload.normalSlots, JSON.stringify(busy))
  assert.ok(busy.waiting.every(slot => slot.waitingReason === 'SLOTS_FULL' && !slot.priority), JSON.stringify(busy))
  const queuedReasons = []
  for (const receipt of receipts) queuedReasons.push((await engine.conversation(receipt.ticketId)).reason)
  const queuedLaunches = queuedReasons.filter(reason => reason === 'slot-queued' || reason === 'slot-priority-waiting').length
  assert.ok(queuedLaunches >= 1, JSON.stringify(queuedReasons))

  // A person's follow-up reaches a Worker turn on the one extra slot while every normal slot is held.
  const followupStartedAt = performance.now()
  await engine.receiveSource({ commandId: 'receive-followup', threadId: personThread, objectId: 'person-followup', type: 'created', version: '1', text: 'Person correction.' })
  const followupAcceptedAt = performance.now()
  // The follow-up is a stable Input first; the extra slot is what lets it start before the queued launches.
  await waitUntil(async () => followupSnapshot !== undefined, "the person's follow-up turn")
  assert.equal(followupSnapshot.holding.filter(slot => slot.priority).length, workload.prioritySlots, JSON.stringify(followupSnapshot))
  assert.ok(followupSnapshot.waiting.every(slot => slot.waitingReason === 'SLOTS_FULL'), JSON.stringify(followupSnapshot))

  await waitUntil(async () => (await engine.listSlots()).holding.length === 0 && (await engine.listSlots()).waiting.length === 0, 'the drained budget')
  for (const receipt of receipts) await waitUntil(async () => (await engine.conversation(receipt.ticketId)).status === 'ready', 'each launch result')
  const completionMs = receipts.map(receipt => performance.now() - acceptedAt.get(receipt.ticketId))
  const idleDirection = await engine.getTicketDirection(idle.ticketId)
  assert.equal(idleDirection.inputs.length, 1)
  assert.equal(idleDirection.inputs[0].state, 'delivered')
  // Fairness budget: every queued launch finishes within the declared bound, so no Ticket is starved
  // beyond a whole number of Worker turns at the declared budget.
  const fairnessBoundMs = Math.ceil(workload.launchTickets / workload.normalSlots) * workload.workerTurnMs * 3
  assert.ok(Math.max(...completionMs) <= fairnessBoundMs, JSON.stringify({ completionMs, fairnessBoundMs }))
  console.log(JSON.stringify({
    workload,
    measured: {
      acceptanceMsForAllLaunches: Number(acceptanceMs.toFixed(1)),
      followupAcceptanceMs: Number((followupAcceptedAt - followupStartedAt).toFixed(1)),
      concurrentWorkerTurnsPeak: peak,
      boundedConcurrency: peak <= workload.normalSlots + workload.prioritySlots,
      queuedLaunches,
      completionMs: { p50: Number(percentile(completionMs, 0.5).toFixed(1)), p95: Number(percentile(completionMs, 0.95).toFixed(1)), max: Number(Math.max(...completionMs).toFixed(1)) },
      fairnessBudget: { launches: workload.launchTickets, finished: completionMs.length, boundMs: fairnessBoundMs },
      priorityHoldsDuringFollowup: followupSnapshot.holding.filter(slot => slot.priority).length,
      queuedLaunchesDuringFollowup: followupSnapshot.waiting.length,
      personFollowupsDelivered: idleDirection.inputs.filter(input => input.state === 'delivered').length,
    },
  }, null, 2))
} finally {
  await engine?.effects.stop(); await sessions?.close(); await context?.fiber.dispose(); await storage?.close()
  await rm(directory, { recursive: true, force: true })
}

async function waitUntil(check, label) {
  const deadline = Date.now() + 30000
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`The declared slot workload did not reach: ${label}.`)
    await sleep(25)
  }
}
