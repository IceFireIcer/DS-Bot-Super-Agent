import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { createHash } from 'node:crypto'
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

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-t37-acceptance-'))
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
  await remoteShell(`pkill -9 -f "remote-device.mjs --config ${configPath}" 2>/dev/null || true`)
  await remoteShell(`cd ${packageRoot} && rm -f ${pairingCodePath} ${deviceLog} ${devicePid}`)
  await remoteShell(`cd ${packageRoot} && setsid -f env PATH=/home/ubuntu/.local/node/bin:$PATH node dev/remote-device.mjs `
    + `--config ${configPath} --pairing-code-file ${pairingCodePath} </dev/null >${deviceLog} 2>&1`)
  await until(async () => (await ssh(`test -f ${pairingCodePath} && echo ready`).catch(() => '')).includes('ready'), 'the device pairing code', 60000)
  await remoteShell(`pgrep -f "remote-device.mjs --config ${configPath}" | head -1 > ${devicePid}`)
}

async function killDevice() {
  await remoteShell(`if test -f ${devicePid}; then kill -9 $(cat ${devicePid}) 2>/dev/null || true; fi`)
  await until(async () => !(await ssh(`test -f ${devicePid} && kill -0 $(cat ${devicePid}) 2>/dev/null && echo alive`).catch(() => '')).includes('alive'), 'the daemon to exit', 60000)
}

const bigBytes = "process.stdout.write('x'.repeat(200000)+'\\nEND\\n')"
const config = { deviceId: 'linux-t37', root: remotePath(deviceRoot, 'work'), jobsPath: remotePath(deviceRoot, 'jobs'),
  statePath: remotePath(deviceRoot, 'device-state.json'), assetsPath: remotePath(deviceRoot, 'assets'),
  listenHost: '127.0.0.1', listenPort: remotePort, pairingCode: '12345678',
  commands: { big: { argv: ['node', '-e', bigBytes], timeoutMs: 10000, backgroundTimeoutMs: 30000 } },
  grants: [{ instanceId: 'private', environmentId: 'remote-project', allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'] }] }
await writeFile(localConfigPath, JSON.stringify(config))
await remoteShell(`rm -rf ${deviceRoot} && mkdir -p ${deviceRoot}/work ${deviceRoot}/jobs ${deviceRoot}/assets`)
await scp(localConfigPath, configPath)

let tunnel
let environment
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
    permissions: ['read', 'write', 'search', 'command'], endpoint: `http://127.0.0.1:${tunnelPort}`, pairingCode,
    expectedDeviceId: config.deviceId, expectedDeviceKey: (await ssh(`grep -o '[a-f0-9]\\{64\\}' ${deviceLog} | head -1`)).trim() })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })

  const content = Buffer.from('device attachment content 多字节 ✓\n')
  const sha256 = createHash('sha256').update(content).digest('hex')
  const attachment = await bound.saveAttachment({ name: 'evidence.txt', data: content, mediaType: 'text/plain' })
  await check('device attachment is content-addressed on the second machine', async () => {
    assert.equal(attachment.id, `file:sha256:${sha256}`)
    assert.equal(attachment.bytes, content.length)
    assert.equal(attachment.deviceId, 'linux-t37')
    assert.equal((await remoteShell(`test -f ${remotePath(deviceRoot, 'assets', 'files', sha256)} && echo stored`)).trim(), 'stored')
  })
  await check('attachment pages reconstruct the complete text', async () => {
    let offset = 0
    let text = ''
    while (true) {
      const page = await bound.readAsset(attachment, { offset, maxBytes: 6 })
      assert.equal(page.encoding, 'utf8')
      text += page.text
      if (!page.truncated) break
      offset = page.nextOffset
    }
    assert.equal(text, content.toString('utf8'))
  })
  await check('a same-named file on the device and the Host cannot substitute', async () => {
    await remoteShell(`printf 'device substitute\\n' > ${remotePath(deviceRoot, 'work', 'evidence.txt')}`)
    await writeFile(join(directory, 'evidence.txt'), 'host substitute\n')
    assert.equal((await bound.readAsset(attachment, { offset: 0, maxBytes: 8 })).text, content.subarray(0, 8).toString('utf8'))
  })

  const job = await bound.startCommand('big')
  await check('long device output keeps a durable spill reference', async () => {
    assert.equal(await job.done.then(result => result.exitCode), 0)
    assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  })
  const spill = await bound.spillReference(job.jobId, 'stdout')
  await check('spill pages reconstruct the whole output beyond the bounded tail', async () => {
    assert.equal(spill.bytes, 200005)
    let offset = 0
    let text = ''
    while (true) {
      const page = await bound.readAsset(spill, { offset, maxBytes: 32768 })
      text += page.text
      if (!page.truncated) break
      offset = page.nextOffset
    }
    assert.equal(text.length, 200005)
    assert.equal(text.slice(0, 200000), 'x'.repeat(200000))
    assert.equal(text.slice(200000), '\nEND\n')
  })
  await check('skill discovery is explicitly rejected with a public-seam gap', async () => {
    await assert.rejects(bound.readAsset({ kind: 'skill', environmentId: 'remote-project', environmentKind: 'remote',
      environmentFingerprint: environment.assetFingerprint, deviceId: 'linux-t37', deviceIncarnation: environment.deviceIncarnation,
      id: 'skill:office', bytes: 0, sha256: '' }), { code: 'ENVIRONMENT_UNSUPPORTED', message: /skill-discovery-public-seam-missing/u })
  })

  await killDevice()
  await check('a disconnected device cannot silently fall back to a Host file', async () => {
    await assert.rejects(bound.readAsset(attachment, { offset: 0, maxBytes: 8 }), { code: 'DEVICE_UNAVAILABLE' })
  })
  await startDevice()
  await check('the original attachment reference resumes after the daemon restarts', async () => {
    assert.equal((await bound.readAsset(attachment, { offset: 0, maxBytes: content.length })).text, content.toString('utf8'))
  })
  await check('the original spill reference resumes by the same job identity', async () => {
    const evidence = await bound.spillReference(job.jobId, 'stdout')
    assert.equal(evidence.sha256, spill.sha256)
    assert.equal(evidence.bytes, spill.bytes)
    assert.equal((await bound.readAsset(spill, { offset: 199990, maxBytes: 15 })).text, 'x'.repeat(10) + '\nEND\n')
  })
  console.log(`T37 acceptance ${passes}/${passes} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
} finally {
  await environment?.close().catch(() => {})
  tunnel?.kill()
  await remoteShell(`pkill -9 -f "remote-device.mjs --config ${configPath}" 2>/dev/null || true`).catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
