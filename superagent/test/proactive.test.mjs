import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const rules = (overrides = {}) => [
  { id: 'observe-review', name: 'Observe review requests', mode: 'observe', match: { actorKinds: ['human'], addressing: ['direct'], textPattern: 'review' },
    communication: 'silent', budget: { maxRuns: 5, windowMs: 3600000 }, enabled: true },
  { id: 'auto-bug', name: 'Prepare bug reproductions', mode: 'auto', match: { actorKinds: ['human', 'bot'], addressing: ['direct'], textPattern: 'bug' },
    communication: 'notify', budget: { maxRuns: 1, windowMs: 3600000 }, enabled: true },
  { id: 'auto-silent', name: 'Silent investigation', mode: 'auto', match: { actorKinds: ['human'], addressing: ['direct'], textPattern: 'quiet' },
    communication: 'silent', budget: { maxRuns: 2, windowMs: 3600000 }, enabled: true },
  ...(overrides.extra ?? []),
]

test('observe never executes, auto prepares inside an isolated budget and never publishes', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-proactive-'))
  const root = join(directory, 'proactive-root')
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  let prepared = 0
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    {}, undefined, [], {}, {}, {}, {}, { hostId: 'proactive-host', leaseMs: 30000 }, {
      rootDirectory: root,
      prepare: async ({ isolatedDirectory, candidate }) => {
        prepared++
        if (candidate.text.includes('quiet')) return undefined
        await import('node:fs/promises').then(fs => fs.writeFile(join(isolatedDirectory, 'prepared.txt'), `Prepared ${candidate.text}`))
        return { summary: `Prepared ${candidate.text}` }
      },
    })
  const saved = await engine.updateProactiveRules({ commandId: 'save-rules', expectedRevision: 1, rules: rules() })
  assert.equal(saved.revision, 2)
  const observed = await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-review', threadId: 'room', objectId: 'm1',
    text: 'Please review this change.', authorKind: 'human', addressing: 'direct' })
  assert.equal(observed[0].state, 'observed')
  assert.equal(prepared, 0)
  const auto = await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-bug', threadId: 'room', objectId: 'm2',
    text: 'There is a bug in the module.', authorKind: 'human', addressing: 'direct' })
  const preparedRun = auto.find(run => run.ruleId === 'auto-bug')
  assert.equal(preparedRun.state, 'prepared')
  assert.ok(preparedRun.isolatedDirectory.startsWith(root))
  assert.equal(await readFile(join(preparedRun.isolatedDirectory, 'prepared.txt'), 'utf8'), 'Prepared There is a bug in the module.')
  const effects = await engine.effects.list()
  assert.deepEqual(effects.items, [], 'preparation does not enqueue a delivery or publish action')
  const exhausted = await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-bug-2', threadId: 'room', objectId: 'm3',
    text: 'Another bug appears.', authorKind: 'human', addressing: 'direct' })
  assert.equal(exhausted.find(run => run.ruleId === 'auto-bug').state, 'budget-exhausted')
  const suppressed = await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-bot', threadId: 'room', objectId: 'm4',
    text: 'bug echo', authorKind: 'bot', addressing: 'direct' })
  assert.equal(suppressed.find(run => run.ruleId === 'auto-bug').state, 'suppressed')
  const silent = await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-quiet', threadId: 'room', objectId: 'm5',
    text: 'quiet investigation', authorKind: 'human', addressing: 'direct' })
  assert.equal(silent.find(run => run.ruleId === 'auto-silent').state, 'silent')
  const replay = await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-quiet', threadId: 'room', objectId: 'm5',
    text: 'quiet investigation', authorKind: 'human', addressing: 'direct' })
  assert.deepEqual(replay, [])

  await engine.setProcessingPaused({ commandId: 'pause-proactive', paused: true })
  assert.deepEqual(await engine.evaluateProactive({ sourceInstanceId: 'desktop', eventId: 'event-paused', threadId: 'room', objectId: 'm6',
    text: 'bug while paused', authorKind: 'human', addressing: 'direct' }), [])
  await engine.setProcessingPaused({ commandId: 'resume-proactive', paused: false })
  assert.ok((await engine.listProactiveRuns()).length >= 5)
  await assert.rejects(engine.updateProactiveRules({ commandId: 'invalid-rule', expectedRevision: 2,
    rules: [{ id: 'bad', name: 'Bad', mode: 'auto', match: { actorKinds: ['human'], addressing: ['direct'], textPattern: '(' },
      communication: 'silent', budget: { maxRuns: 1, windowMs: 1000 }, enabled: true }] }), { code: 'INVALID_CONFIG' })
})
