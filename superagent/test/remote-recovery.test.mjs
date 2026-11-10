import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const grant = {
  instanceId: 'private',
  environmentId: 'remote-project',
  allowedActorIds: ['user', 'other'],
  permissions: ['read', 'write', 'search', 'command'],
}

const commands = {
  hold: {
    argv: [process.execPath, '-e',
      "const fs=require('node:fs');fs.writeFileSync('hold.pid',String(process.pid));console.log('started');setInterval(()=>{},1000)"],
    timeoutMs: 5000,
    backgroundTimeoutMs: 60000,
  },
  quick: {
    argv: [process.execPath, '-e', "console.log('finished')"],
    timeoutMs: 5000,
    backgroundTimeoutMs: 60000,
  },
  foreground: {
    argv: [process.execPath, '-e',
      "const fs=require('node:fs');fs.writeFileSync('hold.pid',String(process.pid));console.log('started');setInterval(()=>{},1000)"],
    timeoutMs: 10000,
    backgroundTimeoutMs: 60000,
  },
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`)
    await sleep(25)
  }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function startDevice(configPath, pairingCodePath) {
  const child = spawn(process.execPath, ['dev/remote-device.mjs', '--config', configPath, '--pairing-code-file', pairingCodePath],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      const line = stdout.split(/\r?\n/u).find(Boolean)
      if (line) {
        try { resolve(JSON.parse(line)) } catch { /* Wait for the complete line. */ }
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`The device process exited before it was ready (${code}): ${stderr.slice(0, 500)}`)))
  })
  return { child, ready }
}

async function killDevice(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await Promise.race([once(child, 'exit'), sleep(5000)])
}

function delayedRemoteEnvironment(root) {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let finish
  const done = new Promise(resolve => { finish = resolve })
  const remote = { deviceId: 'delayed-device', deviceIncarnation: 'delayed-incarnation', actorId: 'user',
    ownerId: 'user', deadlineAt: Date.now() + 60000, deviceState: 'starting', rangeSettled: false }
  const job = { jobId: 'delayed-job', remote, done,
    read: () => ({ stdout: { text: '', lossy: false }, stderr: { text: '', lossy: false } }),
    terminate: () => finish({ exitCode: null, cancelled: true, truncated: false, settled: true }),
    waitForExit: async () => true }
  const environment = {
    kind: 'remote',
    config: { id: 'remote-project', instanceId: 'private', root, allowedActorIds: ['user'],
      permissions: ['read', 'write', 'search', 'command'],
      commands: { hold: { argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 5000 } } },
    deviceId: remote.deviceId,
    deviceIncarnation: remote.deviceIncarnation,
    online: true,
    probe: async () => ({ online: true, root, version: 'delayed-v1', fingerprint: 'delayed-device:delayed-incarnation',
      capabilities: ['read', 'write', 'search', 'command'], capacity: { active: 0, max: 8 } }),
    authorize() {},
    prepare: async () => ({
      cwd: root,
      invoke: async () => ({}),
      artifact: async () => ({ path: 'delayed.txt', bytes: 0, sha256: '0'.repeat(64) }),
      sanitize: text => text,
      planCommand: () => ({ jobId: job.jobId, remote: { ...remote } }),
      startCommand: async () => { await gate; return job },
    }),
    close: async () => {},
  }
  return { environment, release }
}

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-recovery-'))
  const root = join(directory, 'device-work')
  await mkdir(root)
  const listenPort = await freePort()
  const configPath = join(directory, 'device.json')
  const pairingCodePath = join(directory, 'pairing-code.txt')
  const config = { deviceId: 'second-device', root, jobsPath: join(directory, 'device-jobs'), commands,
    grants: [grant], statePath: join(directory, 'device-state.json'), listenHost: '127.0.0.1', listenPort, pairingCode: '12345678' }
  await writeFile(configPath, JSON.stringify(config))
  let running = await startDevice(configPath, pairingCodePath)
  const environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private',
    allowedActorIds: grant.allowedActorIds, permissions: grant.permissions, endpoint: running.ready.endpoint,
    pairingCode: (await readFile(pairingCodePath, 'utf8')).trim(), expectedDeviceId: config.deviceId,
    expectedDeviceKey: running.ready.deviceKeyFingerprint })
  context.after(async () => {
    await environment.close()
    await killDevice(running.child)
    const pid = Number(await readFile(join(root, 'hold.pid'), 'utf8').catch(() => 0))
    if (pid) {
      try { process.kill(pid, 'SIGKILL') } catch { /* The command already exited. */ }
    }
    await rm(directory, { recursive: true, force: true })
  })
  return {
    configPath, pairingCodePath, root, jobsPath: config.jobsPath,
    get running() { return running },
    environment,
    async restart() {
      running = await startDevice(configPath, pairingCodePath)
      return running
    },
    async kill() {
      await killDevice(running.child)
    },
  }
}

test('a device job belongs to the actor that started it and exposes its deadline and recovery evidence', { timeout: 20000 }, async context => {
  const device = await fixture(context)
  const bound = await device.environment.prepare({ instanceId: 'private', actorId: 'user' })
  const job = await bound.startCommand('hold')
  await until(() => job.read().stdout.text.includes('started'), 'the job output')
  const range = await bound.inspectRange(job.jobId)
  assert.equal(range.jobId, job.jobId)
  assert.equal(range.ownerId, 'user')
  assert.equal(typeof range.deadlineAt, 'number')
  await assert.rejects(device.environment.call({ instanceId: 'private', environmentId: 'remote-project', actorId: 'other',
    operation: 'command.inspect', args: { jobId: job.jobId, stdoutOffset: '0', stderrOffset: '0' } }),
  { code: 'JOB_OWNER_MISMATCH' })
  await assert.rejects(device.environment.call({ instanceId: 'private', environmentId: 'remote-project', actorId: 'other',
    operation: 'command.cancel', args: { jobId: job.jobId } }), { code: 'JOB_OWNER_MISMATCH' })
  job.terminate()
  assert.equal(await job.waitForExit(AbortSignal.timeout(10000)), true)
})

test('a daemon restart distinguishes a live process range from log-only output and restores only the live range', { timeout: 30000, skip: process.platform === 'win32' }, async context => {
  const device = await fixture(context)
  const bound = await device.environment.prepare({ instanceId: 'private', actorId: 'user' })

  const live = await bound.startCommand('hold')
  await until(() => live.read().stdout.text.includes('started'), 'the live job output')
  const livePid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  await device.kill()
  await device.restart()

  const liveRange = await bound.inspectRange(live.jobId)
  assert.equal(liveRange.state, 'running')
  assert.equal(liveRange.settled, false)
  assert.equal(liveRange.ownerId, 'user')
  assert.equal(liveRange.recovery.kind, 'live-process')
  assert.equal(liveRange.stdout.text, 'started\n')
  const attached = await bound.attachCommand(live.jobId)
  assert.equal(attached.jobId, live.jobId)
  attached.terminate()
  assert.equal(await attached.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal((await bound.inspectRange(live.jobId)).state, 'cancelled')
  await until(() => {
    try { process.kill(livePid, 0); return false } catch { return true }
  }, 'the recovered live process to stop')

  await rm(join(device.root, 'hold.pid'), { force: true })
  const terminal = await bound.startCommand('hold')
  await until(async () => {
    try { return Number(await readFile(join(device.root, 'hold.pid'), 'utf8')) > 0 }
    catch { return false }
  }, 'the second job process')
  const terminalPid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  assert.notEqual(terminalPid, livePid)
  await device.kill()
  try { process.kill(terminalPid, 'SIGKILL') } catch { /* The process exited with the daemon. */ }
  await until(() => {
    try { process.kill(terminalPid, 0); return false } catch { return true }
  }, 'the second process to exit')
  await device.restart()

  const terminalRange = await bound.inspectRange(terminal.jobId)
  assert.equal(terminalRange.state, 'unknown')
  assert.equal(terminalRange.settled, true)
  assert.equal(terminalRange.recovery.kind, 'log-only')
  assert.equal(terminalRange.stdout.text, 'started\n')
  await assert.rejects(bound.attachCommand(terminal.jobId), { code: 'COMMAND_UNKNOWN' })
})

test('a job record that disappears during a restart stays unknown and is never reattached', { timeout: 20000 }, async context => {
  const device = await fixture(context)
  const bound = await device.environment.prepare({ instanceId: 'private', actorId: 'user' })
  const job = await bound.startCommand('hold')
  await until(() => job.read().stdout.text.includes('started'), 'the original job output')
  const pid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  await device.kill()
  try { process.kill(pid, 'SIGKILL') } catch { /* The device may have taken the child with it. */ }
  await rm(device.jobsPath, { recursive: true, force: true })
  await mkdir(device.jobsPath)
  await device.restart()
  const range = await bound.inspectRange(job.jobId)
  assert.equal(range.jobId, job.jobId)
  assert.equal(range.state, 'unknown')
  assert.equal(range.settled, true)
  assert.equal(range.ownerId, null)
  assert.equal(range.recovery, undefined)
  await assert.rejects(bound.attachCommand(job.jobId), { code: 'COMMAND_UNKNOWN' })
})

test('a PID-only daemon restart keeps the range observable but never signals an unverified process', { timeout: 20000, skip: process.platform !== 'win32' }, async context => {
  const device = await fixture(context)
  const bound = await device.environment.prepare({ instanceId: 'private', actorId: 'user' })
  const job = await bound.startCommand('hold')
  await until(() => job.read().stdout.text.includes('started'), 'the original job output')
  const pid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  await device.kill()
  await device.restart()
  const range = await bound.inspectRange(job.jobId)
  assert.equal(range.state, 'unknown')
  assert.equal(range.settled, false)
  assert.equal(range.recovery.kind, 'unverifiable')
  assert.equal(range.recovery.rangeAlive, 'alive')
  assert.equal(range.recovery.rangeEvidence, 'pid')
  await assert.rejects(bound.attachCommand(job.jobId), { code: 'COMMAND_UNKNOWN' })
  await bound.cancelRange(job.jobId)
  await sleep(500)
  assert.doesNotThrow(() => process.kill(pid, 0))
  process.kill(pid, 'SIGKILL')
  await until(async () => {
    const ended = await bound.inspectRange(job.jobId)
    return ended.state === 'unknown' && ended.settled === true
  }, 'the PID-only range to be observed gone')
})

test('a completed job keeps its exit code and output through a daemon restart', { timeout: 20000 }, async context => {
  const device = await fixture(context)
  const bound = await device.environment.prepare({ instanceId: 'private', actorId: 'user' })
  const job = await bound.startCommand('quick')
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  await device.kill()
  await device.restart()
  const range = await bound.inspectRange(job.jobId)
  assert.equal(range.state, 'exited')
  assert.equal(range.settled, true)
  assert.equal(range.exitCode, 0)
  assert.equal(range.stdout.text, 'finished\n')
  const attached = await bound.attachCommand(job.jobId)
  assert.equal(await attached.done.then(result => result.exitCode), 0)
  assert.equal(attached.read().stdout.text, 'finished\n')
})

test('an unobservable recovered job blocks its Ticket with one evidence question that later reconciliation does not duplicate', { timeout: 90000 }, async context => {
  const device = await fixture(context)
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-recovery-engine-'))
  let native, storage, sessions, engine
  context.after(async () => {
    await engine?.shutdown()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  let workerStarted = false
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      if (!workerStarted) {
        workerStarted = true
        return toolResponse('start_command', { name: 'hold' }, 'recovery-start')
      }
      return textResponse('Started the device job.')
    }
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [device.environment], {}, { waitMs: 60000 })
  const receipt = await engine.submit({ commandId: 'remote-recovery', eventId: 'remote-recovery',
    text: 'Start the long device job.', environmentId: 'remote-project' })
  let conversation
  for (let index = 0; index < 300; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.jobs?.some(job => job.state === 'running') && conversation.reason === 'worker-idle') break
    await sleep(25)
  }
  assert.ok(conversation.jobs.some(job => job.state === 'running'), JSON.stringify(conversation))
  const jobId = conversation.jobs[0].id
  const pid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  await device.kill()
  try { process.kill(pid, 'SIGKILL') } catch { /* The device may have taken the child with it. */ }
  await until(() => {
    try { process.kill(pid, 0); return false } catch { return true }
  }, 'the unobserved device process to exit')
  await device.restart()

  for (let index = 0; index < 600; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.stage === 'waiting-human') break
    await sleep(25)
  }
  assert.equal(conversation.stage, 'waiting-human', JSON.stringify({ stage: conversation.stage, jobs: conversation.jobs }))
  assert.equal(conversation.jobs[0].state, 'unknown')
  assert.match(conversation.attention.question, new RegExp(jobId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.match(conversation.attention.question, /log and exit-unknown|restart|cannot confirm/u)
  const attentionId = conversation.attention.id

  await engine.reconcileRemoteWork({ commandId: 'recheck-one', ticketId: receipt.ticketId })
  await engine.reconcileRemoteWork({ commandId: 'recheck-two', ticketId: receipt.ticketId })
  conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.attention.id, attentionId)
  assert.equal(conversation.attentionHistory.length, 1)
})

test('a new Host adopts a running device job by its stable identity and can still cancel the original range', { timeout: 90000 }, async context => {
  const device = await fixture(context)
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-host-recovery-'))
  const sessionsDirectory = join(directory, 'sessions')
  const databasePath = join(directory, 'state.sqlite')
  let oldNative, oldStorage, oldSessions, oldEngine, native, storage, sessions, engine, restoredEnvironment
  context.after(async () => {
    await engine?.shutdown()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await restoredEnvironment?.close()
    await rm(directory, { recursive: true, force: true })
  })
  let started = false
  const responder = options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      if (!started) {
        started = true
        return toolResponse('start_command', { name: 'hold' }, 'host-recovery-start')
      }
      return textResponse('Started the device job.')
    }
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  }
  oldNative = await nativeContext(sessionsDirectory, responder)
  oldStorage = await SqliteStorage.open(databasePath)
  oldSessions = new core.NativeSessions(oldNative, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  oldEngine = new core.Engine(oldStorage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, oldSessions, [device.environment], {}, { waitMs: 60000 })
  const receipt = await oldEngine.submit({ commandId: 'host-recovery', eventId: 'host-recovery',
    text: 'Start the long device job.', environmentId: 'remote-project' })
  let conversation
  for (let index = 0; index < 300; index++) {
    await oldEngine.effects.drain()
    conversation = await oldEngine.conversation(receipt.ticketId)
    if (conversation.jobs?.some(job => job.state === 'running') && conversation.reason === 'worker-idle') break
    await sleep(25)
  }
  assert.ok(conversation.jobs.some(job => job.state === 'running'), JSON.stringify(conversation))
  const jobId = conversation.jobs[0].id
  const pid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))

  await oldEngine.effects.stop()
  await oldSessions.close()
  await oldNative.fiber.dispose()
  await oldStorage.close()

  const saved = device.environment.snapshot()
  await device.environment.close()
  restoredEnvironment = core.RemoteEnvironment.restore(saved)
  native = await nativeContext(sessionsDirectory, responder)
  storage = await SqliteStorage.open(databasePath)
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [restoredEnvironment], {}, { waitMs: 60000 })
  engine.effects.start()
  let recovered
  for (let index = 0; index < 300; index++) {
    await engine.effects.drain()
    recovered = await engine.getJob(receipt.ticketId, jobId)
    if (recovered.state === 'running' && recovered.remote?.recoveredAt) break
    await sleep(25)
  }
  assert.equal(recovered.state, 'running', JSON.stringify(recovered))
  assert.equal(recovered.remote.deviceState, 'running')
  assert.equal(recovered.remote.rangeSettled, false)
  assert.equal(typeof recovered.remote.recoveredAt, 'number')
  await engine.cancelJob({ commandId: 'host-recovery-cancel', ticketId: receipt.ticketId, jobId, reason: 'Finish the acceptance check.' })
  const cancelled = await engine.getJob(receipt.ticketId, jobId)
  assert.equal(cancelled.state, 'cancelled', JSON.stringify(cancelled))
  await until(() => {
    try { process.kill(pid, 0); return false } catch { return true }
  }, 'the adopted device process to stop')
})

test('a remote job stays starting until its start response arrives', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-delayed-start-'))
  let native, storage, sessions, engine
  const { environment, release } = delayedRemoteEnvironment(join(directory, 'device-work'))
  t.after(async () => {
    release()
    await engine?.shutdown()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  let workerCalls = 0
  native = await nativeContext(join(directory, 'sessions'), options => {
    if (options.model === 'worker') {
      if (workerCalls++ === 0) return toolResponse('start_command', { name: 'hold' }, 'delayed-start')
      return textResponse('Started the delayed device job.')
    }
    return toolResponse('assign_worker', {}, 'delayed-assign')
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [environment], {}, { waitMs: 60000 })
  engine.effects.start()
  const receipt = await engine.submit({ commandId: 'delayed-start', eventId: 'delayed-start',
    text: 'Start the delayed device job.', environmentId: 'remote-project' })
  await until(async () => (await engine.listJobs(receipt.ticketId)).length === 1, 'the delayed start intent', 10000)
  const [intent] = await engine.listJobs(receipt.ticketId)
  assert.equal(intent.state, 'starting')
  release()
  await until(async () => (await engine.getJob(receipt.ticketId, intent.id)).state === 'running', 'the delayed start response', 10000)
})

test('an offline stop remains pending and is confirmed after a daemon restart proves the original range gone', { timeout: 90000 }, async context => {
  const device = await fixture(context)
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-stop-recovery-'))
  let native, storage, sessions, engine
  context.after(async () => {
    await engine?.shutdown()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  let started = false
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      if (!started) {
        started = true
        return toolResponse('start_command', { name: 'hold' }, 'stop-recovery-start')
      }
      return textResponse('Started the device job.')
    }
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [device.environment], {}, { waitMs: 60000 })
  const receipt = await engine.submit({ commandId: 'stop-recovery', eventId: 'stop-recovery',
    text: 'Start the long device job.', environmentId: 'remote-project' })
  let conversation
  for (let index = 0; index < 300; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.jobs?.some(job => job.state === 'running') && conversation.reason === 'worker-idle') break
    await sleep(25)
  }
  assert.ok(conversation.jobs.some(job => job.state === 'running'), JSON.stringify(conversation))
  const pid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  await device.kill()
  await engine.stopTicket({ commandId: 'stop-recovery-command', ticketId: receipt.ticketId, reason: 'Stop while the device is offline.' })
  conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.stop.state, 'stopping')
  assert.equal(conversation.stop.pendingDeviceConfirmation, true)
  assert.equal(conversation.jobs[0].state, 'unknown')
  try { process.kill(pid, 'SIGKILL') } catch { /* The device may have taken the child with it. */ }
  await until(() => {
    try { process.kill(pid, 0); return false } catch { return true }
  }, 'the stopped device process to exit')
  await device.restart()
  conversation = await engine.reconcileStop({ commandId: 'stop-recovery-reconcile', ticketId: receipt.ticketId })
  assert.equal(conversation.stop.state, 'stopped')
  assert.equal(conversation.stop.pendingDeviceConfirmation, false)
  assert.equal(typeof conversation.stop.cancellationConfirmedAt, 'number')
  assert.equal(conversation.jobs[0].state, 'cancelled')
})

test('a foreground remote command keeps a durable start intent that an offline stop can reconcile by original ID', { timeout: 40000 }, async context => {
  const device = await fixture(context)
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-foreground-recovery-'))
  let native, storage, sessions, engine
  context.after(async () => {
    await engine?.shutdown()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      if (results.length === 0) return toolResponse('run_command', { name: 'foreground' }, 'foreground-start')
      return textResponse('The foreground command finished.')
    }
    return results.length ? textResponse('Recorded.') : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    { retryDelayMs: 10, scanIntervalMs: 20 }, sessions, [device.environment], {}, { waitMs: 60000 })
  const receipt = await engine.submit({ commandId: 'foreground-recovery', eventId: 'foreground-recovery',
    text: 'Run the long foreground device command.', environmentId: 'remote-project' })
  engine.effects.start()
  let intent
  for (let index = 0; index < 200; index++) {
    const jobs = await engine.listJobs(receipt.ticketId)
    intent = jobs.find(job => job.command === 'foreground')
    if (intent?.state === 'starting') break
    await sleep(25)
  }
  assert.equal(intent?.state, 'starting', JSON.stringify(intent))
  await until(async () => (await readFile(join(device.root, 'hold.pid'), 'utf8').catch(() => '')).trim() !== '',
    'the foreground device process')
  const pid = Number(await readFile(join(device.root, 'hold.pid'), 'utf8'))
  await device.kill()
  await engine.stopTicket({ commandId: 'foreground-stop', ticketId: receipt.ticketId, reason: 'Stop the offline foreground command.' })
  let conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.stop.pendingDeviceConfirmation, true)
  assert.equal(conversation.jobs.find(job => job.command === 'foreground').state, 'unknown')
  try { process.kill(pid, 'SIGKILL') } catch { /* The device may have taken the child with it. */ }
  await until(() => {
    try { process.kill(pid, 0); return false } catch { return true }
  }, 'the foreground device process to exit')
  await device.restart()
  conversation = await engine.reconcileStop({ commandId: 'foreground-reconcile', ticketId: receipt.ticketId })
  assert.equal(conversation.stop.state, 'stopped')
  assert.equal(conversation.jobs.find(job => job.command === 'foreground').state, 'cancelled')
})
