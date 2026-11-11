import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

test('the benchmark CLI completes the same twelve identified events in isolated modes before reporting totals', { timeout: 120000 }, async () => {
  const output = await new Promise((resolve, reject) => {
    execFile(process.execPath, ['dev/collaboration-bench.mjs'], { cwd: root, timeout: 110000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Benchmark CLI failed: ${error.message}\n${stderr}`)); return }
      try { resolve(JSON.parse(stdout)) } catch (cause) { reject(cause) }
    })
  })
  const expectedIds = Array.from({ length: 12 }, (_, index) => `event-${String(index + 1).padStart(2, '0')}`)
  assert.equal(output.workload.stream.length, 12)
  assert.deepEqual(output.workload.stream.map(event => event.id), expectedIds)
  assert.equal(output.workload.stream.filter(event => event.kind === 'initial').length, 6)
  assert.equal(output.workload.stream.filter(event => event.kind === 'followup').length, 6)
  assert.equal(output.workload.digest, createHash('sha256').update(JSON.stringify(output.workload.stream)).digest('hex'))
  const allSessions = []
  for (const [name, mode] of Object.entries(output.modes)) {
    assert.equal(mode.events, 12, name)
    assert.deepEqual(mode.outcomes.map(outcome => outcome.eventId), expectedIds, name)
    assert.equal(mode.populationDigest, output.workload.digest, name)
    assert.equal(mode.workerCalls, 12, name)
    assert.equal(mode.settledTurns, 12, name)
    assert.equal(mode.activeTurnsAtEnd, 0, name)
    assert.equal(mode.duplicateExecutions, 0, name)
    for (const metric of ['acceptanceMs', 'responseMs', 'completionMs']) assert.equal(mode[metric].samples, 12, `${name}/${metric}`)
    for (const outcome of mode.outcomes) {
      const event = output.workload.stream.find(candidate => candidate.id === outcome.eventId)
      assert.equal(outcome.inputDigest, createHash('sha256').update(JSON.stringify(event)).digest('hex'))
      assert.equal(outcome.threadId, event.threadId)
      assert.equal(outcome.status, 'completed')
      assert.match(outcome.output, new RegExp(event.id))
      assert.ok(outcome.persistedTurnEndSeq > outcome.persistedInputSeq)
      assert.ok(outcome.persistedOutputSeq > outcome.persistedInputSeq)
      assert.ok(outcome.persistedTurnEndSeq > outcome.persistedOutputSeq)
      assert.ok(outcome.acceptedAtMs >= outcome.startedAtMs)
      assert.ok(outcome.responseAtMs >= outcome.acceptedAtMs)
      assert.ok(outcome.completedAtMs >= outcome.responseAtMs)
      assert.ok(mode.totalMs >= outcome.completedAtMs, `${name} total excludes settled work`)
    }
    allSessions.push(new Set(mode.outcomes.map(outcome => outcome.sessionId)))
  }
  for (let left = 0; left < allSessions.length; left++) for (let right = left + 1; right < allSessions.length; right++) {
    assert.equal([...allSessions[left]].filter(id => allSessions[right].has(id)).length, 0, 'modes cannot share Sessions')
  }
  assert.equal(output.modes.routerWorker.replay.duplicateExecutions, 0)
  assert.equal(output.modes.subscriptionDirect.replay.duplicateExecutions, 0)
  assert.equal(output.modes.routerWorker.replay.duplicateTickets, 0)
  assert.equal(output.modes.subscriptionDirect.replay.duplicateTickets, 0)
  assert.equal(output.modes.routerWorker.replay.duplicateNotifications, 0)
  assert.equal(output.modes.subscriptionDirect.replay.duplicateNotifications, 0)
  assert.equal(output.modes.subscriptionDirect.directFollowups, 6)
  assert.equal(output.modes.routerWorker.directFollowups, 0)
  assert.equal(output.modes.routerWorker.tickets, 6)
  assert.equal(output.modes.subscriptionDirect.tickets, 6)
  for (const name of ['routerWorker', 'subscriptionDirect']) {
    const mode = output.modes[name]
    assert.equal(mode.notifications.acknowledgement, 6)
    assert.equal(mode.notifications.result, 0)
    assert.equal(mode.notifications.observed.length, 6)
    assert.equal(mode.notifications.ledger.filter(item => item.state === 'sent').length, 6)
    for (const threadId of ['thread-1', 'thread-2', 'thread-3', 'thread-4', 'thread-5', 'thread-6']) {
      assert.equal(new Set(mode.outcomes.filter(outcome => outcome.threadId === threadId).map(outcome => outcome.ticketId)).size, 1)
      assert.equal(new Set(mode.outcomes.filter(outcome => outcome.threadId === threadId).map(outcome => outcome.sessionId)).size, 1)
    }
  }
  assert.ok(output.modes.routerWorker.routerCalls > output.modes.subscriptionDirect.routerCalls)
  assert.match(output.environment.tokenMeasurement, /unavailable/u)
})
