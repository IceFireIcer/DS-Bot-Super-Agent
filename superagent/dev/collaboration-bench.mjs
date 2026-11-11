import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { Engine, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from './native-mock.mjs'

const stream = Object.freeze([
  ...Array.from({ length: 6 }, (_, index) => Object.freeze({ id: `event-0${index + 1}`, kind: 'initial', threadId: `thread-${index + 1}`,
    text: `event-0${index + 1}: inspect project ${index + 1}.` })),
  ...Array.from({ length: 6 }, (_, index) => {
    const id = `event-${String(index + 7).padStart(2, '0')}`
    return Object.freeze({ id, kind: 'followup', threadId: `thread-${index + 1}`, text: `${id}: update project ${index + 1}.` })
  }),
])
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const workload = Object.freeze({ seed: 20261111, initialRequests: 6, followups: 6, workerTurnMs: 20,
  routerBatchLimit: 20, normalSlots: 2, prioritySlots: 1, modeDeadlineMs: 25000,
  arrivalPolicy: 'canonical order, each event starts after the previous Worker turn settles; no concurrency throughput claim',
  routerWorkerBaseline: 'a scripted public NativeSessions Router forwarding tool precedes each follow-up intake; the production Engine subscription contract is unchanged',
  stream, digest: digest(stream) })
const modes = {}
for (const name of ['singleSession', 'routerWorker', 'subscriptionDirect']) modes[name] = await measureMode(name)
console.log(JSON.stringify({ schemaVersion: 2, workload,
  environment: { model: 'mock', provider: 'native-mock', node: process.version, platform: process.platform,
    tokenMeasurement: 'unavailable: the mock model reports no token usage', realModel: 'not run', remoteHost: 'not run', managedHost: 'not run' },
  modes,
  proactive: { status: 'not run' }, supervisor: { status: 'not run' },
  recovery: { status: 'not run: no crash or Host takeover in this workload; per-mode stateReopenMs is connection reopen only' },
}, null, 2))

async function measureMode(name) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-collaboration-bench-'))
  const state = { name, calls: { router: 0, worker: 0 }, routerInputs: new Set(), assessorInputs: new Set(),
    turns: [], notifications: [], tickets: new Map(), admissions: new Map(), activeTurns: 0 }
  try {
    state.context = await nativeContext(join(directory, 'sessions'), options => respond(state, options))
    state.storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
    state.sessions = new NativeSessions(state.context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' }, timeoutMs: 5000 })
    if (name !== 'singleSession') state.engine = new Engine(state.storage, `bench-${name}`, {
      sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: [...new Set(stream.map(event => event.threadId))], versionOrder: 'sequence',
      intake: { mode: 'auto', maxBatchSize: workload.routerBatchLimit, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
        rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
    }, { retryDelayMs: 10, scanIntervalMs: 20 }, state.sessions, [], { maxSlots: workload.normalSlots, maxPrioritySlots: workload.prioritySlots }, {}, {}, {
      channel: { deliver: async (delivery, context) => {
        state.notifications.push({ id: delivery.id, purpose: delivery.purpose, idempotencyKey: context.idempotencyKey })
        return { type: 'success' }
      } },
    })
    state.started = performance.now()
    state.deadline = state.started + workload.modeDeadlineMs
    const outcomes = []
    for (const event of stream) outcomes.push(await processEvent(state, event))
    await settle(state)
    const totalMs = performance.now() - state.started
    const observedEvents = state.turns.map(turn => turn.event)
    assert.deepEqual(observedEvents, stream, `${name} did not process exactly the canonical stream`)
    const snapshot = await observe(state)
    const before = { turns: state.turns.length, tickets: snapshot.tickets, notifications: state.notifications.length }
    const replayStarted = performance.now()
    if (state.engine) {
      for (const event of stream) {
        const received = await receive(state, event)
        if (event.kind === 'initial') await assess(state, event, received)
      }
      await settle(state)
    }
    const after = await observe(state)
    const duplicateNotifications = state.notifications.length - new Set(state.notifications.map(item => item.idempotencyKey)).size
    return {
      events: observedEvents.length, populationDigest: digest(observedEvents), totalMs,
      acceptanceBoundary: state.engine ? 'receiveSource returns its durable receipt (includes follow-up fan-out)' : 'NativeSessions onMessagePersisted confirms the user/message flush; no business acceptance receipt',
      responseBoundary: 'the scripted Worker emits its first text delta for this event',
      completionBoundary: 'NativeSessions is idle, persisted turn/end is completed, no Worker slot or active relay/outbox remains; turn completion, not Ticket ready/result',
      acceptanceMs: summarize(outcomes.map(outcome => outcome.acceptedAtMs - outcome.startedAtMs)),
      responseMs: summarize(outcomes.map(outcome => outcome.responseAtMs - outcome.startedAtMs)),
      completionMs: summarize(outcomes.map(outcome => outcome.completedAtMs - outcome.startedAtMs)),
      outcomes, routerCalls: state.calls.router, routerTurns: state.routerInputs.size, routerBatches: state.assessorInputs.size,
      intakeEvaluations: after.intakeEvaluations, workerCalls: state.calls.worker,
      settledTurns: outcomes.filter(outcome => outcome.status === 'completed').length, activeTurnsAtEnd: state.activeTurns,
      tickets: snapshot.tickets, directFollowups: outcomes.filter(outcome => outcome.route === 'subscription').length,
      directRatio: outcomes.filter(outcome => outcome.route === 'subscription').length / stream.filter(event => event.kind === 'followup').length,
      duplicateExecutions: before.turns - new Set(observedEvents.map(event => event.id)).size,
      notifications: { acknowledgement: state.notifications.filter(item => item.purpose === 'acknowledgement').length,
        result: state.notifications.filter(item => item.purpose === 'result').length, duplicate: duplicateNotifications,
        observed: state.notifications, ledger: after.deliveries },
      unknown: { effects: after.effects.filter(effect => effect.state === 'unknown').length, jobs: after.jobs.filter(job => job.state === 'unknown').length },
      replay: { status: state.engine ? 'all twelve source events replayed after timed completion' : 'not applicable: raw Session has no source-event deduplication contract',
        durationMs: performance.now() - replayStarted, duplicateExecutions: state.turns.length - before.turns,
        duplicateTickets: after.tickets - before.tickets, duplicateNotifications: state.notifications.length - before.notifications },
      stateReopenMs: await measureReopen(state),
    }
  } finally {
    await cleanup(state, directory)
  }
}

function respond(state, options) {
  if (options.model === 'router') {
    state.calls.router++
    const latest = options.messages.filter(message => message.role === 'user').at(-1)
    state.routerInputs.add(`${options.sessionId}:${latest.id}`)
    const text = latest.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const after = options.messages.slice(options.messages.lastIndexOf(latest) + 1)
    if (options.tools?.some(tool => tool.name === 'forward_event')) return after.some(message => message.role === 'tool')
      ? textResponse('Event forwarded.') : toolResponse('forward_event', {})
    if (options.tools?.some(tool => tool.name === 'record_batch_assessment')) {
      state.assessorInputs.add(`${options.sessionId}:${latest.id}`)
      return after.some(message => message.role === 'tool') ? textResponse('Assessment recorded.')
        : toolResponse('record_batch_assessment', { results: JSON.stringify(JSON.parse(text.split('Candidates JSON: ').at(-1))
          .map(event => ({ eventId: event.eventId, outcome: 'accept', reason: 'Fixed mock request.', evidence: 'Canonical benchmark event.' }))) })
    }
    return routerResponse(options)
  }
  return (async function* () {
    state.calls.worker++
    state.activeTurns++
    try {
      const user = options.messages.filter(message => message.role === 'user').at(-1)
      const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const event = stream.find(candidate => candidate.text === text)
      assert.ok(event, 'Worker received a noncanonical or rewritten input')
      const turn = { event, sessionId: options.sessionId, output: `Handled ${event.id}.` }
      state.turns.push(turn)
      await admitted(state.admissions.get(event.id), options.signal)
      await sleep(workload.workerTurnMs, undefined, { signal: options.signal })
      turn.responseAt = performance.now()
      yield* textResponse(turn.output)
    } finally { state.activeTurns-- }
  })()
}

async function processEvent(state, event) {
  const started = performance.now()
  let acceptedAt
  let admit
  state.admissions.set(event.id, new Promise(resolve => { admit = resolve }))
  const accept = () => { acceptedAt = performance.now(); admit() }
  let route = 'session'
  if (!state.engine) {
    const result = await state.sessions.run({ sessionId: `${state.name}-session`, role: 'worker', text: event.text, messageId: event.id,
      tools: [], onMessagePersisted: async () => { accept() } })
    assert.equal(result.status, 'idle')
  } else {
    const forward = async () => {
      const received = await receive(state, event)
      accept()
      if (event.kind === 'initial') {
        const assessed = await assess(state, event, received)
        assert.ok(assessed.receipts[0]?.ticketId, 'Initial event was not accepted')
        state.tickets.set(event.threadId, assessed.receipts[0].ticketId)
      }
      return 'Canonical event forwarded unchanged.'
    }
    if (state.name === 'routerWorker' && event.kind === 'followup') {
      route = 'router-forward'
      // Preserve Thread identity: this baseline adds only a public Router turn
      // before the same intake, without bypassing production subscriptions.
      await state.sessions.run({ sessionId: state.sessions.routerSessionId, role: 'router', text: JSON.stringify(event), tools: [{ name: 'forward_event',
        description: 'Forward this exact canonical follow-up to its original Thread once.', parameters: {}, execute: forward }] })
    } else {
      route = event.kind === 'followup' ? 'subscription' : 'router-assign'
      await forward()
    }
  }
  await waitFor(state, async () => state.turns.some(turn => turn.event.id === event.id && turn.responseAt !== undefined), `Worker response for ${event.id}`)
  await settle(state)
  const turns = state.turns.filter(turn => turn.event.id === event.id)
  assert.equal(turns.length, 1, `Repeated execution of ${event.id}`)
  const turn = turns[0]
  const events = await sessionEvents(state.sessions, turn.sessionId)
  const input = events.find(candidate => candidate.type === 'user/message' && candidate.data?.content?.some(block => block.type === 'text' && block.text === event.text))
  assert.ok(input, `No durable input for ${event.id}`)
  const end = events.find(candidate => Number(candidate.seq) > Number(input.seq) && candidate.type === 'turn/end')
  assert.equal(end?.data?.reason?.kind, 'completed', `No completed durable turn for ${event.id}`)
  const output = events.find(candidate => Number(candidate.seq) > Number(input.seq) && Number(candidate.seq) < Number(end.seq)
    && candidate.type === 'assistant/message' && candidate.data?.message?.content?.some(block => block.type === 'text' && block.text === turn.output))
  assert.ok(output, `No durable Worker output for ${event.id}`)
  assert.ok(!state.sessions.agentOf(turn.sessionId), `Worker ${event.id} still active`)
  return { eventId: event.id, threadId: event.threadId, inputDigest: digest(event), sessionId: turn.sessionId, route,
    ...(state.engine ? { ticketId: state.tickets.get(event.threadId) } : {}),
    status: 'completed', output: turn.output, persistedInputSeq: Number(input.seq), persistedOutputSeq: Number(output.seq), persistedTurnEndSeq: Number(end.seq),
    startedAtMs: started - state.started, acceptedAtMs: acceptedAt - state.started, responseAtMs: turn.responseAt - state.started, completedAtMs: performance.now() - state.started }
}

async function admitted(promise, signal) {
  assert.ok(promise, 'Worker has no matching source admission')
  signal?.throwIfAborted()
  let abort
  const aborted = new Promise((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
  })
  try { await Promise.race([promise, aborted]) } finally { signal?.removeEventListener('abort', abort) }
}

function receive(state, event) {
  return state.engine.receiveSource({ commandId: `receive-${event.id}`, threadId: event.threadId, objectId: event.id, type: 'created', version: '1',
    text: event.text, authorId: 'user', authorKind: 'human', addressing: 'direct' })
}

function assess(state, event, received) {
  return state.engine.assessSourceBatch({ commandId: `assess-${event.id}`, threadId: event.threadId, eventIds: [received.eventId] })
}

async function settle(state) {
  await waitFor(state, async () => {
    if (state.activeTurns || state.turns.some(turn => state.sessions.agentOf(turn.sessionId))) return false
    if (!state.engine) return true
    const slots = await state.engine.listSlots()
    const effects = await listEffects(state.engine)
    return slots.holding.length === 0 && slots.waiting.length === 0 && effects.length === 0
  }, 'all Worker turns, slots and Effects to settle')
}

async function waitFor(state, check, label) {
  while (!await check()) {
    if (performance.now() > state.deadline) throw new Error(`${state.name}: deadline waiting for ${label}`)
    if (state.engine) await state.engine.effects.drain()
    await sleep(5)
  }
}

async function listEffects(engine) {
  const items = []
  let cursor
  for (let page = 0; page < 10; page++) {
    const result = await engine.effects.list(cursor)
    items.push(...result.items)
    cursor = result.cursor
    if (!cursor) return items
  }
  throw new Error('Benchmark Effect pagination exceeded its ten-page budget')
}

async function sessionEvents(sessions, sessionId) {
  const events = []
  let cursor
  for (let page = 0; page < 20; page++) {
    const result = await sessions.readSession(sessionId, { limit: 100, ...(cursor === undefined ? {} : { after: cursor }) })
    events.push(...result.events)
    cursor = result.cursor
    if (cursor === undefined) return events
  }
  throw new Error('Benchmark Session pagination exceeded its twenty-page budget')
}

async function observe(state) {
  if (!state.engine) return { tickets: state.tickets.size, intakeEvaluations: [], effects: [], jobs: [], deliveries: [] }
  const tickets = await state.engine.listTickets()
  assert.equal(tickets.cursor, undefined, 'Benchmark ticket page exceeded its budget')
  const jobs = []
  const deliveries = []
  for (const ticketId of state.tickets.values()) {
    jobs.push(...await state.engine.listJobs(ticketId))
    deliveries.push(...(await state.engine.getTicketDeliveries(ticketId)).map(delivery => ({ id: delivery.id, purpose: delivery.purpose, state: delivery.state })))
  }
  const evaluations = []
  for (const threadId of state.tickets.keys()) evaluations.push(...(await state.engine.listEvaluations(threadId)).items)
  return { tickets: tickets.items.length, intakeEvaluations: evaluations.map(evaluation => ({ id: evaluation.id, threadId: evaluation.threadId, state: evaluation.state })),
    effects: await listEffects(state.engine), jobs, deliveries }
}

async function cleanup(state, directory) {
  const failures = []
  for (const release of [() => state.engine?.effects.stop(), () => state.engine?.shutdown(), () => state.sessions?.close(),
    () => state.context?.fiber.dispose(), () => state.storage?.close(), () => rm(directory, { recursive: true, force: true })]) {
    try { await release() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Benchmark cleanup failed')
}

async function measureReopen(state) {
  const started = performance.now()
  const reopened = await state.storage.reconnect()
  try { await reopened.transaction(`bench-${state.name}`, transaction => transaction.list('ticket', 20)) } finally { await reopened.close() }
  return performance.now() - started
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  return { p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1), samples: samples.length }
}
