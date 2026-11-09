import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

async function runtimeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-retry-'))
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
      if (!completed) {
        const result = text.startsWith('Continue after resume.') ? 'Second result.' : 'First result.'
        yield* toolResponse('report_ready', { result, evidence: `Verified ${result}` })
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
  return { engine, storage }
}

test('retry keeps the Ticket, Session and directory but creates a new Assignment generation', { timeout: 20000 }, async t => {
  const { engine } = await runtimeFixture(t)
  const receipt = await engine.submit({ commandId: 'first', eventId: 'first-message', text: 'First attempt.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const first = await engine.conversation(receipt.ticketId)
  assert.equal(first.status, 'ready')
  assert.equal(first.reports[0].result, 'First result.')
  assert.equal(first.assignments.length, 1)

  const retried = await engine.retryTicket({ commandId: 'retry-once', ticketId: receipt.ticketId, reason: 'The first result needs a safer retry.' })
  assert.equal(retried.reports.length, 0, 'the old ready report must not remain current')
  assert.notEqual(retried.assignments[0].id, first.assignments[0].id)
  assert.notEqual(retried.assignments[0].generation, first.assignments[0].generation)
  assert.equal(retried.assignments[0].sessionId, first.assignments[0].sessionId)
  assert.deepEqual(retried.assignments[0].environment, first.assignments[0].environment)
  assert.equal(retried.assignmentHistory.length, 2)
  assert.equal(retried.recovery.previousAssignmentId, first.assignments[0].id)
  assert.equal(retried.recovery.assignmentId, retried.assignments[0].id)
  assert.equal(retried.recovery.checks.length, 4)
  assert.match(retried.recovery.checks.join(' '), /version-control/u)
  assert.match(retried.recovery.checks.join(' '), /original platform ID/u)

  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const final = await engine.conversation(receipt.ticketId)
  assert.equal(final.status, 'ready')
  assert.equal(final.reports[0].result, 'Second result.')
  assert.deepEqual(final.reportHistory.map(report => report.result), ['First result.', 'Second result.'])
  assert.equal(final.assignments[0].id, retried.assignments[0].id)
})

test('retry refuses unknown effects, unconfirmed previous work, stops and waiting questions', { timeout: 25000 }, async t => {
  const { engine, storage } = await runtimeFixture(t)
  const receipt = await engine.submit({ commandId: 'retry-guards', eventId: 'retry-guards-message', text: 'Create a result.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  const first = await engine.conversation(receipt.ticketId)
  assert.equal(first.status, 'ready')

  await storage.transaction('private', tx => tx.insert('effect', 'unknown-retry-probe', {
    key: 'unknown-retry-probe', stream: 'relay', scope: receipt.ticketId, payload: { ticketId: receipt.ticketId },
    id: 'unknown-retry-probe', generation: 'unknown-retry-probe', queueKey: '9999999999999999', state: 'unknown', attempts: 1, availableAt: Date.now(),
  }))
  await assert.rejects(engine.retryTicket({ commandId: 'retry-unknown', ticketId: receipt.ticketId, reason: 'Unknown external work.' }), { code: 'UNKNOWN_OUTCOME' })
  await storage.transaction('private', tx => tx.remove('effect', 'unknown-retry-probe'))

  await storage.transaction('private', tx => tx.insert('job', `${JSON.stringify(['job', receipt.ticketId])}:prior-job`, {
    id: 'prior-job', ticketId: receipt.ticketId, assignmentId: first.assignments[0].id, generation: first.assignments[0].generation,
    environmentId: 'project', command: 'build', state: 'running', startedAt: Date.now(), runtimeToken: 'previous-runtime',
  }))
  await assert.rejects(engine.retryTicket({ commandId: 'retry-job', ticketId: receipt.ticketId, reason: 'Retry without checking the job.' }), { code: 'WORK_UNCONFIRMED' })
  const blocked = await engine.conversation(receipt.ticketId)
  assert.equal(blocked.reason, 'recovery-blocked')
  assert.deepEqual(blocked.recovery.blockedWork, [{ kind: 'job', id: 'prior-job', state: 'unknown' }])
  await assert.rejects(engine.retryTicket({ commandId: 'retry-job', ticketId: receipt.ticketId, reason: 'Retry without checking the job.' }), { code: 'WORK_UNCONFIRMED' })

  const stoppedReceipt = await engine.submit({ commandId: 'stopped-retry', eventId: 'stopped-retry-message', text: 'Stop this work.' })
  for (let index = 0; index < 6; index++) await engine.effects.drain()
  await engine.stopTicket({ commandId: 'stop-before-retry', ticketId: stoppedReceipt.ticketId, reason: 'A person stopped it.' })
  await assert.rejects(engine.retryTicket({ commandId: 'retry-stopped', ticketId: stoppedReceipt.ticketId, reason: 'Try again.' }), { code: 'TICKET_STOPPED' })
})
