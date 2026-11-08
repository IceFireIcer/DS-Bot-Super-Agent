import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function until(check, label, timeout = 20000) {
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

function scripted(plan) {
  return function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const text = workerText(options)
    const script = plan(text, options)
    const steps = Array.isArray(script) ? script : script.steps
    const done = toolCount(options)
    if (steps === undefined) { yield* textResponse('No plan for this prompt.'); return }
    const next = steps[done]
    if (!next) { yield* textResponse(Array.isArray(script) ? 'Turn complete.' : script.text); return }
    yield* toolResponse(next[0], resolveLatest(options, next[1]), `call-${done}`)
  }
}

function resolveLatest(options, args) {
  const toolTexts = options.messages.filter(message => message.role === 'tool')
    .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  const ids = toolTexts.flatMap(text => [...text.matchAll(/"jobId":"([^"]+)"/gu)].map(match => match[1]))
  const first = ids[0]
  const latest = ids.at(-1)
  if (!Object.values(args).includes('LATEST') && !Object.values(args).includes('FIRST')) return args
  if (!latest) throw new Error('The scripted plan referenced a job ID before the model had learned one.')
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, value === 'LATEST' ? latest : value === 'FIRST' ? first : value]))
}

const longCommand = (timeoutMs = 10000) => ({ argv: [process.execPath, '-e',
  "const fs=require('node:fs');fs.writeFileSync('job-started.txt','started');setInterval(()=>{if(fs.existsSync('job-done.txt')){console.log('finished');process.exit(0)}},25)"], timeoutMs })

async function fixture(t, { plan, respond, jobs = {}, source = {}, twoTickets = false }) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-previews-'))
  const roots = twoTickets ? [join(directory, 'one'), join(directory, 'two')] : [join(directory, 'one')]
  for (const root of roots) await mkdir(root, { recursive: true })
  let environments = [], native, storage, sessions, engine
  t.after(async () => {
    await engine?.shutdown()
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    for (const environment of environments) await environment.close()
    await rm(directory, { recursive: true, force: true })
  })
  const commands = {
    preview: longCommand(), build: longCommand(), verify: { argv: [process.execPath, '-e', "console.log('verified')"], timeoutMs: 2000 },
  }
  for (const [index, root] of roots.entries()) environments.push(await core.LocalEnvironment.open({ id: `project-${index}`, instanceId: 'private', root,
    allowedActorIds: ['user'], permissions: ['read', 'write', 'search', 'command'], commands }))
  native = await nativeContext(join(directory, 'sessions'), respond ?? scripted(plan))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], ...source },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, environments, {}, jobs)
  engine.effects.start()
  const accept = async (threadId, objectId, text, environmentId = 'project-0') => {
    const received = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text })
    return (await engine.acceptSource({ commandId: `accept-${objectId}`, threadId, objectId, expectedEventId: received.eventId, environmentId })).ticketId
  }
  return { engine, accept, roots, storage, sessions, environments }
}

test('an explicit preview survives a ready handoff without holding a slot or waking the Worker', { timeout: 40000 }, async t => {
  const prompts = []
  const { engine, accept, roots } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      prompts.push(text)
      if (text.startsWith('Prepare a review.')) return [
        ['write_file', { path: 'review.txt', text: 'Review this result.\n' }],
        ['start_command', { name: 'preview' }],
        ['start_command', { name: 'build' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'Local review server for acceptance.', artifact: 'review.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'The review is ready.', evidence: 'Wrote and verified review.txt.', artifacts: 'review.txt' }],
      ]
      return []
    },
  })
  const ticketId = await accept('room', 'room-1', 'Prepare a review.')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the ready handoff')
  await until(async () => (await engine.conversation(ticketId)).messages.some(message => message.purpose === 'result'), 'the result delivery')
  const conversation = await engine.conversation(ticketId)
  assert.equal(conversation.stage, 'ready')
  assert.equal(conversation.lifecycle, 'ended')
  assert.equal(conversation.assignments[0].state, 'ended')
  assert.deepEqual((await engine.listSlots()).holding, [])
  const previews = await engine.listPreviews(ticketId)
  assert.equal(previews.length, 1)
  const [preview] = previews
  assert.equal(preview.state, 'running')
  assert.equal(preview.purpose, 'Local review server for acceptance.')
  assert.equal(preview.artifact.path, 'review.txt')
  assert.equal(preview.assignmentId, conversation.assignments[0].id)
  assert.equal(preview.environmentId, 'project-0')
  assert.equal(preview.holdsSlot, false)
  assert.equal(conversation.previews[0].id, preview.id)
  await until(async () => (await engine.listJobs(ticketId)).find(job => job.command === 'build')?.state === 'cancelled', 'ordinary job cancellation')
  const jobs = await engine.listJobs(ticketId)
  assert.equal(jobs.find(job => job.id === preview.jobId).state, 'running')
  assert.equal(jobs.find(job => job.command === 'build').state, 'cancelled')
  assert.equal(jobs.find(job => job.command === 'build').cancelReason, 'assignment-ended')
  assert.equal((await engine.getJob(ticketId, preview.jobId)).state, 'running')
  assert.match(await readFile(join(roots[0], 'job-started.txt'), 'utf8'), /started/u)

  const beforeExit = prompts.filter(text => text.startsWith('Background job ')).length
  await assert.rejects(engine.cancelJob({ commandId: 'cancel-preview-job', ticketId, jobId: preview.jobId, reason: 'Wrong route.' }),
    { code: 'PREVIEW_REQUIRES_CANCEL_PREVIEW' })
  await assert.rejects(engine.resolvePreview({ commandId: 'resolve-running-preview', ticketId, previewId: preview.id, reason: 'Wrong state.' }),
    { code: 'PREVIEW_NOT_UNKNOWN' })
  const cancelled = await engine.cancelPreview({ commandId: 'cancel-preview', ticketId, previewId: preview.id, reason: 'Acceptance is complete.' })
  await until(async () => (await engine.getPreview(ticketId, preview.id)).state === 'cancelled', 'the preview cancellation fact')
  assert.equal(cancelled[0].state, 'cancelled')
  assert.equal((await engine.conversation(ticketId)).stage, 'ready')
  assert.equal(prompts.filter(text => text.startsWith('Background job ')).length, beforeExit)
  assert.deepEqual((await engine.effects.list()).items.filter(effect => effect.stream === 'relay' && effect.payload.jobId === preview.jobId), [])
  assert.equal((await engine.listPreviews(ticketId))[0].state, 'cancelled')
})

test('a waiting-human handoff releases the slot and stops related subagents while retaining the preview', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    source: { allowedThreadIds: ['room', 'other'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Ask while previewing.') ? [
      ['write_file', { path: 'question.txt', text: 'Needs a decision.\n' }],
      ['start_command', { name: 'preview' }],
      ['keep_preview', { jobId: 'FIRST', purpose: 'Preview for the pending decision.', artifact: 'question.txt' }],
      ['ask_human', { question: 'Should this preview be accepted?', options: 'Yes\nNo' }],
    ] : [],
  })
  const ticketId = await accept('room', 'room-1', 'Ask while previewing.')
  await until(async () => (await engine.conversation(ticketId)).status === 'waiting-human', 'the waiting-human handoff')
  await until(async () => (await engine.listSlots()).holding.length === 0, 'the slot to be released')
  const conversation = await engine.conversation(ticketId)
  assert.equal(conversation.stage, 'waiting-human')
  assert.equal(conversation.lifecycle, 'open')
  const previews = await engine.listPreviews(ticketId)
  assert.equal(previews.length, 1)
  assert.equal(previews[0].state, 'running')
  assert.equal(previews[0].assignmentId, conversation.assignments[0].id)
  assert.deepEqual(await engine.listSubagents(ticketId), [])
  assert.equal((await engine.getJob(ticketId, previews[0].jobId)).state, 'running')
})

test('a preview process exiting naturally stays a review fact and never wakes the Worker', { timeout: 40000 }, async t => {
  const prompts = []
  const { engine, accept, roots } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      prompts.push(text)
      if (text.startsWith('Prepare an exiting preview.')) return [
        ['write_file', { path: 'exit.txt', text: 'Review.\n' }],
        ['start_command', { name: 'preview' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'Preview that exits by itself.', artifact: 'exit.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Ready for review.', evidence: 'Wrote and verified exit.txt.', artifacts: 'exit.txt' }],
      ]
      return []
    },
  })
  const ticketId = await accept('room', 'room-1', 'Prepare an exiting preview.')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the ready handoff')
  const [preview] = await engine.listPreviews(ticketId)
  const beforeExit = prompts.filter(text => text.startsWith('Background job ')).length
  await writeFile(join(roots[0], 'job-done.txt'), 'go')
  await until(async () => (await engine.getPreview(ticketId, preview.id)).state === 'exited', 'the natural preview exit')
  const exited = await engine.getPreview(ticketId, preview.id)
  assert.equal(exited.state, 'exited')
  assert.equal(exited.exitCode, 0)
  assert.deepEqual((await engine.listSlots()).holding, [])
  await engine.effects.drain()
  await sleep(300)
  assert.equal(prompts.filter(text => text.startsWith('Background job ')).length, beforeExit)
  assert.deepEqual((await engine.effects.list()).items.filter(effect => effect.stream === 'relay' && effect.payload.jobId === preview.jobId), [])
  assert.equal((await engine.conversation(ticketId)).stage, 'ready')
  assert.equal((await engine.conversation(ticketId)).reports.length, 1)
})

test('Assignment cleanup is scoped to managed preview ownership and foreign work is untouched', { timeout: 40000 }, async t => {
  const { engine, accept, roots } = await fixture(t, {
    twoTickets: true,
    source: { allowedThreadIds: ['room', 'other'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Owned preview.')) return [
        ['write_file', { path: 'owned.txt', text: 'owned\n' }],
        ['start_command', { name: 'preview' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'Owned preview.', artifact: 'owned.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Owned result.', evidence: 'Wrote and verified owned.txt.', artifacts: 'owned.txt' }],
      ]
      if (text.startsWith('Independent work.')) return [['start_command', { name: 'preview' }]]
      return []
    },
  })
  const owned = await accept('room', 'room-1', 'Owned preview.', 'project-0')
  const independent = await accept('other', 'other-1', 'Independent work.', 'project-1')
  await until(async () => (await engine.conversation(owned)).status === 'ready', 'the owned ready handoff')
  await until(async () => (await engine.conversation(independent)).reason === 'worker-background', 'the independent job')
  const [preview] = await engine.listPreviews(owned)
  const [foreignJob] = await engine.listJobs(independent)
  await engine.cancelPreview({ commandId: 'cancel-owned', ticketId: owned, previewId: preview.id, reason: 'Acceptance finished.' })
  assert.equal((await engine.getJob(owned, preview.jobId)).state, 'cancelled')
  assert.equal((await engine.getJob(independent, foreignJob.id)).state, 'running')
  assert.equal((await engine.listSlots()).holding.some(slot => slot.ticketId === independent), true)
  assert.match(await readFile(join(roots[1], 'job-started.txt'), 'utf8'), /started/u)
  await engine.cancelJob({ commandId: 'clean-independent', ticketId: independent, jobId: foreignJob.id, reason: 'Cleanup test.' })
})

test('an unconfirmed preview cleanup stays pending confirmation and does not pretend to be stopped', { timeout: 40000 }, async t => {
  const { engine, accept, storage, sessions, environments } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Prepare an unconfirmed preview.')) return [
        ['write_file', { path: 'review.txt', text: 'Review.\n' }],
        ['start_command', { name: 'preview' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'Owned preview.', artifact: 'review.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Ready.', evidence: 'Wrote and verified review.txt.', artifacts: 'review.txt' }],
      ]
      return []
    },
  })
  const ticketId = await accept('room', 'room-1', 'Prepare an unconfirmed preview.')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the ready handoff')
  const [preview] = await engine.listPreviews(ticketId)
  // A real restart loses every handle; the old preview record must not be reported as running by the new Host.
  await engine.effects.stop()
  await engine.shutdown()
  const sameHost = await engine.getPreview(ticketId, preview.id)
  assert.equal(sameHost.state, 'unknown')
  assert.equal(sameHost.pendingConfirmation, true)
  const reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    {}, sessions, environments)
  const stale = await reopened.getPreview(ticketId, preview.id)
  assert.equal(stale.state, 'unknown')
  assert.equal(stale.pendingConfirmation, true)
  assert.match(stale.reason, /pending confirmation/u)
  const stoppedTicket = await reopened.stopTicket({ commandId: 'stop-unconfirmed-preview', ticketId, reason: 'Stop an unknown preview.' })
  assert.equal(stoppedTicket.status, 'stopping')
  assert.equal(stoppedTicket.stop?.cancellationConfirmedAt, undefined)
  const stopped = await reopened.cancelPreview({ commandId: 'unconfirmed-cancel', ticketId, previewId: preview.id, reason: 'Stop the preview.' })
  assert.equal(stopped[0].state, 'unknown')
  assert.equal(stopped[0].pendingConfirmation, true)
  assert.match(stopped[0].reason, /pending confirmation/u)
  assert.equal((await reopened.getPreview(ticketId, preview.id)).state, 'unknown')
  const resolved = await reopened.resolvePreview({ commandId: 'resolve-lost-preview', ticketId, previewId: preview.id,
    reason: 'A person confirmed the preview process is gone.' })
  assert.equal(resolved[0].state, 'resolved')
  assert.equal(resolved[0].pendingConfirmation, false)
  const afterResolve = await reopened.conversation(ticketId)
  assert.equal(afterResolve.status, 'stopped')
  assert.ok(afterResolve.stop?.cancellationConfirmedAt)
  await reopened.shutdown()
})

test('stopping a Ticket cancels only its own retained preview and leaves another Ticket running', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    twoTickets: true,
    source: { allowedThreadIds: ['room', 'other'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Preview then stop.')) return [
        ['write_file', { path: 'stop.txt', text: 'Stop.\n' }],
        ['start_command', { name: 'preview' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'Preview to stop.', artifact: 'stop.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Ready.', evidence: 'Wrote and verified stop.txt.', artifacts: 'stop.txt' }],
      ]
      if (text.startsWith('Keep running.')) return [['start_command', { name: 'preview' }]]
      return []
    },
  })
  const owned = await accept('room', 'room-1', 'Preview then stop.', 'project-0')
  const other = await accept('other', 'other-1', 'Keep running.', 'project-1')
  await until(async () => (await engine.conversation(owned)).status === 'ready', 'the ready handoff')
  await until(async () => (await engine.conversation(other)).reason === 'worker-background', 'the other running job')
  const [preview] = await engine.listPreviews(owned)
  const [otherJob] = await engine.listJobs(other)
  const stopped = await engine.stopTicket({ commandId: 'stop-preview-ticket', ticketId: owned, reason: 'Close the preview.' })
  assert.equal(stopped.status, 'stopped')
  assert.equal((await engine.getPreview(owned, preview.id)).state, 'cancelled')
  assert.equal((await engine.getJob(owned, preview.jobId)).cancelReason, 'stop')
  assert.equal((await engine.getJob(other, otherJob.id)).state, 'running')
  await engine.cancelJob({ commandId: 'clean-other', ticketId: other, jobId: otherJob.id, reason: 'Cleanup.' })
})

test('a person resolving a lost preview does not forge a stop owned by another Host', { timeout: 40000 }, async t => {
  const { engine, accept, storage, sessions, environments } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Lost preview.') ? [
      ['write_file', { path: 'lost.txt', text: 'Lost.\n' }],
      ['start_command', { name: 'preview' }],
      ['keep_preview', { jobId: 'FIRST', purpose: 'Lost preview.', artifact: 'lost.txt' }],
      ['run_command', { name: 'verify' }],
      ['report_ready', { result: 'Ready.', evidence: 'Wrote and verified lost.txt.', artifacts: 'lost.txt' }],
    ] : [],
  })
  const ticketId = await accept('room', 'room-1', 'Lost preview.')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the ready handoff')
  const [preview] = await engine.listPreviews(ticketId)
  await engine.effects.stop()
  await engine.shutdown()
  await engine.stopTicket({ commandId: 'old-host-stop', ticketId, reason: 'The old Host disappeared.' })
  const reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    {}, sessions, environments)
  const recovered = await reopened.conversation(ticketId)
  assert.equal(recovered.status, 'stopped')
  assert.equal(recovered.stop?.cancellationConfirmedAt, undefined)
  const resolved = await reopened.resolvePreview({ commandId: 'resolve-lost-other-host', ticketId, previewId: preview.id,
    reason: 'The person confirms the preview is gone.' })
  assert.equal(resolved[0].state, 'resolved')
  const after = await reopened.conversation(ticketId)
  assert.equal(after.status, 'stopped')
  assert.equal(after.stop?.cancellationConfirmedAt, undefined)
  await assert.rejects(reopened.resumeTicket({ commandId: 'resume-without-host-evidence', ticketId }), { code: 'CANCELLATION_UNCONFIRMED' })
  await reopened.shutdown()
})

test('idle, draft, ready and ended remain separate stages and ready creates no new work', { timeout: 40000 }, async t => {
  const prompts = []
  const { engine, accept } = await fixture(t, {
    source: { allowedThreadIds: ['room', 'other', 'draft'], versionOrder: 'sequence' },
    plan: text => {
      prompts.push(text)
      if (text.startsWith('Draft then finish.')) return [
        ['write_file', { path: 'answer.txt', text: 'Answer.\n' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Finished.', evidence: 'Wrote and verified answer.txt.', artifacts: 'answer.txt' }],
      ]
      if (text.startsWith('Idle only.')) return []
      if (text.startsWith('Draft with a long job.')) return [['start_command', { name: 'build' }]]
      return []
    },
  })
  const readyTicket = await accept('room', 'room-1', 'Draft then finish.')
  await until(async () => (await engine.conversation(readyTicket)).status === 'ready', 'the ready handoff')
  const idleTicket = await accept('other', 'other-1', 'Idle only.')
  await until(async () => (await engine.conversation(idleTicket)).reason === 'worker-idle', 'the idle turn')
  const idle = await engine.conversation(idleTicket)
  assert.equal(idle.stage, 'idle')
  assert.equal(idle.lifecycle, 'open')
  const draftTicket = await accept('draft', 'draft-1', 'Draft with a long job.')
  await until(async () => (await engine.conversation(draftTicket)).reason === 'worker-background', 'the draft turn')
  const draft = await engine.conversation(draftTicket)
  assert.equal(draft.stage, 'draft')
  assert.equal(draft.lifecycle, 'open')
  const [draftJob] = await engine.listJobs(draftTicket)
  await engine.cancelJob({ commandId: 'cancel-draft-job', ticketId: draftTicket, jobId: draftJob.id, reason: 'Stage test cleanup.' })
  await until(async () => (await engine.conversation(readyTicket)).messages.some(message => message.purpose === 'result'), 'the ready result delivery')
  const ready = await engine.conversation(readyTicket)
  assert.equal(ready.stage, 'ready')
  assert.equal(ready.lifecycle, 'ended')
  assert.equal(ready.reports.length, 1)
  const readyEffects = (await engine.effects.list()).items.filter(effect => effect.stream === 'relay' && effect.state === 'pending' && effect.payload.ticketId === readyTicket)
  assert.deepEqual(readyEffects, [])
  const readyPrompts = prompts.length
  for (let index = 0; index < 3; index++) await engine.effects.drain()
  assert.equal(prompts.length, readyPrompts)
  assert.equal((await engine.conversation(readyTicket)).reports.length, 1)
  assert.deepEqual((await engine.listSlots()).holding, [])
})

test('the loopback chat exposes preview queries and owner-only cancellation', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => {
      if (text.startsWith('Prepare a routable preview.')) return [
        ['write_file', { path: 'route.txt', text: 'Route.\n' }],
        ['start_command', { name: 'preview' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'A preview exposed by the local chat.', artifact: 'route.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Ready.', evidence: 'Wrote and verified route.txt.', artifacts: 'route.txt' }],
      ]
      return []
    },
  })
  const chat = await core.createChatServer(engine)
  t.after(() => chat.close())
  const ticketId = await accept('room', 'room-1', 'Prepare a routable preview.')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the ready handoff')
  const listed = await (await fetch(`${chat.url}/previews?ticket=${ticketId}`)).json()
  assert.equal(listed.length, 1)
  const detail = await (await fetch(`${chat.url}/preview?ticket=${ticketId}&preview=${listed[0].id}`)).json()
  assert.equal(detail.purpose, 'A preview exposed by the local chat.')
  const unresolved = await fetch(`${chat.url}/resolve-preview`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'chat-resolve-running', ticketId, previewId: listed[0].id, reason: 'Not lost.' }) })
  assert.equal(unresolved.status, 400)
  assert.equal((await unresolved.json()).code, 'PREVIEW_NOT_UNKNOWN')
  const cancelled = await (await fetch(`${chat.url}/cancel-preview`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'chat-cancel-preview', ticketId, previewId: listed[0].id, reason: 'Done reviewing.' }) })).json()
  assert.equal(cancelled[0].state, 'cancelled')
})

test('ready stops a running child Agent while an explicit preview survives', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: (text, options) => {
      if (options.sessionId?.startsWith('subagent-')) return { steps: [], text: 'Child finished.' }
      if (text.startsWith('Delegate and preview.')) return [
        ['write_file', { path: 'review.txt', text: 'Review.\n' }],
        ['start_command', { name: 'preview' }],
        ['delegate_subagent', { task: 'Write a short child result.' }],
        ['keep_preview', { jobId: 'FIRST', purpose: 'Preview with a child Agent.', artifact: 'review.txt' }],
        ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Ready.', evidence: 'Wrote and verified review.txt.', artifacts: 'review.txt' }],
      ]
      return []
    },
  })
  const ticketId = await accept('room', 'room-1', 'Delegate and preview.')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the ready handoff')
  await until(async () => {
    const listed = await engine.listSubagents(ticketId)
    return listed.length === 1 && ['cancelled', 'unknown', 'completed', 'failed'].includes(listed[0].state)
  }, 'the child Agent to finish cancellation')
  const [subagent] = await engine.listSubagents(ticketId)
  assert.ok(['cancelled', 'unknown', 'completed', 'failed'].includes(subagent.state))
  assert.equal((await engine.listPreviews(ticketId))[0].state, 'running')
  await until(async () => (await engine.listSlots()).holding.length === 0, 'the child completion wake to drain its slot')
  assert.deepEqual((await engine.listSlots()).holding, [])
})

test('waiting-human stops a live child Agent and never lets its exit wake the Worker', { timeout: 40000 }, async t => {
  const prompts = []
  const { engine, accept } = await fixture(t, {
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    respond: async function* (options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      if (options.sessionId?.startsWith('subagent-')) {
        prompts.push('child entered')
        await new Promise(resolve => {
          if (options.signal?.aborted) resolve(undefined)
          else options.signal?.addEventListener('abort', () => resolve(undefined), { once: true })
        })
        yield* textResponse('Child stopped.')
        return
      }
      const text = workerText(options)
      prompts.push(text)
      if (text.startsWith('Ask with a live child.')) {
        const plan = [
          ['write_file', { path: 'child-preview.txt', text: 'Preview.\n' }],
          ['start_command', { name: 'preview' }],
          ['delegate_subagent', { task: 'Wait until the parent hands off.' }],
          ['keep_preview', { jobId: 'FIRST', purpose: 'Preview with a live child.', artifact: 'child-preview.txt' }],
          ['ask_human', { question: 'Accept this preview?', options: 'Yes\nNo' }],
        ]
        const next = plan[toolCount(options)]
        yield* (next ? toolResponse(next[0], resolveLatest(options, next[1]), `parent-${toolCount(options)}`) : textResponse('Waiting.'))
        return
      }
      yield* textResponse('Turn complete.')
    },
  })
  const ticketId = await accept('room', 'room-1', 'Ask with a live child.')
  await until(async () => (await engine.listSubagents(ticketId)).length === 1, 'the child start fact')
  await until(async () => (await engine.conversation(ticketId)).status === 'waiting-human', 'the waiting-human handoff')
  await until(async () => (await engine.listSubagents(ticketId))[0].state !== 'running', 'the child stop')
  const [child] = await engine.listSubagents(ticketId)
  assert.ok(['cancelled', 'unknown'].includes(child.state))
  assert.equal((await engine.listPreviews(ticketId))[0].state, 'running')
  assert.equal((await engine.listSlots()).holding.length, 0)
  await engine.effects.drain()
  assert.equal(prompts.filter(text => text.startsWith('Subagent ')).length, 0)
})

test('retained previews are bounded per Ticket instead of bypassing the job budget forever', { timeout: 40000 }, async t => {
  const { engine, accept } = await fixture(t, {
    jobs: { maxPerTicket: 2 },
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    plan: text => text.startsWith('Retain too many previews.') ? [
      ['write_file', { path: 'review.txt', text: 'Review.\n' }],
      ['start_command', { name: 'preview' }],
      ['keep_preview', { jobId: 'FIRST', purpose: 'First preview.', artifact: 'review.txt' }],
      ['start_command', { name: 'preview' }],
      ['keep_preview', { jobId: 'LATEST', purpose: 'Second preview.', artifact: 'review.txt' }],
      ['start_command', { name: 'preview' }],
      ['keep_preview', { jobId: 'LATEST', purpose: 'Third preview.', artifact: 'review.txt' }],
    ] : [],
  })
  const ticketId = await accept('room', 'room-1', 'Retain too many previews.')
  await until(async () => (await engine.listJobs(ticketId)).length === 3, 'three managed jobs')
  await until(async () => (await engine.listPreviews(ticketId)).length === 2, 'the bounded preview list')
  const previews = await engine.listPreviews(ticketId)
  assert.deepEqual(previews.map(preview => preview.purpose), ['First preview.', 'Second preview.'])
  const third = (await engine.listJobs(ticketId)).find(job => !previews.some(preview => preview.jobId === job.id))
  assert.equal(third.state, 'running')
  await engine.cancelJob({ commandId: 'clean-third-job', ticketId, jobId: third.id, reason: 'Bound test cleanup.' })
})

test('preview history returns the actual newest 100 records instead of a key-order window', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-preview-history-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const previews = new core.Previews('runtime', Date.now, () => true, { maxPerTicket: 16 })
  await storage.transaction('private', async transaction => {
    for (let index = 0; index < 105; index++) {
      const id = `preview-${String(index).padStart(3, '0')}`
      const preview = await previews.start(transaction, { job: { id, ticketId: 'ticket', assignmentId: 'assignment', generation: 'generation',
        environmentId: 'project', command: 'preview', state: 'running', startedAt: index, runtimeToken: 'runtime' },
        purpose: `Preview ${index}.`, artifact: { path: 'review.txt', bytes: 1, sha256: '0'.repeat(64) } })
      await previews.markUnconfirmed(transaction, 'ticket', preview.id)
      await previews.resolve(transaction, 'ticket', preview.id, 'Closed.')
    }
  })
  const listed = await storage.transaction('private', transaction => previews.list(transaction, 'ticket'))
  assert.equal(listed.length, 100)
  assert.equal(listed[0].id, 'preview-005')
  assert.equal(listed.at(-1).id, 'preview-104')
})
