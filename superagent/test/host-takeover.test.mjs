import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }
const stopHeadKey = ticketId => JSON.stringify(['stop-head', ticketId])
const digest = value => createHash('sha256').update(value).digest('hex')

async function openRuntime(directory, options = {}) {
  const { hostId, leaseMs = 100, now = () => Date.now(), allowedActorIds = ['user'], workerTurns = [], environments = [] } = options
  const native = await nativeContext(join(directory, `sessions-${hostId ?? 'default'}`), response => {
    const user = response.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = response.messages.slice(response.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (response.model === 'worker') {
      workerTurns.push(text)
      if (text.includes('Host was replaced')) return textResponse('Recovered.')
      return completed ? textResponse('Recorded.') : textResponse('First turn completed without a ready report.')
    }
    const tool = response.tools[completed]
    if (!tool) return textResponse('Router complete.')
    if (tool.name.startsWith('deliver_result')) {
      const ready = JSON.parse(text.slice('Ready report:'.length))
      return toolResponse(tool.name, { reportId: ready.id }, `router-${completed}`)
    }
    return toolResponse(tool.name, {}, `router-${completed}`)
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { ...source, allowedActorIds }, {}, sessions, environments,
    {}, {}, {}, {}, { hostId, leaseMs, now })
  return { engine, storage, sessions, native, hostId,
    async close() {
      await engine.effects.stop().catch(() => {})
      await engine.shutdown().catch(() => {})
      await sessions.close().catch(() => {})
      await native.fiber.dispose().catch(() => {})
      await storage.close().catch(() => {})
    } }
}

async function settle(engine, turns = 8) {
  for (let index = 0; index < turns; index++) await engine.effects.drain()
}

async function readyTicket(runtime, text = 'Finish the original request.') {
  const receipt = await runtime.engine.submit({ commandId: `submit-${randomUUID()}`, eventId: `event-${randomUUID()}`, text })
  await settle(runtime.engine)
  const conversation = await runtime.engine.conversation(receipt.ticketId)
  assert.equal(conversation.assignments.length, 1, JSON.stringify(conversation))
  return { receipt, conversation, assignment: conversation.assignments[0] }
}

async function markPriorTurn(runtime, ticketId) {
  await runtime.storage.transaction('private', async transaction => {
    const assignment = await transaction.get('assignment', ticketId)
    await transaction.replace('assignment', ticketId, { ...assignment, state: 'running', runtimeToken: 'prior-host-runtime' })
    const intent = await transaction.get('intent', ticketId)
    await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-running' })
  })
}

function remoteEnvironment(root, job) {
  const observation = { deviceId: 'device-replacement', deviceIncarnation: 'incarnation-one', actorId: 'user' }
  const environment = {
    kind: 'remote',
    config: { id: 'remote-project', instanceId: 'private', root, allowedActorIds: ['user'],
      permissions: ['read', 'write', 'search', 'command'], commands: {} },
    deviceId: observation.deviceId,
    deviceIncarnation: observation.deviceIncarnation,
    online: true,
    probe: async () => ({ online: true, root, version: 'replacement-v1', fingerprint: 'device-replacement:incarnation-one',
      capabilities: ['read', 'write', 'search', 'command'], capacity: { active: 0, max: 8 } }),
    authorize() {},
    prepare: async () => ({
      cwd: root,
      invoke: async () => ({}),
      artifact: async () => ({ path: 'replacement.txt', bytes: 0, sha256: '0'.repeat(64) }),
      sanitize: value => value,
      inspectRange: async jobId => ({ jobId, state: job.state ?? 'running', settled: false, cancelled: false,
        ownerId: 'user', deadlineAt: Date.now() + 60000, exitCode: null, signal: null,
        stdout: { text: '', nextOffset: 0, lossy: false }, stderr: { text: '', nextOffset: 0, lossy: false } }),
      attachCommand: async () => job,
    }),
    close: async () => {},
  }
  return { environment, observation }
}

test('a legal Host takeover ends the previous Assignment and resumes with a recovery note', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-'))
  let now = 1000
  const workerTurns = []
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now, workerTurns })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })

  const { receipt, assignment: previous } = await readyTicket(first)
  await markPriorTurn(first, receipt.ticketId)

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now, workerTurns })
  runtimes.push(second)
  const lease = await second.engine.acquireHost()
  assert.equal(lease.epoch, 2)

  const takeover = await second.engine.getHostTakeover()
  assert.equal(takeover.epoch, 2)
  assert.equal(takeover.previousHostId, 'host-a')
  assert.equal(takeover.state, 'completed')
  assert.equal(takeover.tickets.length, 1)
  assert.equal(takeover.tickets[0].outcome, 'resumed')
  assert.equal(takeover.tickets[0].previousAssignmentId, previous.id)

  const continued = await second.engine.conversation(receipt.ticketId)
  const successor = continued.assignments[0]
  assert.notEqual(successor.id, previous.id)
  assert.notEqual(successor.generation, previous.generation)
  assert.equal(successor.sessionId, previous.sessionId)
  assert.deepEqual(successor.environment, previous.environment)
  assert.equal(successor.state, 'pending')
  assert.equal(successor.recovery.reason, 'HOST_REPLACED')
  assert.equal(successor.recovery.previousAssignmentId, previous.id)
  assert.equal(successor.recovery.takeoverId, takeover.id)
  assert.equal(continued.assignmentHistory.some(item => item.id === previous.id), true)

  await assert.rejects(first.engine.getTicket(receipt.ticketId), { code: 'HOST_LEASED' })
  await assert.rejects(first.engine.submit({ commandId: 'old-host-new-work', eventId: 'old-host-new-work', text: 'Old Host writes.' }), { code: 'HOST_LEASED' })
  await assert.rejects(first.engine.reconcileRemoteWork({ commandId: 'old-host-reconcile' }), { code: 'HOST_LEASED' })

  const resurrected = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now })
  runtimes.push(resurrected)
  await assert.rejects(resurrected.engine.getTicket(receipt.ticketId), { code: 'HOST_LEASED' })
  await assert.rejects(resurrected.engine.conversation(receipt.ticketId), { code: 'HOST_LEASED' })

  await settle(second.engine)
  assert.equal(workerTurns.some(text => text.includes('Host was replaced')), true, JSON.stringify(workerTurns))
  assert.match(workerTurns.find(text => text.includes('Host was replaced')), /reconcile each external action by its original ID/u)
  const final = await second.engine.conversation(receipt.ticketId)
  assert.equal(final.assignments[0].id, successor.id)
  assert.equal(final.assignments[0].state, 'running')
})

test('a Host takeover preserves an unconfirmed stop and does not create a successor', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-stop-'))
  let now = 1000
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })
  const { receipt, assignment: previous } = await readyTicket(first)
  await first.storage.transaction('private', async transaction => {
    const stop = { id: `${JSON.stringify(['stop', receipt.ticketId])}:prior`, instanceId: 'private', ticketId: receipt.ticketId,
      state: 'stopping', requestedAt: now, requestedBy: 'user', reason: 'A person stopped it.', runtimeToken: 'prior-host-runtime' }
    await transaction.insert('stop-state', stop.id, stop)
    await transaction.insert('stop-head', stopHeadKey(receipt.ticketId), { stopId: stop.id })
    const assignment = await transaction.get('assignment', receipt.ticketId)
    await transaction.replace('assignment', receipt.ticketId, { ...assignment, state: 'running', runtimeToken: 'prior-host-runtime' })
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-running' })
  })

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now })
  runtimes.push(second)
  await second.engine.acquireHost()
  const takeover = await second.engine.getHostTakeover()
  assert.equal(takeover.tickets[0].outcome, 'stopped')

  const stopped = await second.engine.conversation(receipt.ticketId)
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.stop.recoveryReason, 'HOST_REPLACED')
  assert.equal(stopped.stop.cancellationConfirmedAt, undefined)
  assert.equal(stopped.assignments[0].id, previous.id)
  assert.equal(stopped.assignments[0].state, 'ended')
  assert.equal(stopped.assignmentHistory.length, 1)
  await assert.rejects(second.engine.resumeTicket({ commandId: 'resume-after-takeover', ticketId: receipt.ticketId }),
    { code: 'CANCELLATION_UNCONFIRMED' })
})

test('a Host takeover preserves a waiting human question and lets the answer continue the work', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-waiting-'))
  let now = 1000
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })
  const { receipt, assignment: previous } = await readyTicket(first)
  const attentionId = `${JSON.stringify(['attention', receipt.ticketId])}:prior`
  await first.storage.transaction('private', async transaction => {
    const attention = { id: attentionId, instanceId: 'private', ticketId: receipt.ticketId, assignmentId: previous.id,
      sessionId: previous.sessionId, question: 'Which branch should this continue on?', options: ['main', 'release'],
      destination: { sourceInstanceId: 'desktop', actorId: 'user', eventId: receipt.ticketId },
      status: 'waiting', sequence: 1, createdAt: now }
    await transaction.insert('attention', attentionId, attention)
    await transaction.insert('attention-head', JSON.stringify(['attention-head', receipt.ticketId]), { attentionId })
    const ticket = await transaction.get('ticket', receipt.ticketId)
    await transaction.replace('ticket', receipt.ticketId, { ...ticket, constraint: { kind: 'waiting-human', attentionId, reason: attention.question } })
    const assignment = await transaction.get('assignment', receipt.ticketId)
    await transaction.replace('assignment', receipt.ticketId, { ...assignment, state: 'running', runtimeToken: 'prior-host-runtime' })
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'pending', reason: 'waiting-human' })
  })

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now })
  runtimes.push(second)
  await second.engine.acquireHost()
  const takeover = await second.engine.getHostTakeover()
  assert.equal(takeover.tickets[0].outcome, 'waiting-human')

  const waiting = await second.engine.conversation(receipt.ticketId)
  assert.equal(waiting.status, 'waiting-human')
  assert.equal(waiting.attention.id, attentionId)
  assert.equal(waiting.attention.status, 'waiting')
  assert.equal(waiting.assignments[0].id, previous.id)
  assert.equal(waiting.assignments[0].state, 'ended')
  assert.equal(waiting.assignmentHistory.length, 1)

  await second.engine.answerAttention({ commandId: 'answer-after-takeover', attentionId, text: 'Continue on main.' })
  await settle(second.engine)
  const answered = await second.engine.conversation(receipt.ticketId)
  assert.equal(answered.attention.status, 'answered')
  assert.equal((await second.engine.getTicket(receipt.ticketId)).ticket.constraint, undefined)
  assert.notEqual(answered.assignments[0].id, previous.id)
})

test('unknown jobs and effects block the successor before a conflicting turn can start', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-unknown-'))
  let now = 1000
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })
  const { receipt, assignment: previous } = await readyTicket(first)
  await first.storage.transaction('private', async transaction => {
    await transaction.insert('job', `${JSON.stringify(['job', receipt.ticketId])}:prior-job`, {
      id: 'prior-job', ticketId: receipt.ticketId, assignmentId: previous.id, generation: previous.generation,
      environmentId: 'project', environmentKind: 'local', command: 'build', state: 'running', startedAt: now, runtimeToken: 'prior-host-runtime',
    })
    await transaction.insert('effect', 'prior-unknown-effect', {
      key: 'prior-unknown-effect', stream: 'relay', scope: receipt.ticketId, payload: { ticketId: receipt.ticketId },
      id: 'prior-unknown-effect', generation: 'prior-unknown-effect', queueKey: '9999999999999999', state: 'unknown', attempts: 1, availableAt: now,
    })
    const assignment = await transaction.get('assignment', receipt.ticketId)
    await transaction.replace('assignment', receipt.ticketId, { ...assignment, state: 'running', runtimeToken: 'prior-host-runtime' })
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-running' })
  })

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now })
  runtimes.push(second)
  await second.engine.acquireHost()
  const takeover = await second.engine.getHostTakeover()
  assert.equal(takeover.tickets[0].outcome, 'blocked')
  assert.deepEqual(takeover.tickets[0].blockers.map(blocker => blocker.code).sort(), ['unknown-effect', 'unknown-job'])

  const blocked = await second.engine.conversation(receipt.ticketId)
  assert.equal(blocked.status, 'waiting-human')
  assert.equal(blocked.attention.status, 'waiting')
  assert.match(blocked.attention.question, /previous Host could not prove/u)
  assert.deepEqual(blocked.attention.options, ['Keep it unknown', 'Recheck and continue', 'Stop the work'])
  assert.equal(blocked.assignments[0].id, previous.id)
  assert.equal(blocked.assignments[0].state, 'ended')
  assert.equal(blocked.assignmentHistory.length, 1)
  assert.equal(blocked.jobs[0].state, 'unknown')
  await settle(second.engine)
  assert.equal((await second.engine.conversation(receipt.ticketId)).assignmentHistory.length, 1,
    'no successor may run while the previous external work is unknown')

  await second.engine.answerAttention({ commandId: 'keep-unknown', attentionId: blocked.attention.id,
    text: 'Keep it unknown and continue without touching it.' })
  await settle(second.engine)
  const answered = await second.engine.conversation(receipt.ticketId)
  assert.equal(answered.attention.status, 'answered')
  assert.equal((await second.engine.getTicket(receipt.ticketId)).ticket.constraint, undefined)
  assert.notEqual(answered.assignments[0].id, previous.id)
})

test('a live remote job is adopted and rebound to the successor Assignment, then wakes it', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-live-job-'))
  const root = join(directory, 'device')
  await mkdir(root)
  let now = 1000
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const job = { jobId: 'live-job', state: 'running', done,
    read: () => ({ stdout: { text: 'partial output', lossy: false }, stderr: { text: '', lossy: false } }),
    terminate: () => finish({ exitCode: null, cancelled: true, truncated: false, settled: true }),
    waitForExit: async () => true }
  const { environment } = remoteEnvironment(root, job)
  const workerTurns = []
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now, workerTurns, environments: [environment] })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })
  const receipt = await first.engine.submit({ commandId: 'submit-live', eventId: 'submit-live', text: 'Start a device job.', environmentId: 'remote-project', target: 'remote-only' })
  await settle(first.engine)
  const initial = await first.engine.conversation(receipt.ticketId)
  assert.equal(initial.assignments.length, 1, JSON.stringify(initial))
  const previous = initial.assignments[0]
  await first.storage.transaction('private', async transaction => {
    await transaction.insert('job', `${JSON.stringify(['job', receipt.ticketId])}:live-job`, {
      id: 'live-job', ticketId: receipt.ticketId, assignmentId: previous.id, generation: previous.generation,
      environmentId: 'remote-project', environmentKind: 'remote', command: 'hold', state: 'running', startedAt: now,
      runtimeToken: 'prior-host-runtime', remote: { deviceId: 'device-replacement', deviceIncarnation: 'incarnation-one', actorId: 'user' },
    })
    await transaction.insert('remote-job', `${JSON.stringify(['remote-job', receipt.ticketId])}:live-job`, { ticketId: receipt.ticketId, jobId: 'live-job' })
    const assignment = await transaction.get('assignment', receipt.ticketId)
    await transaction.replace('assignment', receipt.ticketId, { ...assignment, state: 'running', runtimeToken: 'prior-host-runtime' })
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-background' })
  })

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now, workerTurns, environments: [environment] })
  runtimes.push(second)
  await second.engine.acquireHost()
  const takeover = await second.engine.getHostTakeover()
  assert.equal(takeover.tickets[0].outcome, 'waiting-job')

  const waiting = await second.engine.conversation(receipt.ticketId)
  const successor = waiting.assignments[0]
  assert.notEqual(successor.id, previous.id)
  assert.equal(successor.state, 'running')
  assert.equal(successor.recovery.reason, 'HOST_REPLACED')
  assert.equal(successor.recovery.previousAssignmentId, previous.id)
  assert.equal(waiting.reason, 'worker-background')
  const jobs = await second.engine.listJobs(receipt.ticketId)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'live-job')
  assert.equal(jobs[0].assignmentId, successor.id)
  assert.equal(jobs[0].state, 'running')

  finish({ exitCode: 0, cancelled: false, truncated: false, settled: true })
  await settle(second.engine, 12)
  const finished = await second.engine.listJobs(receipt.ticketId)
  assert.equal(finished[0].state, 'exited')
  assert.equal(finished[0].exitCode, 0)
  const continued = await second.engine.conversation(receipt.ticketId)
  assert.equal(continued.assignments[0].id, successor.id)
  assert.equal(workerTurns.some(text => text.includes('Background job live-job')), true, JSON.stringify(workerTurns))
})

test('a queued person follow-up waits for takeover and is delivered exactly once', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-input-'))
  let now = 1000
  const workerTurns = []
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now, workerTurns })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })
  const { receipt, assignment: previous } = await readyTicket(first)
  const inputId = 'prior-queued-input'
  const eventId = 'prior-follow-up-event'
  await first.storage.transaction('private', async transaction => {
    const input = { id: inputId, instanceId: 'private', ticketId: receipt.ticketId, sourceEventId: eventId, threadId: 'desktop',
      objectId: 'prior-follow-up', text: 'A person queued this follow-up.', authorId: 'user', ownership: 'worker',
      directionVersion: 2, state: 'pending', receivedAt: now }
    const ownershipId = `${JSON.stringify(['work-ownership', receipt.ticketId])}:${digest(eventId)}`
    await transaction.insert('work-input', inputId, input)
    await transaction.insert('pending-input', `${JSON.stringify(['pending-input', receipt.ticketId])}:${digest(inputId)}`,
      { ticketId: receipt.ticketId, inputId })
    await transaction.insert('work-ownership', ownershipId, { id: ownershipId, instanceId: 'private', ticketId: receipt.ticketId,
      sourceEventId: eventId, inputId, subscriptionId: 'prior-subscription', state: 'owned', basis: 'fanout', assignedAt: now })
    const ticket = await transaction.get('ticket', receipt.ticketId)
    await transaction.replace('ticket', receipt.ticketId, { ...ticket, directionVersion: 2 })
    const assignment = await transaction.get('assignment', receipt.ticketId)
    await transaction.replace('assignment', receipt.ticketId, { ...assignment, state: 'running', runtimeToken: 'prior-host-runtime' })
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-running' })
  })

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now, workerTurns })
  runtimes.push(second)
  await second.engine.acquireHost()
  const takeover = await second.engine.getHostTakeover()
  assert.equal(takeover.tickets[0].outcome, 'input-pending')
  const waiting = await second.engine.conversation(receipt.ticketId)
  assert.equal(waiting.reason, 'followup-pending')
  assert.equal(waiting.assignments[0].id, previous.id)
  assert.equal(waiting.assignments[0].state, 'ended')
  assert.equal(waiting.assignmentHistory.length, 1)

  let direction
  for (let attempt = 0; attempt < 300; attempt++) {
    await second.engine.effects.drain()
    direction = await second.engine.getTicketDirection(receipt.ticketId)
    if (direction.inputs[0]?.delivery?.persistedAt !== undefined) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const delivered = await second.engine.conversation(receipt.ticketId)
  assert.equal(direction.inputs[0].delivery.persistedAt !== undefined, true, JSON.stringify({ direction, delivered, workerTurns }))
  assert.equal(direction.inputs[0].delivery.persistedMessageId, direction.inputs[0].delivery.messageId)
  assert.notEqual(delivered.assignments[0].id, previous.id)
  assert.equal(delivered.assignments[0].sessionId, previous.sessionId)
  assert.equal(workerTurns.filter(text => text.includes('A person queued this follow-up.')).length, 1, JSON.stringify(workerTurns))
})

test('a pending takeover blocks new work and a repeated acquisition finishes the same record', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-takeover-pending-'))
  let now = 1000
  const first = await openRuntime(directory, { hostId: 'host-a', leaseMs: 100, now: () => now })
  const runtimes = [first]
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }) })
  const commandId = 'original-command'
  const eventId = 'original-event'
  const receipt = await first.engine.submit({ commandId, eventId, text: 'Finish the original request.' })
  await settle(first.engine)
  const previous = (await first.engine.conversation(receipt.ticketId)).assignments[0]
  assert.equal(previous.state, 'running')
  await markPriorTurn(first, receipt.ticketId)

  now += 200
  const second = await openRuntime(directory, { hostId: 'host-b', leaseMs: 100, now: () => now })
  runtimes.push(second)
  await second.engine.acquireHost()
  const completed = await second.engine.getHostTakeover()
  assert.equal(completed.state, 'completed')

  // A crash after the epoch advanced but before reconciliation finished leaves a pending record behind.
  await second.storage.transaction('private', transaction => transaction.replace('host-takeover', completed.id,
    { ...completed, state: 'pending', completedAt: undefined, tickets: [] }))
  await assert.rejects(second.engine.submit({ commandId: 'blocked-new-work', eventId: 'blocked-new-work', text: 'New Host work.' }),
    { code: 'HOST_TAKEOVER_PENDING' })
  const replay = await second.engine.submit({ commandId, eventId, text: 'Finish the original request.' })
  assert.deepEqual(replay, receipt)

  const finished = await second.engine.acquireHost()
  assert.equal(finished.epoch, 2)
  assert.equal((await second.engine.getHostTakeover()).state, 'completed')
  const continued = await second.engine.conversation(receipt.ticketId)
  assert.equal(continued.assignments.length, 1)
  assert.equal(continued.assignments[0].recovery.previousAssignmentId, previous.id)
  assert.equal(continued.assignmentHistory.filter(item => item.id === previous.id).length, 1)
  const accepted = await second.engine.submit({ commandId: 'after-takeover', eventId: 'after-takeover', text: 'New Host work.' })
  assert.equal(accepted.status, 'pending')
})
