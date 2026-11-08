import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

for (const sourceMode of [false, true]) test(`a native Router delivers ready evidence to the original ${sourceMode ? 'versioned source thread' : 'desktop message'}`, { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-loop-'))
  let native
  let storage
  let sessions
  let engine
  let releaseWorker
  context.after(async () => {
    releaseWorker?.()
    await engine?.effects.stop()
    await sessions?.close()
    await native?.fiber.dispose()
    await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const requests = []
  let startWorker
  const workerStarted = new Promise(resolve => { startWorker = resolve })
  const workerGate = new Promise(resolve => { releaseWorker = resolve })
  native = await nativeContext(join(directory, 'sessions'), options => {
    requests.push(options)
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const hadTool = options.messages.slice(options.messages.lastIndexOf(user) + 1).some(message => message.role === 'tool')
    if (hadTool) return textResponse('Recorded.')
    if (options.model === 'worker') return (async function* () {
      startWorker()
      await workerGate
      yield* toolResponse('report_ready', { result: 'The answer is 4.', evidence: 'Computed 2 + 2 = 4 from the original request.' })
    })()
    if (text.startsWith('Ready report:')) {
      const report = JSON.parse(text.slice('Ready report:'.length))
      return toolResponse('deliver_result', { reportId: report.id })
    }
    return toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], ...(sourceMode ? { allowedThreadIds: ['room'], versionOrder: 'sequence' } : {}) }, {}, sessions)
  const command = { commandId: 'request', eventId: 'original-message', text: 'What is 2 + 2? Show the answer.' }
  const received = sourceMode ? await engine.receiveSource({ commandId: 'receive', objectId: command.eventId, threadId: 'room', type: 'created', version: '1', text: command.text }) : undefined
  const sourceRequest = { commandId: 'request', objectId: command.eventId, threadId: 'room', expectedEventId: received?.eventId }
  const receipt = sourceMode ? await engine.acceptSource(sourceRequest) : await engine.submit(command)
  assert.equal((await engine.conversation(receipt.ticketId)).status, 'pending')
  const running = (async () => { for (let index = 0; index < 5; index++) await engine.effects.drain() })()
  await workerStarted
  assert.equal((await engine.conversation(receipt.ticketId)).status, 'running')
  assert.equal((await engine.conversation(receipt.ticketId)).messages.some(message => message.purpose === 'result'), false)
  releaseWorker()
  await running
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  const conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'ready')
  assert.equal(conversation.assignments.length, 1)
  assert.equal(conversation.reports.length, 1)
  assert.equal(conversation.reports[0].kind, 'ready')
  assert.equal(conversation.messages.length, 2)
  assert.deepEqual(conversation.messages.map(message => message.purpose), ['acknowledgement', 'result'])
  assert.ok(conversation.messages.every(message => message.destination.eventId === 'original-message'))
  if (sourceMode) assert.ok(conversation.messages.every(message => message.destination.threadId === 'room'))
  assert.equal(conversation.messages[1].text, 'The answer is 4.')
  assert.equal(conversation.messages[1].reportId, conversation.reports[0].id)
  const worker = requests.filter(request => request.model === 'worker')
  assert.ok(worker[0].messages.some(message => message.role === 'user' && message.content.some(block => block.text === command.text)))
  assert.deepEqual(worker[0].tools.map(tool => tool.name), ['add_thread_subscription', 'ask_human', 'remove_thread_subscription', 'report_ready'])
  if (sourceMode) await engine.acceptSource({ ...sourceRequest, commandId: 'transport-retry' })
  else await engine.submit({ ...command, commandId: 'transport-retry' })
  for (let index = 0; index < 3; index++) await engine.effects.drain()
  assert.equal((await engine.conversation(receipt.ticketId)).messages.length, 2)
  assert.equal((await engine.conversation(receipt.ticketId)).assignments.length, 1)
})

test('idle Worker text never becomes a result and cannot invoke Router-only delivery tools', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-idle-worker-'))
  let native
  let storage
  let sessions
  let engine
  context.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const visible = []
  native = await nativeContext(join(directory, 'sessions'), options => {
    if (options.model === 'worker') {
      visible.push(...options.tools.map(tool => tool.name))
      return options.messages.some(message => message.role === 'tool') ? textResponse('I have not finished yet.') : toolResponse('deliver_result', { reportId: 'forged' })
    }
    return options.messages.some(message => message.role === 'tool') ? textResponse('Assigned.') : toolResponse('assign_worker', {})
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const receipt = await engine.submit({ commandId: 'idle', eventId: 'message', text: 'Prepare a complete answer.' })
  for (let index = 0; index < 4; index++) await engine.effects.drain()
  const conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'running')
  assert.equal(conversation.reason, 'worker-idle')
  assert.deepEqual(conversation.reports, [])
  assert.deepEqual(conversation.messages.map(message => message.purpose), ['acknowledgement'])
  assert.equal(visible.some(name => name === 'report_ready'), true)
  assert.equal(visible.some(name => name === 'assign_worker' || name === 'deliver_result'), false)
})

for (const partial of [false, true]) test(`Engine notices share the next busy Router turn and ${partial ? 'retry an unhandled item' : 'keep individual receipts'}`, { timeout: 10000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-engine-burst-'))
  let native, storage, sessions, engine, release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  context.after(async () => {
    release()
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const turns = []
  let now = 100
  native = await nativeContext(join(directory, 'sessions'), async function* (options) {
    if (options.model === 'worker') { yield* textResponse('No completed result.'); return }
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.map(block => block.text ?? '').join('')
    const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
    if (!results.length) {
      turns.push(text)
      if (text.includes('Hold the Router.')) { entered(); await gate }
    }
    if (partial && text.includes('Request alpha.') && text.includes('Request beta.') && results.length === 1) { yield* textResponse('Only the first notice was handled.'); return }
    const tool = options.tools[results.length]
    if (tool) yield* toolResponse(tool.name, {}, `call-${results.length}`)
    else yield* textResponse('Assigned.')
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, { now: () => now, retryDelayMs: 1 }, sessions)
  await engine.submit({ commandId: 'hold', eventId: 'hold', text: 'Hold the Router.' })
  const running = engine.effects.drain()
  await started
  const alpha = await engine.submit({ commandId: 'alpha', eventId: 'alpha', text: 'Request alpha.' })
  const beta = await engine.submit({ commandId: 'beta', eventId: 'beta', text: 'Request beta.' })
  const notices = (await engine.effects.list()).items.filter(effect => effect.stream === 'notice' && [alpha.ticketId, beta.ticketId].includes(effect.payload.ticketId))
  assert.equal(notices.length, 2)
  release()
  await running
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  assert.ok(turns.some(text => text.includes('Request alpha.') && text.includes('Request beta.')), JSON.stringify(turns))
  if (partial) {
    assert.equal((await engine.effects.receipt(notices[0].id, notices[0].generation)).state, 'done')
    assert.equal((await engine.effects.receipt(notices[1].id, notices[1].generation)).state, 'pending')
    assert.equal((await engine.conversation(beta.ticketId)).assignments.length, 0)
    now += 10
    for (let index = 0; index < 5; index++) await engine.effects.drain()
  }
  for (const notice of notices) assert.equal((await engine.effects.receipt(notice.id, notice.generation)).state, 'done')
  for (const receipt of [alpha, beta]) assert.equal((await engine.conversation(receipt.ticketId)).assignments.length, 1)
})
