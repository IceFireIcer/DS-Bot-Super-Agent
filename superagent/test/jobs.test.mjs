import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`)
    await sleep(20)
  }
}

function workerText(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  return user.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function toolCount(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  return options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
}

// The scripted Worker calls the next tool of its plan until the plan is exhausted, then stops with plain text.
// A plan may name the job the model just learned about as 'LATEST', exactly as a model would reuse the ID it read.
function scripted(plan) {
  return function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const text = workerText(options)
    const steps = plan(text)
    const done = toolCount(options)
    if (steps === undefined) { yield* textResponse('No plan for this prompt.'); return }
    const next = steps[done]
    if (!next) { yield* textResponse('Turn complete.'); return }
    yield* toolResponse(next[0], resolveLatest(options, next[1]), `call-${done}`)
  }
}

function resolveLatest(options, args) {
  if (!Object.values(args).includes('LATEST')) return args
  const toolTexts = options.messages.filter(message => message.role === 'tool')
    .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  const latest = [...toolTexts].reverse().map(text => text.match(/"jobId":"([^"]+)"/u)?.[1]).find(Boolean)
  if (!latest) throw new Error('The scripted plan referenced a job ID before the model had learned one.')
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, value === 'LATEST' ? latest : value]))
}

async function fixture(t, { commands, plan, slots = {}, jobs = {}, source = {} }) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-jobs-'))
  const root = join(directory, 'work')
  await mkdir(root)
  let environment, native, storage, sessions, engine
  t.after(async () => {
    engine?.shutdown()
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close(); await environment?.close()
    await rm(directory, { recursive: true, force: true })
  })
  environment = await core.LocalEnvironment.open({ id: 'project', instanceId: 'private', root, allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], commands })
  native = await nativeContext(join(directory, 'sessions'), scripted(plan))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], ...source },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [environment], slots, jobs)
  engine.effects.start()
  const accept = async (threadId, objectId, text, environmentId = 'project') => {
    const received = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text })
    return (await engine.acceptSource({ commandId: `accept-${objectId}`, threadId, objectId, expectedEventId: received.eventId, ...(environmentId ? { environmentId } : {}) })).ticketId
  }
  return { engine, accept, root, directory, storage }
}

// A long command that publishes a marker file, then exits only when the test writes the release file.
const longCommand = (timeoutMs = 5000) => ({ argv: [process.execPath, '-e',
  "const fs=require('node:fs');fs.writeFileSync('job-started.txt','started');setInterval(()=>{if(fs.existsSync('job-done.txt')){console.log('finished');process.exit(0)}},25)"],
  timeoutMs, backgroundTimeoutMs: 120000 })

test('a long command starts asynchronously, the turn ends at once, and the completion returns to the same Worker', { timeout: 40000 }, async t => {
  const prompts = []
  const { engine, accept, root } = await fixture(t, {
    commands: { build: longCommand(), verify: { argv: [process.execPath, '-e', "console.log('ok')"], timeoutMs: 2000 } },
    source: { allowedThreadIds: ['room', 'other'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Run the long build.')) { prompts.push(text); return [['start_command', { name: 'build' }]] }
  if (text.startsWith('Background job ')) { prompts.push(text); return [] }
      if (text.startsWith('Unrelated request.')) return [
        ['write_file', { path: 'independent.txt', text: 'done\n' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Independent result.', evidence: 'Wrote and verified independent.txt.', artifacts: 'independent.txt' }],
      ]
      return undefined
    },
  })
  const ticketId = await accept('room', 'room-1', 'Run the long build.')
  // The starting turn returns while the process is still running, so the Ticket is neither idle nor finished.
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  const [started] = await engine.listJobs(ticketId)
  assert.equal(started.state, 'running')
  assert.equal(started.command, 'build')
  assert.equal(started.settled, false)
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end with a running job')
  assert.deepEqual((await engine.listSlots()).holding.map(slot => slot.ticketId), [ticketId])
  assert.equal((await engine.conversation(ticketId)).reports.length, 0)

  // A new person's request in another Thread is accepted and completed while the build still runs.
  const independent = await accept('other', 'other-1', 'Unrelated request.')
  await until(async () => (await engine.conversation(independent)).status === 'ready', 'the independent result')
  assert.equal((await engine.getJob(ticketId, started.id)).state, 'running')

  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, 'job-done.txt'), 'go')
  await until(async () => (await engine.getJob(ticketId, started.id)).settled, 'the job exit')
  const finished = await engine.getJob(ticketId, started.id)
  assert.equal(finished.state, 'exited')
  assert.equal(finished.exitCode, 0)
  assert.equal(finished.succeeded, true)
  assert.match(finished.output.stdout.text, /finished/u)
  // The completion is a fact handed back to the Worker that started it, not a result on its own.
  await until(async () => prompts.some(text => text.startsWith('Background job ')), 'the completion event')
  const event = prompts.find(text => text.startsWith('Background job '))
  assert.match(event, new RegExp(started.id, 'u'))
  assert.match(event, /exit code 0/u)
  assert.match(await readFile(join(root, 'job-started.txt'), 'utf8'), /started/u)
  assert.equal((await engine.conversation(ticketId)).reports.length, 0)
})

test('background work keeps its slot, so a new launch still respects the declared budget', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    commands: { build: longCommand() },
    slots: { maxSlots: 1 },
    source: { allowedThreadIds: ['room', 'second'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Start a long build.')) return [['start_command', { name: 'build' }]]
      if (text.startsWith('Second request.')) return []
      return undefined
    },
  })
  const ticketId = await accept('room', 'room-1', 'Start a long build.')
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end with a running job')
  // The running job still holds the only normal slot, so an unrelated launch has to wait.
  const second = await accept('second', 'second-1', 'Second request.')
  await until(async () => (await engine.conversation(second)).reason === 'slot-queued', 'the second launch to queue')
  const snapshot = await engine.listSlots()
  assert.deepEqual(snapshot.holding.map(slot => slot.ticketId), [ticketId])
  assert.deepEqual(snapshot.waiting.map(slot => [slot.ticketId, slot.waitingReason]), [[second, 'SLOTS_FULL']])
})

test('a completion of an earlier Assignment generation cannot wake the current one', { timeout: 40000 }, async t => {
  const prompts = []
  const { engine, accept, storage } = await fixture(t, {
    commands: { build: longCommand() },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Start a long build.')) return [['start_command', { name: 'build' }]]
      if (!text.startsWith('Continue after resume.')) prompts.push(text)
      return []
    },
  })
  const ticketId = await accept('room', 'room-1', 'Start a long build.')
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  const [job] = await engine.listJobs(ticketId)
  await engine.stopTicket({ commandId: 'stop-before-resume', ticketId, reason: 'Restart the work.' })
  await engine.resumeTicket({ commandId: 'resume-work', ticketId })
  const replacement = await engine.conversation(ticketId)
  assert.notEqual(replacement.assignments[0].id, job.assignmentId)
  assert.equal(replacement.jobs[0].state, 'cancelled')
  // A wake that still names the old job is skipped instead of becoming a turn on the current Assignment.
  prompts.length = 0
  await storage.transaction('private', transaction => engine.effects.enqueue(transaction,
    { key: `stale-job:${job.id}`, stream: 'relay', scope: ticketId, payload: { ticketId, jobId: job.id } }))
  for (let index = 0; index < 3; index++) await engine.effects.drain()
  assert.deepEqual(prompts, [])
  // The resumed Assignment finished its own turn; the stale job completed no turn of its own.
  await until(async () => (await engine.listSlots()).holding.length === 0 && (await engine.listSlots()).waiting.length === 0, 'the drained slots')
  assert.deepEqual(prompts, [])
})

test('a direction change and a cancelled long command both reach the running work', { timeout: 40000 }, async t => {
  const prompts = []
  let snapshotJob
  const { engine, accept } = await fixture(t, {
    commands: { build: longCommand() },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Start a long build.')) { prompts.push(text); return [['start_command', { name: 'build' }]] }
      // Reading the job from inside the follow-up turn proves the background work was still running then.
      if (text.startsWith('Change direction:')) {
        prompts.push(text)
        snapshotJob = snapshotJob()
        return [['cancel_job', { jobId: 'LATEST', reason: 'The direction changed.' }]]
      }
      return undefined
    },
  })
  const ticketId = await accept('room', 'room-1', 'Start a long build.')
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  const [job] = await engine.listJobs(ticketId)
  snapshotJob = () => engine.getJob(ticketId, job.id)

  // A person's follow-up reaches the same Worker while the background job keeps running.
  await engine.receiveSource({ commandId: 'receive-change', threadId: 'room', objectId: 'room-2', type: 'created', version: '1', text: 'Change direction: stop that build.' })
  await until(async () => prompts.some(text => text.startsWith('Change direction:')), 'the direction-change turn')
  const during = await snapshotJob
  assert.equal(during.state, 'running')
  // The Worker cancels its own job through the model tool.
  await until(async () => (await engine.getJob(ticketId, job.id)).state === 'cancelled', 'the in-turn cancellation')
  const cancelled = await engine.getJob(ticketId, job.id)
  assert.equal(cancelled.cancelReason, 'worker')
  assert.equal(cancelled.succeeded, false)
  // A cancelled job is not a completed result, and it does not wake another turn of its own.
  const turns = prompts.filter(text => text.startsWith('Background job ')).length
  await sleep(300)
  assert.equal(prompts.filter(text => text.startsWith('Background job ')).length, turns)
  assert.equal((await engine.conversation(ticketId)).reports.length, 0)
})

test('a human cancel command is authorized, idempotent and never reported as a success', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    commands: { build: longCommand() },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Start a long build.') ? [['start_command', { name: 'build' }]] : undefined,
  })
  const ticketId = await accept('room', 'room-1', 'Start a long build.')
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  const [job] = await engine.listJobs(ticketId)
  const cancelled = await engine.cancelJob({ commandId: 'human-cancel', ticketId, jobId: job.id, reason: 'A person stopped it.' })
  assert.equal(cancelled[0].state, 'cancelled')
  assert.equal(cancelled[0].cancelReason, 'human')
  // A replayed command is accepted without a second fact; a reused ID with another reason is rejected.
  const replay = await engine.cancelJob({ commandId: 'human-cancel', ticketId, jobId: job.id, reason: 'A person stopped it.' })
  assert.equal(replay[0].state, 'cancelled')
  await assert.rejects(engine.cancelJob({ commandId: 'human-cancel', ticketId, jobId: job.id, reason: 'Another reason.' }), { code: 'IDENTITY_CONFLICT' })
  await assert.rejects(engine.cancelJob({ commandId: 'unknown-job', ticketId, jobId: 'missing', reason: 'Nothing to stop.' }), { code: 'NOT_FOUND' })
  // A cancelled process range is not a delivered result.
  await sleep(200)
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
})

test('a stop terminates background work and its late exit never wakes the stopped Ticket', { timeout: 40000 }, async t => {
  const { engine, accept, root } = await fixture(t, {
    commands: { build: longCommand() },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Start a long build.') ? [['start_command', { name: 'build' }]] : undefined,
  })
  const ticketId = await accept('room', 'room-1', 'Start a long build.')
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  const [job] = await engine.listJobs(ticketId)
  const stopped = await engine.stopTicket({ commandId: 'stop-long', ticketId, reason: 'The work is no longer needed.' })
  assert.equal(stopped.status, 'stopped')
  const afterStop = await engine.getJob(ticketId, job.id)
  assert.equal(afterStop.state, 'cancelled')
  assert.equal(afterStop.cancelReason, 'stop')
  assert.equal((await engine.listSlots()).holding.length, 0)
  // The process range really stopped: the marker file is not written by a process that was never terminated.
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, 'job-done.txt'), 'go')
  await sleep(400)
  assert.equal((await engine.getJob(ticketId, job.id)).state, 'cancelled')
  assert.equal((await engine.conversation(ticketId)).status, 'stopped')
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
})

test('background work is bounded per Ticket, and an over-budget start creates no job record', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    commands: { build: longCommand() },
    jobs: { maxPerTicket: 1 },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Start two.')) return [['start_command', { name: 'build' }], ['start_command', { name: 'build' }]]
      return undefined
    },
  })
  const ticketId = await accept('room', 'room-1', 'Start two.')
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the first job start fact')
  const [job] = await engine.listJobs(ticketId)
  // The second start exceeds the declared budget: it is refused before a process exists and stays one job.
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end')
  await sleep(300)
  assert.deepEqual((await engine.listJobs(ticketId)).length, 1)
  assert.equal((await engine.getJob(ticketId, job.id)).state, 'running')
})

test('a Ticket with more job records than the query budget still answers with its newest work and keeps the evidence', { timeout: 40000 }, async t => {
  const { engine, accept, storage } = await fixture(t, {
    commands: { quick: { argv: [process.execPath, '-e', "console.log('quick')"], timeoutMs: 2000 } },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Start a quick job.') ? [['start_command', { name: 'quick' }]] : [],
  })
  const ticketId = await accept('room', 'room-1', 'Start a quick job.')
  await until(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  // Older records are evidence and are never deleted automatically; the query just stays bounded.
  await storage.transaction('private', async transaction => {
    for (let index = 0; index < 120; index++) {
      const id = `historic-${String(index).padStart(3, '0')}`
      await transaction.insert('job', `${JSON.stringify(['job', ticketId])}:${id}`, { id, ticketId, assignmentId: 'earlier',
        generation: 'earlier', environmentId: 'project', command: 'quick', state: 'exited', startedAt: index, runtimeToken: 'earlier-runtime', exitCode: 0 })
    }
  })
  const listed = await engine.listJobs(ticketId)
  assert.equal(listed.length <= 100, true, 'the query stays within its declared record budget')
  assert.equal(listed.at(-1).startedAt > 100, true, 'the newest record is the one just started')
  const stored = await storage.transaction('private', transaction => transaction.scan('job', { limit: 100 }))
  assert.equal(stored.items.length, 100, 'evidence from earlier runtimes is retained, not deleted')
})

test('the declared wait terminates a long job without a success claim, and a restart leaves it unknown', { timeout: 40000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-jobs-expire-'))
  const root = join(directory, 'work')
  await mkdir(root)
  let environment, native, storage, sessions, engine, reopened
  t.after(async () => {
    engine?.shutdown(); reopened?.shutdown()
    await engine?.effects.stop(); await reopened?.effects.stop()
    await sessions?.close(); await native?.fiber.dispose(); await storage?.close(); await environment?.close()
    await rm(directory, { recursive: true, force: true })
  })
  environment = await core.LocalEnvironment.open({ id: 'project', instanceId: 'private', root, allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], commands: { build: longCommand(5000) } })
  native = await nativeContext(join(directory, 'sessions'), scripted(text => text.startsWith('Start a long build.') ? [['start_command', { name: 'build' }]] : undefined))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, { retryDelayMs: 10, scanIntervalMs: 20 },
    sessions, [environment], {}, { maxPerTicket: 2, waitMs: 400 })
  engine.effects.start()
  const receipt = await engine.submit({ commandId: 'expire-request', eventId: 'expire-message', text: 'Start a long build.', environmentId: 'project' })
  await until(async () => (await engine.listJobs(receipt.ticketId)).length === 1, 'the job start fact')
  const [job] = await engine.listJobs(receipt.ticketId)
  await until(async () => (await engine.getJob(receipt.ticketId, job.id)).state === 'cancelled', 'the declared wait to expire')
  const expired = await engine.getJob(receipt.ticketId, job.id)
  assert.equal(expired.cancelReason, 'deadline')
  assert.equal(expired.succeeded, false)
  assert.match(expired.reason, /declared background wait expired/u)
  assert.deepEqual((await engine.conversation(receipt.ticketId)).reports, [])

  // A running record left by an earlier runtime cannot be proven live; the next runtime reports it unknown.
  await engine.cancelJob({ commandId: 'prepare-restart', ticketId: receipt.ticketId, jobId: job.id, reason: 'Reset for the restart check.' })
  await storage.transaction('private', async transaction => {
    await transaction.insert('job', JSON.stringify(['job', receipt.ticketId]) + ':restart-job', { id: 'restart-job', ticketId: receipt.ticketId,
      assignmentId: 'earlier-assignment', generation: 'earlier-generation', environmentId: 'project', command: 'build', state: 'running', startedAt: 1, runtimeToken: 'earlier-runtime' })
  })
  reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions, [environment])
  const recovered = await reopened.getJob(receipt.ticketId, 'restart-job')
  assert.equal(recovered.state, 'unknown')
  assert.equal(recovered.settled, false)
  assert.equal(recovered.succeeded, false)
})

test('a job record this process no longer holds reads unknown instead of holding work forever', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-jobs-unheld-'))
  let storage
  t.after(async () => { await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const jobs = new core.Jobs(storage, 'private', 'this-runtime')
  // A settlement write that never committed leaves exactly this: a `running` record of this runtime with no
  // live handle or pending start behind it. It must not count as work this Host still holds.
  const record = { id: 'unheld', ticketId: 'ticket', assignmentId: 'assignment', generation: 'generation', environmentId: 'project',
    command: 'build', state: 'running', startedAt: 1, runtimeToken: 'this-runtime' }
  await storage.transaction('private', transaction => transaction.insert('job', JSON.stringify(['job', 'ticket']) + ':unheld', record))
  const view = await jobs.read('ticket', 'unheld')
  assert.equal(view.state, 'unknown')
  assert.equal(view.settled, false)
  assert.equal(view.succeeded, false)
  assert.equal(await storage.transaction('private', transaction => jobs.hasActive(transaction, { ticketId: 'ticket' })), false)
})

test('an active job stays visible past the query budget, and a cancel keeps its confirmed fact and output', { timeout: 40000 }, async t => {
  const { engine, accept, storage } = await fixture(t, {
    commands: { build: { argv: [process.execPath, '-e', "console.log('built');setInterval(()=>{},1000)"], timeoutMs: 10000,
      backgroundTimeoutMs: 120000 } },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Start a long build.') ? [['start_command', { name: 'build' }]] : [],
  })
  const ticketId = await accept('room', 'room-1', 'Start a long build.')
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end with a running job')
  const [job] = await engine.listJobs(ticketId)
  // A long-lived Ticket's history can exceed the job query budget without hiding a job that is still running:
  // admission and slot holding read the active index, not the bounded history scan.
  await storage.transaction('private', async transaction => {
    for (let index = 0; index < 120; index++) {
      const id = `historic-${String(index).padStart(3, '0')}`
      await transaction.insert('job', `${JSON.stringify(['job', ticketId])}:${id}`, { id, ticketId, assignmentId: 'earlier',
        generation: 'earlier', environmentId: 'project', command: 'build', state: 'exited', startedAt: index, runtimeToken: 'earlier-runtime', exitCode: 0 })
    }
  })
  assert.deepEqual((await engine.listSlots()).holding.map(slot => slot.ticketId), [ticketId], 'the running job keeps the slot')
  assert.equal((await engine.conversation(ticketId)).reason, 'worker-background')
  assert.equal((await engine.getJob(ticketId, job.id)).state, 'running')
  // A confirmed cancel keeps its terminal fact and the bounded output tail it captured before the range was dropped.
  await until(async () => (await engine.getJob(ticketId, job.id)).output.stdout.text.includes('built'), 'the job output')
  const cancelled = await engine.cancelJob({ commandId: 'cancel-under-history', ticketId, jobId: job.id, reason: 'No longer needed.' })
  const target = cancelled.find(entry => entry.id === job.id)
  assert.equal(target.state, 'cancelled')
  assert.match(target.output.stdout.text, /built/u)
  assert.equal((await engine.listSlots()).holding.length, 0)
})
