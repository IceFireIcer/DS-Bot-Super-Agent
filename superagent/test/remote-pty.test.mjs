import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'

const grant = {
  instanceId: 'private',
  environmentId: 'remote-project',
  allowedActorIds: ['user'],
  permissions: ['read', 'write', 'search', 'command'],
}

const scripts = {
  pty: "const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync('pty-child.pid',String(child.pid));console.log('pty-ready');process.stdin.on('data',data=>process.stdout.write('echo:'+data))",
  tree: "const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync('tree-child.pid',String(child.pid));console.log('tree-ready');setInterval(()=>{},1000)",
  check: "const fs=require('node:fs');const pid=Number(fs.readFileSync(process.argv[1],'utf8'));try{process.kill(pid,0);console.log('alive')}catch{console.log('gone')}",
}

const commands = {
  pty: { argv: ['node', '-e', scripts.pty], timeoutMs: 5000, backgroundTimeoutMs: 15000, pty: true },
  tree: { argv: ['node', '-e', scripts.tree], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  checkPty: { argv: ['node', '-e', scripts.check, 'pty-child.pid'], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  checkTree: { argv: ['node', '-e', scripts.check, 'tree-child.pid'], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`)
    await sleep(20)
  }
}

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-pty-'))
  const root = join(directory, 'device-work')
  await mkdir(root)
  let device, environment
  context.after(async () => {
    await environment?.close()
    await device?.close()
    await rm(directory, { recursive: true, force: true })
  })
  device = await core.RemoteDevice.open({ deviceId: 'second-device', root, jobsPath: join(directory, 'device-jobs'),
    commands, grants: [grant], statePath: join(directory, 'device-state.json') })
  const endpoint = await device.start()
  environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], endpoint, pairingCode: device.pairingCode,
    expectedDeviceId: 'second-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  return { root, device, environment, bound }
}

// The GitHub Windows runner has no working ConPTY for this node-pty build; the real Windows T34 run covers it.
const ptySkip = process.platform === 'win32' && process.env.CI === 'true'
  ? 'GitHub Windows runners provide no working ConPTY for node-pty.' : false

test('a configured PTY exposes the public terminal handle and writes/echoes through the device', { timeout: 20000, skip: ptySkip }, async context => {
  const { bound } = await fixture(context)
  const terminal = await bound.spawnTerminal({ name: 'pty', rows: 24, cols: 80 })
  assert.ok(Number.isInteger(terminal.pid) && terminal.pid >= 0)
  assert.equal(typeof terminal.output.on, 'function')
  assert.equal(typeof terminal.write, 'function')
  assert.equal(typeof terminal.resize, 'function')
  assert.equal(typeof terminal.signalForeground, 'function')
  assert.equal(typeof terminal.inspectForeground, 'function')
  assert.equal(typeof terminal.inspectActivity, 'function')
  const chunks = []
  terminal.output.on('data', chunk => chunks.push(chunk.toString()))
  await until(() => chunks.join('').includes('pty-ready'), 'PTY readiness')
  await terminal.write('hello\n')
  await until(() => chunks.join('').includes('hello'), 'PTY echo')
  await terminal.resize(100, 40)
  assert.equal(await terminal.inspectForeground(), undefined)
  assert.equal((await terminal.inspectActivity()).state, 'unknown')
  await terminal.terminate()
  assert.equal((await bound.invoke('run_command', { name: 'checkPty' })).stdout.trim(), 'gone')
})

test('cancelling a command confirms the whole process group, not only the parent', { timeout: 20000 }, async context => {
  const { bound } = await fixture(context)
  const job = await bound.startCommand('tree')
  await until(() => job.read().stdout.text.includes('tree-ready'), 'the process tree')
  assert.equal((await bound.invoke('run_command', { name: 'checkTree' })).stdout.trim(), 'alive')
  job.terminate()
  assert.equal(await job.done.then(result => result.cancelled), true)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal((await bound.invoke('run_command', { name: 'checkTree' })).stdout.trim(), 'gone')
})
