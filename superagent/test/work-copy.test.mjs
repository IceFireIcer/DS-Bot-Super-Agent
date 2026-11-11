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

async function git(root, ...args) {
  return run('git', args, root)
}

async function disposeAll(disposers, message) {
  const errors = []
  for (const dispose of disposers) {
    try { await dispose() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, message)
}

async function repository(directory, name = 'repo') {
  const root = join(directory, name)
  await mkdir(root)
  await git(root, 'init')
  await git(root, 'config', 'user.email', 't39@example.invalid')
  await git(root, 'config', 'user.name', 'T39')
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'keep.txt'), 'keep\n')
  await git(root, 'add', 'tracked.txt', 'src/keep.txt')
  await git(root, 'commit', '-m', 'base')
  return root
}

async function fixture(context, environments, sourceEnvironmentId, resources = []) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-'))
  const native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') return textResponse('No tool work is needed.')
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {}, 'assign')
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, environments)
  engine.effects.start()
  context.after(() => disposeAll([
    () => engine.effects.stop(),
    () => engine.shutdown(),
    () => sessions.close(),
    () => native.fiber.dispose(),
    () => storage.close(),
    ...environments.map(environment => () => environment.close()),
    ...resources.map(resource => () => resource.close()),
    async () => {
      assert.ok(directory.startsWith(join(tmpdir(), 'ds-bot-t39-')))
      await rm(directory, { recursive: true, force: true })
    },
  ], 'Work-copy fixture cleanup failed.'))
  const receipt = await engine.submit({ commandId: `t39-${sourceEnvironmentId}`, eventId: `t39-${sourceEnvironmentId}`,
    text: 'Prepare a handoff copy.', environmentId: sourceEnvironmentId })
  let conversation
  for (let index = 0; index < 500; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.assignments.length && conversation.reason === 'worker-idle') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(conversation.assignments.length, 1, JSON.stringify(conversation))
  return { engine, ticketId: receipt.ticketId, directory, conversation }
}

async function replicateChanges(sourceRoot, targetRoot, files) {
  for (const file of files) {
    const target = join(targetRoot, ...file.path.split('/'))
    if (file.state === 'deleted') {
      await rm(target, { force: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(join(sourceRoot, ...file.path.split('/'))))
  }
}

test('prepares and verifies a Git work copy with uncommitted and untracked files', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-git-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'changed\n')
  await writeFile(join(sourceRoot, 'src', 'new.txt'), 'new file\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read', 'write', 'search'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read', 'write', 'search'], commands: {} })
  const { engine, ticketId, conversation } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const before = conversation.assignments[0]
  const prepared = await engine.prepareHandoffCopy({ commandId: 'prepare', ticketId, targetEnvironmentId: 'target' })
  assert.equal(prepared.status, 'prepared', JSON.stringify(prepared))
  assert.equal(prepared.baseCommit.length, 40)
  assert.deepEqual(prepared.files.map(file => file.path).sort(), ['src/new.txt', 'tracked.txt'])
  assert.equal(prepared.files.some(file => file.state === 'untracked'), true)
  assert.equal(prepared.files.some(file => file.state === 'modified'), true)
  assert.equal(prepared.patch.bytes > 0, true)
  assert.equal(prepared.blockers.length, 0)
  const after = await engine.conversation(ticketId)
  assert.equal(after.assignments[0].id, before.id)
  assert.equal(after.assignments[0].generation, before.generation)
  assert.equal((await engine.getHandoffCopy(ticketId)).id, prepared.id)

  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  const verified = await engine.verifyHandoffCopy({ commandId: 'verify', ticketId })
  assert.equal(verified.status, 'verified', JSON.stringify(verified))
  assert.equal(typeof verified.verifiedAt, 'number')
  assert.equal((await engine.conversation(ticketId)).assignments[0].generation, before.generation)
})

test('blocks an unknown target change or a different target commit', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-blocked-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'changed\n')
  await writeFile(join(targetRoot, 'target-only.txt'), 'not in the manifest\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = await engine.prepareHandoffCopy({ commandId: 'blocked', ticketId, targetEnvironmentId: 'target' })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === 'unknown-target-change'), true)
  await writeFile(join(targetRoot, 'target-only.txt'), 'still here\n')
  const still = await engine.getHandoffCopy(ticketId)
  assert.equal(still.status, 'handoff-blocked')
  assert.match(still.blockers.map(blocker => blocker.message).join(' '), /not be overwritten/u)
})

test('a different target commit is handoff-blocked', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-commit-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'source change\n')
  await writeFile(join(targetRoot, 'target.txt'), 'target change\n')
  await git(targetRoot, 'add', 'target.txt')
  await git(targetRoot, '-c', 'user.email=t39@example.invalid', '-c', 'user.name=T39', 'commit', '-m', 'target ahead')
  assert.notEqual(await git(targetRoot, 'rev-parse', 'HEAD'), await git(sourceRoot, 'rev-parse', 'HEAD'))
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = await engine.prepareHandoffCopy({ commandId: 'commit-mismatch', ticketId, targetEnvironmentId: 'target' })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === 'target-commit-mismatch'), true)
})

test('a deleted target file that is not in the manifest is handoff-blocked', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-target-delete-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'source change\n')
  await rm(join(targetRoot, 'src', 'keep.txt'))
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = await engine.prepareHandoffCopy({ commandId: 'target-delete', ticketId, targetEnvironmentId: 'target' })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === 'unknown-target-change'), true)
})

test('the change budget is a visible blocker, not a partial copy', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-budget-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'large.txt'), 'x'.repeat(8 * 1024 * 1024 + 1))
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = await engine.prepareHandoffCopy({ commandId: 'budget', ticketId, targetEnvironmentId: 'target' })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === core.workCopyGaps.changeBudget), true)
  assert.deepEqual(blocked.files, [])
})

test('a real paired device can inspect and verify the prepared copy', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-remote-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'remote change\n')
  await writeFile(join(sourceRoot, 'untracked.txt'), 'untracked\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const device = await core.RemoteDevice.open({ deviceId: 't39-device', root: targetRoot,
    grants: [{ instanceId: 'private', environmentId: 'remote', allowedActorIds: ['user'], permissions: ['read'] }] })
  const remote = await core.RemoteEnvironment.pair({ id: 'remote', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read'], endpoint: await device.start(), pairingCode: device.pairingCode,
    expectedDeviceId: 't39-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const { engine, ticketId } = await fixture(context, [source, remote], 'source', [device])
  const prepared = await engine.prepareHandoffCopy({ commandId: 'remote-prepare', ticketId, targetEnvironmentId: 'remote' })
  assert.equal(prepared.status, 'prepared', JSON.stringify(prepared))
  await replicateChanges(sourceRoot, targetRoot, prepared.files)
  const verified = await engine.verifyHandoffCopy({ commandId: 'remote-verify', ticketId })
  assert.equal(verified.status, 'verified', JSON.stringify(verified))
  assert.equal(verified.target.deviceId, 't39-device')
})

test('source changes after preparation block verification', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-source-changed-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  await writeFile(join(sourceRoot, 'tracked.txt'), 'first change\n')
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = await core.LocalEnvironment.open({ id: 'target', instanceId: 'private', root: targetRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const prepared = await engine.prepareHandoffCopy({ commandId: 'prepare', ticketId, targetEnvironmentId: 'target' })
  assert.equal(prepared.status, 'prepared')
  await writeFile(join(sourceRoot, 'tracked.txt'), 'second change\n')
  const blocked = await engine.verifyHandoffCopy({ commandId: 'verify-after-change', ticketId })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === 'source-changed'), true)
})

test('a missing work-copy capability is handoff-blocked rather than executed', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-missing-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await mkdir(targetRoot)
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = {
    kind: 'local', config: { id: 'target', instanceId: 'private', root: targetRoot, allowedActorIds: ['user'],
      permissions: ['read'], commands: {} },
    authorize() {}, async prepare() { return { cwd: targetRoot, invoke: async () => ({}), artifact: async () => ({}), sanitize: text => text } },
    async close() {},
  }
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = await engine.prepareHandoffCopy({ commandId: 'missing', ticketId, targetEnvironmentId: 'target' })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === core.workCopyGaps.inspectMissing), true)
})

test('a target probe failure is persisted as handoff-blocked', { timeout: 30000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-probe-'))
  const sourceRoot = await repository(directory, 'source')
  const targetRoot = join(directory, 'target')
  await run('git', ['clone', sourceRoot, targetRoot], directory)
  const source = await core.LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  const target = {
    kind: 'local', config: { id: 'target', instanceId: 'private', root: targetRoot, allowedActorIds: ['user'],
      permissions: ['read'], commands: {} },
    async probe() { throw new core.CoreError('ENVIRONMENT_CHANGED', 'The target directory changed.') },
    authorize() {}, async prepare() { return { cwd: targetRoot, invoke: async () => ({}), artifact: async () => ({}), sanitize: text => text } },
    async close() {},
  }
  const { engine, ticketId } = await fixture(context, [source, target], 'source')
  context.after(() => rm(directory, { recursive: true, force: true }))
  const blocked = await engine.prepareHandoffCopy({ commandId: 'probe-failure', ticketId, targetEnvironmentId: 'target' })
  assert.equal(blocked.status, 'handoff-blocked')
  assert.equal(blocked.blockers.some(blocker => blocker.code === 'ENVIRONMENT_CHANGED'), true)
})
