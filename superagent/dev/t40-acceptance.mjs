import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, LocalEnvironment, NativeSessions, RemoteEnvironment } from '../dist/index.js'
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

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t40-acceptance-'))
const remotePath = (...parts) => parts.join('/').replace(/\/+/gu, '/')
const remoteTarget = remotePath(deviceRoot, 'target')
const configPath = remotePath(deviceRoot, 'device.json')
const pairingCodePath = remotePath(deviceRoot, 'pairing-code.txt')
const deviceLog = remotePath(deviceRoot, 'device.log')
const devicePid = remotePath(deviceRoot, 'device.pid')
const configLocal = join(directory, 'device.json')
const bundle = join(directory, 'source.bundle')
const localSource = join(directory, 'source')
const localTarget = join(directory, 'local-target')

function commandLine(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} did not finish within 30 seconds.`)) }, 30000)
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
function ssh(command) { return commandLine('ssh', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', host, command]) }
function remoteShell(command) { return ssh(`echo ${Buffer.from(command).toString('base64')} | base64 -d | bash`) }
function scp(source, target) { return commandLine('scp', ['-i', key, '-o', 'StrictHostKeyChecking=no', source, `${host}:${target}`]) }
function scpFrom(source, target) { return commandLine('scp', ['-i', key, '-o', 'StrictHostKeyChecking=no', `${host}:${source}`, target]) }
function localGit(root, ...args) { return commandLine('git', args, { cwd: root }) }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
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

async function makeRepo(root) {
  await mkdir(root)
  await localGit(root, 'init')
  await localGit(root, 'config', 'user.email', 't40@example.invalid')
  await localGit(root, 'config', 'user.name', 'T40')
  await writeFile(join(root, 'tracked.txt'), 'base\n')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'keep.txt'), 'keep\n')
  await localGit(root, 'add', 'tracked.txt', 'src/keep.txt')
  await localGit(root, 'commit', '-m', 'base')
}

async function copyFiles(sourceRoot, targetRoot, files, fromRemote = false) {
  for (const file of files) {
    const target = join(targetRoot, ...file.path.split('/'))
    if (file.state === 'deleted') { await rm(target, { force: true }); continue }
    await mkdir(join(target, '..'), { recursive: true }).catch(() => {})
    if (fromRemote) await scpFrom(remotePath(remoteTarget, ...file.path.split('/')), target)
    else await scp(join(sourceRoot, ...file.path.split('/')), remotePath(remoteTarget, ...file.path.split('/')))
  }
}

await makeRepo(localSource)
await localGit(localSource, 'clone', localSource, localTarget)
await localGit(localSource, 'bundle', 'create', bundle, '--all')
await writeFile(join(localSource, 'tracked.txt'), 'changed locally\n')
await writeFile(join(localSource, 'new.txt'), 'untracked local\n')

const config = { deviceId: 'linux-t40', root: remoteTarget, listenHost: '127.0.0.1', listenPort: remotePort,
  pairingCode: '12345678', grants: [{ instanceId: 'private', environmentId: 'remote-project',
    allowedActorIds: ['user'], permissions: ['read'] }] }
await writeFile(configLocal, JSON.stringify(config))
await remoteShell(`rm -rf ${deviceRoot} && mkdir -p ${deviceRoot}`)
await scp(bundle, remotePath(deviceRoot, 'source.bundle'))
await remoteShell(`cd ${deviceRoot} && git clone source.bundle target`)
await scp(configLocal, configPath)

let tunnel
let remote
let localSourceEnvironment
let localTargetEnvironment
let native
let sessions
let storage
let engine
let passes = 0
const startedAt = Date.now()
async function check(label, fn) { await fn(); passes++; console.log(`ok ${passes} - ${label}`) }

try {
  await startDevice()
  const pairingCode = (await ssh(`cat ${pairingCodePath}`)).trim()
  const tunnelPort = localPort ?? await freePort()
  tunnel = spawn('ssh', ['-N', '-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'ExitOnForwardFailure=yes',
    '-L', `${tunnelPort}:127.0.0.1:${remotePort}`, host], { stdio: 'ignore', windowsHide: true })
  await until(() => portOpen(tunnelPort), 'the SSH device tunnel')
  remote = await RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read'], endpoint: `http://127.0.0.1:${tunnelPort}`, pairingCode, expectedDeviceId: config.deviceId,
    expectedDeviceKey: (await ssh(`grep -o '[a-f0-9]\\{64\\}' ${deviceLog} | head -1`)).trim(), timeoutMs: 30000 })
  localSourceEnvironment = await LocalEnvironment.open({ id: 'source', instanceId: 'private', root: localSource,
    allowedActorIds: ['user'], permissions: ['read'], commands: {} })
  localTargetEnvironment = await LocalEnvironment.open({ id: 'local-target', instanceId: 'private', root: localTarget,
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
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [localSourceEnvironment, remote, localTargetEnvironment])
  engine.effects.start()
  const receipt = await engine.submit({ commandId: 't40-submit', eventId: 't40-submit', text: 'Move the work.', environmentId: 'source', target: 'auto' })
  let conversation
  for (let index = 0; index < 300; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.assignments.length && conversation.reason === 'worker-idle') break
    await sleep(25)
  }
  assert.equal(conversation.assignments.length, 1)
  const originalSessionId = conversation.assignments[0].sessionId

  const prepared = await engine.prepareHandoffCopy({ commandId: 't40-copy-out', ticketId: receipt.ticketId, targetEnvironmentId: 'remote-project' })
  await copyFiles(localSource, remoteTarget, prepared.files)
  await engine.verifyHandoffCopy({ commandId: 't40-verify-out', ticketId: receipt.ticketId })
  const outbound = await engine.requestHandoff({ commandId: 't40-out', ticketId: receipt.ticketId, targetEnvironmentId: 'remote-project', reason: 'Move to the Ubuntu device.' })
  await check('local to Ubuntu handoff completes with a new Assignment generation', async () => {
    assert.equal(outbound.state, 'completed', JSON.stringify(outbound))
    const current = await engine.conversation(receipt.ticketId)
    assert.equal(current.assignments.length, 1)
    assert.equal(current.assignments[0].environment.id, 'remote-project')
    assert.equal(current.assignments[0].sessionId, originalSessionId)
    assert.notEqual(current.assignments[0].generation, conversation.assignments[0].generation)
  })

  const preparedBack = await engine.prepareHandoffCopy({ commandId: 't40-copy-back', ticketId: receipt.ticketId, targetEnvironmentId: 'local-target' })
  await copyFiles(remoteTarget, localTarget, preparedBack.files, true)
  await engine.verifyHandoffCopy({ commandId: 't40-verify-back', ticketId: receipt.ticketId })
  const inbound = await engine.requestHandoff({ commandId: 't40-back', ticketId: receipt.ticketId, targetEnvironmentId: 'local-target', reason: 'Return to the Host.' })
  await check('Ubuntu to local handoff completes and preserves the Session', async () => {
    assert.equal(inbound.state, 'completed', JSON.stringify(inbound))
    const current = await engine.conversation(receipt.ticketId)
    assert.equal(current.assignments.length, 1)
    assert.equal(current.assignments[0].environment.id, 'local-target')
    assert.equal(current.assignments[0].sessionId, originalSessionId)
    assert.equal(current.environmentHandoff.state, 'completed')
  })
  console.log(`T40 acceptance ${passes}/${passes} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
} finally {
  await engine?.effects.stop().catch(() => {})
  await engine?.shutdown().catch(() => {})
  await sessions?.close().catch(() => {})
  await native?.fiber.dispose().catch(() => {})
  await storage?.close().catch(() => {})
  await localTargetEnvironment?.close().catch(() => {})
  await localSourceEnvironment?.close().catch(() => {})
  await remote?.close().catch(() => {})
  tunnel?.kill()
  await remoteShell(`pkill -9 -f "remote-device.mjs --config ${configPath}" 2>/dev/null || true`).catch(() => {})
  await remoteShell(`rm -rf ${deviceRoot}`).catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
