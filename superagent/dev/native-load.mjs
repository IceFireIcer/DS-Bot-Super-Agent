import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, toolResponse, textResponse, routerResponse } from './native-mock.mjs'

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-load-'))
let context
let storage
let sessions
let engine
let modelCalls = 0
try {
  context = await nativeContext(join(directory, 'sessions'), options => {
    modelCalls++
    if (options.model === 'router') return routerResponse(options)
    const latest = options.messages.filter(message => message.role === 'user').at(-1)
    if (options.messages.slice(options.messages.lastIndexOf(latest) + 1).some(message => message.role === 'tool')) return textResponse('Recorded.')
    return toolResponse('report_ready', { result: 'The answer is 4.', evidence: 'Checked 2 + 2 = 4.' })
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new Engine(storage, 'load', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const start = performance.now()
  const receipts = []
  for (let index = 0; index < 10; index++) receipts.push(await engine.submit({ commandId: `request-${index}`, eventId: `message-${index}`, text: 'What is 2 + 2?' }))
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  for (const receipt of receipts) {
    const conversation = await engine.conversation(receipt.ticketId)
    assert.equal(conversation.status, 'ready')
    assert.equal(conversation.assignments.length, 1)
    assert.equal(conversation.reports.length, 1)
    assert.deepEqual(conversation.messages.map(message => message.purpose), ['acknowledgement', 'result'])
  }
  const beforeReplay = modelCalls
  for (let index = 0; index < 20; index++) await engine.submit({ commandId: `retry-${index}`, eventId: 'message-0', text: 'What is 2 + 2?' })
  await engine.effects.drain()
  assert.equal(modelCalls, beforeReplay)
  const persisted = await context.sessionPersistence.list()
  assert.equal(persisted.length, 11)
  assert.equal(context.agents.list().length, 0)
  console.log(JSON.stringify({ workload: { requests: 10, retries: 20, deliveredMessages: 20 }, nativeSessions: persisted.length, modelCalls, replayAddsModelCalls: false, elapsedMs: performance.now() - start }))
} finally {
  await engine?.effects.stop(); await sessions?.close(); await context?.fiber.dispose(); await storage?.close()
  await rm(directory, { recursive: true, force: true })
}
