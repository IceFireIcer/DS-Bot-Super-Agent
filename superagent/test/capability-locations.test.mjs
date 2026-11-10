import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

class CapabilityEnvironment {
  kind
  config
  deviceId
  deviceIncarnation
  state

  constructor(id, kind, options = {}) {
    this.kind = kind
    this.config = { id, instanceId: options.instanceId ?? 'private', root: options.root ?? `/tmp/${id}`,
      allowedActorIds: options.allowedActorIds ?? ['user'],
      permissions: options.permissions ?? ['read', 'write', 'search', 'command'], commands: {}, commandNames: [] }
    this.deviceId = kind === 'remote' ? options.deviceId ?? `device-${id}` : undefined
    this.deviceIncarnation = kind === 'remote' ? options.deviceIncarnation ?? `incarnation-${id}` : undefined
    this.state = { online: options.online ?? true, root: this.config.root,
      version: options.version ?? (kind === 'local' ? 'local-v1' : 'remote-v3'),
      fingerprint: options.fingerprint ?? `${kind}:${id}`, capabilities: [...this.config.permissions],
      capacity: options.capacity ?? { active: 0, max: 4 },
      productCapabilities: options.productCapabilities ?? {} }
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
    return { cwd: this.config.root, invoke: async () => { throw new core.CoreError('UNSUPPORTED_CAPABILITY', 'No tools.') },
      artifact: async () => { throw new core.CoreError('UNSUPPORTED_CAPABILITY', 'No artifacts.') }, sanitize: text => text }
  }

  async close() {}
}

async function fixture(context, environments, source = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-capability-locations-'))
  const native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') return textResponse('No tool work is needed.')
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], ...source },
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
  return { engine, storage, sessions, directory }
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

test('the Instance declares browser and MCP on the Host and Office in an Environment', async context => {
  const local = new CapabilityEnvironment('host-work', 'local', { productCapabilities: { office: true } })
  const remote = new CapabilityEnvironment('remote-work', 'remote', { productCapabilities: { office: true } })
  const { engine } = await fixture(context, [local, remote], { hostCapabilities: { browser: true, mcp: true } })
  const locations = await engine.getCapabilityLocations()
  const browser = locations.find(item => item.id === 'browser')
  assert.equal(browser.location, 'host')
  assert.deepEqual(browser.roles, ['worker'])
  assert.equal(browser.local.support, 'available')
  assert.equal(browser.local.credentials, 'host')
  assert.equal(browser.local.privacy, 'host')
  assert.deepEqual(browser.remote.gaps, ['remote-browser-contract-unverified'])
  const mcp = locations.find(item => item.id === 'mcp')
  assert.equal(mcp.location, 'host')
  assert.equal(mcp.local.credentials, 'host')
  assert.deepEqual(mcp.remote.gaps, ['remote-mcp-contract-unverified'])
  const office = locations.find(item => item.id === 'office')
  assert.equal(office.location, 'environment')
  assert.equal(office.local.support, 'conditional')
  assert.deepEqual(office.local.permissions, ['read', 'command'])
  assert.equal(office.local.credentials, 'environment')
  assert.deepEqual(office.remote.gaps, ['remote-office-contract-unverified'])
})

test('a local Assignment can satisfy Office while a remote Assignment cannot', async context => {
  const local = new CapabilityEnvironment('host-work', 'local', { productCapabilities: { office: true } })
  const remote = new CapabilityEnvironment('remote-work', 'remote', { productCapabilities: { office: true } })
  const { engine } = await fixture(context, [local, remote], { hostCapabilities: { browser: true, mcp: true } })

  const localReceipt = await engine.submit({ commandId: 'office-local', eventId: 'office-local', text: 'Edit the document.',
    capabilities: ['office'] })
  const localConversation = await settle(engine, localReceipt.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(localConversation.assignments[0].environment.id, 'host-work')
  assert.deepEqual(localConversation.executionSelection.requiredCapabilities, ['office'])
  assert.equal(localConversation.capabilityPlan.status, 'available')
  assert.equal(localConversation.capabilityPlan.items[0].id, 'office')
  assert.equal(localConversation.capabilityPlan.items[0].environmentId, 'host-work')

  const remoteReceipt = await engine.submit({ commandId: 'office-remote', eventId: 'office-remote', text: 'Edit the document.',
    target: 'remote-only', capabilities: ['office'] })
  const waiting = await settle(engine, remoteReceipt.ticketId, conversation => conversation.reason === 'environment-waiting')
  assert.deepEqual(waiting.assignments, [])
  assert.equal(waiting.executionSelection.status, 'waiting')
  assert.equal(waiting.capabilityPlan.status, 'blocked')
  assert.match(waiting.capabilityPlan.items[0].reasons.join(' '), /remote-office-contract-unverified/u)
  assert.equal(waiting.executionSelection.candidates.find(candidate => candidate.id === 'remote-work').permissions.includes('command'), true)
})

test('host-only browser or MCP blocks remote-only and leaves auto on a local Environment', async context => {
  const local = new CapabilityEnvironment('host-work', 'local')
  const remote = new CapabilityEnvironment('remote-work', 'remote')
  const { engine } = await fixture(context, [local, remote], { hostCapabilities: { browser: true, mcp: true } })

  const blocked = await engine.submit({ commandId: 'browser-remote', eventId: 'browser-remote', text: 'Use the browser.',
    target: 'remote-only', capabilities: ['browser'] })
  const waiting = await settle(engine, blocked.ticketId, conversation => conversation.reason === 'environment-waiting')
  assert.deepEqual(waiting.assignments, [])
  assert.equal(waiting.capabilityPlan.items[0].location, 'host')
  assert.match(waiting.capabilityPlan.items[0].reasons.join(' '), /Host/u)

  const auto = await engine.submit({ commandId: 'browser-auto', eventId: 'browser-auto', text: 'Use the browser.',
    target: 'auto', capabilities: ['browser'] })
  const selected = await settle(engine, auto.ticketId, conversation => conversation.assignments.length > 0)
  assert.equal(selected.assignments[0].environment.id, 'host-work')
  assert.equal(selected.capabilityPlan.status, 'available')
  assert.equal(selected.capabilityPlan.items[0].environmentId, undefined)
})

test('an undeclared Host capability fails closed even for a local Environment', async context => {
  const local = new CapabilityEnvironment('host-work', 'local')
  const { engine } = await fixture(context, [local])
  const receipt = await engine.submit({ commandId: 'browser-undeclared', eventId: 'browser-undeclared',
    text: 'Use the browser.', capabilities: ['browser'] })
  const waiting = await settle(engine, receipt.ticketId, conversation => conversation.reason === 'environment-waiting')
  assert.deepEqual(waiting.assignments, [])
  assert.equal(waiting.capabilityPlan.status, 'blocked')
  assert.match(waiting.capabilityPlan.items[0].reasons.join(' '), /not declared/u)
})

test('Office requires its local skills and command permissions without widening the Environment', async context => {
  const withoutOffice = new CapabilityEnvironment('host-work', 'local', { productCapabilities: { office: false } })
  const { engine } = await fixture(context, [withoutOffice], { hostCapabilities: { browser: true } })
  const receipt = await engine.submit({ commandId: 'office-missing', eventId: 'office-missing', text: 'Edit the document.',
    capabilities: ['office'] })
  const waiting = await settle(engine, receipt.ticketId, conversation => conversation.reason === 'environment-waiting')
  assert.deepEqual(waiting.assignments, [])
  assert.equal(waiting.capabilityPlan.status, 'blocked')
  assert.match(waiting.capabilityPlan.items[0].reasons.join(' '), /office|skills|command/u)
  assert.deepEqual(withoutOffice.config.permissions, ['read', 'write', 'search', 'command'])
})

test('a real local Environment with skills and an office command satisfies Office', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-office-capability-'))
  const root = join(directory, 'work')
  const skills = join(directory, 'skills')
  await mkdir(root)
  await mkdir(join(skills, 'office'), { recursive: true })
  await writeFile(join(skills, 'office', 'SKILL.md'), '---\nname: office\ndescription: Office helper.\n---\nUse office.\n')
  const local = await core.LocalEnvironment.open({ id: 'host-work', instanceId: 'private', root,
    allowedActorIds: ['user'], permissions: ['read', 'write', 'search', 'command'], skillsPath: skills,
    commands: { office: { argv: [process.execPath, '-e', "console.log('office')"], timeoutMs: 2000 } } })
  const { engine } = await fixture(context, [local])
  context.after(() => rm(directory, { recursive: true, force: true }))
  const receipt = await engine.submit({ commandId: 'real-office', eventId: 'real-office', text: 'Edit the office document.',
    capabilities: ['office'] })
  const conversation = await settle(engine, receipt.ticketId, value => value.assignments.length > 0)
  assert.equal(conversation.assignments[0].environment.id, 'host-work')
  assert.equal(conversation.capabilityPlan.status, 'available')
  assert.equal((await engine.getEnvironmentCapabilities('host-work')).skills.supported, true)
  const bound = await local.prepare({ instanceId: 'private', actorId: 'user' })
  assert.deepEqual((await bound.listSkills()).map(skill => skill.name), ['office'])
  const job = await bound.startCommand('office')
  assert.equal((await job.done).exitCode, 0)
  assert.match(job.read().stdout.text, /office/u)
})

test('a non-capability blocker stays visible in the capability plan', async context => {
  const full = new CapabilityEnvironment('host-work', 'local', { productCapabilities: { office: true },
    capacity: { active: 4, max: 4 } })
  const { engine } = await fixture(context, [full])
  const receipt = await engine.submit({ commandId: 'office-full', eventId: 'office-full', text: 'Edit the document.',
    capabilities: ['office'] })
  const waiting = await settle(engine, receipt.ticketId, conversation => conversation.reason === 'environment-waiting')
  assert.match(waiting.capabilityPlan.items[0].reasons.join(' '), /capacity/u)
})

test('a real paired device explicitly rejects Office while remaining an eligible non-Office target', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-office-remote-'))
  const root = join(directory, 'device-work')
  await mkdir(root)
  const device = await core.RemoteDevice.open({ deviceId: 'office-device', root,
    grants: [{ instanceId: 'private', environmentId: 'remote-work', allowedActorIds: ['user'],
      permissions: ['read', 'write', 'search'] }] })
  const remote = await core.RemoteEnvironment.pair({ id: 'remote-work', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search'], endpoint: await device.start(), pairingCode: device.pairingCode,
    expectedDeviceId: 'office-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const { engine } = await fixture(context, [remote])
  context.after(async () => { await remote.close(); await device.close(); await rm(directory, { recursive: true, force: true }) })
  const receipt = await engine.submit({ commandId: 'remote-office-real', eventId: 'remote-office-real',
    text: 'Edit the office document.', target: 'remote-only', capabilities: ['office'] })
  const waiting = await settle(engine, receipt.ticketId, value => value.reason === 'environment-waiting')
  assert.deepEqual(waiting.assignments, [])
  assert.match(waiting.capabilityPlan.items[0].reasons.join(' '), /remote-office-contract-unverified/u)
  assert.equal(waiting.executionSelection.candidates[0].productCapabilities.office, false)
})

test('capability requirements are validated, idempotent and isolated by Instance', async context => {
  const local = new CapabilityEnvironment('host-work', 'local')
  const { engine, storage, sessions } = await fixture(context, [local], { hostCapabilities: { browser: true } })
  await assert.rejects(engine.submit({ commandId: 'unknown-capability', eventId: 'unknown-capability', text: 'Work.',
    capabilities: ['browser', 'browser'] }), { code: 'INVALID_INPUT' })
  await assert.rejects(engine.submit({ commandId: 'unknown-capability', eventId: 'unknown-capability', text: 'Work.',
    capabilities: ['shell'] }), { code: 'INVALID_INPUT' })
  const receipt = await engine.submit({ commandId: 'stable-capability', eventId: 'stable-capability', text: 'Work.',
    capabilities: ['browser'] })
  await assert.rejects(engine.submit({ commandId: 'stable-capability', eventId: 'stable-capability', text: 'Work.',
    capabilities: ['mcp'] }), { code: 'IDENTITY_CONFLICT' })
  const plan = await engine.getCapabilityPlan(receipt.ticketId)
  assert.deepEqual(plan.required, ['browser'])
  const foreign = new core.Engine(storage, 'private', { sourceInstanceId: 'other', actorId: 'user', allowedActorIds: ['user'] },
    {}, sessions, [local])
  await assert.rejects(foreign.getCapabilityPlan(receipt.ticketId), { code: 'SOURCE_NOT_AUTHORIZED' })
  const otherActor = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'other',
    allowedActorIds: ['user', 'other'] }, {}, sessions, [local])
  await assert.rejects(otherActor.getCapabilityPlan(receipt.ticketId), { code: 'SOURCE_NOT_AUTHORIZED' })
  assert.equal((await foreign.getCapabilityLocations()).find(item => item.id === 'browser').local.support, 'unavailable')
})

test('an inferred intake acceptance carries capability requirements', async context => {
  const local = new CapabilityEnvironment('host-work', 'local', { productCapabilities: { office: true } })
  const { engine } = await fixture(context, [local], { allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000,
      allowedRequesterIds: ['user'], allowedBotActorIds: [],
      rules: [{ id: 'inferred', actorKinds: ['human'], addressing: ['direct'], mode: 'inferred' }],
      assess: async (events, _signal, onDelivered) => {
        await onDelivered()
        return events.map(event => ({ eventId: event.eventId, outcome: 'accept', reason: 'Office work.', capabilities: ['office'] }))
      } } })
  const received = await engine.receiveSource({ commandId: 'capability-intake', threadId: 'room', objectId: 'office-message',
    type: 'created', version: '1', text: 'Edit the office document.' })
  assert.equal(received.status, 'recorded')
  const evaluated = await engine.assessSourceBatch({ commandId: 'capability-intake-eval', threadId: 'room', eventIds: [received.eventId] })
  const receipt = evaluated.items.find(item => item.receipt)?.receipt
  assert.ok(receipt)
  const conversation = await settle(engine, receipt.ticketId, value => value.assignments.length > 0)
  assert.deepEqual(conversation.capabilityPlan.required, ['office'])
  assert.equal(conversation.capabilityPlan.status, 'available')
})
