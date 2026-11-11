import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { NativeSessions } from '../dist/index.js'
import { createSessionAssessor } from '../dist/supervisor-session.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const snapshot = {
  ticketId: 't1', request: 'Inspect the project.', mandateId: 'm1', mandateScope: 'Inspect the project.',
  assignmentId: 'a1', generation: 'g1', stage: 'running', intentReason: 'worker-running', directionVersion: 1,
  reportIds: ['r1'], lastReportId: 'r1', lastReportAt: 1_000, toolDigest: 'tools', reportDigest: 'report',
  deliveryDigest: 'delivery', jobStates: [], subagentStates: [], unknownEffects: 0, unknownJobs: 0,
  attention: 'none', stop: 'none', setup: 'ready', paused: false, waiting: false, observedAt: 2_000,
  progressFingerprint: 'progress',
}

async function context(t, responder) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-supervisor-session-'))
  const native = await nativeContext(directory, responder)
  const sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  t.after(async () => {
    await sessions.close().catch(() => {})
    await native.fiber.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  return { native, sessions }
}

test('the independent supervisor Session records one semantic result through the mock Agent loop', async t => {
  let calls = 0
  const { sessions } = await context(t, () => {
    calls += 1
    return calls === 1
      ? toolResponse('record_supervision', { kind: 'deviation', reason: 'The report changed the requested scope.', recommendation: 'Return to the original file set.', action: 'correct' }, 'supervision-1')
      : textResponse('Recorded.')
  })
  const assess = createSessionAssessor(sessions, { sessionId: 'supervisor-test' })
  const result = await assess(snapshot, new AbortController().signal)
  assert.deepEqual(result, { kind: 'deviation', reason: 'The report changed the requested scope.', recommendation: 'Return to the original file set.', action: 'correct', assessorVersion: 'ds-supervisor-1', model: 'mock/router' })
  assert.ok(calls >= 2, 'the Agent loop continued after the tool result')
})

test('a supervisor Session that answers without the recording tool is rejected', async t => {
  const { sessions } = await context(t, () => textResponse('Everything looks fine.'))
  const assess = createSessionAssessor(sessions, { sessionId: 'supervisor-no-tool' })
  await assert.rejects(assess(snapshot, new AbortController().signal), /did not record/u)
})
