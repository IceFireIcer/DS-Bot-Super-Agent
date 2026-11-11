import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(' ')}: ${stderr || error.message}`))
      else resolve(stdout.trim())
    })
  })
}

async function repository(directory, name) {
  const root = join(directory, name)
  await mkdir(root)
  await run('git', ['init'], root)
  await run('git', ['config', 'user.email', 't41@example.invalid'], root)
  await run('git', ['config', 'user.name', 'T41'], root)
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'keep.txt'), 'keep\n')
  await run('git', ['add', 'tracked.txt', 'src/keep.txt'], root)
  await run('git', ['commit', '-m', 'base'], root)
  return root
}

async function replicateChanges(sourceRoot, targetRoot, files) {
  for (const file of files) {
    const target = join(targetRoot, ...file.path.split('/'))
    if (file.state === 'deleted') { await rm(target, { force: true }); continue }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(join(sourceRoot, ...file.path.split('/'))))
  }
}

async function openRuntime(directory, environments, workerTurns) {
  const native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      workerTurns.push(user.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      return textResponse('No tool work is needed.')
    }
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {}, 'assign')
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, environments)
  return { engine, storage, sessions, native }
}

async function closeRuntime(runtime) {
  await runtime?.engine.effects.stop().catch(() => {})
  await runtime?.engine.shutdown().catch(() => {})
  await runtime?.sessions.close().catch(() => {})
  await runtime?.native.fiber.dispose().catch(() => {})
  await runtime?.storage.close().catch(() => {})
}

function commandKey(commandId) {
  return createHash('sha256').update(JSON.stringify(['desktop', 'user', commandId])).digest('hex')
}

function handoffFingerprint(ticketId, targetEnvironmentId, reason) {
  return createHash('sha256').update(JSON.stringify(['request-handoff', 'private', ticketId, targetEnvironmentId, reason])).digest('hex')
}

async function fixture(context, targetOnline = true) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t41-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'changed after base\n')
  await writeFile(join(sourceRoot, 'new.txt'), 'untracked\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const workerTurns = []
  const runtime = await openRuntime(directory, [source, target], workerTurns)
  await runtime.engine.acquireHost()
  runtime.engine.effects.start()
  const receipt = await runtime.engine.submit({ commandId: 't41-submit', eventId: 't41-submit', text: 'Prepare the handoff.', environmentId: 'source' })
  let conversation
  for (let index = 0; index < 300; index++) {
    await runtime.engine.effects.drain()
    conversation = await runtime.engine.conversation(receipt.ticketId)
    if (conversation.assignments.length && conversation.reason === 'worker-idle') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(conversation.assignments.length, 1, JSON.stringify(conversation))
  const prepared = await runtime.engine.prepareHandoffCopy({ commandId: 't41-copy', ticketId: receipt.ticketId, targetEnvironmentId: 'target' })
  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  await runtime.engine.verifyHandoffCopy({ commandId: 't41-verify', ticketId: receipt.ticketId })
  const copy = await runtime.engine.getHandoffCopy(receipt.ticketId)
  assert.equal(copy.status, 'verified')
  if (!targetOnline) await target.close()
  context.after(async () => {
    await closeRuntime(runtime)
    await source.close().catch(() => {})
    await target.close().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, receipt, conversation, copy, source, target, targetRoot, workerTurns, runtime }
}

async function injectFlushingHandoff(runtime, record) {
  await runtime.storage.transaction('private', transaction => transaction.insert('handoff-state',
    JSON.stringify(['handoff-state', record.ticketId]), record))
}

function interruptedRecord({ ticketId, assignment, copy, targetRoot, commandId, reason, state = 'flushing' }) {
  const now = Date.now()
  const steps = [{ name: 'requested', state: 'completed', at: now },
    ...(state === 'requested' ? [] : [{ name: 'safe-boundary', state: 'completed', at: now },
      { name: 'jobs-reconciled', state: 'completed', at: now, detail: '0 settled source job(s)' }]),
    ...(state === 'switching' ? [{ name: 'session-flushed', state: 'completed', at: now },
      { name: 'target-revalidated', state: 'completed', at: now }, { name: 'copy-verified', state: 'completed', at: now }] : [])]
  return { id: 't41-recovered-handoff', instanceId: 'private', ticketId,
    source: structuredClone(assignment.environment), target: { id: 'target', kind: 'local', root: targetRoot },
    sourceAssignmentId: assignment.id, sourceGeneration: assignment.generation, copyId: copy.id,
    state, reason, requestedBy: 'user', requestedAt: now,
    settledJobs: [], blockers: [],
    steps,
    command: { key: commandKey(commandId), fingerprint: handoffFingerprint(ticketId, 'target', reason) } }
}

test('a restart reconciles every interrupted handoff step and completes the same command', { timeout: 120000 }, async context => {
  for (const state of ['requested', 'flushing', 'switching']) {
    const initial = await fixture(context)
    const before = initial.conversation.assignments[0]
    const commandId = `t41-recover-${state}`
    const reason = `Resume after ${state} crash`
    const record = interruptedRecord({ ticketId: initial.receipt.ticketId, assignment: before, copy: initial.copy,
      targetRoot: initial.targetRoot, commandId, reason, state })
    await closeRuntime(initial.runtime)
    const runtime = await openRuntime(initial.directory, [initial.source, initial.target], initial.workerTurns)
    context.after(() => closeRuntime(runtime))
    await injectFlushingHandoff(runtime, record)
    await runtime.engine.acquireHost()
    runtime.engine.effects.start()
    let handoff
    for (let index = 0; index < 300; index++) {
      await runtime.engine.effects.drain()
      handoff = await runtime.engine.getEnvironmentHandoff(initial.receipt.ticketId)
      if (handoff?.state === 'completed' || handoff?.state === 'blocked') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(handoff.state, 'completed', JSON.stringify({ state, handoff }))
    assert.equal(handoff.id, 't41-recovered-handoff')
    const after = await runtime.engine.conversation(initial.receipt.ticketId)
    assert.equal(after.assignments.length, 1)
    assert.equal(after.assignments[0].id, handoff.targetAssignmentId)
    assert.equal(after.assignments[0].sessionId, before.sessionId)
    assert.equal(after.assignments[0].generation !== before.generation, true)
    assert.equal(after.assignments[0].environment.id, 'target')
    for (let index = 0; index < 300 && initial.workerTurns.length < 2; index++) {
      await runtime.engine.effects.drain()
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(initial.workerTurns.length, 2)
    assert.match(initial.workerTurns[1], /new execution Environment/u)
    const replay = await runtime.engine.requestHandoff({ commandId, ticketId: initial.receipt.ticketId,
      targetEnvironmentId: 'target', reason })
    assert.equal(replay.id, 't41-recovered-handoff')
    assert.equal(replay.state, 'completed')
    await closeRuntime(runtime)
  }
})

test('a restart keeps the source Assignment when the recorded target is offline', { timeout: 40000 }, async context => {
  const initial = await fixture(context, false)
  const before = initial.conversation.assignments[0]
  const record = interruptedRecord({ ticketId: initial.receipt.ticketId, assignment: before, copy: initial.copy,
    targetRoot: initial.targetRoot, commandId: 't41-offline', reason: 'Target offline after crash' })
  await closeRuntime(initial.runtime)
  const runtime = await openRuntime(initial.directory, [initial.source, initial.target], initial.workerTurns)
  context.after(() => closeRuntime(runtime))
  await injectFlushingHandoff(runtime, record)
  await runtime.engine.acquireHost()
  runtime.engine.effects.start()
  let handoff
  for (let index = 0; index < 300; index++) {
    await runtime.engine.effects.drain()
    handoff = await runtime.engine.getEnvironmentHandoff(initial.receipt.ticketId)
    if (handoff?.state === 'completed' || handoff?.state === 'blocked') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(handoff.state, 'blocked', JSON.stringify(handoff))
  assert.equal(handoff.blockers.some(blocker => blocker.code === 'target-ineligible'), true)
  assert.equal(handoff.blockers.find(blocker => blocker.code === 'target-ineligible')?.nextOwner, 'operator')
  const after = await runtime.engine.conversation(initial.receipt.ticketId)
  assert.equal(after.assignments[0].id, before.id)
  assert.equal(after.assignments[0].generation, before.generation)
  await closeRuntime(runtime)
})

test('a stop takes precedence over an interrupted handoff and resume does not continue it', { timeout: 40000 }, async context => {
  const initial = await fixture(context)
  const before = initial.conversation.assignments[0]
  const record = interruptedRecord({ ticketId: initial.receipt.ticketId, assignment: before, copy: initial.copy,
    targetRoot: initial.targetRoot, commandId: 't41-stopped', reason: 'Stopped after crash' })
  await closeRuntime(initial.runtime)
  const runtime = await openRuntime(initial.directory, [initial.source, initial.target], initial.workerTurns)
  context.after(() => closeRuntime(runtime))
  await injectFlushingHandoff(runtime, record)
  await runtime.engine.acquireHost()
  await runtime.engine.stopTicket({ commandId: 't41-stop-command', ticketId: initial.receipt.ticketId, reason: 'Human stop.' })
  runtime.engine.effects.start()
  const handoff = await runtime.engine.getEnvironmentHandoff(initial.receipt.ticketId)
  assert.equal(handoff.state, 'blocked', JSON.stringify(handoff))
  assert.equal(handoff.blockers.some(blocker => blocker.code === 'ticket-stopping'), true)
  assert.equal(handoff.targetAssignmentId, undefined)
  await runtime.engine.resumeTicket({ commandId: 't41-resume', ticketId: initial.receipt.ticketId })
  const after = await runtime.engine.conversation(initial.receipt.ticketId)
  assert.equal(after.environmentHandoff.state, 'blocked')
  assert.equal(after.assignments[0].environment.id, 'source')
  assert.equal(after.assignments[0].id !== handoff.targetAssignmentId, true)
  await closeRuntime(runtime)
})

test('an unknown external outcome blocks a handoff with a visible owner', { timeout: 40000 }, async context => {
  const initial = await fixture(context)
  await initial.runtime.storage.transaction('private', transaction => transaction.insert('effect', '9999999999999999', {
    key: 't41-unknown-effect', stream: 'relay', scope: initial.receipt.ticketId, payload: { ticketId: initial.receipt.ticketId },
    id: 't41-unknown-effect-id', generation: 't41-unknown-effect-generation', queueKey: '9999999999999999',
    state: 'unknown', attempts: 1, availableAt: 0, reason: 'The external outcome was not confirmed.' }))
  const handoff = await initial.runtime.engine.requestHandoff({ commandId: 't41-unknown', ticketId: initial.receipt.ticketId,
    targetEnvironmentId: 'target', reason: 'Try the handoff.' })
  assert.equal(handoff.state, 'blocked')
  const blocker = handoff.blockers.find(candidate => candidate.code === 'unknown-effect')
  assert.ok(blocker)
  assert.equal(blocker.nextOwner, 'human')
  const after = await initial.runtime.engine.conversation(initial.receipt.ticketId)
  assert.equal(after.assignments[0].id, initial.conversation.assignments[0].id)
})

test('an unknown outbox acknowledgement does not block an execution handoff', { timeout: 40000 }, async context => {
  const initial = await fixture(context)
  await initial.runtime.storage.transaction('private', transaction => transaction.insert('effect', '9999999999999998', {
    key: 't41-unknown-outbox', stream: 'outbox', scope: initial.receipt.ticketId, payload: { ticketId: initial.receipt.ticketId },
    id: 't41-unknown-outbox-id', generation: 't41-unknown-outbox-generation', queueKey: '9999999999999998',
    state: 'unknown', attempts: 1, availableAt: 0, reason: 'The acknowledgement was not confirmed.' }))
  const handoff = await initial.runtime.engine.requestHandoff({ commandId: 't41-outbox', ticketId: initial.receipt.ticketId,
    targetEnvironmentId: 'target', reason: 'The execution world still moves.' })
  assert.equal(handoff.state, 'completed', JSON.stringify(handoff))
})

test('one broken interrupted record does not stop the other recoveries', { timeout: 40000 }, async context => {
  const initial = await fixture(context)
  const before = initial.conversation.assignments[0]
  const record = interruptedRecord({ ticketId: initial.receipt.ticketId, assignment: before, copy: initial.copy,
    targetRoot: initial.targetRoot, commandId: 't41-mixed', reason: 'Mixed recovery' })
  await closeRuntime(initial.runtime)
  const runtime = await openRuntime(initial.directory, [initial.source, initial.target], initial.workerTurns)
  context.after(() => closeRuntime(runtime))
  await injectFlushingHandoff(runtime, { ...record, id: 't41-orphan-handoff', ticketId: 'missing-ticket' })
  await injectFlushingHandoff(runtime, record)
  await runtime.engine.acquireHost()
  runtime.engine.effects.start()
  let handoff
  for (let index = 0; index < 300; index++) {
    await runtime.engine.effects.drain()
    handoff = await runtime.engine.getEnvironmentHandoff(initial.receipt.ticketId)
    if (handoff?.state === 'completed' || handoff?.state === 'blocked') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(handoff.state, 'completed', JSON.stringify(handoff))
  const orphan = await runtime.storage.transaction('private', transaction => transaction.get('handoff-state',
    JSON.stringify(['handoff-state', 'missing-ticket'])))
  assert.equal(orphan.state, 'blocked')
  assert.equal(orphan.blockers.some(blocker => blocker.code === 'handoff-recovery-failed'), true)
  assert.equal(orphan.blockers.find(blocker => blocker.code === 'handoff-recovery-failed')?.nextOwner, 'host')
  await closeRuntime(runtime)
})
