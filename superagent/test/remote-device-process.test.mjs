import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as core from '../dist/index.js'

test('a separate device process serves a paired host over the encrypted channel', { timeout: 20000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-process-'))
  const root = join(directory, 'device-work')
  await mkdir(root)
  const config = join(directory, 'device.json')
  const pairingCodePath = join(directory, 'pairing-code.txt')
  await writeFile(config, JSON.stringify({ deviceId: 'separate-device', root, statePath: join(directory, 'device-state.json'),
    grants: [{ instanceId: 'private', environmentId: 'remote-project', allowedActorIds: ['user'], permissions: ['read', 'write', 'search'] }] }))
  const child = spawn(process.execPath, ['dev/remote-device.mjs', '--config', config, '--pairing-code-file', pairingCodePath],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] })
  context.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)) }
    await rm(directory, { recursive: true, force: true })
  })
  const ready = await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      const line = stdout.split(/\r?\n/u).find(Boolean)
      if (line) try { resolve(JSON.parse(line)) } catch { /* Wait for the complete line. */ }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`The device process exited before it was ready (${code}): ${stderr.slice(0, 500)}`)))
  })
  assert.equal(ready.deviceId, 'separate-device')
  const pairingCode = (await readFile(pairingCodePath, 'utf8')).trim()
  assert.match(pairingCode, /^\d{8}$/u)
  const environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search'], endpoint: ready.endpoint, pairingCode,
    expectedDeviceId: ready.deviceId, expectedDeviceKey: ready.deviceKeyFingerprint })
  context.after(() => environment.close())
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  await bound.invoke('write_file', { path: 'process.txt', text: 'written on the device process\n' })
  assert.equal((await bound.invoke('read_file', { path: 'process.txt' })).text, 'written on the device process\n')
  assert.equal(await readFile(join(root, 'process.txt'), 'utf8'), 'written on the device process\n')
  assert.deepEqual((await bound.invoke('grep', { pattern: 'device process' })).matches,
    [{ path: 'process.txt', line: 1, text: 'written on the device process' }])
  await environment.revoke()
  await assert.rejects(environment.prepare({ instanceId: 'private', actorId: 'user' }), { code: 'DEVICE_REVOKED' })
})
