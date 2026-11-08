import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
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

function promptOf(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  return user.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function toolCount(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  return options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
}

/**
 * The scripted responder serves the Router, the Worker and any child Agent from one place, so a test can assert
 * exactly which tools each Agent was given and what each one wrote.
 */
function scripted(plan) {
  return function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const text = promptOf(options)
    const script = plan(text, options)
    if (script === undefined) { yield* textResponse('No plan for this prompt.'); return }
    const steps = Array.isArray(script) ? script : script.steps
    const done = toolCount(options)
    const next = steps[done]
    if (!next) { yield* textResponse(Array.isArray(script) ? 'Turn complete.' : script.text); return }
    yield* toolResponse(next[0], next[1], `call-${done}`)
  }
}

async function fixture(t, { commands, plan, respond, source = {}, jobs = {}, subagents = {} }) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-subagents-'))
  const root = join(directory, 'work')
  await mkdir(root)
  let environment, native, storage, sessions, engine
  t.after(async () => {
    await engine?.shutdown()
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close(); await environment?.close()
    await rm(directory, { recursive: true, force: true })
  })
  environment = await core.LocalEnvironment.open({ id: 'project', instanceId: 'private', root, allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], commands })
  native = await nativeContext(join(directory, 'sessions'), respond ?? scripted(plan))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], ...source },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [environment], {}, jobs, subagents)
  engine.effects.start()
  const accept = async (threadId, objectId, text) => {
    const received = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text })
    return (await engine.acceptSource({ commandId: `accept-${objectId}`, threadId, objectId, expectedEventId: received.eventId, environmentId: 'project' })).ticketId
  }
  return { engine, accept, root, directory, storage, sessions, native }
}

const verifyCommand = { verify: { argv: [process.execPath, '-e', "console.log('ok')"], timeoutMs: 2000 } }

test('a delegated child inherits the parent Working directory and tools, and its result returns to that Worker', { timeout: 60000 }, async t => {
  const turns = []
  const childTools = []
  const { engine, accept, root } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room', 'other'], versionOrder: 'sequence' },
    plan: (text, options) => {
      if (options.sessionId.startsWith('subagent-')) {
        childTools.push(options.tools.map(tool => tool.name).sort())
        turns.push(['child', text])
        return { steps: [['write_file', { path: 'child.txt', text: 'from the child\n' }], ['read_file', { path: 'child.txt' }]], text: 'Wrote child.txt from the child.' }
      }
      if (text.startsWith('Run the parent task.')) {
        turns.push(['parent', text])
        return { steps: [['delegate_subagent', { task: 'Write child.txt with the child text.' }]], text: 'Delegated the subtask.' }
      }
      if (text.startsWith('Subagent ')) turns.push(['parent-event', text])
      return [['write_file', { path: 'parent.txt', text: 'from the parent\n' }], ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Both files exist.', evidence: 'Read the subtask result and verified parent.txt.', artifacts: 'parent.txt' }]]
    },
  })
  const ticketId = await accept('room', 'room-1', 'Run the parent task.')
  await until(async () => (await engine.listSubagents(ticketId)).length === 1, 'the subtask start fact')
  const [subtask] = await engine.listSubagents(ticketId)
  // The child acts under the Ticket's own Mandate, never a new or wider one.
  const ticket = await engine.getTicket(ticketId)
  assert.equal(subtask.mandateId, ticket.mandate.id)
  assert.equal(subtask.generation, (await engine.conversation(ticketId)).assignments[0].generation, 'the child records the delegating generation')
  assert.equal(subtask.state !== 'cancelled', true)
  // The child ran in the same bound directory and wrote a real file there.
  await until(async () => (await engine.getSubagent(ticketId, subtask.id)).state === 'completed', 'the subtask result')
  const completed = await engine.getSubagent(ticketId, subtask.id)
  assert.equal(completed.succeeded, true)
  assert.match(completed.result.text, /child/u)
  assert.equal(await readFile(join(root, 'child.txt'), 'utf8'), 'from the child\n')
  // The child's whole tool list is a subset of the parent's work tools: no Router, delivery or delegation tools.
  assert.equal(childTools.length >= 1, true, JSON.stringify(childTools))
  for (const tools of childTools) {
    assert.equal(tools.includes('report_ready'), false, JSON.stringify(tools))
    assert.equal(tools.includes('ask_human'), false, JSON.stringify(tools))
    assert.equal(tools.includes('delegate_subagent'), false, JSON.stringify(tools))
    assert.equal(tools.includes('start_command'), false, JSON.stringify(tools))
    assert.equal(tools.includes('cancel_job'), false, JSON.stringify(tools))
    assert.equal(tools.includes('deliver_result'), false, JSON.stringify(tools))
    assert.equal(tools.includes('assign_worker'), false, JSON.stringify(tools))
    assert.equal(tools.includes('write_file'), true, JSON.stringify(tools))
  }
  // The completion arrives at the parent Worker as evidence, and never as a ready report by itself.
  await until(async () => turns.some(([kind]) => kind === 'parent-event'), 'the subtask completion event')
  const event = turns.find(([kind]) => kind === 'parent-event')[1]
  assert.match(event, new RegExp(subtask.id, 'u'))
  assert.match(event, new RegExp(subtask.generation, 'u'), 'the completion names the delegating generation')
  await until(async () => (await engine.conversation(ticketId)).status === 'ready', 'the parent result')
  const conversation = await engine.conversation(ticketId)
  assert.equal(await readFile(join(root, 'parent.txt'), 'utf8'), 'from the parent\n')
  assert.equal(conversation.subagents[0].state, 'completed')
})

test('two Workers with their own child Agents never share a directory or a tool scope', { timeout: 60000 }, async t => {
  const seen = []
  const { engine, accept, directory } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room', 'lab'], versionOrder: 'sequence' },
    plan: (text, options) => {
      const isChild = options.sessionId.startsWith('subagent-')
      if (isChild) {
        if (!seen.some(([, , sessionId]) => sessionId === options.sessionId)) {
          seen.push(['child', text, options.sessionId, options.tools.map(tool => tool.name).sort()])
        }
        return { steps: [['write_file', { path: `${options.sessionId}.txt`, text }]], text: `Wrote ${options.sessionId}.txt.` }
      }
      if (text.startsWith('Room task.')) return { steps: [['delegate_subagent', { task: 'write room-child' }]], text: 'Delegated room.' }
      if (text.startsWith('Lab task.')) return { steps: [['delegate_subagent', { task: 'write lab-child' }]], text: 'Delegated lab.' }
      if (text.startsWith('Subagent ')) return []
      return [['write_file', { path: 'done.txt', text: 'done\n' }], ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Done.', evidence: 'Wrote and verified done.txt.', artifacts: 'done.txt' }]]
    },
  })
  const room = await accept('room', 'room-1', 'Room task.')
  const lab = await accept('lab', 'lab-1', 'Lab task.')
  await until(async () => (await engine.listSubagents(room)).length === 1 && (await engine.listSubagents(lab)).length === 1, 'both subtask start facts')
  await until(async () => seen.filter(([kind]) => kind === 'child').length >= 2, 'both children to run')
  await until(async () => (await engine.listSubagents(room)).every(subagent => subagent.settled)
    && (await engine.listSubagents(lab)).every(subagent => subagent.settled), 'both children to finish')
  const [roomChild] = await engine.listSubagents(room)
  const [labChild] = await engine.listSubagents(lab)
  // Each Ticket sees exactly one subtask, owned by its own Assignment and Session — never the other's.
  assert.equal((await engine.listSubagents(room)).length, 1)
  assert.equal((await engine.listSubagents(lab)).length, 1)
  assert.notEqual(roomChild.assignmentId, labChild.assignmentId)
  await assert.rejects(engine.getSubagent(room, labChild.id), { code: 'NOT_FOUND' })
  await assert.rejects(engine.getSubagent(lab, roomChild.id), { code: 'NOT_FOUND' })
  // Each child wrote only into the parent's bound directory, and only its own file.
  const sessionIds = seen.map(([, , sessionId]) => sessionId)
  assert.equal(new Set(sessionIds).size, sessionIds.length, 'every child had its own Session')
  for (const [kind, , sessionId, tools] of seen.filter(([kind]) => kind === 'child')) {
    assert.equal(kind, 'child')
    assert.equal((await readFile(join(directory, 'work', `${sessionId}.txt`), 'utf8')).startsWith('write '), true)
    assert.equal(tools.includes('read_file') || tools.includes('write_file'), true, JSON.stringify(tools))
    assert.equal(tools.includes('deliver_result'), false, JSON.stringify(tools))
  }
  await assert.rejects(readFile(join(directory, 'child.txt')), { code: 'ENOENT' }, 'no child wrote outside its own named file')
})

test('a child Agent keeps running past the parent turn, holds the slot, and a stop disposes it without waking work', { timeout: 60000 }, async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  let childCancelled = false
  const { engine, accept, root } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    respond: async function* (options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      const text = promptOf(options)
      if (options.sessionId.startsWith('subagent-')) {
        entered()
        await Promise.race([
          gate,
          new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => { childCancelled = true; reject(new Error('child cancelled')) }, { once: true })),
        ])
        yield* textResponse('Child finished late.')
        return
      }
      if (text.startsWith('Run a long subtask.')) yield* (toolCount(options) ? textResponse('Delegated.') : toolResponse('delegate_subagent', { task: 'long child' }))
      else yield* textResponse('Turn complete.')
    },
  })
  const ticketId = await accept('room', 'room-1', 'Run a long subtask.')
  await started
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end with a running subagent')
  // The running child keeps the Ticket's slot and keeps it out of the idle state.
  assert.deepEqual((await engine.listSlots()).holding.map(slot => slot.ticketId), [ticketId])
  assert.deepEqual((await engine.listSubagents(ticketId)).map(subagent => subagent.state), ['running'])
  const [subtask] = await engine.listSubagents(ticketId)
  // A human stop cancels the child by ownership and never lets its late result wake the Ticket.
  const stopped = await engine.stopTicket({ commandId: 'stop-child', ticketId, reason: 'The subtask is no longer needed.' })
  assert.equal(stopped.status, 'stopped')
  await until(async () => childCancelled, 'the child Agent to be cancelled')
  const afterStop = await engine.getSubagent(ticketId, subtask.id)
  assert.equal(afterStop.state, 'cancelled')
  assert.equal(afterStop.cancelReason, 'stop')
  assert.equal((await engine.listSlots()).holding.length, 0)
  release()
  await sleep(400)
  const afterResume = await engine.getSubagent(ticketId, subtask.id)
  assert.equal(afterResume.state, 'cancelled')
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
  assert.equal((await engine.conversation(ticketId)).status, 'stopped')
  void root
})

test('a subagent budget refuses an over-budget start before any child Agent exists', { timeout: 60000 }, async t => {
  const { engine, accept } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    subagents: { maxPerTicket: 1 },
    plan: (text, options) => {
      if (options.sessionId.startsWith('subagent-')) return { steps: [], text: 'Child finished.' }
      if (text.startsWith('Delegate twice.')) return { steps: [['delegate_subagent', { task: 'first child' }], ['delegate_subagent', { task: 'second child' }]], text: 'Done delegating.' }
      return []
    },
  })
  const ticketId = await accept('room', 'room-1', 'Delegate twice.')
  // The second delegation exceeds the declared budget and is refused before any child Agent exists.
  await until(async () => (await engine.listSubagents(ticketId)).length >= 1, 'the first subtask start fact')
  await sleep(400)
  assert.equal((await engine.listSubagents(ticketId)).length, 1)
})

test('the declared subagent deadline ends the child and reports a deadline fact, never a success', { timeout: 60000 }, async t => {
  const events = []
  const { engine, accept } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    subagents: { deadlineMs: 1000 },
    respond: async function* (options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      const text = promptOf(options)
      if (options.sessionId.startsWith('subagent-')) {
        await Promise.race([
          new Promise(resolve => setTimeout(resolve, 30000)),
          new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('child deadline')), { once: true })),
        ])
        yield* textResponse('Child finished too late.')
        return
      }
      events.push(text)
      if (text.startsWith('Run a long subtask.')) yield* (toolCount(options) ? textResponse('Delegated.') : toolResponse('delegate_subagent', { task: 'long child' }))
      else yield* textResponse('Turn complete.')
    },
  })
  const ticketId = await accept('room', 'room-1', 'Run a long subtask.')
  await until(async () => (await engine.listSubagents(ticketId)).length === 1, 'the subtask start fact')
  const [subtask] = await engine.listSubagents(ticketId)
  await until(async () => (await engine.getSubagent(ticketId, subtask.id)).state === 'cancelled', 'the declared deadline to end the child')
  const expired = await engine.getSubagent(ticketId, subtask.id)
  assert.equal(expired.cancelReason, 'deadline')
  assert.equal(expired.succeeded, false)
  // The deadline wakes the Worker with the fact so it can report or retry, and it is never a ready report itself.
  await until(async () => events.some(text => text.startsWith('Subagent ')), 'the deadline event')
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
})

test('a late child result after a resume is audit-only and never wakes the new generation', { timeout: 60000 }, async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const generations = []
  const { engine, accept, storage } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    respond: async function* (options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      const text = promptOf(options)
      if (options.sessionId.startsWith('subagent-')) {
        entered()
        await Promise.race([gate, new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('child cancelled')), { once: true }))])
        yield* textResponse('Child finished after the resume.')
        return
      }
      generations.push([options.sessionId, text])
      if (text.startsWith('Run a long subtask.')) yield* (toolCount(options) ? textResponse('Delegated.') : toolResponse('delegate_subagent', { task: 'long child' }))
      else yield* textResponse('Turn complete.')
    },
  })
  const ticketId = await accept('room', 'room-1', 'Run a long subtask.')
  await started
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end with a running subagent')
  const [subtask] = await engine.listSubagents(ticketId)
  await engine.stopTicket({ commandId: 'stop-then-resume', ticketId, reason: 'Restart the work.' })
  await engine.resumeTicket({ commandId: 'resume-work', ticketId })
  const resumed = await engine.conversation(ticketId)
  assert.notEqual(resumed.assignments[0].id, subtask.assignmentId)
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-idle', 'the resumed turn to finish')
  // The old child is disposed at the stop, so its late text cannot wake the replacement Assignment.
  const before = generations.length
  release()
  await sleep(500)
  assert.equal(generations.length, before, 'no new Worker turn was started by the late result')
  const afterResume = await engine.getSubagent(ticketId, subtask.id)
  assert.equal(afterResume.state, 'cancelled')
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])
  void storage
})

test('a stop that cannot confirm the child stays stopping instead of claiming the range is gone', { timeout: 60000 }, async t => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const { engine, accept } = await fixture(t, {
    commands: verifyCommand,
    source: { allowedThreadIds: ['room'], versionOrder: 'sequence' },
    subagents: { cleanupMs: 300 },
    respond: async function* (options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      const text = promptOf(options)
      if (options.sessionId.startsWith('subagent-')) {
        entered()
        await gate
        yield* textResponse('Child finished eventually.')
        return
      }
      if (text.startsWith('Run a long subtask.')) yield* (toolCount(options) ? textResponse('Delegated.') : toolResponse('delegate_subagent', { task: 'long child' }))
      else yield* textResponse('Turn complete.')
    },
  })
  try {
    const ticketId = await accept('room', 'room-1', 'Run a long subtask.')
    await started
    await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'the turn to end with a running subagent')
    const [subtask] = await engine.listSubagents(ticketId)
    // The child ignores cancellation, so the declared cleanup budget expires without quiescence evidence.
    const stopped = await engine.stopTicket({ commandId: 'stop-unconfirmed', ticketId, reason: 'Stop the work.' })
    assert.equal(stopped.status, 'stopping', JSON.stringify(stopped.stop))
    assert.equal(stopped.stop.cancellationConfirmedAt, undefined)
    const child = await engine.getSubagent(ticketId, subtask.id)
    assert.equal(child.state, 'unknown')
    assert.equal(child.succeeded, false)
    await assert.rejects(engine.resumeTicket({ commandId: 'resume-too-early', ticketId }), { code: 'STOPPING' })
    assert.equal((await engine.conversation(ticketId)).status, 'stopping')
  } finally {
    // Let the unresponsive child finish so its Agent can be disposed at teardown.
    release()
    await sleep(300)
  }
})
