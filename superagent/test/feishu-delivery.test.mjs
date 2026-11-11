import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as core from '../dist/index.js'

const view = (overrides = {}) => ({ id: 'delivery-1', instanceId: 'private', ticketId: 'ticket-1', purpose: 'answer', text: 'Use the blue option.',
  destination: { sourceInstanceId: 'feishu:tenant:chat', actorId: 'alice', eventId: 'message:om_question', threadId: 'feishu:tenant:chat' },
  basis: { kind: 'human-question', questionEventId: 'question', questionText: 'Which color?', fact: 'blue' },
  effectId: 'effect-1', effectGeneration: 'gen-1', sequence: 1, createdAt: 1, state: 'pending', ...overrides })
const context = { idempotencyKey: 'effect-1:gen-1', signal: new AbortController().signal }

test('a Feishu answer replies in place and reuses the same uuid for retries', async () => {
  const calls = []
  let fail = false
  const channel = new core.FeishuDeliveryChannel({ replyMessage: async request => {
    calls.push(request)
    if (fail) throw new core.FeishuApiError(undefined, 503, 'unavailable')
    return { messageId: 'om_reply' }
  } }, { now: () => 1000 })
  assert.deepEqual(await channel.deliver(view(), context), { type: 'success' })
  assert.equal(calls[0].messageId, 'om_question')
  assert.equal(calls[0].text, 'Use the blue option.')
  assert.match(calls[0].uuid, /^[a-f0-9]{32}$/u)
  fail = true
  assert.equal((await channel.reconcile(view(), context)).type, 'transient')
  fail = false
  await channel.deliver(view(), context)
  assert.equal(calls.at(-1).uuid, calls[0].uuid, 'a retry or reconcile keeps the Feishu deduplication key')
})

test('Feishu delivery maps transient, gone and unsupported destinations', async () => {
  const withError = error => new core.FeishuDeliveryChannel({ replyMessage: async () => { throw error } }, { now: () => 1000 })
  assert.deepEqual(await withError(new core.FeishuApiError(99991400, undefined, 'rate limited')).deliver(view(), context),
    { type: 'transient', reason: 'FEISHU_99991400' })
  assert.deepEqual(await withError(new core.FeishuApiError(undefined, 503, 'unavailable')).deliver(view(), context),
    { type: 'transient', reason: 'FEISHU_HTTP_503' })
  assert.deepEqual(await withError(new core.FeishuApiError(230110, undefined, 'deleted')).deliver(view(), context),
    { type: 'permanent', reason: 'DESTINATION_GONE: the Feishu message was deleted.' })
  assert.deepEqual(await withError(new core.FeishuApiError(230027, undefined, 'no permission')).deliver(view(), context),
    { type: 'permanent', reason: 'FEISHU_230027' })
  assert.deepEqual(await withError(new core.FeishuApiError(12345, undefined, 'unexpected')).deliver(view(), context),
    { type: 'unknown', reason: 'FEISHU_12345' })
  const channel = new core.FeishuDeliveryChannel({ replyMessage: async () => ({ messageId: 'om_reply' }) }, { now: () => 1000 })
  assert.equal((await channel.deliver(view({ destination: { sourceInstanceId: 'github:repo', actorId: 'alice', eventId: 'message:om_question',
    threadId: 'github:repo#1' } }), context)).type, 'permanent')
  assert.equal((await channel.deliver(view({ destination: { sourceInstanceId: 'feishu:tenant:chat', actorId: 'alice', eventId: 'issue:1',
    threadId: 'feishu:tenant:chat' } }), context)).type, 'permanent')
  const huge = new core.FeishuDeliveryChannel({ replyMessage: async () => ({ messageId: 'om_reply' }) }, { maxTextChars: 150000, now: () => 1000 })
  assert.equal((await huge.deliver(view({ text: '\n'.repeat(150000) }), context)).type, 'permanent')
})

test('a Feishu IM reply is kept short while the full text stays in the Ticket', async () => {
  const calls = []
  const channel = new core.FeishuDeliveryChannel({ replyMessage: async request => { calls.push(request); return { messageId: 'om_reply' } } }, { now: () => 1000 })
  await channel.deliver(view({ text: 'x'.repeat(5000) }), context)
  assert.equal(calls[0].text.length <= 4000, true)
  assert.match(calls[0].text, /\[Truncated for Feishu\. The full text is in the Ticket\.\]$/u)
})
