import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, toolResponse, textResponse } from '../dev/native-mock.mjs'

const grant = {
  instanceId: 'private',
  environmentId: 'remote-project',
  allowedActorIds: ['user'],
  permissions: ['read', 'write', 'search'],
}

test('a Worker reads, writes and searches on the paired device and records that execution location', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-execution-'))
  const hostRoot = join(directory, 'host-work')
  const deviceRoot = join(directory, 'device-work')
  await mkdir(hostRoot)
  await mkdir(deviceRoot)
  const resolvedDeviceRoot = await realpath(deviceRoot)
  await writeFile(join(hostRoot, 'answer.txt'), 'host content')
  await writeFile(join(deviceRoot, 'answer.txt'), 'device content')
  let device, environment, native, storage, sessions, engine
  context.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await environment?.close(); await device?.close(); await rm(directory, { recursive: true, force: true })
  })
  device = await core.RemoteDevice.open({ deviceId: 'second-device', root: deviceRoot, grants: [grant] })
  const endpoint = await device.start()
  environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search'], endpoint, pairingCode: device.pairingCode, expectedDeviceId: 'second-device',
    expectedDeviceKey: device.deviceKeyFingerprint })
  let workerTools
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      workerTools = options.tools.map(tool => tool.name).sort()
      const steps = [
        ['read_file', { path: 'answer.txt' }], ['write_file', { path: 'answer.txt', text: 'remote content\n' }],
        ['read_file', { path: 'answer.txt' }], ['glob', { pattern: '*.txt' }], ['grep', { pattern: 'remote' }],
        ['report_ready', { result: 'Updated answer.txt on the paired device.', evidence: 'Read the device copy, wrote it, then read and searched it again after the write.', artifacts: 'answer.txt' }],
      ]
      const next = steps[results.length]
      return next ? toolResponse(next[0], next[1], `remote-${results.length}`) : textResponse('Ready.')
    }
    if (results.length) return textResponse('Recorded.')
    return text.startsWith('Ready report:') ? toolResponse('deliver_result', { reportId: JSON.parse(text.slice('Ready report:'.length)).id }) : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions, [environment])
  const receipt = await engine.submit({ commandId: 'remote', eventId: 'message', text: 'Update answer.txt on the paired device and verify it.', environmentId: 'remote-project' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'ready')
  assert.equal(conversation.assignments[0].environment.kind, 'remote')
  assert.equal(conversation.assignments[0].environment.id, 'remote-project')
  assert.equal(conversation.assignments[0].environment.deviceId, 'second-device')
  assert.equal(conversation.assignments[0].environment.root, resolvedDeviceRoot)
  assert.equal(conversation.executionLocation.kind, 'remote')
  assert.equal(conversation.reports[0].artifacts[0].path, 'answer.txt')
  assert.deepEqual(conversation.reports[0].toolFacts.map(fact => fact.tool), ['read_file', 'write_file', 'read_file', 'glob', 'grep'])
  assert.equal(conversation.reports[0].toolFacts[0].output.text, 'device content')
  assert.deepEqual(workerTools, ['add_thread_subscription', 'ask_human', 'cancel_subagent', 'delegate_subagent', 'glob', 'grep',
    'read_asset', 'read_context', 'read_file', 'remove_thread_subscription', 'report_ready', 'subagent_status', 'write_file'])
  assert.equal(await readFile(join(deviceRoot, 'answer.txt'), 'utf8'), 'remote content\n')
  assert.equal(await readFile(join(hostRoot, 'answer.txt'), 'utf8'), 'host content')
  const evidence = JSON.stringify(conversation.reports[0].toolFacts)
  assert.doesNotMatch(evidence, new RegExp(hostRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.doesNotMatch(evidence, new RegExp(resolvedDeviceRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  const listed = engine.listEnvironments()
  assert.deepEqual(listed.map(item => ({ id: item.id, kind: item.kind, deviceId: item.deviceId })), [{ id: 'remote-project', kind: 'remote', deviceId: 'second-device' }])
  await environment.revoke()
  await assert.rejects(engine.submit({ commandId: 'after-revoke', eventId: 'after-revoke', text: 'Use the revoked device.', environmentId: 'remote-project' }), { code: 'DEVICE_REVOKED' })
})

test('a remote ready report needs post-write file evidence and cannot request a command tool', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-verification-'))
  const deviceRoot = join(directory, 'device-work')
  await mkdir(deviceRoot)
  let device, environment, native, storage, sessions, engine
  context.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await environment?.close(); await device?.close(); await rm(directory, { recursive: true, force: true })
  })
  device = await core.RemoteDevice.open({ deviceId: 'second-device', root: deviceRoot, grants: [grant] })
  const endpoint = await device.start()
  environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search'], endpoint, pairingCode: device.pairingCode, expectedDeviceId: 'second-device',
    expectedDeviceKey: device.deviceKeyFingerprint })
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      const steps = [
        ['write_file', { path: 'answer.txt', text: 'unverified\n' }],
        ['report_ready', { result: 'Wrote without checking it.', evidence: 'Only wrote the file.', artifacts: 'answer.txt' }],
      ]
      const next = steps[results.length]
      return next ? toolResponse(next[0], next[1], `remote-verify-${results.length}`) : textResponse('Asked once.')
    }
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions, [environment])
  const receipt = await engine.submit({ commandId: 'remote-verification', eventId: 'remote-verification', text: 'Write the file.', environmentId: 'remote-project' })
  for (let index = 0; index < 10; index++) await engine.effects.drain()
  const conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.stage, 'idle', JSON.stringify({ status: conversation.status, reason: conversation.reason, stage: conversation.stage }))
  assert.equal(conversation.reason, 'worker-idle', JSON.stringify({ status: conversation.status, reason: conversation.reason, stage: conversation.stage }))
  assert.deepEqual(conversation.reports, [])
  assert.equal(await readFile(join(deviceRoot, 'answer.txt'), 'utf8'), 'unverified\n')
})
