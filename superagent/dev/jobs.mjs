import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine, LocalEnvironment, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from './native-mock.mjs'

// Declared workload for asynchronous long commands. Every figure below is measured in this run on this
// machine; none is copied from the reference prototype or an earlier experiment.
const workload = { longCommandMs: 12000, shortCommandMs: 400, backgroundWaitMs: 60000, scanIntervalMs: 50, tickets: 4 }
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-job-load-'))
const root = join(directory, 'work')
await mkdir(root)
let context, storage, sessions, engine
const prompts = []
try {
  context = await nativeContext(join(directory, 'sessions'), function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const steps = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    prompts.push(text)
    if (text.startsWith('Long build ')) return yield* (steps ? textResponse('Turn complete.') : toolResponse('start_command', { name: 'long' }))
    if (text.startsWith('Chat while the build runs')) {
      const plan = [['write_file', { path: 'chat.txt', text: 'answered\n' }], ['run_command', { name: 'verify' }],
        ['report_ready', { result: 'Answered while the build ran.', evidence: 'Wrote and verified chat.txt during the long command.', artifacts: 'chat.txt' }]]
      const next = plan[steps]
      return yield* (next ? toolResponse(next[0], next[1], `chat-${steps}`) : textResponse('Done.'))
    }
    yield* textResponse('Turn complete.')
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const environment = await LocalEnvironment.open({ id: 'project', instanceId: 'job-load', root, allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], commands: {
      // A real Windows process that keeps running until released, so the turn really returns before it ends.
      long: { argv: [process.execPath, '-e', "const fs=require('node:fs');const end=Date.now()+12000;fs.writeFileSync('long-started.txt','started');setInterval(()=>{if(Date.now()>end||fs.existsSync('long-release.txt')){console.log('long finished');process.exit(0)}},25)"], timeoutMs: 10000, backgroundTimeoutMs: 60000 },
      verify: { argv: [process.execPath, '-e', "console.log('ok')"], timeoutMs: 2000 },
    } })
  engine = new Engine(storage, 'job-load', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room', 'chat'], versionOrder: 'sequence' },
    { retryDelayMs: 10, scanIntervalMs: workload.scanIntervalMs }, sessions, [environment], {}, { maxPerTicket: 4, waitMs: workload.backgroundWaitMs })
  engine.effects.start()
  const accept = async (threadId, objectId, text) => {
    const event = await engine.receiveSource({ commandId: `receive-${objectId}`, threadId, objectId, type: 'created', version: '1', text })
    return (await engine.acceptSource({ commandId: `accept-${objectId}`, threadId, objectId, expectedEventId: event.eventId, environmentId: 'project' })).ticketId
  }
  const waitUntil = async (check, label, timeout = 60000) => {
    const deadline = Date.now() + timeout
    while (!await check()) {
      if (Date.now() > deadline) throw new Error(`The declared job workload did not reach: ${label}.`)
      await sleep(20)
    }
  }

  const startedAt = performance.now()
  const ticketId = await accept('room', 'build-1', 'Long build 1.')
  await waitUntil(async () => (await engine.listJobs(ticketId)).length === 1, 'the job start fact')
  const [job] = await engine.listJobs(ticketId)
  const turnReturnedMs = performance.now() - startedAt
  // New input is accepted and answered while the long command is still running.
  const chatAt = performance.now()
  const chatTicket = await accept('chat', 'chat-1', 'Chat while the build runs.')
  await waitUntil(async () => (await engine.conversation(chatTicket)).status === 'ready', 'the independent reply')
  const chatReplyMs = performance.now() - chatAt
  const duringChat = await engine.getJob(ticketId, job.id)
  // A direction correction cancels the job and is not treated as a delivered result.
  const correctionAt = performance.now()
  await engine.cancelJob({ commandId: 'correction', ticketId, jobId: job.id, reason: 'The person changed direction.' })
  const correctionMs = performance.now() - correctionAt
  const corrected = await engine.getJob(ticketId, job.id)
  assert.equal(corrected.state, 'cancelled')
  assert.equal(corrected.succeeded, false)
  const slotHoldsAfterCancel = (await engine.listSlots()).holding.length

  // A second long build that ends normally proves the completion event returns to its own Worker.
  const normalAt = performance.now()
  const normalTicket = await accept('room', 'build-2', 'Long build 2.')
  await waitUntil(async () => (await engine.listJobs(normalTicket)).length === 1, 'the second job start fact')
  const [normalJob] = await engine.listJobs(normalTicket)
  await writeFile(join(root, 'long-release.txt'), 'release')
  await waitUntil(async () => (await engine.getJob(normalTicket, normalJob.id)).settled, 'the job exit')
  await waitUntil(async () => prompts.some(text => text.startsWith(`Background job ${normalJob.id}`)), 'the completion event')
  const completionMs = performance.now() - normalAt
  const completed = await engine.getJob(normalTicket, normalJob.id)
  assert.equal(completed.state, 'exited')
  assert.equal(completed.exitCode, 0)
  assert.equal(completed.succeeded, true)
  const completionEvent = prompts.find(text => text.startsWith(`Background job ${normalJob.id}`))
  assert.match(completionEvent, /exit code 0/u)
  // The completion event never turns into a result by itself.
  assert.deepEqual((await engine.conversation(normalTicket)).reports, [])
  await waitUntil(async () => (await engine.listSlots()).holding.length === 0, 'the drained slots')
  console.log(JSON.stringify({
    workload,
    measured: {
      turnReturnedWhileCommandRunningMs: Number(turnReturnedMs.toFixed(1)),
      independentReplyDuringLongCommandMs: Number(chatReplyMs.toFixed(1)),
      jobStillRunningWhenAnswered: duringChat.state === 'running',
      directionCorrectionMs: Number(correctionMs.toFixed(1)),
      slotsHeldAfterCancel: slotHoldsAfterCancel,
      completionEventLatencyMs: Number(completionMs.toFixed(1)),
      completionExitCode: completed.exitCode,
      completionReportedAsResult: false,
    },
  }, null, 2))
} finally {
  engine?.shutdown(); await engine?.effects.stop(); await sessions?.close(); await context?.fiber.dispose(); await storage?.close()
  await rm(directory, { recursive: true, force: true })
}
