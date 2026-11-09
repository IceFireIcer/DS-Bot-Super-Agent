import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

class ProbeEnvironment {
  kind
  config
  deviceId
  deviceIncarnation
  state

  constructor(id, kind, options = {}) {
    this.kind = kind
    this.config = { id, instanceId: 'private', root: options.root ?? `/tmp/${id}`, allowedActorIds: options.allowedActorIds ?? ['user'],
      permissions: options.permissions ?? ['read', 'write', 'search', 'command'], commands: {}, commandNames: [] }
    this.deviceId = kind === 'remote' ? options.deviceId ?? `device-${id}` : undefined
    this.deviceIncarnation = kind === 'remote' ? options.deviceIncarnation ?? `incarnation-${id}` : undefined
    this.state = { online: options.online ?? true, root: this.config.root, version: options.version ?? (kind === 'local' ? 'local-v1' : 'remote-v2'),
      fingerprint: options.fingerprint ?? `${kind}:${id}`, capabilities: [...this.config.permissions],
      capacity: options.capacity ?? { active: 0, max: 4 },
      ...(options.offlineReason ? { offlineReason: options.offlineReason } : {}) }
  }

  get online() { return this.state.online }

  authorize(identity) {
    if (identity.instanceId !== this.config.instanceId || !this.config.allowedActorIds.includes(identity.actorId)) {
      throw new core.CoreError('ENVIRONMENT_DENIED', 'This actor cannot use the environment.')
    }
  }

  async probe(identity) {
    this.authorize(identity)
    return { ...this.state }
  }

  async prepare(identity) {
    this.authorize(identity)
    const root = this.config.root
    return {
      cwd: root,
      invoke: async () => { throw new core.CoreError('UNSUPPORTED_CAPABILITY', 'The probe environment has no tools.') },
      artifact: async () => { throw new core.CoreError('UNSUPPORTED_CAPABILITY', 'The probe environment has no artifacts.') },
      sanitize: text => text,
    }
  }

  async close() {}
}

async function fixture(context, environments) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-execution-target-'))
  const native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') return textResponse('No tool work is needed.')
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, environments)
  context.after(async () => {
    await engine.effects.stop()
    await engine.shutdown()
    await sessions.close()
    await native.fiber.dispose()
    await storage.close()
    for (const environment of environments) await environment.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { engine, storage, sessions }
}

async function settle(engine, ticketId, check, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await engine.effects.drain()
    const conversation = await engine.conversation(ticketId)
    if (await check(conversation)) return conversation
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return engine.conversation(ticketId)
}

test('the Instance defaults to local and a Ticket can override within the configured allowlist', { timeout: 20000 }, async context => {
  const local = new ProbeEnvironment('host-work', 'local', { fingerprint: 'local-root-v1' })
  const remote = new ProbeEnvironment('remote-work', 'remote')
  const { engine } = await fixture(context, [local, remote])
  assert.equal((await engine.getExecutionPolicy()).defaultTarget, 'local')
  assert.equal((await engine.getExecutionPolicy()).revision, 0)

  const localReceipt = await engine.submit({ commandId: 'default-local', eventId: 'default-local', text: 'Use the default target.' })
  const localConversation = await settle(engine, localReceipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(localConversation.assignments[0].environment.id, 'host-work')
  assert.equal(localConversation.executionSelection.status, 'selected')
  assert.equal(localConversation.executionSelection.selected.id, 'host-work')
  assert.equal(localConversation.executionSelection.source, 'default')

  const remoteReceipt = await engine.submit({ commandId: 'remote-only', eventId: 'remote-only', text: 'Use the remote device.',
    target: 'remote-only' })
  const remoteConversation = await settle(engine, remoteReceipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(remoteConversation.assignments[0].environment.id, 'remote-work')
  assert.equal(remoteConversation.executionSelection.selected.kind, 'remote')
  assert.equal(remoteConversation.executionSelection.source, 'ticket')
})

test('a global default change only affects later resolution and never moves an existing Assignment', { timeout: 20000 }, async context => {
  const local = new ProbeEnvironment('host-work', 'local')
  const remote = new ProbeEnvironment('remote-work', 'remote')
  const { engine } = await fixture(context, [local, remote])
  const receipt = await engine.submit({ commandId: 'first-local', eventId: 'first-local', text: 'Start locally.' })
  const before = await settle(engine, receipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(before.assignments[0].environment.id, 'host-work')

  const updated = await engine.updateExecutionPolicy({ commandId: 'policy-remote', expectedRevision: 0,
    policy: { defaultTarget: 'remote-only' } })
  assert.equal(updated.revision, 1)
  assert.equal(updated.defaultTarget, 'remote-only')
  const unchanged = await engine.conversation(receipt.ticketId)
  assert.equal(unchanged.assignments[0].environment.id, 'host-work')

  const next = await engine.submit({ commandId: 'second-remote', eventId: 'second-remote', text: 'Start on the remote.' })
  const after = await settle(engine, next.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(after.assignments[0].environment.id, 'remote-work')
  assert.equal(after.executionSelection.policyRevision, 1)
})

test('remote-only waits with selection evidence and retries by command when an eligible device returns', { timeout: 20000 }, async context => {
  const local = new ProbeEnvironment('host-work', 'local')
  const remote = new ProbeEnvironment('remote-work', 'remote', { online: false, offlineReason: 'device offline' })
  const { engine, storage, sessions } = await fixture(context, [local, remote])
  const receipt = await engine.submit({ commandId: 'remote-wait', eventId: 'remote-wait', text: 'Wait for the device.',
    target: 'remote-only' })
  const waiting = await settle(engine, receipt.ticketId, conversation => conversation.reason === 'environment-waiting')
  assert.deepEqual(waiting.assignments, [])
  assert.equal(waiting.executionSelection.status, 'waiting')
  assert.match(waiting.executionSelection.reason, /offline|unavailable/u)
  assert.equal(waiting.executionSelection.candidates[0].eligible, false)
  assert.ok(waiting.executionSelection.candidates[0].reasons.length > 0)
  await assert.rejects(engine.resumeTicket({ commandId: 'resume-waiting-target', ticketId: receipt.ticketId }), { code: 'ENVIRONMENT_WAITING' })
  await assert.rejects(engine.retryTicket({ commandId: 'retry-waiting-target', ticketId: receipt.ticketId, reason: 'Retry too early.' }),
    { code: 'ENVIRONMENT_WAITING' })
  await storage.transaction('private', transaction => engine.effects.enqueue(transaction, { key: 'waiting-follow-up',
    stream: 'relay', scope: receipt.ticketId, payload: { ticketId: receipt.ticketId } }))
  await engine.effects.drain()
  const afterWake = await engine.conversation(receipt.ticketId)
  assert.deepEqual(afterWake.assignments, [])
  assert.equal(afterWake.reason, 'environment-waiting')
  const foreign = new core.Engine(storage, 'private', { sourceInstanceId: 'other', actorId: 'user', allowedActorIds: ['user'] },
    {}, sessions, [local, remote])
  await assert.rejects(foreign.getExecutionSelection(receipt.ticketId), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(foreign.retryExecutionTarget({ commandId: 'foreign-retry', ticketId: receipt.ticketId }),
    { code: 'SOURCE_NOT_AUTHORIZED' })

  remote.state = { ...remote.state, online: true, offlineReason: undefined }
  await engine.retryExecutionTarget({ commandId: 'retry-target', ticketId: receipt.ticketId })
  await engine.retryExecutionTarget({ commandId: 'retry-target', ticketId: receipt.ticketId })
  const selected = await settle(engine, receipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(selected.assignments[0].environment.id, 'remote-work')
  assert.equal(selected.executionSelection.status, 'selected')
})

test('auto records capability, capacity, fingerprint and version evidence before choosing a device', { timeout: 20000 }, async context => {
  const local = new ProbeEnvironment('host-work', 'local', { online: false, permissions: ['read'], offlineReason: 'host unavailable' })
  const noWrite = new ProbeEnvironment('remote-no-write', 'remote', { permissions: ['read', 'search'] })
  const full = new ProbeEnvironment('remote-full', 'remote', { capacity: { active: 4, max: 4 } })
  const unknownCapacity = new ProbeEnvironment('remote-unknown-capacity', 'remote', { capacity: 'unknown' })
  const wrongRoot = new ProbeEnvironment('remote-wrong-root', 'remote')
  wrongRoot.state = { ...wrongRoot.state, root: '/somewhere/else' }
  const noProbe = {
    kind: 'remote',
    config: { id: 'remote-no-probe', instanceId: 'private', root: '/tmp/remote-no-probe', allowedActorIds: ['user'],
      permissions: ['read', 'write', 'search', 'command'], commands: {}, commandNames: [] },
    deviceId: 'device-no-probe', deviceIncarnation: 'incarnation-no-probe',
    authorize() {},
    async prepare() { throw new core.CoreError('UNSUPPORTED_CAPABILITY', 'The no-probe Environment has no tools.') },
    async close() {},
  }
  const good = new ProbeEnvironment('remote-good', 'remote', { version: 'remote-v2', fingerprint: 'device-good:incarnation-good' })
  const { engine } = await fixture(context, [local, noWrite, full, unknownCapacity, wrongRoot, noProbe, good])
  await engine.updateExecutionPolicy({ commandId: 'policy-auto', expectedRevision: 0,
    policy: { defaultTarget: 'auto', requiredPermissions: ['read', 'write'] } })
  const receipt = await engine.submit({ commandId: 'auto-choice', eventId: 'auto-choice', text: 'Choose a capable target.' })
  const conversation = await settle(engine, receipt.ticketId, value => value.assignments.length > 0)
  assert.equal(conversation.assignments[0].environment.id, 'remote-good')
  const selection = conversation.executionSelection
  assert.equal(selection.selected.id, 'remote-good')
  assert.equal(selection.candidates.find(candidate => candidate.id === 'remote-no-write').reasons.some(reason => /permission|capability/u.test(reason)), true)
  assert.equal(selection.candidates.find(candidate => candidate.id === 'remote-full').reasons.some(reason => /capacity/u.test(reason)), true)
  assert.equal(selection.candidates.find(candidate => candidate.id === 'remote-unknown-capacity').reasons.some(reason => /capacity/u.test(reason)), true)
  assert.equal(selection.candidates.find(candidate => candidate.id === 'remote-wrong-root').reasons.some(reason => /directory/u.test(reason)), true)
  assert.equal(selection.candidates.find(candidate => candidate.id === 'remote-no-probe').reasons.some(reason => /probe/u.test(reason)), true)
  assert.equal(selection.candidates.find(candidate => candidate.id === 'host-work').eligible, false)
  assert.equal(selection.selected.fingerprint, 'device-good:incarnation-good')
  assert.equal(selection.selected.version, 'remote-v2')
  const work = await engine.getTicket(receipt.ticketId)
  assert.equal(work.mandate.environment, 'auto')
  assert.equal(work.intent.environment, 'remote')
})

test('explicit or ticket selection cannot escape the actor allowlist or the ticket target kind', { timeout: 20000 }, async context => {
  const local = new ProbeEnvironment('host-work', 'local')
  const remote = new ProbeEnvironment('remote-work', 'remote')
  const foreign = new ProbeEnvironment('foreign-work', 'remote', { allowedActorIds: ['other'] })
  const { engine } = await fixture(context, [local, remote, foreign])
  await assert.rejects(engine.submit({ commandId: 'foreign', eventId: 'foreign', text: 'Use foreign work.',
    environmentId: 'foreign-work' }), { code: 'ENVIRONMENT_DENIED' })
  await assert.rejects(engine.submit({ commandId: 'kind-mismatch', eventId: 'kind-mismatch', text: 'Use foreign work.',
    environmentId: 'remote-work', target: 'local-only' }), { code: 'ENVIRONMENT_DENIED' })
})

test('actual local and paired remote Environments form one dual-mode selection loop', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-execution-target-real-'))
  const localRoot = join(directory, 'local-work')
  const remoteRoot = join(directory, 'remote-work')
  await mkdir(localRoot)
  await mkdir(remoteRoot)
  const local = await core.LocalEnvironment.open({ id: 'host-work', instanceId: 'private', root: localRoot,
    allowedActorIds: ['user'], permissions: ['read', 'write', 'search'], commands: {} })
  const device = await core.RemoteDevice.open({ deviceId: 'second-device', root: remoteRoot,
    grants: [{ instanceId: 'private', environmentId: 'remote-work', allowedActorIds: ['user'],
      permissions: ['read', 'write', 'search'] }] })
  const remote = await core.RemoteEnvironment.pair({ id: 'remote-work', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search'], endpoint: await device.start(), pairingCode: device.pairingCode,
    expectedDeviceId: 'second-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') return textResponse('No tool work is needed.')
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [local, remote])
  context.after(async () => {
    await engine.effects.stop()
    await engine.shutdown()
    await sessions.close()
    await native.fiber.dispose()
    await storage.close()
    await remote.close()
    await device.close()
    await local.close()
    await rm(directory, { recursive: true, force: true })
  })

  const localReceipt = await engine.submit({ commandId: 'real-local', eventId: 'real-local', text: 'Use the Host.' })
  const localConversation = await settle(engine, localReceipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(localConversation.assignments[0].environment.id, 'host-work')
  assert.equal(localConversation.executionSelection.selected.fingerprint.includes(':'), true)

  const remoteReceipt = await engine.submit({ commandId: 'real-remote', eventId: 'real-remote', text: 'Use the device.',
    target: 'remote-only' })
  const remoteConversation = await settle(engine, remoteReceipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(remoteConversation.assignments[0].environment.id, 'remote-work')
  assert.equal(remoteConversation.executionSelection.selected.deviceId, 'second-device')
  assert.equal(remoteConversation.executionSelection.selected.version, 'remote-v3')
  assert.equal(remoteConversation.executionSelection.candidates.find(candidate => candidate.id === 'remote-work').capacity.max, 64)
})

test('a retained Assignment refuses to run after the selected Environment fingerprint changes', { timeout: 20000 }, async context => {
  const local = new ProbeEnvironment('host-work', 'local', { fingerprint: 'root-before' })
  const { engine } = await fixture(context, [local])
  const receipt = await engine.submit({ commandId: 'fingerprint-before', eventId: 'fingerprint-before', text: 'Start locally.' })
  await settle(engine, receipt.ticketId, conversation => conversation.assignments.length > 0 && conversation.reason === 'worker-idle')
  local.state = { ...local.state, fingerprint: 'root-after' }
  await engine.retryTicket({ commandId: 'fingerprint-retry', ticketId: receipt.ticketId, reason: 'Check the retained target.' })
  const failed = await settle(engine, receipt.ticketId, conversation => conversation.setup?.state === 'failed')
  assert.equal(failed.setup.code, 'ENVIRONMENT_CHANGED')
  assert.equal(failed.setup.state, 'failed')
})
