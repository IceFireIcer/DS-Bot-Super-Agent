import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { nativeContext, textResponse } from '../dev/native-mock.mjs'

test('the native Session adapter preserves original input and an idle turn is not a ready report', { timeout: 10000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-'))
  let runtime
  let native
  context.after(async () => { await runtime?.close(); await native?.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  const requests = []
  native = await nativeContext(directory, options => {
    requests.push(options)
    return textResponse('This is partial thinking, not a completed result.')
  })
  runtime = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const outcome = await runtime.run({ sessionId: 'worker-one', role: 'worker', text: 'Original request exactly as supplied.', tools: [] })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'worker')
  assert.deepEqual(requests[0].tools ?? [], [])
  assert.ok(requests[0].messages.some(message => message.role === 'user' && message.content.some(block => block.text === 'Original request exactly as supplied.')))
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
