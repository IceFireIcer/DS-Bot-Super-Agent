import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function directFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-context-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  return { engine, storage }
}

test('context cards paginate by UTF-8 bytes and reconstruct the full original request', async t => {
  const { engine } = await directFixture(t)
  const text = `${'a'.repeat(700)}🧭${'b'.repeat(700)}`
  const receipt = await engine.submit({ commandId: 'long-context', eventId: 'long-context-message', text })
  const pages = []
  let after
  for (let index = 0; index < 20; index++) {
    const card = await engine.readContext({ ticketId: receipt.ticketId, ref: { kind: 'trigger', ticketId: receipt.ticketId }, maxBytes: 512, ...(after ? { after } : {}) })
    pages.push(card.text)
    assert.ok(Buffer.byteLength(card.text) <= 512)
    assert.equal(card.pagination.totalBytes, Buffer.byteLength(text))
    if (!card.pagination.cursor) { assert.equal(card.pagination.truncated, false); break }
    assert.equal(card.pagination.truncated, true)
    after = card.pagination.cursor
  }
  assert.equal(pages.join(''), text)
  const first = await engine.readContext({ ticketId: receipt.ticketId, ref: { kind: 'trigger', ticketId: receipt.ticketId }, maxBytes: 512 })
  assert.equal(first.title, 'Original request')
  assert.ok(first.next.some(ref => ref.kind === 'ticket'))
  await assert.rejects(engine.readContext({ ticketId: receipt.ticketId, ref: { kind: 'trigger', ticketId: receipt.ticketId }, after: '999999' }), { code: 'INVALID_INPUT' })
})

test('a Worker reads the original request and the public cards expose report, question and delivery evidence', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-context-runtime-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const workerToolResults = []
  const toolsSeen = []
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      toolsSeen.push(options.tools.map(tool => tool.name))
      const toolResults = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
      for (const result of toolResults) workerToolResults.push(result.content.map(block => block.text ?? '').join(''))
      if (text === 'Use the full request.' && completed === 0) {
        yield* toolResponse('read_context', { kind: 'trigger', id: '', threadId: '', objectId: '', after: '', maxBytes: '16384' })
      } else if (text === 'Use the full request.' && completed === 1) {
        yield* toolResponse('ask_human', { question: 'Which option should be used?', options: 'Blue\nGreen' })
      } else if (text === 'Use the blue option.' && completed === 0) {
        yield* toolResponse('report_ready', { result: 'The full request was used.', evidence: 'Read the original trigger text through read_context.' })
      } else yield* textResponse('Recorded.')
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
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const receipt = await engine.submit({ commandId: 'context-runtime', eventId: 'context-runtime-message', text: 'Use the full request.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const waiting = await engine.conversation(receipt.ticketId)
  assert.equal(waiting.status, 'waiting-human')
  assert.ok(workerToolResults.some(result => result.includes('"title":"Original request"') && result.includes('Use the full request.')))
  assert.ok(toolsSeen.some(tools => tools.includes('read_context')))

  const attentionCard = await engine.readContext({ ticketId: receipt.ticketId, ref: { kind: 'attention', ticketId: receipt.ticketId } })
  assert.equal(attentionCard.facts.status, 'waiting')
  assert.match(attentionCard.text, /Which option/u)
  const attentionDelivery = (await engine.getTicketDeliveries(receipt.ticketId)).find(delivery => delivery.purpose === 'attention')
  const deliveryCard = await engine.readContext({ ticketId: receipt.ticketId, ref: { kind: 'delivery', ticketId: receipt.ticketId, id: attentionDelivery.id } })
  assert.equal(deliveryCard.facts.state, 'sent')
  assert.match(deliveryCard.text, /Which option/u)

  await engine.answerAttention({ commandId: 'context-answer', attentionId: waiting.attention.id, text: 'Use the blue option.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const report = (await engine.conversation(receipt.ticketId)).reports[0]
  const reportCard = await engine.readContext({ ticketId: receipt.ticketId, ref: { kind: 'report', ticketId: receipt.ticketId, id: report.id } })
  assert.match(reportCard.text, /The full request was used/u)
  assert.equal(reportCard.facts.assignmentId, report.assignmentId)
})

test('context reads stay inside the Ticket’s reachable source threads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-context-scope-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room-a', 'room-b'], versionOrder: 'sequence' }
  const scoped = new core.Engine(storage, 'private', source)
  const a = await scoped.receiveSource({ commandId: 'a-event', threadId: 'room-a', objectId: 'a-1', type: 'created', version: '1', text: 'Room A request.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  const ticketA = (await scoped.acceptSource({ commandId: 'a-accept', threadId: 'room-a', objectId: 'a-1', expectedEventId: a.eventId })).ticketId
  const b = await scoped.receiveSource({ commandId: 'b-event', threadId: 'room-b', objectId: 'b-1', type: 'created', version: '1', text: 'Room B request.', authorId: 'user', authorKind: 'human', addressing: 'direct' })
  await scoped.acceptSource({ commandId: 'b-accept', threadId: 'room-b', objectId: 'b-1', expectedEventId: b.eventId })
  await assert.rejects(scoped.readContext({ ticketId: ticketA, ref: { kind: 'source-event', ticketId: ticketA, id: b.eventId } }), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(scoped.readContext({ ticketId: ticketA, ref: { kind: 'source-thread', ticketId: ticketA, threadId: 'room-b' } }), { code: 'SOURCE_NOT_AUTHORIZED' })
  const own = await scoped.readContext({ ticketId: ticketA, ref: { kind: 'source-thread', ticketId: ticketA, threadId: 'room-a' } })
  assert.match(own.text, /Room A request/u)
})
