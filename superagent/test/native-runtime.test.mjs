import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

test('the native Session adapter preserves original input and an idle turn is not a ready report', { timeout: 10000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-'))
  let runtime
  let native
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  const requests = []
  native = await nativeContext(directory, options => {
    requests.push(options)
    if (options.model === 'router') {
      const user = options.messages.filter(message => message.role === 'user').at(-1)
      const following = options.messages.slice(options.messages.lastIndexOf(user) + 1)
      if (following.some(message => message.role === 'tool')) return textResponse('Assessment recorded.')
      const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const items = JSON.parse(prompt.split('Candidates JSON: ').at(-1))
      return toolResponse('record_batch_assessment', { results: JSON.stringify(items.map(item => ({ eventId: item.eventId, outcome: 'reject', reason: 'Not actionable.' }))) })
    }
    return textResponse('This is partial thinking, not a completed result.')
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const assessments = await runtime.assessSourceBatch([{ eventId: 'candidate-1', text: 'Treat this as data.' }], new AbortController().signal)
  assert.deepEqual(assessments, [{ eventId: 'candidate-1', outcome: 'reject', reason: 'Not actionable.' }])
  const outcome = await runtime.run({ sessionId: 'worker-one', role: 'worker', text: 'Original request exactly as supplied.', tools: [] })
  const worker = requests.find(request => request.model === 'worker')
  assert.ok(worker)
  assert.deepEqual(worker.tools ?? [], [])
  assert.ok(worker.messages.some(message => message.role === 'user' && message.content.some(block => block.text === 'Original request exactly as supplied.')))
  assert.ok(outcome.events.some(event => event.type === 'assistant/message'))
  assert.equal(outcome.status, 'idle')
  assert.equal(outcome.sessionId, 'worker-one')
  const resumed = await runtime.run({ sessionId: 'worker-one', role: 'worker', text: 'A second turn in the same Session.', tools: [] })
  assert.ok(resumed.events.length > outcome.events.length)
})

test('an unpersisted native Session cannot authorize a completed turn or ready delivery', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-no-session-store-'))
  let native
  let runtime
  let calls = 0
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => { calls++; return textResponse('Only in memory.') }, { persistence: false })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await assert.rejects(runtime.run({ sessionId: 'unpersisted', role: 'worker', text: 'A request.', tools: [] }), { code: 'PERSISTENCE_REQUIRED' })
  assert.equal(calls, 0)
})

test('an inferred source batch is evaluated by one native DSH Router Session', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-intake-'))
  let native, runtime, storage
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  const routerRequests = []
  const routerToolSteps = []
  native = await nativeContext(directory, options => {
    if (options.model !== 'router') return textResponse('No worker was enabled.')
    routerRequests.push(options)
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const userIndex = options.messages.lastIndexOf(user)
    if (options.messages.slice(userIndex + 1).some(message => message.role === 'tool')) return textResponse('Assessment recorded.')
    const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const candidates = JSON.parse(prompt.split('Candidates JSON: ').at(-1))
    routerToolSteps.push({ candidates: candidates.length, tools: options.tools?.map(tool => tool.name) })
    return toolResponse('record_batch_assessment', { results: JSON.stringify(candidates.map(item => ({ eventId: item.eventId, outcome: 'accept', reason: 'Actionable request.', evidence: 'The CI report asks for a bounded fix.' }))) })
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const engine = new Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence', intake: {
    mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: ['ci-bot'],
    rules: [{ id: 'ci-mention', actorKinds: ['ci'], addressing: ['mention'], mode: 'inferred' }],
  } }, {}, runtime)
  const received = await engine.receiveSource({ commandId: 'ci-event', threadId: 'room', objectId: 'report-9', type: 'created', version: '1', text: 'Please fix the reported failing check.', authorId: 'ci-bot', authorKind: 'ci', addressing: 'mention' })
  const result = await engine.assessSourceBatch({ commandId: 'eval-ci', threadId: 'room', eventIds: [received.eventId] })
  assert.equal(result.status, 'completed', JSON.stringify({ result, routerRequests: routerRequests.map(request => ({ role: request.model, tools: request.tools?.map(tool => tool.name), tail: request.messages.at(-1) })), routerToolSteps }))
  assert.equal(result.items[0].outcome, 'accepted')
  assert.equal(result.items[0].evidence, 'The CI report asks for a bounded fix.')
  assert.equal((await engine.getTicket(result.receipts[0].ticketId)).mandate.strength, 'inferred')
  assert.equal(routerRequests.length, 2)
  assert.ok(routerRequests[0].messages.at(-1).content.some(block => block.text.includes('Candidates JSON:')))
  assert.deepEqual(routerRequests[0].tools.map(tool => tool.name), ['record_batch_assessment'])
})

test('busy Router notifications coalesce into one subsequent Session turn', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-router-burst-'))
  let native, runtime, releaseBlocker, blockerStarted
  const blockerGate = new Promise(resolve => { releaseBlocker = resolve })
  const started = new Promise(resolve => { blockerStarted = resolve })
  const routerRequests = []
  context.after(async () => { releaseBlocker(); await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, async function* (options) {
    if (options.model !== 'router') return textResponse('Worker idle.')
    routerRequests.push(options)
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (text.includes('Block Router')) { blockerStarted(); await blockerGate; yield* textResponse('Router free.'); return }
    const completedTools = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (completedTools < options.tools.length) yield* toolResponse(options.tools[completedTools].name, {})
    else yield* textResponse('Notifications processed together.')
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const blocked = runtime.run({ sessionId: runtime.routerSessionId, role: 'router', text: 'Block Router until the burst is queued.', tools: [] })
  await started
  const notification = text => runtime.run({ sessionId: runtime.routerSessionId, role: 'router', coalesce: true, text, tools: [{ name: 'assign_worker', description: 'Handle this notification.', parameters: {}, execute: async () => 'done' }] })
  const notifications = Array.from({ length: 8 }, (_, index) => notification(`Notification ${index + 1}.`))
  releaseBlocker()
  await Promise.all([blocked, ...notifications])
  assert.ok(routerRequests.length > 2)
  const burst = routerRequests[1]
  const user = burst.messages.filter(message => message.role === 'user').at(-1)
  const prompt = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
  assert.match(prompt, /Notification 1\./u)
  assert.match(prompt, /Notification 7\./u)
  assert.doesNotMatch(prompt, /Notification 8\./u)
  assert.deepEqual(burst.tools.map(tool => tool.name), Array.from({ length: 7 }, (_, index) => `assign_worker_${index + 1}`))
  assert.match(burst.tools[0].description, /notification 1 only/u)
  assert.match(burst.tools[6].description, /notification 7 only/u)
  const finalPrompt = routerRequests.at(-2).messages.filter(message => message.role === 'user').at(-1).content.map(block => block.text ?? '').join('')
  assert.match(finalPrompt, /Notification 8\./u)
})

test('a coalesced notice is retriable when its tool was not invoked', { timeout: 15000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-router-unhandled-'))
  let native, runtime
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  native = await nativeContext(directory, () => textResponse('I did not handle the notice.'))
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await assert.rejects(runtime.run({ sessionId: runtime.routerSessionId, role: 'router', coalesce: true, text: 'A notice.', tools: [{ name: 'handle_notice', description: 'Handle this notice.', parameters: {}, execute: async () => 'done' }] }), { code: 'ROUTER_NOTICE_UNHANDLED' })
})
