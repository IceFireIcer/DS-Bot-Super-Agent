import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalEnvironment, NativeSessions, RemoteEnvironment, Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from './native-mock.mjs'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`Use --${name} <value>.`)
  return value
}

function optionalArgument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const host = argument('host')
const key = argument('key')
const packageRoot = argument('package-root')
const deviceRoot = argument('device-root')
const remotePort = Number(argument('remote-port'))
const localPort = optionalArgument('local-port') === undefined ? undefined : Number(optionalArgument('local-port'))
if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw new Error('--remote-port must be a TCP port.')
if (localPort !== undefined && (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)) throw new Error('--local-port must be a TCP port.')

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t39-acceptance-'))
const remotePath = (...parts) => parts.join('/').replace(/\/+/gu, '/')
const targetPath = remotePath(deviceRoot, 'target')
const configPath = remotePath(deviceRoot, 'device.json')
const pairingCodePath = remotePath(deviceRoot, 'pairing-code.txt')
const deviceLog = remotePath(deviceRoot, 'device.log')
const devicePid = remotePath(deviceRoot, 'device.pid')
const localConfigPath = join(directory, 'device.json')
const localBundle = join(directory, 'source.bundle')

function commandLine(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} did not finish within 30 seconds.`))
    }, 30000)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { if (stderr.length < 4000) stderr += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 800)}`))
    })
  })
}

function ssh(command) {
  return commandLine('ssh', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', host, command])
}

function remoteShell(command) {
  const encoded = Buffer.from(command).toString('base64')
  return ssh(`echo ${encoded} | base64 -d | bash`)
}

function scp(source, target) {
  return commandLine('scp', ['-i', key, '-o', 'StrictHostKeyChecking=no', source, `${host}:${target}`])
}

function localGit(root, ...args) {
  return commandLine('git', args, { cwd: root })
}

function sleep(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)) }

async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`)
    await sleep(100)
  }
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 500)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.once('error', () => { clearTimeout(timer); socket.destroy(); resolve(false) })
  })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function startDevice() {
  await remoteShell(`pkill -9 -f "remote-device.mjs --config ${configPath}" 2>/dev/null || true`)
  await remoteShell(`rm -f ${pairingCodePath} ${deviceLog} ${devicePid}`)
  await remoteShell(`cd ${packageRoot} && setsid -f env PATH=$HOME/.local/node/bin:$PATH node dev/remote-device.mjs ` +
    `--config ${configPath} --pairing-code-file ${pairingCodePath} </dev/null >${deviceLog} 2>&1`)
  await until(async () => (await ssh(`test -f ${pairingCodePath} && echo ready`).catch(() => '')).includes('ready'), 'the device pairing code', 60000)
  await remoteShell(`pgrep -f "remote-device.mjs --config ${configPath}" | head -1 > ${devicePid}`)
}

const sourceRoot = join(directory, 'source')
await mkdir(sourceRoot)
await localGit(sourceRoot, 'init')
await localGit(sourceRoot, 'config', 'user.email', 't39@example.invalid')
await localGit(sourceRoot, 'config', 'user.name', 'T39')
await writeFile(join(sourceRoot, 'tracked.txt'), 'base\n')
await mkdir(join(sourceRoot, 'src'))
await writeFile(join(sourceRoot, 'src', 'keep.txt'), 'keep\n')
await localGit(sourceRoot, 'add', 'tracked.txt', 'src/keep.txt')
await localGit(sourceRoot, 'commit', '-m', 'base')
await localGit(sourceRoot, 'bundle', 'create', localBundle, '--all')

const config = { deviceId: 'linux-t39', root: targetPath, listenHost: '127.0.0.1', listenPort: remotePort,
  pairingCode: '12345678', grants: [{ instanceId: 'private', environmentId: 'remote-project',
    allowedActorIds: ['user'], permissions: ['read'] }] }
await writeFile(localConfigPath, JSON.stringify(config))
await remoteShell(`rm -rf ${deviceRoot} && mkdir -p ${deviceRoot}`)
await scp(localBundle, remotePath(deviceRoot, 'source.bundle'))
await remoteShell(`cd ${deviceRoot} && git clone source.bundle target`)
await writeFile(join(sourceRoot, 'tracked.txt'), 'changed\n')
await writeFile(join(sourceRoot, 'src', 'new.txt'), 'untracked\n')
await scp(localConfigPath, configPath)

let tunnel
let environment
let native
let sessions
let storage
let engine
let source
let passes = 0
const startedAt = Date.now()
async function check(label, run) {
  await run()
  passes++
  console.log(`ok ${passes} - ${label}`)
}

try {
  await startDevice()
  const pairingCode = (await ssh(`cat ${pairingCodePath}`)).trim()
  const tunnelPort = localPort ?? await freePort()
  tunnel = spawn('ssh', ['-N', '-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'ExitOnForwardFailure=yes',
    '-L', `${tunnelPort}:127.0.0.1:${remotePort}`, host], { stdio: 'ignore', windowsHide: true })
  await until(() => portOpen(tunnelPort), 'the SSH device tunnel')
  environment = await RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read'], endpoint: `http://127.0.0.1:${tunnelPort}`, pairingCode, expectedDeviceId: 'linux-t39',
    expectedDeviceKey: (await ssh(`grep -o '[a-f0-9]\\{64\\}' ${deviceLog} | head -1`)).trim(), timeoutMs: 30000 })
  source = await LocalEnvironment.open({ id: 'source', instanceId: 'private', root: sourceRoot,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') return textResponse('No tool work is needed.')
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {}, 'assign')
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [source, environment])
  engine.effects.start()
  const receipt = await engine.submit({ commandId: 't39-submit', eventId: 't39-submit', text: 'Prepare a handoff copy.', environmentId: 'source' })
  let conversation
  for (let index = 0; index < 300; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.assignments.length && conversation.reason === 'worker-idle') break
    await sleep(25)
  }
  assert.equal(conversation.assignments.length, 1)
  const assignment = conversation.assignments[0]

  const prepared = await engine.prepareHandoffCopy({ commandId: 't39-prepare', ticketId: receipt.ticketId, targetEnvironmentId: 'remote-project' })
  await check('the source commit and uncommitted/untracked list are prepared', async () => {
    assert.equal(prepared.status, 'prepared', JSON.stringify(prepared))
    assert.equal(prepared.baseCommit.length, 40)
    assert.deepEqual(prepared.files.map(file => file.path).sort(), ['src/new.txt', 'tracked.txt'])
    assert.equal(prepared.files.some(file => file.state === 'modified'), true)
    assert.equal(prepared.files.some(file => file.state === 'untracked'), true)
    assert.equal(prepared.patch.bytes > 0, true)
  })
  await check('preflight does not change the current Assignment', async () => {
    const current = await engine.conversation(receipt.ticketId)
    assert.equal(current.assignments[0].id, assignment.id)
    assert.equal(current.assignments[0].generation, assignment.generation)
  })

  for (const file of prepared.files) {
    const remoteTarget = remotePath(targetPath, ...file.path.split('/'))
    if (file.state === 'deleted') {
      await remoteShell(`rm -f ${remoteTarget}`)
      continue
    }
    await remoteShell(`mkdir -p ${remoteTarget.slice(0, remoteTarget.lastIndexOf('/'))}`)
    await scp(join(sourceRoot, ...file.path.split('/')), remoteTarget)
  }
  const verified = await engine.verifyHandoffCopy({ commandId: 't39-verify', ticketId: receipt.ticketId })
  await check('the second device verifies the explicit synced copy by hashes', async () => {
    assert.equal(verified.status, 'verified', JSON.stringify(verified))
    assert.equal(typeof verified.verifiedAt, 'number')
    assert.equal(verified.target.deviceId, 'linux-t39')
  })

  await remoteShell(`printf 'unknown target change\\n' > ${remotePath(targetPath, 'unknown.txt')}`)
  const blocked = await engine.prepareHandoffCopy({ commandId: 't39-blocked', ticketId: receipt.ticketId, targetEnvironmentId: 'remote-project' })
  await check('an unknown target file is handoff-blocked, not overwritten', async () => {
    assert.equal(blocked.status, 'handoff-blocked')
    assert.equal(blocked.blockers.some(blocker => blocker.code === 'unknown-target-change'), true)
  })
  console.log(`T39 acceptance ${passes}/${passes} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
} finally {
  await engine?.effects.stop().catch(() => {})
  await engine?.shutdown().catch(() => {})
  await sessions?.close().catch(() => {})
  await native?.fiber.dispose().catch(() => {})
  await storage?.close().catch(() => {})
  await source?.close().catch(() => {})
  await environment?.close().catch(() => {})
  tunnel?.kill()
  await remoteShell(`pkill -9 -f "remote-device.mjs --config ${configPath}" 2>/dev/null || true`).catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
