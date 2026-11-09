import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

test('supervision puts human questions, blocked work and stops before ordinary running work', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-supervision-'))
  let native, storage, sessions, engine, chat
  t.after(async () => {
    await chat?.close(); await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(directory, async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (text === 'Ask for approval.' && !completed) yield* toolResponse('ask_human', { question: 'Approve the change?', options: 'Yes\nNo' })
      else if (text === 'Finish this.' && !completed) yield* toolResponse('report_ready', { result: 'Finished.', evidence: 'Verified the change.' })
      else if (text === 'Stop this.' && !completed) yield* toolResponse('report_ready', { result: 'Ready to stop.', evidence: 'Verified before stop.' })
      else yield* textResponse('Recorded.')
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
  const attention = await engine.submit({ commandId: 'attention', eventId: 'attention-message', text: 'Ask for approval.' })
  const ready = await engine.submit({ commandId: 'ready', eventId: 'ready-message', text: 'Finish this.' })
  const stopped = await engine.submit({ commandId: 'stopped', eventId: 'stopped-message', text: 'Stop this.' })
  for (let index = 0; index < 8; index++) await engine.effects.drain()
  await engine.stopTicket({ commandId: 'stop-supervision', ticketId: stopped.ticketId, reason: 'A person stopped it.' })
  await storage.transaction('private', tx => tx.insert('effect', 'supervision-unknown', {
    key: 'supervision-unknown', stream: 'relay', scope: ready.ticketId, payload: { ticketId: ready.ticketId },
    id: 'supervision-unknown', generation: 'supervision-unknown', queueKey: '9999999999999999', state: 'unknown', attempts: 1, availableAt: Date.now(),
  }))
  const view = await engine.getSupervision()
  assert.equal(view.items[0].ticketId, attention.ticketId)
  assert.equal(view.items[0].bucket, 'needsHuman')
  assert.match(view.items[0].nextAction, /Answer the current question/u)
  assert.ok(view.items.some(item => item.ticketId === ready.ticketId && item.bucket === 'blocked'))
  assert.ok(view.items.some(item => item.ticketId === stopped.ticketId && item.bucket === 'stopped'))
  assert.equal(view.counts.needsHuman, 1)
  assert.equal(view.counts.blocked, 1)
  assert.equal(view.counts.stopped, 1)
  const again = await engine.getSupervision()
  assert.deepEqual(again.items.map(item => [item.ticketId, item.bucket, item.state]), view.items.map(item => [item.ticketId, item.bucket, item.state]))

  chat = await core.createChatServer(engine)
  assert.match(await (await fetch(chat.url)).text(), /Needs you/u)
  const route = await (await fetch(`${chat.url}/supervision`)).json()
  assert.equal(route.items[0].ticketId, attention.ticketId)
})
