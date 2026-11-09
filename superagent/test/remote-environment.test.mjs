import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'

const grant = {
  instanceId: 'private',
  environmentId: 'remote-project',
  allowedActorIds: ['user'],
  permissions: ['read', 'write', 'search'],
}

async function fixture(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-environment-'))
  const rootPath = join(directory, 'device-work')
  await mkdir(rootPath)
  const root = await realpath(rootPath)
  let device
  context.after(async () => { await device?.close(); await rm(directory, { recursive: true, force: true }) })
  device = await core.RemoteDevice.open({ deviceId: 'second-device', root, grants: Array.isArray(options.grants) ? options.grants : [grant], ...options })
  const endpoint = await device.start()
  return { directory, root, device, endpoint }
}

function pairOptions(endpoint, pairingCode, overrides = {}) {
  return { id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'], permissions: ['read', 'write', 'search'],
    endpoint, pairingCode, expectedDeviceId: 'second-device', expectedDeviceKey: '0'.repeat(64), ...overrides }
}

test('a paired device serves bounded files and literal search through an authenticated channel', async context => {
  const { root, device, endpoint } = await fixture(context)
  await writeFile(join(root, 'existing.txt'), 'device content\n')
  await assert.rejects(core.RemoteEnvironment.pair(pairOptions(endpoint, '00000000')), { code: 'PAIRING_DENIED' })
  await assert.rejects(core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode, { allowedActorIds: ['intruder'] })), { code: 'GRANT_DENIED' })
  await assert.rejects(core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode, { expectedDeviceId: 'impostor' })), error =>
    error.code === 'DEVICE_IDENTITY_MISMATCH' && !error.message.includes(device.pairingCode))
  const environment = await core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode, { expectedDeviceKey: device.deviceKeyFingerprint }))
  context.after(() => environment.close())
  assert.equal(environment.kind, 'remote')
  assert.equal(environment.deviceId, 'second-device')
  assert.equal(environment.deviceKeyFingerprint, device.deviceKeyFingerprint)
  assert.equal(environment.config.root, root)

  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  assert.equal((await bound.invoke('read_file', { path: 'existing.txt' })).text, 'device content\n')
  await mkdir(join(root, 'nested'))
  await bound.invoke('write_file', { path: 'nested/answer.txt', text: 'hello\n' })
  assert.equal(await readFile(join(root, 'nested/answer.txt'), 'utf8'), 'hello\n')
  assert.deepEqual((await bound.invoke('glob', { pattern: '*.txt' })).paths, ['existing.txt', 'nested/answer.txt'])
  assert.deepEqual((await bound.invoke('grep', { pattern: 'hello' })).matches, [{ path: 'nested/answer.txt', line: 1, text: 'hello' }])
  assert.equal((await bound.artifact('nested/answer.txt')).sha256, '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')
  for (const path of ['../existing.txt', '/etc/passwd', 'C:\\Windows\\win.ini', '.env', 'nested/../../existing.txt']) {
    await assert.rejects(bound.invoke('read_file', { path }), { code: 'PATH_DENIED' })
  }
  await assert.rejects(bound.invoke('run_command', { name: 'verify' }), { code: 'UNSUPPORTED_CAPABILITY' })
  await assert.rejects(environment.call({ instanceId: 'private', environmentId: 'other', actorId: 'user', operation: 'status', args: {} }), { code: 'GRANT_DENIED' })
  await assert.rejects(environment.call({ instanceId: 'private', environmentId: 'remote-project', actorId: 'intruder', operation: 'status', args: {} }), { code: 'GRANT_DENIED' })
  await assert.rejects(environment.prepare({ instanceId: 'other', actorId: 'user' }), { code: 'ENVIRONMENT_DENIED' })
  await assert.rejects(environment.prepare({ instanceId: 'private', actorId: 'intruder' }), { code: 'ENVIRONMENT_DENIED' })
})

test('the peer cannot read a file through a symbolic link or a revoked pairing', async context => {
  const { root, device, endpoint, directory } = await fixture(context)
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'outside')
  const { symlink } = await import('node:fs/promises')
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  const environment = await core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode, { expectedDeviceKey: device.deviceKeyFingerprint }))
  context.after(() => environment.close())
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  await assert.rejects(bound.invoke('read_file', { path: 'linked/secret.txt' }), { code: 'PATH_DENIED' })
  assert.deepEqual((await bound.invoke('glob', { pattern: '*' })).paths, [])
  await environment.revoke()
  assert.equal(environment.revoked, true)
  assert.throws(() => environment.snapshot(), { code: 'DEVICE_REVOKED' })
  await assert.rejects(environment.prepare({ instanceId: 'private', actorId: 'user' }), { code: 'DEVICE_REVOKED' })
  await assert.rejects(bound.invoke('read_file', { path: 'nothing.txt' }), { code: 'DEVICE_REVOKED' })
})

test('requests and results stay encrypted on the wire', async context => {
  const { root, device, endpoint } = await fixture(context)
  const seen = []
  const proxy = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      seen.push(Buffer.concat(chunks).toString('utf8'))
      const target = new URL(request.url, endpoint)
      const upstream = httpRequest(target, { method: request.method, headers: request.headers }, result => {
        response.writeHead(result.statusCode ?? 500, result.headers)
        result.pipe(response)
      })
      upstream.on('error', error => response.writeHead(502).end(error.message))
      upstream.end(Buffer.concat(chunks))
    })
  })
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve) })
  context.after(() => new Promise(resolve => { proxy.closeAllConnections(); proxy.close(resolve) }))
  const address = proxy.address()
  const proxied = `http://127.0.0.1:${address.port}`
  const environment = await core.RemoteEnvironment.pair(pairOptions(proxied, device.pairingCode, { expectedDeviceKey: device.deviceKeyFingerprint }))
  context.after(() => environment.close())
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  await bound.invoke('write_file', { path: 'wire.txt', text: 'transport-secret-value' })
  assert.equal((await bound.invoke('read_file', { path: 'wire.txt' })).text, 'transport-secret-value')
  const wire = seen.join('\n')
  assert.ok(seen.length >= 3)
  assert.doesNotMatch(wire, /transport-secret-value/u)
  assert.doesNotMatch(wire, /wire\.txt/u)
  assert.doesNotMatch(wire, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
})

test('a paired device rejects a forged or replayed encrypted envelope', async context => {
  const { device, endpoint } = await fixture(context)
  const environment = await core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode, { expectedDeviceKey: device.deviceKeyFingerprint }))
  context.after(() => environment.close())
  const forged = await fetch(`${endpoint}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, pairingId: 'forged', requestId: 'request', at: Date.now(),
      body: Buffer.alloc(32).toString('base64url') }) })
  assert.equal(forged.status, 401)
  assert.ok(!JSON.stringify(await forged.json()).includes(device.pairingCode))
})

test('device state persists the paired host without persisting its pairing code', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-device-state-'))
  const root = join(directory, 'work')
  await mkdir(root)
  const statePath = join(directory, 'device-state.json')
  let device
  context.after(async () => { await device?.close(); await rm(directory, { recursive: true, force: true }) })
  device = await core.RemoteDevice.open({ deviceId: 'second-device', root, grants: [grant], statePath })
  const endpoint = await device.start()
  const environment = await core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode, { expectedDeviceKey: device.deviceKeyFingerprint }))
  context.after(() => environment.close())
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  await bound.invoke('write_file', { path: 'persisted.txt', text: 'kept' })
  const pairingCode = device.pairingCode
  const state = await readFile(statePath, 'utf8')
  assert.doesNotMatch(state, new RegExp(pairingCode, 'u'))
  await device.close()
  device = await core.RemoteDevice.open({ deviceId: 'second-device', root, grants: [grant], statePath, listenPort: Number(new URL(endpoint).port) })
  await device.start()
  const restored = await core.RemoteEnvironment.pair(pairOptions(`http://127.0.0.1:${new URL(endpoint).port}`, device.pairingCode,
    { expectedDeviceKey: environment.deviceKeyFingerprint }))
  context.after(() => restored.close())
  assert.equal(restored.deviceKeyFingerprint, environment.deviceKeyFingerprint)
})

test('a host restores its protected connection state without the pairing code', async context => {
  const { device, endpoint } = await fixture(context)
  const environment = await core.RemoteEnvironment.pair(pairOptions(endpoint, device.pairingCode,
    { expectedDeviceKey: device.deviceKeyFingerprint }))
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  await bound.invoke('write_file', { path: 'restored.txt', text: 'still paired\n' })
  const state = environment.snapshot()
  assert.equal(state.hostNonce.length > 0, true)
  assert.doesNotMatch(JSON.stringify(state), new RegExp(device.pairingCode, 'u'))
  await environment.close()
  const restored = core.RemoteEnvironment.restore(state)
  context.after(() => restored.close())
  const next = await restored.prepare({ instanceId: 'private', actorId: 'user' })
  assert.equal((await next.invoke('read_file', { path: 'restored.txt' })).text, 'still paired\n')
})
