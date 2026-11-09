import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function fixture(t, replies) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-feishu-answer-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (!completed && text.includes('Request a human decision')) {
        yield* toolResponse('ask_human', { question: 'Which color should be used?', options: 'Blue\nGreen' })
      } else if (!completed && text.includes('Use the blue option')) {
        yield* toolResponse('report_ready', { result: 'Used the blue option.', evidence: 'Applied the answered color choice.' })
      } else yield* textResponse('Waiting or complete.')
      return
    }
    const tool = options.tools[completed]
    if (!tool) { yield* textResponse('Router complete.'); return }
    if (tool.name.startsWith('deliver_result')) {
      const ready = JSON.parse(text.slice('Ready report:'.length))
      yield* toolResponse(tool.name, { reportId: ready.id }, `router-${completed}`)
    } else yield* toolResponse(tool.name, {}, `router-${completed}`)
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const channel = new core.FeishuDeliveryChannel({ replyMessage: async request => {
    replies.push(request)
    return { messageId: `om_reply_${replies.length}` }
  } })
  engine = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant:chat', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant:'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] } },
    {}, sessions, [], {}, {}, {}, { channel })
  const source = new core.FeishuSource(storage, 'private', engine, { tenantKey: 'tenant', chatIds: ['chat'] })
  return { engine, source }
}

test('a Feishu question and its authorized answer stay in the original discussion', { timeout: 20000 }, async t => {
  const replies = []
  const { engine, source } = await fixture(t, replies)
  const question = await source.receive({ eventId: 'feishu-question', cursor: '1', tenantKey: 'tenant', chatId: 'chat', chatType: 'p2p',
    messageId: 'om_q', senderId: 'alice', text: 'Request a human decision.', createTime: '1700000000000', updateTime: '1700000000000' })
  const evaluated = await engine.assessSourceBatch({ commandId: 'feishu-eval', threadId: 'feishu:tenant:chat', eventIds: [question.eventId] })
  const ticketId = evaluated.receipts[0].ticketId
  for (let index = 0; index < 8; index++) await engine.effects.drain()
  let conversation = await engine.conversation(ticketId)
  assert.equal(conversation.status, 'waiting-human', JSON.stringify({ conversation, replies, effects: await engine.effects.list() }))
  const questionReply = replies.find(reply => reply.text === conversation.attention.question)
  assert.equal(questionReply?.messageId, 'om_q', 'the question replies to the message that started the work')

  await source.receive({ eventId: 'feishu-answer', cursor: '2', tenantKey: 'tenant', chatId: 'chat', chatType: 'p2p',
    messageId: 'om_a', senderId: 'alice', text: 'Use the blue option.', createTime: '1700000001000', updateTime: '1700000001000' })
  for (let index = 0; index < 12; index++) await engine.effects.drain()
  const resultReply = replies.find(reply => reply.text === 'Used the blue option.')
  assert.equal(resultReply?.messageId, 'om_q')
  conversation = await engine.conversation(ticketId)
  assert.equal(conversation.lifecycle, 'ended')
  assert.equal(conversation.messages.find(message => message.purpose === 'result')?.state, 'sent')
  assert.ok(replies.every(reply => /^[a-f0-9]{32}$/u.test(reply.uuid)))
})
