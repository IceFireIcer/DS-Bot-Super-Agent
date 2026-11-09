import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteEnvironment } from '../dist/index.js'

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

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t35-acceptance-'))
const remotePath = (...parts) => parts.join('/').replace(/\/+/gu, '/')
const configPath = remotePath(deviceRoot, 'device.json')
const pairingCodePath = remotePath(deviceRoot, 'pairing-code.txt')
const deviceLog = remotePath(deviceRoot, 'device.log')
const devicePid = remotePath(deviceRoot, 'device.pid')
const localConfigPath = join(directory, 'device.json')

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
    child.stderr?.on('data', chunk => { stderr += chunk })
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

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

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
  await remoteShell(`cd ${packageRoot} && rm -f ${pairingCodePath} ${deviceLog} ${devicePid}`)
  await remoteShell(`cd ${packageRoot} && setsid -f env PATH=$HOME/.local/node/bin:$PATH node dev/remote-device.mjs `
    + `--config ${configPath} --pairing-code-file ${pairingCodePath} </dev/null >${deviceLog} 2>&1`)
  await until(async () => (await ssh(`test -f ${pairingCodePath} && echo ready`).catch(() => '')).includes('ready'), 'the device pairing code')
  await remoteShell(`pgrep -f "remote-device.mjs --config ${configPath}" | head -1 > ${devicePid}`)
}

async function killDevice() {
  await remoteShell(`if test -f ${devicePid}; then kill -9 $(cat ${devicePid}) 2>/dev/null || true; fi`)
  await until(async () => !(await ssh(`test -f ${devicePid} && kill -0 $(cat ${devicePid}) 2>/dev/null && echo alive`).catch(() => '')).includes('alive'), 'the daemon to exit')
}

const config = { deviceId: 'linux-t35', root: remotePath(deviceRoot, 'work'), jobsPath: remotePath(deviceRoot, 'jobs'),
  statePath: remotePath(deviceRoot, 'device-state.json'), listenHost: '127.0.0.1', listenPort: remotePort,
  pairingCode: '12345678',
  commands: { hold: { argv: ['node', '-e', "const fs=require('node:fs');fs.writeFileSync('hold.pid',String(process.pid));console.log('started');setInterval(()=>{},1000)"],
    timeoutMs: 5000, backgroundTimeoutMs: 60000 },
  short: { argv: ['node', '-e', "const fs=require('node:fs');fs.writeFileSync('hold.pid',String(process.pid));console.log('started');setInterval(()=>{},1000)"],
    timeoutMs: 500, backgroundTimeoutMs: 2500 },
  quick: { argv: ['node', '-e', "console.log('finished')"], timeoutMs: 5000, backgroundTimeoutMs: 60000 } },
  grants: [{ instanceId: 'private', environmentId: 'remote-project', allowedActorIds: ['user'], permissions: ['read', 'write', 'search', 'command'] }] }
await writeFile(localConfigPath, JSON.stringify(config))
await remoteShell(`rm -rf ${deviceRoot} && mkdir -p ${deviceRoot}/work ${deviceRoot}/jobs`)
await scp(localConfigPath, configPath)

let tunnel
let environment
const startedAt = Date.now()
try {
  await startDevice()
  const pairingCode = (await ssh(`cat ${pairingCodePath}`)).trim()
  const tunnelPort = localPort ?? await freePort()
  tunnel = spawn('ssh', ['-N', '-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'ExitOnForwardFailure=yes',
    '-L', `${tunnelPort}:127.0.0.1:${remotePort}`, host], { stdio: 'ignore', windowsHide: true })
  await until(() => portOpen(tunnelPort), 'the SSH device tunnel')
  environment = await RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], endpoint: `http://127.0.0.1:${tunnelPort}`, pairingCode,
    expectedDeviceId: config.deviceId, expectedDeviceKey: (await ssh(`grep -o '[a-f0-9]\\{64\\}' ${deviceLog} | head -1`)).trim() })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })

  const live = await bound.startCommand('hold')
  await until(() => live.read().stdout.text.includes('started'), 'the live range output')
  const livePid = Number(await ssh(`cat ${config.root}/hold.pid`))
  await killDevice()
  await startDevice()
  const liveRange = await bound.inspectRange(live.jobId)
  assert.equal(liveRange.state, 'running')
  assert.equal(liveRange.settled, false)
  assert.equal(liveRange.recovery.kind, 'live-process')
  assert.equal(liveRange.recovery.rangeEvidence, 'posix-proc')
  assert.equal(liveRange.stdout.text, 'started\n')
  const attached = await bound.attachCommand(live.jobId)
  attached.terminate()
  assert.equal(await attached.waitForExit(AbortSignal.timeout(10000)), true)
  assert.equal((await bound.inspectRange(live.jobId)).state, 'cancelled')
  await until(async () => !(await ssh(`kill -0 ${livePid} 2>/dev/null && echo alive`).catch(() => '')).includes('alive'), 'the recovered range to stop')

  await remoteShell(`rm -f ${config.root}/hold.pid`)
  const terminal = await bound.startCommand('hold')
  await until(async () => (await ssh(`cat ${config.root}/hold.pid`).catch(() => '')).trim() !== '', 'the second range PID')
  const terminalPid = Number(await ssh(`cat ${config.root}/hold.pid`))
  await killDevice()
  await remoteShell(`kill -9 ${terminalPid} 2>/dev/null || true`)
  await until(async () => !(await ssh(`kill -0 ${terminalPid} 2>/dev/null && echo alive`).catch(() => '')).includes('alive'), 'the second range to exit')
  await startDevice()
  const terminalRange = await bound.inspectRange(terminal.jobId)
  assert.equal(terminalRange.state, 'unknown')
  assert.equal(terminalRange.settled, true)
  assert.equal(terminalRange.recovery.kind, 'log-only')
  assert.equal(terminalRange.stdout.text, 'started\n')
  await assert.rejects(bound.attachCommand(terminal.jobId), { code: 'COMMAND_UNKNOWN' })

  await remoteShell(`rm -f ${config.root}/hold.pid`)
  const short = await bound.startCommand('short')
  await until(async () => (await ssh(`cat ${config.root}/hold.pid`).catch(() => '')).trim() !== '', 'the deadline range PID')
  const shortPid = Number(await ssh(`cat ${config.root}/hold.pid`))
  await killDevice()
  await sleep(3000)
  await startDevice()
  let shortRange
  await until(async () => {
    shortRange = await bound.inspectRange(short.jobId)
    return shortRange.state === 'cancelled' && shortRange.settled
  }, 'the original device deadline to stop the recovered range')
  assert.equal(shortRange.recovery.kind, 'live-process')
  await until(async () => !(await ssh(`kill -0 ${shortPid} 2>/dev/null && echo alive`).catch(() => '')).includes('alive'), 'the deadline range to stop')

  const missing = await bound.startCommand('hold')
  await until(async () => (await ssh(`cat ${config.root}/hold.pid`).catch(() => '')).trim() !== '', 'the unqueryable range PID')
  const missingPid = Number(await ssh(`cat ${config.root}/hold.pid`))
  await killDevice()
  await remoteShell(`kill -9 ${missingPid} 2>/dev/null || true; rm -rf ${config.jobsPath}`)
  await until(async () => !(await ssh(`kill -0 ${missingPid} 2>/dev/null && echo alive`).catch(() => '')).includes('alive'), 'the unqueryable range to exit')
  await startDevice()
  const missingRange = await bound.inspectRange(missing.jobId)
  assert.equal(missingRange.state, 'unknown')
  assert.equal(missingRange.settled, true)
  assert.equal(missingRange.ownerId, null)
  assert.equal(missingRange.recovery, undefined)
  await assert.rejects(bound.attachCommand(missing.jobId), { code: 'COMMAND_UNKNOWN' })

  const completed = await bound.startCommand('quick')
  assert.equal(await completed.done.then(result => result.exitCode), 0)
  assert.equal(await completed.waitForExit(AbortSignal.timeout(5000)), true)
  const completedRange = await bound.inspectRange(completed.jobId)
  assert.equal(completedRange.state, 'exited')
  assert.equal(completedRange.exitCode, 0)
  assert.equal(completedRange.stdout.text, 'finished\n')

  console.log(JSON.stringify({ result: 'passed', checks: 26, elapsedMs: Date.now() - startedAt,
    liveJob: live.jobId, terminalJob: terminal.jobId, deadlineJob: short.jobId, missingJob: missing.jobId,
    completedJob: completed.jobId }))
} finally {
  await environment?.close().catch(() => {})
  tunnel?.kill()
  await remoteShell(`if test -f ${devicePid}; then kill -9 $(cat ${devicePid}) 2>/dev/null || true; fi; `
    + `if test -f ${config.root}/hold.pid; then kill -9 $(cat ${config.root}/hold.pid) 2>/dev/null || true; fi; `
    + `rm -f ${config.root}/hold.pid`).catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
