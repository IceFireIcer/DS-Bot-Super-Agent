import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const allPermissions = ['read', 'write', 'search', 'command']
const grant = {
  instanceId: 'private',
  environmentId: 'remote-project',
  allowedActorIds: ['user'],
  permissions: allPermissions,
}

const scripts = {
  inspect: "const fs=require('node:fs');console.log(process.cwd());console.log(process.env.SA_REMOTE_MARKER);console.log(fs.readFileSync('input.txt','utf8'));console.log('多字节✓')",
  hold: "const fs=require('node:fs');console.log('start-多字节✓');const timer=setInterval(()=>{if(fs.existsSync('release.txt')){clearInterval(timer);console.log('done-✓')}},20)",
  quick: "require('node:fs').writeFileSync('executed.txt','device-job\\n');console.log('quick-done')",
  count: "require('node:fs').appendFileSync('starts.txt','x');console.log('started')",
}

const commands = {
  inspect: { argv: ['node', '-e', scripts.inspect], timeoutMs: 5000, backgroundTimeoutMs: 15000, env: { SA_REMOTE_MARKER: 'device-env' } },
  hold: { argv: ['node', '-e', scripts.hold], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  quick: { argv: ['node', '-e', scripts.quick], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  count: { argv: ['node', '-e', scripts.count], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  long: { argv: ['node', '-e', "console.log('cancel-start');setInterval(()=>{},1000)"], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  big: { argv: ['node', '-e', "process.stdout.write('start\\n');process.stdout.write('x'.repeat(40000));console.log('end')"], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
  split: { argv: ['node', '-e', "process.stdout.write(Buffer.from([0x2d,0xe2]));setTimeout(()=>process.stdout.write(Buffer.from([0x9c,0x93,0x0a])),1000)"], timeoutMs: 5000, backgroundTimeoutMs: 15000 },
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

async function proxyFixture(endpoint) {
  const state = { blocked: false, dropNext: false }
  const server = createServer((request, response) => {
    if (state.blocked) {
      request.destroy()
      response.destroy()
      return
    }
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const upstream = httpRequest(new URL(request.url, endpoint), { method: request.method, headers: request.headers }, result => {
        const answer = []
        result.on('data', chunk => answer.push(chunk))
        result.on('end', () => {
          if (state.dropNext) {
            state.dropNext = false
            response.destroy()
            return
          }
          const body = Buffer.concat(answer)
          const headers = { ...result.headers }
          delete headers['transfer-encoding']
          response.writeHead(result.statusCode ?? 500, { ...headers, 'content-length': String(body.length) }).end(body)
        })
      })
      upstream.on('error', error => response.writeHead(502).end(error.message))
      upstream.end(Buffer.concat(chunks))
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }),
  }
}

async function fixture(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-command-'))
  const root = join(directory, 'device-work')
  await mkdir(root)
  await writeFile(join(root, 'input.txt'), 'file-on-device\n')
  const resolvedRoot = await realpath(root)
  const config = { deviceId: 'second-device', root, jobsPath: join(directory, 'device-jobs'), commands,
    grants: Array.isArray(options.grants) ? options.grants : [grant], statePath: join(directory, 'device-state.json'), ...options.open }
  let device, environment, proxy
  context.after(async () => {
    if (options.manualCleanup) return
    await environment?.close()
    await device?.close()
    await proxy?.close()
    await rm(directory, { recursive: true, force: true })
  })
  device = await core.RemoteDevice.open(config)
  const directEndpoint = await device.start()
  if (options.proxy) {
    proxy = await proxyFixture(directEndpoint)
  }
  const endpoint = proxy?.endpoint ?? directEndpoint
  environment = await core.RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private', allowedActorIds: ['user'],
    permissions: Array.isArray(options.permissions) ? options.permissions : allPermissions, endpoint, pairingCode: device.pairingCode,
    expectedDeviceId: 'second-device', expectedDeviceKey: device.deviceKeyFingerprint })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  return { directory, root, resolvedRoot, device, environment, bound, proxy, config }
}

function jobText(job) {
  const read = job.read()
  return read.stdout.text
}

test('a paired device resolves the executable and runs a configured command in its own cwd and environment', { timeout: 20000 }, async context => {
  const { root, resolvedRoot, environment, bound } = await fixture(context)
  const executable = await bound.resolveExecutable('inspect')
  assert.equal(isAbsolute(executable), true)
  assert.notEqual(executable, root)

  const result = await bound.invoke('run_command', { name: 'inspect' })
  assert.equal(result.exitCode, 0)
  assert.equal(result.cancelled, false)
  assert.equal(result.truncated, false)
  assert.equal(result.stdout, '<device-workdir>\ndevice-env\nfile-on-device\n\n多字节✓\n')
  assert.equal(await readFile(join(resolvedRoot, 'input.txt'), 'utf8'), 'file-on-device\n')
  assert.doesNotMatch(result.stdout, new RegExp(resolvedRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))

  const job = await bound.startCommand('quick')
  assert.equal(typeof job.jobId, 'string')
  assert.ok(job.jobId.startsWith(`job:private:remote-project:${environment.deviceIncarnation}:`))
  assert.notEqual(job.jobId, executable)
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(2000)), true)
  assert.equal(jobText(job), 'quick-done\n')
  assert.equal(await readFile(join(root, 'executed.txt'), 'utf8'), 'device-job\n')
})

test('a device job keeps running across a transport disconnect and resumes by byte offset without losing multibyte text', { timeout: 20000 }, async context => {
  const { root, bound, proxy } = await fixture(context, { proxy: true })
  const job = await bound.startCommand('hold')
  await until(() => jobText(job).includes('start-多字节✓'), 'the first job output')
  const first = job.read().stdout
  assert.equal(first.lossy, false)
  assert.equal(first.text, 'start-多字节✓\n')

  proxy.state.blocked = true
  await sleep(200)
  await writeFile(join(root, 'release.txt'), 'release\n')
  await sleep(200)
  proxy.state.blocked = false

  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  const final = job.read().stdout
  assert.equal(final.lossy, false)
  assert.equal(final.text, 'start-多字节✓\ndone-✓\n')
  assert.doesNotMatch(final.text, /\uFFFD/u)
})

test('the remote subprocess provider returns a synchronous public handle with offset readers and cancellation', { timeout: 20000 }, async context => {
  const { environment, bound } = await fixture(context)
  const handle = bound.spawnCommand('quick')
  assert.equal(handle instanceof core.RemoteJobHandle, true)
  assert.equal(typeof handle.terminate, 'function')
  assert.equal(typeof handle.waitForExit, 'function')
  assert.equal(handle.stdin, undefined)
  assert.equal(handle.stdout, undefined)
  assert.equal(handle.stderr, undefined)
  assert.equal(handle.control, undefined)
  assert.equal(typeof handle.collected.stdout.readFrom, 'function')
  assert.equal(handle.done instanceof Promise, true)
  assert.ok(handle.jobId.startsWith(`job:private:remote-project:${environment.deviceIncarnation}:`))
  assert.equal(await handle.done.then(outcome => outcome.exitCode), 0)
  assert.equal(await handle.waitForExit(AbortSignal.timeout(2000)), true)
  const first = handle.collected.stdout.readFrom(0)
  const second = handle.collected.stdout.readFrom(0)
  assert.equal(first.text, 'quick-done\n')
  assert.deepEqual(first, second)
})

test('a UTF-8 character split across bytes and a disconnect is reconstructed without replacement text', { timeout: 20000 }, async context => {
  const { bound, proxy } = await fixture(context, { proxy: true })
  const job = await bound.startCommand('split')
  await until(() => job.read().stdout.text.length > 0, 'the leading split output')
  const partial = job.read().stdout
  assert.equal(partial.text, '-')
  assert.equal(partial.lossy, false)
  proxy.state.blocked = true
  await sleep(1500)
  proxy.state.blocked = false
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal(job.read().stdout.text, '-✓\n')
  assert.doesNotMatch(job.read().stdout.text, /\uFFFD/u)
})

test('an immediate cancellation is queued after the start and confirmed by the actual child exit', { timeout: 20000 }, async context => {
  const { bound } = await fixture(context)
  const job = await bound.startCommand('long')
  job.terminate()
  assert.equal(await job.done.then(result => result.cancelled), true)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
})

test('a cancellation requested during a transport outage is retried until the device confirms it', { timeout: 20000 }, async context => {
  const { bound, proxy } = await fixture(context, { proxy: true })
  const job = await bound.startCommand('long')
  await until(() => job.read().stdout.text.includes('cancel-start'), 'the long output')
  proxy.state.blocked = true
  job.terminate()
  await sleep(300)
  proxy.state.blocked = false
  assert.equal(await job.done.then(result => result.cancelled), true)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
})

test('large terminal output keeps its byte total and lossy fact across a daemon restart', { timeout: 20000 }, async context => {
  const { config, environment, bound } = await fixture(context)
  const job = await bound.startCommand('big')
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  const state = environment.snapshot()
  await environment.close()
  const reopened = await core.RemoteDevice.open(config)
  context.after(() => reopened.close())
  const endpoint = await reopened.start()
  const restored = core.RemoteEnvironment.restore({ ...state, endpoint })
  context.after(() => restored.close())
  const restoredBound = await restored.prepare({ instanceId: 'private', actorId: 'user' })
  const attached = await restoredBound.attachCommand(job.jobId)
  const read = attached.read().stdout
  assert.equal(read.lossy, true)
  assert.equal(await attached.done.then(result => result.exitCode), 0)
  assert.equal(await attached.waitForExit(AbortSignal.timeout(2000)), true)
})

test('a terminal device job record and its output survive a daemon restart', { timeout: 20000 }, async context => {
  const { config, environment, bound } = await fixture(context)
  const job = await bound.startCommand('quick')
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  const state = environment.snapshot()
  await environment.close()
  const reopened = await core.RemoteDevice.open(config)
  context.after(() => reopened.close())
  const endpoint = await reopened.start()
  const restored = core.RemoteEnvironment.restore({ ...state, endpoint })
  context.after(() => restored.close())
  const restoredBound = await restored.prepare({ instanceId: 'private', actorId: 'user' })
  const attached = await restoredBound.attachCommand(job.jobId)
  assert.equal(attached.jobId, job.jobId)
  assert.equal(jobText(attached), 'quick-done\n')
  assert.equal(await attached.done.then(result => result.exitCode), 0)
  assert.equal(await attached.waitForExit(AbortSignal.timeout(2000)), true)
})

test('the durable Engine job record uses the device-stable job identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-remote-command-record-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const jobs = new core.Jobs(storage, 'private', 'runtime')
  try {
    const jobId = `job:private:remote-project:incarnation:${randomUUID()}`
    const job = { jobId, done: Promise.resolve({ exitCode: 0, cancelled: false, truncated: false, settled: true }),
      read: () => ({ stdout: { text: 'done', lossy: false }, stderr: { text: '', lossy: false } }),
      terminate: () => {}, waitForExit: async () => true }
    const record = await storage.transaction('private', transaction => jobs.start(transaction, {
      ticketId: 'ticket', assignmentId: 'assignment', generation: 'generation',
      environmentId: 'remote-project', command: 'quick', job }))
    assert.equal(record.id, jobId)
    jobs.attach(record)
  } finally {
    jobs.shutdown()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('a fresh paired client observes the same job by its stable ID after reconnecting', { timeout: 20000 }, async context => {
  const { root, environment, bound } = await fixture(context)
  const job = await bound.startCommand('hold')
  await until(() => jobText(job).includes('start-多字节✓'), 'the first job output')
  const state = environment.snapshot()
  const restored = core.RemoteEnvironment.restore(state)
  context.after(() => restored.close())
  const restoredBound = await restored.prepare({ instanceId: 'private', actorId: 'user' })
  const attached = await restoredBound.attachCommand(job.jobId)
  assert.equal(attached.jobId, job.jobId)
  assert.ok(jobText(attached).includes('start-多字节✓'))

  await writeFile(join(root, 'release.txt'), 'release\n')
  assert.equal(await attached.done.then(result => result.exitCode), 0)
  assert.equal(await attached.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal(jobText(attached), 'start-多字节✓\ndone-✓\n')
  await environment.close()
})

test('a lost start response is reconciled by the original job ID instead of starting the command twice', { timeout: 20000 }, async context => {
  const { root, environment, bound, proxy } = await fixture(context, { proxy: true })
  proxy.state.dropNext = true
  const job = await bound.startCommand('count')
  assert.equal(await job.done.then(result => result.exitCode), 0)
  assert.equal(await job.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal(await readFile(join(root, 'starts.txt'), 'utf8'), 'x')
  assert.equal(jobText(job), 'started\n')

  await assert.rejects(environment.call({ instanceId: 'private', environmentId: 'remote-project', actorId: 'user',
    operation: 'command.start', args: { jobId: job.jobId, name: 'quick', mode: 'background' } }), { code: 'IDENTITY_CONFLICT' })
  await assert.rejects(environment.call({ instanceId: 'private', environmentId: 'remote-project', actorId: 'user',
    operation: 'command.start', args: { jobId: 'job:private:remote-project:wrong:1', name: 'quick', mode: 'background' } }),
  { code: 'JOB_IDENTITY_MISMATCH' })
})

test('two device jobs keep separate output and cancelling one does not disturb the other', { timeout: 20000 }, async context => {
  const { root, bound } = await fixture(context)
  const first = await bound.startCommand('hold')
  const second = await bound.startCommand('hold')
  await until(() => jobText(first).includes('start-') && jobText(second).includes('start-'), 'both jobs to start')
  first.terminate()
  assert.equal(await first.done.then(result => result.cancelled), true)
  assert.equal(await first.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal(jobText(second).includes('done-'), false)
  await writeFile(join(root, 'release.txt'), 'release\n')
  assert.equal(await second.done.then(result => result.exitCode), 0)
  assert.equal(await second.waitForExit(AbortSignal.timeout(5000)), true)
  assert.equal(jobText(second), 'start-多字节✓\ndone-✓\n')
})

test('command capability requires both the device grant and the paired permission set', { timeout: 20000 }, async context => {
  await assert.rejects(fixture(context, {
    permissions: ['read', 'search'],
    grants: [{ ...grant, permissions: ['read', 'search'] }],
  }).then(({ bound }) => bound.invoke('run_command', { name: 'quick' })), { code: 'PERMISSION_DENIED' })
  await assert.rejects(core.RemoteDevice.open({ deviceId: 'bad', root: tmpdir(), commands,
    grants: [{ ...grant, permissions: ['command'], allowedActorIds: ['user'] }] }), { code: 'INVALID_CONFIG' })
})

test('a Worker runs and observes a device command through the public Engine tools', { timeout: 30000 }, async context => {
  const { directory, device, environment } = await fixture(context, { manualCleanup: true })
  let native, storage, sessions, engine
  context.after(async () => {
    engine?.shutdown()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await environment?.close()
    await device?.close()
    await rm(directory, { recursive: true, force: true })
  })
  let workerTools
  native = await nativeContext(join(directory, 'sessions'), options => {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (options.model === 'worker') {
      workerTools = options.tools.map(tool => tool.name).sort()
      if (results.length === 0) return toolResponse('run_command', { name: 'quick' }, 'remote-command-0')
      if (results.length === 1) return toolResponse('report_ready', { result: 'Ran a command on the paired device.',
        evidence: 'run_command returned exit 0 and the device wrote executed.txt in its bound working directory.',
        artifacts: 'executed.txt' }, 'remote-command-ready')
      return textResponse('Ready.')
    }
    if (results.length) return textResponse('Recorded.')
    return text.startsWith('Ready report:')
      ? toolResponse('deliver_result', { reportId: JSON.parse(text.slice('Ready report:'.length)).id })
      : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions,
    [environment], {}, { waitMs: 60000 })
  const receipt = await engine.submit({ commandId: 'remote-command', eventId: 'remote-command', text: 'Run a command on the paired device.', environmentId: 'remote-project' })
  let conversation
  for (let index = 0; index < 400; index++) {
    await engine.effects.drain()
    conversation = await engine.conversation(receipt.ticketId)
    if (conversation.status === 'ready') break
    await sleep(25)
  }
  assert.ok(conversation)
  assert.equal(conversation.status, 'ready', JSON.stringify({ status: conversation.status, reason: conversation.reason }))
  assert.equal(conversation.executionLocation.kind, 'remote')
  assert.deepEqual(conversation.reports[0].toolFacts.map(fact => fact.tool), ['run_command'])
  assert.ok(workerTools.includes('run_command'))
  assert.ok(workerTools.includes('start_command'))
  assert.ok(workerTools.includes('job_status'))
  assert.equal(await readFile(join(directory, 'device-work', 'executed.txt'), 'utf8'), 'device-job\n')
  assert.equal(device.listPairings().length, 1)
})
