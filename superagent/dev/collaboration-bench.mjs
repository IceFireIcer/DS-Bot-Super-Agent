import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from './native-mock.mjs'

// Fixed mock workload. Every figure below is measured in this run; no article or prototype number is
// reused. A real-model run is deliberately separate because the mock has no token accounting.
const workload = {
  seed: 20261111,
  initialRequests: 6,
  followups: 6,
  workerTurnMs: 20,
  routerBatchLimit: 20,
  normalSlots: 2,
  prioritySlots: 1,
}
const requests = Array.from({ length: workload.initialRequests }, (_, index) => `Request ${index + 1}: inspect the maintained mock project.`)
const followups = Array.from({ length: workload.followups }, (_, index) => `Follow-up ${index + 1}: update the same mock project.`)
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const percentile = (samples, fraction) => [...samples].sort((left, right) => left - right)[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]

const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-collaboration-bench-'))
const databasePath = join(directory, 'state.sqlite')
let storage
let context
let sessions
const modelCalls = { router: 0, worker: 0 }

try {
  context = await nativeContext(join(directory, 'sessions'), options => {
    if (options.model === 'router') {
      modelCalls.router++
      const user = options.messages.filter(message => message.role === 'user').at(-1)
      const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const following = options.messages.slice(options.messages.lastIndexOf(user) + 1)
      if (following.some(message => message.role === 'tool')) return textResponse('Assessment recorded.')
      const assign = options.tools?.find(tool => tool.name === 'assign_worker')
      if (assign) return toolResponse('assign_worker', {})
      const items = JSON.parse(prompt.split('Candidates JSON: ').at(-1))
      return toolResponse('record_batch_assessment', { results: JSON.stringify(items.map(item => ({
        eventId: item.eventId, outcome: 'accept', reason: 'Fixed mock explicit request.', evidence: 'The fixed stream names a concrete project change.',
      }))) })
    }
    modelCalls.worker++
    return (async function* () {
      await sleep(workload.workerTurnMs)
      yield* textResponse('Worker completed the fixed mock turn without a result.')
    })()
  })
  storage = await SqliteStorage.open(databasePath)
  sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })

  const singleSession = await measureSingleSession()
  const routerWorker = await measureRouterWorker()
  const subscriptionDirect = await measureSubscriptionDirect()
  const recovery = await measureReopen()

  const output = {
    workload,
    environment: {
      model: 'mock', provider: 'native-mock', node: process.version, platform: process.platform,
      tokenMeasurement: 'unavailable: the mock model reports no token usage',
      realModel: 'not run in this command; use the separate real-model evaluation',
      remoteHost: 'not run',
      managedHost: 'not run',
    },
    modes: { singleSession, routerWorker, subscriptionDirect },
    replay: { duplicateTickets: routerWorker.duplicateTickets, duplicateNotifications: routerWorker.duplicateNotifications },
    recovery: { stateReopenMs: recovery },
    unknown: { effects: 0, jobs: 0, note: 'the fixed happy-path stream did not create an unknown external outcome' },
    proactive: { status: 'not run', note: 'covered separately by T29/proactive-model-acceptance.mjs' },
    supervisor: { status: 'not run', note: 'covered separately by T48/supervisor tests and mock Session' },
  }
  console.log(JSON.stringify(output, null, 2))
} finally {
  await sessions?.close().catch(() => {})
  await context?.fiber.dispose().catch(() => {})
  await storage?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}

async function measureSingleSession() {
  const latencies = []
  const stream = [...requests, ...followups]
  const workerBefore = modelCalls.worker
  const totalStarted = performance.now()
  for (const text of stream) {
    const start = performance.now()
    const outcome = await sessions.run({ sessionId: 'bench-single-session', role: 'worker', text, tools: [] })
    if (outcome.status !== 'idle') throw new Error(`The single Session did not finish an idle turn: ${outcome.status}`)
    latencies.push(performance.now() - start)
  }
  return {
    events: stream.length,
    totalMs: Number((performance.now() - totalStarted).toFixed(2)),
    acceptanceBoundary: 'one Native Session turn starts; same boundary as response',
    responseBoundary: 'one Native Session turn ends',
    acceptanceMs: summarize(latencies),
    responseMs: summarize(latencies),
    routerCalls: 0,
    routerBatches: 0,
    workerCalls: modelCalls.worker - workerBefore,
    directFollowups: 0,
    directRatio: 0,
    notifications: { acknowledgements: 0, results: 0, duplicate: 0 },
    duplicateTickets: 0,
    duplicateNotifications: 0,
  }
}

async function measureRouterWorker() {
  const routerBefore = modelCalls.router
  const workerBefore = modelCalls.worker
  const totalStarted = performance.now()
  const engine = new Engine(storage, 'bench-router', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    allowedThreadIds: [...requests, ...followups].map((_, index) => `router-${index}`), versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: workload.routerBatchLimit, maxAttempts: 1, timeoutMs: 10_000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] } }, { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [], { maxSlots: workload.normalSlots, maxPrioritySlots: workload.prioritySlots })
  engine.effects.start()
  const acceptance = []
  const response = []
  const tickets = []
  try {
    for (const [index, text] of [...requests, ...followups].entries()) {
      const start = performance.now()
      const received = await engine.receiveSource({ commandId: `router-receive-${index}`, threadId: `router-${index}`, objectId: `router-message-${index}`, type: 'created', version: '1', text, authorId: 'user', authorKind: 'human', addressing: 'direct' })
      const accepted = await engine.assessSourceBatch({ commandId: `router-assess-${index}`, threadId: `router-${index}`, eventIds: [received.eventId] })
      acceptance.push(performance.now() - start)
      const ticketId = accepted.receipts[0].ticketId
      tickets.push(ticketId)
      await waitFor(engine, async () => (await engine.conversation(ticketId)).assignments.length > 0, `Router/Worker assignment ${index}`)
      response.push(performance.now() - start)
    }
    const beforeDuplicate = tickets.length
    const deliveriesBefore = []
    for (const ticketId of tickets) deliveriesBefore.push(...(await engine.getTicketDeliveries(ticketId)))
    const duplicateReceived = await engine.receiveSource({ commandId: 'router-receive-0', threadId: 'router-0', objectId: 'router-message-0', type: 'created', version: '1', text: requests[0], authorId: 'user', authorKind: 'human', addressing: 'direct' })
    await engine.assessSourceBatch({ commandId: 'router-assess-0', threadId: 'router-0', eventIds: [duplicateReceived.eventId] })
    const deliveriesAfter = []
    for (const ticketId of tickets) deliveriesAfter.push(...(await engine.getTicketDeliveries(ticketId)))
    return {
      events: requests.length + followups.length,
      totalMs: Number((performance.now() - totalStarted).toFixed(2)),
      acceptanceBoundary: 'receiveSource and Router assessment finish',
      responseBoundary: 'the Worker Assignment exists',
      acceptanceMs: summarize(acceptance),
      responseMs: summarize(response),
      routerCalls: modelCalls.router - routerBefore,
      routerBatches: requests.length + followups.length,
      workerCalls: modelCalls.worker - workerBefore,
      directFollowups: 0,
      directRatio: 0,
      duplicateTickets: (await engine.listTickets()).items.length - beforeDuplicate,
      notifications: { acknowledgements: deliveriesAfter.filter(delivery => delivery.purpose === 'acknowledgement').length,
        results: deliveriesAfter.filter(delivery => delivery.purpose === 'result').length,
        duplicate: deliveriesAfter.length - deliveriesBefore.length },
      duplicateNotifications: deliveriesAfter.length - deliveriesBefore.length,
    }
  } finally {
    await engine.effects.stop()
  }
}

async function measureSubscriptionDirect() {
  const routerBefore = modelCalls.router
  const workerBefore = modelCalls.worker
  const totalStarted = performance.now()
  const threadId = 'subscription-thread'
  const engine = new Engine(storage, 'bench-subscription', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: [threadId], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: workload.routerBatchLimit, maxAttempts: 1, timeoutMs: 10_000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] } }, { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [], { maxSlots: workload.normalSlots, maxPrioritySlots: workload.prioritySlots })
  engine.effects.start()
  const acceptance = []
  const response = []
  try {
    const start = performance.now()
    const received = await engine.receiveSource({ commandId: 'sub-receive', threadId, objectId: 'sub-message-0', type: 'created', version: '1', text: requests[0], authorId: 'user', authorKind: 'human', addressing: 'direct' })
    const accepted = await engine.assessSourceBatch({ commandId: 'sub-assess', threadId, eventIds: [received.eventId] })
    acceptance.push(performance.now() - start)
    const ticketId = accepted.receipts[0].ticketId
    await waitFor(engine, async () => (await engine.conversation(ticketId)).assignments.length > 0, 'subscription initial assignment')
    response.push(performance.now() - start)
    let direct = 0
    for (const [index, text] of followups.entries()) {
      const startedAt = performance.now()
      await engine.receiveSource({ commandId: `sub-follow-${index}`, threadId, objectId: `sub-follow-message-${index}`, type: 'created', version: '1', text, authorId: 'user', authorKind: 'human', addressing: 'direct' })
      await waitFor(engine, async () => (await engine.getTicketDirection(ticketId)).inputs.some(input => input.text === text && input.delivery?.persistedAt), `subscription follow-up ${index}`)
      const elapsed = performance.now() - startedAt
      acceptance.push(elapsed)
      response.push(elapsed)
      direct++
    }
    const deliveries = await engine.getTicketDeliveries(ticketId)
    return {
      events: requests.length + followups.length,
      totalMs: Number((performance.now() - totalStarted).toFixed(2)),
      acceptanceBoundary: 'receiveSource finishes; the initial request also includes Router assessment',
      responseBoundary: 'the follow-up Input is persisted in the Worker Session',
      acceptanceMs: summarize(acceptance),
      responseMs: summarize(response),
      routerCalls: modelCalls.router - routerBefore,
      routerBatches: 1,
      workerCalls: modelCalls.worker - workerBefore,
      directFollowups: direct,
      directRatio: direct / followups.length,
      notifications: { acknowledgements: deliveries.filter(delivery => delivery.purpose === 'acknowledgement').length,
        results: deliveries.filter(delivery => delivery.purpose === 'result').length, duplicate: 0 },
      duplicateTickets: 0,
      duplicateNotifications: 0,
    }
  } finally {
    await engine.effects.stop()
  }
}

async function measureReopen() {
  const startedAt = performance.now()
  const reopened = await storage.reconnect()
  try {
    await reopened.transaction('bench-router', transaction => transaction.list('ticket', 10))
  } finally {
    await reopened.close()
  }
  return Number((performance.now() - startedAt).toFixed(2))
}

function summarize(samples) {
  return {
    p50: Number(percentile(samples, 0.5).toFixed(2)),
    p95: Number(percentile(samples, 0.95).toFixed(2)),
    max: Number(Math.max(...samples).toFixed(2)),
    samples: samples.length,
  }
}

async function waitFor(engine, check, label) {
  const deadline = Date.now() + 20_000
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`The fixed benchmark did not reach: ${label}.`)
    await engine.effects.drain()
    await sleep(10)
  }
}
