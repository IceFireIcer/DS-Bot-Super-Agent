import assert from 'node:assert/strict'
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

async function git(root, ...args) { return run('git', args, root) }

async function repository(directory, name = 'source') {
  const root = join(directory, name)
  await mkdir(root)
  await git(root, 'init')
  await git(root, 'config', 'user.email', 't40@example.invalid')
  await git(root, 'config', 'user.name', 'T40')
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'keep.txt'), 'keep\n')
  await git(root, 'add', 'tracked.txt', 'src/keep.txt')
  await git(root, 'commit', '-m', 'base')
  return root
}

async function cleanupDirectory(directory) {
  await rm(directory, { recursive: true, force: true })
}

async function fixture(context, environments, submit) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-'))
  const workerTurns = []
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
  engine.effects.start()
  context.after(async () => {
    await engine.effects.stop()
    await engine.shutdown()
    await sessions.close()
    await native.fiber.dispose()
    await storage.close()
    for (const environment of environments) await environment.close()
    await rm(directory, { recursive: true, force: true })
  })
  const receipt = await engine.submit(submit)
  let conversation
  for (let index = 0; index < 300; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.assignments.length && conversation.reason === 'worker-idle') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(conversation.assignments.length, 1, JSON.stringify(conversation))
  return { engine, ticketId: receipt.ticketId, conversation, directory, sessions, storage, workerTurns }
}

async function replicateChanges(sourceRoot, targetRoot, files) {
  for (const file of files) {
    const target = join(targetRoot, ...file.path.split('/'))
    if (file.state === 'deleted') { await rm(target, { force: true }); continue }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(join(sourceRoot, ...file.path.split('/'))))
  }
}

test('a local Assignment hands off to a paired remote Environment and keeps the Session', { timeout: 40000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-local-remote-'))
  const sourceRoot = await repository(directory)
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'changed for remote\n')
  await writeFile(join(sourceRoot, 'new.txt'), 'untracked\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const device = await core.RemoteDevice.open({ deviceId: 't40-device', root: targetRoot,
    grants: [{ instanceId: 'private', environmentId: 'remote', allowedActorIds: ['user'], permissions: ['read'] }] })
  const remote = await core.RemoteEnvironment.pair({ id: 'remote', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read'], endpoint: await device.start(), pairingCode: device.pairingCode,
    expectedDeviceId: 't40-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const { engine, ticketId, conversation, workerTurns } = await fixture(context, [source, remote],
    { commandId: 't40-local-remote', eventId: 't40-local-remote', text: 'Prepare the handoff.', environmentId: 'source', target: 'auto' })
  context.after(async () => { await remote.close(); await device.close(); await cleanupDirectory(directory) })
  const before = conversation.assignments[0]
  const prepared = await engine.prepareHandoffCopy({ commandId: 't40-copy', ticketId, targetEnvironmentId: 'remote' })
  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  await engine.verifyHandoffCopy({ commandId: 't40-verify', ticketId })
  const handoff = await engine.requestHandoff({ commandId: 't40-handoff', ticketId, targetEnvironmentId: 'remote', reason: 'Move to the device.' })
  assert.equal(handoff.state, 'completed', JSON.stringify(handoff))
  const replay = await engine.requestHandoff({ commandId: 't40-handoff', ticketId, targetEnvironmentId: 'remote', reason: 'Move to the device.' })
  assert.equal(replay.id, handoff.id)
  assert.equal(replay.state, 'completed')
  assert.equal(handoff.sourceAssignmentId, before.id)
  assert.ok(handoff.targetAssignmentId)
  assert.equal(handoff.targetGeneration.length > 0, true)
  assert.equal((await engine.getEnvironmentHandoff(ticketId)).state, 'completed')
  const after = await engine.conversation(ticketId)
  assert.equal(after.assignments.length, 1)
  assert.equal(after.assignments[0].id, handoff.targetAssignmentId)
  assert.equal(after.assignments[0].sessionId, before.sessionId)
  assert.equal(after.assignments[0].environment.id, 'remote')
  assert.notEqual(after.assignments[0].generation, before.generation)
  assert.equal(after.environmentHandoff.state, 'completed')
  assert.equal(after.ticket?.state ?? 'open', 'open')
  for (let index = 0; index < 300 && workerTurns.length < 2; index++) {
    await engine.effects.drain()
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(workerTurns.length, 2, JSON.stringify(workerTurns))
  assert.match(workerTurns[1], /new execution Environment/u)
  assert.match(workerTurns[1], /work copy was verified/u)
  assert.doesNotMatch(workerTurns[1], /Prepare the handoff/u)
})

test('a remote Assignment hands off back to a local Environment', { timeout: 40000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-remote-local-'))
  const sourceRoot = await repository(directory)
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'changed remotely\n')
  await writeFile(join(sourceRoot, 'remote.txt'), 'untracked remotely\n')
  const remoteDevice = await core.RemoteDevice.open({ deviceId: 't40-source-device', root: sourceRoot,
    grants: [{ instanceId: 'private', environmentId: 'remote', allowedActorIds: ['user'], permissions: ['read'] }] })
  const source = await core.RemoteEnvironment.pair({ id: 'remote', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read'], endpoint: await remoteDevice.start(), pairingCode: remoteDevice.pairingCode,
    expectedDeviceId: 't40-source-device', expectedDeviceKey: remoteDevice.deviceKeyFingerprint })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId, conversation } = await fixture(context, [source, target],
    { commandId: 't40-remote-local', eventId: 't40-remote-local', text: 'Return the work.', environmentId: 'remote', target: 'auto' })
  context.after(async () => { await source.close(); await remoteDevice.close(); await cleanupDirectory(directory) })
  const before = conversation.assignments[0]
  const prepared = await engine.prepareHandoffCopy({ commandId: 't40-copy-back', ticketId, targetEnvironmentId: 'target' })
  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  await engine.verifyHandoffCopy({ commandId: 't40-verify-back', ticketId })
  const handoff = await engine.requestHandoff({ commandId: 't40-handoff-back', ticketId, targetEnvironmentId: 'target', reason: 'Return to the Host.' })
  assert.equal(handoff.state, 'completed', JSON.stringify(handoff))
  const after = await engine.conversation(ticketId)
  assert.equal(after.assignments.length, 1)
  assert.equal(after.assignments[0].environment.id, 'target')
  assert.equal(after.assignments[0].sessionId, before.sessionId)
  assert.equal(after.assignments[0].generation !== before.generation, true)
})

test('a target excluded by the Ticket execution target is handoff-blocked', { timeout: 40000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-target-'))
  const sourceRoot = await repository(directory)
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const device = await core.RemoteDevice.open({ deviceId: 't40-target-device', root: targetRoot,
    grants: [{ instanceId: 'private', environmentId: 'remote', allowedActorIds: ['user'], permissions: ['read'] }] })
  const remote = await core.RemoteEnvironment.pair({ id: 'remote', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read'], endpoint: await device.start(), pairingCode: device.pairingCode,
    expectedDeviceId: 't40-target-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const { engine, ticketId, conversation } = await fixture(context, [source, remote],
    { commandId: 't40-target', eventId: 't40-target', text: 'Stay local.', environmentId: 'source' })
  context.after(async () => { await remote.close(); await device.close(); await cleanupDirectory(directory) })
  const before = conversation.assignments[0]
  const prepared = await engine.prepareHandoffCopy({ commandId: 't40-target-copy', ticketId, targetEnvironmentId: 'remote' })
  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  await engine.verifyHandoffCopy({ commandId: 't40-target-verify', ticketId })
  const handoff = await engine.requestHandoff({ commandId: 't40-target-handoff', ticketId, targetEnvironmentId: 'remote', reason: 'Try a remote target.' })
  assert.equal(handoff.state, 'blocked')
  assert.equal(handoff.blockers.some(blocker => blocker.code === 'target-ineligible'), true, JSON.stringify(handoff.blockers))
  const after = await engine.conversation(ticketId)
  assert.equal(after.assignments[0].id, before.id)
  assert.equal(after.assignments[0].environment.id, 'source')
})

test('a handoff without a verified copy is blocked without changing the Assignment', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-blocked-'))
  const sourceRoot = await repository(directory)
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId, conversation } = await fixture(context, [source, target],
    { commandId: 't40-blocked', eventId: 't40-blocked', text: 'Do not move yet.', environmentId: 'source' })
  context.after(() => cleanupDirectory(directory))
  const before = conversation.assignments[0]
  const handoff = await engine.requestHandoff({ commandId: 't40-blocked-handoff', ticketId, targetEnvironmentId: 'target', reason: 'No copy yet.' })
  assert.equal(handoff.state, 'blocked')
  assert.equal(handoff.blockers.some(blocker => blocker.code === 'handoff-copy-missing'), true)
  const after = await engine.conversation(ticketId)
  assert.equal(after.assignments[0].id, before.id)
  assert.equal(after.assignments[0].generation, before.generation)
})

test('a source change after verification blocks the handoff', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-stale-'))
  const sourceRoot = await repository(directory)
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'first\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId, workerTurns } = await fixture(context, [source, target],
    { commandId: 't40-stale', eventId: 't40-stale', text: 'Prepare, then change.', environmentId: 'source' })
  context.after(() => cleanupDirectory(directory))
  const prepared = await engine.prepareHandoffCopy({ commandId: 't40-stale-copy', ticketId, targetEnvironmentId: 'target' })
  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  await engine.verifyHandoffCopy({ commandId: 't40-stale-verify', ticketId })
  await writeFile(join(sourceRoot, 'tracked.txt'), 'second\n')
  const handoff = await engine.requestHandoff({ commandId: 't40-stale-handoff', ticketId, targetEnvironmentId: 'target', reason: 'Stale copy.' })
  assert.equal(handoff.state, 'blocked')
  assert.equal(handoff.blockers.some(blocker => blocker.code === 'handoff-copy-not-verified'), true)
  assert.equal(workerTurns.length, 1)
})
