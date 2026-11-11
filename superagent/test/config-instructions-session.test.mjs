import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Engine, NativeSessions, createSessionConfigInterpreter } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const roles = {
  revision: 1,
  roles: {
    router: { name: 'Router', model: { provider: 'mock', model: 'router' }, instructions: '', skills: [] },
    worker: { name: 'Worker', model: { provider: 'mock', model: 'worker' }, instructions: '', skills: [] },
  },
}
const policy = { mode: 'off', maxBatchSize: 10, maxAttempts: 2, timeoutMs: 1_000, allowedRequesterIds: ['user', 'maintainer'], allowedBotActorIds: [], rules: [] }

async function context(t, responder) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-config-session-'))
  const native = await nativeContext(directory, responder)
  const sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  t.after(async () => {
    await sessions.close().catch(() => {})
    await native.fiber.dispose().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })
  return { native, sessions, directory }
}

test('the config interpreter Session records a constrained policy change through the mock Agent loop', async t => {
  let calls = 0
  const { sessions } = await context(t, () => {
    calls += 1
    return calls === 1
      ? toolResponse('propose_behavior_change', { target: 'policy', summary: 'Observe direct human questions.', roles: '', policy: JSON.stringify({ mode: 'observe' }) }, 'config-1')
      : textResponse('Recorded.')
  })
  const interpret = createSessionConfigInterpreter(sessions, { sessionId: 'config-interpreter-test', version: 'prompt-v1' })
  const change = await interpret({ instruction: 'Only observe direct human questions for now.', roles, policy, signal: new AbortController().signal })
  assert.equal(change.target, 'policy')
  assert.equal(change.policy.mode, 'observe')
  assert.equal(change.interpreterVersion, 'prompt-v1')
  assert.equal(change.model, 'mock/router')
  assert.ok(calls >= 2)
})

test('the config interpreter Session cannot answer without the recording tool', async t => {
  const { sessions } = await context(t, () => textResponse('Nothing to change.'))
  const interpret = createSessionConfigInterpreter(sessions, { sessionId: 'config-interpreter-no-tool' })
  await assert.rejects(interpret({ instruction: 'Change something.', roles, policy, signal: new AbortController().signal }), /did not record/u)
})

test('the interpreter tool records at most one change per instruction', async () => {
  const fake = {
    getRoutes: () => ({ router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } }),
    async run(request) {
      await request.tools[0].execute({ target: 'policy', summary: 'First change.', roles: '', policy: JSON.stringify({ mode: 'observe' }) })
      await assert.rejects(request.tools[0].execute({ target: 'policy', summary: 'Second change.', roles: '', policy: JSON.stringify({ mode: 'off' }) }), /one change/u)
      return { status: 'idle' }
    },
  }
  const interpret = createSessionConfigInterpreter(fake, { sessionId: 'tool-once' })
  const change = await interpret({ instruction: 'Observe.', roles, policy, signal: new AbortController().signal })
  assert.equal(change.policy.mode, 'observe')
})

test('an Engine instruction through the independent Session applies the validated policy and preserves allowlists', async t => {
  let calls = 0
  const { sessions } = await context(t, () => {
    calls += 1
    return calls === 1
      ? toolResponse('propose_behavior_change', { target: 'policy', summary: 'Observe direct human questions.', roles: '', policy: JSON.stringify({ mode: 'observe' }) }, 'config-engine-1')
      : textResponse('Recorded.')
  })
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-config-engine-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close().catch(() => {}); await rm(directory, { recursive: true, force: true }) })
  const engine = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'maintainer', allowedActorIds: ['user', 'maintainer'], authoringActorIds: ['maintainer'],
    intake: policy,
  })
  const before = await engine.getIntakePolicy()
  const record = await engine.updateBehaviorFromInstruction(
    { commandId: 'engine-instruction', instruction: 'Only observe direct human questions for now.', expectedPolicyRevision: before.revision },
    createSessionConfigInterpreter(sessions, { sessionId: 'config-engine-test' }),
  )
  assert.equal(record.status, 'applied')
  const after = await engine.getIntakePolicy()
  assert.equal(after.policy.mode, 'observe')
  assert.deepEqual(after.policy.allowedRequesterIds, ['user', 'maintainer'])
})
