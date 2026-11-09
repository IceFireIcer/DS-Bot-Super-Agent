import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'

const allPermissions = ['read', 'write', 'search', 'command']
const grant = { instanceId: 'private', environmentId: 'remote-project', allowedActorIds: ['user'], permissions: allPermissions }
const big = { big: { argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(40000)+'\\nEND\\n')"], timeoutMs: 10000, backgroundTimeoutMs: 20000 } }

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }

async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function readAll(bound, reference, pageBytes = 4096) {
  const pages = []
  let offset = 0
  while (true) {
    const page = await bound.readAsset(reference, { offset, maxBytes: pageBytes })
    assert.equal(page.encoding, 'utf8')
    pages.push(page.text)
    if (!page.truncated) break
    assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  }
  return pages.join('')
}

async function localFixture(context, { assets = true, commands = big } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-local-assets-'))
  const root = join(directory, 'work')
  await mkdir(root)
  const assetsPath = join(directory, 'assets')
  let environment
  context.after(async () => {
    await environment?.close()
    await rm(directory, { recursive: true, force: true })
  })
  environment = await core.LocalEnvironment.open({ id: 'project', instanceId: 'private', root, allowedActorIds: ['user'],
    permissions: allPermissions, commands, ...(assets ? { assetsPath } : {}) })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  return { directory, root, assetsPath, environment, bound }
}

async function remoteFixture(context, { assets = true, commands = big, deviceId = 'asset-device' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-assets-'))
  const root = join(directory, 'device-work')
  const hostRoot = join(directory, 'host-work')
  await mkdir(root)
  await mkdir(hostRoot)
  const resolvedRoot = await realpath(root)
  const config = { deviceId, root, grants: [grant], commands, jobsPath: join(directory, 'jobs'),
    statePath: join(directory, 'state.json'), ...(assets ? { assetsPath: join(directory, 'device-assets') } : {}) }
  let device, environment
  context.after(async () => {
    await environment?.close()
    await device?.close()
    await rm(directory, { recursive: true, force: true })
  })
  device = await core.RemoteDevice.open(config)
  const endpoint = await device.start()
  environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: allPermissions, endpoint, pairingCode: device.pairingCode, expectedDeviceId: deviceId,
    expectedDeviceKey: device.deviceKeyFingerprint })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  return { directory, root, resolvedRoot, hostRoot, assetsPath: config.assetsPath, config, device, environment, bound, endpoint }
}

test('local attachments are content-addressed and every page stays bound to the local Environment identity', { timeout: 20000 }, async context => {
  const { bound, assetsPath } = await localFixture(context)
  const content = Buffer.from('attachment-多字节-✓\n')
  const reference = await bound.saveAttachment({ name: 'evidence.txt', data: content, mediaType: 'text/plain' })
  assert.equal(reference.kind, 'attachment')
  assert.equal(reference.environmentId, 'project')
  assert.equal(reference.environmentKind, 'local')
  assert.match(reference.environmentFingerprint, /^local:/u)
  assert.equal(reference.sha256, digest(content))
  assert.equal(reference.bytes, content.length)
  assert.equal(reference.id, `file:sha256:${digest(content)}`)
  assert.equal(await readAll(bound, reference, 5), content.toString('utf8'))
  assert.deepEqual(await readFile(join(assetsPath, 'files', digest(content))), content)

  const capabilities = await bound.assetCapabilities()
  assert.equal(capabilities.attachments.supported, true)
  assert.equal(capabilities.spill.supported, true)
  assert.equal(capabilities.skills.supported, false)
  assert.ok(capabilities.skills.gaps.includes('skill-discovery-public-seam-missing'))
  await assert.rejects(bound.readAsset({ ...reference, environmentFingerprint: 'local:other' }), { code: 'REFERENCE_STALE' })
  await assert.rejects(bound.readAsset({ kind: 'skill', environmentId: 'project', environmentKind: 'local',
    environmentFingerprint: reference.environmentFingerprint, id: 'skill:office', bytes: 0, sha256: '' }), {
    code: 'ENVIRONMENT_UNSUPPORTED', message: /skill-discovery-public-seam-missing/u })
})

test('local long output pages the complete spill instead of the bounded tail', { timeout: 30000 }, async context => {
  const { bound } = await localFixture(context)
  const result = await bound.invoke('run_command', { name: 'big' })
  assert.equal(result.exitCode, 0)
  assert.equal(result.truncated, true)
  assert.equal(result.stdout, '[Truncated output withheld to protect credentials.]')
  assert.ok(result.spills?.stdout)
  const reference = result.spills.stdout
  assert.equal(reference.kind, 'spill')
  assert.equal(reference.bytes, 40005)
  const complete = await readAll(bound, reference, 16384)
  assert.equal(complete.length, 40005)
  assert.equal(complete.slice(0, 40000), 'x'.repeat(40000))
  assert.equal(complete.slice(40000), '\nEND\n')
  const last = await bound.readAsset(reference, { offset: 40000, maxBytes: 16 })
  assert.equal(last.text, '\nEND\n')
  assert.equal(last.truncated, false)
})

test('remote attachments stay on the device and a same-named Host file cannot substitute', { timeout: 30000 }, async context => {
  const { bound, root, hostRoot, assetsPath } = await remoteFixture(context)
  const content = Buffer.from('device attachment content\n')
  const reference = await bound.saveAttachment({ name: 'evidence.txt', data: content })
  assert.equal(reference.environmentKind, 'remote')
  assert.equal(reference.deviceId, 'asset-device')
  assert.ok(reference.deviceIncarnation)
  assert.equal(await readAll(bound, reference, 7), content.toString('utf8'))
  assert.deepEqual(await readFile(join(assetsPath, 'files', digest(content))), content)
  await writeFile(join(root, 'evidence.txt'), 'same-named device work file\n')
  await writeFile(join(hostRoot, 'evidence.txt'), 'same-named host work file\n')
  assert.equal(await readAll(bound, reference, 7), content.toString('utf8'))

  await writeFile(join(root, 'artifact.txt'), 'artifact bytes\n')
  const artifact = await bound.artifact('artifact.txt')
  assert.equal(artifact.reference.kind, 'artifact')
  assert.equal(await readAll(bound, artifact.reference), 'artifact bytes\n')
  await writeFile(join(root, 'artifact.txt'), 'replacement bytes\n')
  await assert.rejects(bound.readAsset(artifact.reference), { code: 'REFERENCE_STALE' })
})

test('remote spill survives a Host reconnect and a daemon restart by its original reference', { timeout: 40000 }, async context => {
  const { bound, environment, device, config, endpoint } = await remoteFixture(context)
  const job = await bound.startCommand('big')
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  const reference = await bound.spillReference(job.jobId, 'stdout')
  assert.equal(reference.bytes, 40005)
  assert.equal(await readAll(bound, reference, 8192), 'x'.repeat(40000) + '\nEND\n')

  const snapshot = environment.snapshot()
  await environment.close()
  const restored = core.RemoteEnvironment.restore(snapshot)
  const reconnected = await restored.prepare({ instanceId: 'private', actorId: 'user' })
  assert.equal(await readAll(reconnected, reference, 8192), 'x'.repeat(40000) + '\nEND\n')

  const port = Number(new URL(endpoint).port)
  await device.close()
  const restarted = await core.RemoteDevice.open({ ...config, listenPort: port })
  context.after(() => restarted.close())
  const restartedEndpoint = await restarted.start()
  assert.equal(restartedEndpoint, endpoint)
  const afterRestart = await restored.prepare({ instanceId: 'private', actorId: 'user' })
  assert.equal(await readAll(afterRestart, reference, 8192), 'x'.repeat(40000) + '\nEND\n')
  const evidence = await afterRestart.spillReference(job.jobId, 'stdout')
  assert.equal(evidence.sha256, reference.sha256)
  assert.equal(evidence.bytes, reference.bytes)
  await restored.close()
})

test('a device without an asset store explicitly rejects attachments and spill with listed gaps', { timeout: 20000 }, async context => {
  const { bound, environment } = await remoteFixture(context, { assets: false })
  const capabilities = await bound.assetCapabilities()
  assert.equal(capabilities.attachments.supported, false)
  assert.ok(capabilities.attachments.gaps.includes('device-asset-store-unconfigured'))
  assert.equal(capabilities.spill.supported, false)
  assert.equal(capabilities.skills.supported, false)
  await assert.rejects(bound.saveAttachment({ name: 'blocked.txt', data: Buffer.from('blocked') }), {
    code: 'ENVIRONMENT_UNSUPPORTED', message: /device-asset-store-unconfigured/u })
  await assert.rejects(bound.invoke('save_attachment', { name: 'blocked.txt', data: Buffer.from('blocked').toString('base64'), encoding: 'base64', mediaType: '' }),
    { code: 'ENVIRONMENT_UNSUPPORTED', message: /device-asset-store-unconfigured/u })
  await assert.rejects(bound.readAsset({ kind: 'skill', environmentId: 'remote-project', environmentKind: 'remote',
    environmentFingerprint: environment.assetFingerprint, deviceId: 'asset-device', deviceIncarnation: environment.deviceIncarnation,
    id: 'skill:office', bytes: 0, sha256: '' }), { code: 'ENVIRONMENT_UNSUPPORTED', message: /skill-discovery-public-seam-missing/u })
})

test('the public Engine can save and re-read an attachment through the Environment after a transport outage', { timeout: 30000 }, async context => {
  const { environment } = await remoteFixture(context)
  const stateDirectory = await mkdtemp(join(tmpdir(), 'ds-bot-asset-engine-'))
  const storage = await SqliteStorage.open(join(stateDirectory, 'engine.sqlite'))
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    {}, undefined, [environment])
  context.after(async () => { await engine.shutdown(); await storage.close(); await rm(stateDirectory, { recursive: true, force: true }) })
  const content = Buffer.from('engine attachment content\n')
  const reference = await engine.saveEnvironmentAttachment({ commandId: 'save-attachment', environmentId: 'remote-project',
    name: 'engine.txt', data: content.toString('base64'), encoding: 'base64', mediaType: 'text/plain' })
  assert.equal(reference.id, `file:sha256:${digest(content)}`)
  const replay = await engine.saveEnvironmentAttachment({ commandId: 'save-attachment', environmentId: 'remote-project',
    name: 'engine.txt', data: content.toString('base64'), encoding: 'base64', mediaType: 'text/plain' })
  assert.deepEqual(replay, reference)
  await assert.rejects(engine.saveEnvironmentAttachment({ commandId: 'save-attachment', environmentId: 'remote-project',
    name: 'different.txt', data: content.toString('base64'), encoding: 'base64', mediaType: 'text/plain' }), { code: 'IDENTITY_CONFLICT' })
  const page = await engine.readEnvironmentAsset({ environmentId: 'remote-project', reference })
  assert.equal(page.text, content.toString('utf8'))
  const capabilities = await engine.getEnvironmentCapabilities('remote-project')
  assert.equal(capabilities.attachments.supported, true)
  assert.equal(capabilities.skills.supported, false)
})

test('a delegated child inherits the same remote asset tools and reads its parent attachment', { timeout: 40000 }, async context => {
  const { environment, hostRoot } = await remoteFixture(context)
  const stateDirectory = await mkdtemp(join(tmpdir(), 'ds-bot-asset-subagent-'))
  await writeFile(join(hostRoot, 'child-evidence.txt'), 'host substitute\n')
  const content = Buffer.from('remote-child-evidence\n')
  const sha256 = digest(content)
  let childTools
  let native, storage, sessions, engine
  context.after(async () => {
    await engine?.shutdown(); await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(stateDirectory, { recursive: true, force: true })
  })
  native = await nativeContext(join(stateDirectory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'router') return routerResponse(options)
    if (options.sessionId.startsWith('subagent-')) {
      childTools = options.tools.map(tool => tool.name).sort()
      if (!results.length) {
        return toolResponse('read_asset', { kind: 'attachment', id: `file:sha256:${sha256}`, sha256, bytes: String(content.length),
          offset: '', maxBytes: '', path: '' }, 'child-read')
      }
      const last = results.at(-1)
      const body = last.content.filter(block => block.type === 'text').map(block => block.text).join('')
      return textResponse(`child-read:${body.includes('remote-child-evidence') ? 'ok' : 'missing'}`)
    }
    if (text.includes('child-evidence')) {
      if (!results.length) return toolResponse('save_attachment', { name: 'child-evidence.txt',
        data: content.toString('base64'), encoding: 'base64', mediaType: 'text/plain' }, 'parent-save')
      if (results.length === 1) return toolResponse('delegate_subagent', { task: 'Read the parent attachment and report its text.' }, 'parent-delegate')
      return textResponse('Delegated.')
    }
    if (results.length === 1 && text.startsWith('Subagent ')) return toolResponse('report_ready',
      { result: 'Child read the parent attachment.', evidence: 'The child inherited the same remote asset tools.', artifacts: '' }, 'parent-ready')
    return textResponse('Child finished.')
  })
  storage = await SqliteStorage.open(join(stateDirectory, 'subagent.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    {}, sessions, [environment], {}, { waitMs: 60000 })
  engine.effects.start()
  const receipt = await engine.submit({ commandId: 'child-evidence', eventId: 'child-evidence', text: 'Use the child-evidence attachment.',
    environmentId: 'remote-project' })
  await until(async () => (await engine.listSubagents(receipt.ticketId)).some(child => child.settled), 'the child result')
  const [child] = await engine.listSubagents(receipt.ticketId)
  assert.equal(child.state, 'completed')
  assert.equal(child.succeeded, true)
  assert.match(child.result.text, /child-read:ok/u)
  assert.ok(childTools.includes('read_asset'))
  assert.ok(childTools.includes('save_attachment'))
})
