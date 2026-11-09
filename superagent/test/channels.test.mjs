import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

async function githubFixture(t, suffix = 'acme/repo') {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-github-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const [owner, repo] = suffix.split('/')
  const engine = new core.Engine(storage, 'private', { kind: 'github', sourceInstanceId: `github:${suffix}`, actorId: 'agent', allowedActorIds: ['agent'],
    allowedThreadPrefixes: [`github:${suffix}#`], versionOrder: 'sequence' })
  return { engine, storage, source: new core.GitHubSource(storage, 'private', engine, { owner, repo, selfActorIds: ['agent'] }) }
}

test('GitHub source reception advances a durable cursor and keeps repositories isolated', async t => {
  const { engine, storage, source } = await githubFixture(t)
  const event = (deliveryId, cursor, overrides = {}) => ({ deliveryId, cursor, repo: 'acme/repo', kind: 'issue', action: 'created', number: 1,
    id: 'issue-1', authorId: 'alice', title: 'Fix the bug', body: 'The original details.', updatedAt: '2026-01-01T00:00:00Z', ...overrides })
  const result = await source.poll([event('d3', '3', { action: 'edited', body: 'Edited details.' }), event('d1', '1'), event('d2', '2', { kind: 'review', id: 'r1', action: 'reviewed', body: 'Review note.' })])
  assert.deepEqual({ processed: result.processed, filtered: result.filtered }, { processed: 3, filtered: 0 })
  assert.equal(await source.cursor(), '3')
  const again = await source.poll([event('d1', '1'), event('d3', '3')])
  assert.deepEqual({ processed: again.processed, filtered: again.filtered }, { processed: 0, filtered: 0 })
  const issue = await engine.getSourceObject({ threadId: 'github:acme/repo#1', objectId: 'issue:1' })
  assert.match(issue.text, /Issue #1 edited\.[\s\S]*Edited details\./u)
  const review = await engine.getSourceObject({ threadId: 'github:acme/repo#1', objectId: 'pr:1:review:r1' })
  assert.match(review.text, /Pull request #1 review\.[\s\S]*Review note\./u)
  await assert.rejects(source.receive(event('d4', '4', { repo: 'other/repo' })), { code: 'SOURCE_SCOPE_DENIED' })
  const self = await source.receive(event('d5', '5', { authorId: 'agent' }))
  assert.equal(self.status, 'filtered')
  assert.equal(await source.cursor(), '5')
  const malformed = await source.poll([event('d6', '6', { repo: 'other/repo' })])
  assert.deepEqual({ processed: malformed.processed, malformed: malformed.malformed, failed: malformed.failed }, { processed: 0, malformed: 1, failed: 0 })
  assert.equal(await source.cursor(), '6')

  const otherEngine = new core.Engine(storage, 'private', { kind: 'github', sourceInstanceId: 'github:acme/other', actorId: 'agent',
    allowedActorIds: ['agent'], allowedThreadPrefixes: ['github:acme/other#'], versionOrder: 'opaque' })
  assert.throws(() => otherEngine.getSourceObject({ threadId: 'github:acme/repo#1', objectId: 'issue:1' }), { code: 'SOURCE_SCOPE_DENIED' })
})

test('GitHub source derives a canonical sequence from composite API cursors and keeps the latest edit', async t => {
  const { engine, source } = await githubFixture(t)
  const event = (deliveryId, cursor, overrides = {}) => ({ deliveryId, cursor, repo: 'acme/repo', kind: 'issue', action: 'created', number: 1,
    id: 'issue-1', authorId: 'alice', title: 'Fix the bug', body: 'First details.', updatedAt: cursor.split('#')[0], ...overrides })
  const first = await source.poll([event('d1', '2026-01-01T00:00:00Z#issue#0000000001')])
  assert.equal(first.processed, 1)
  const second = await source.poll([event('d2', '2026-01-02T00:00:00Z#issue#0000000001', { action: 'edited', body: 'Edited later.' })])
  assert.equal(second.processed, 1)
  const issue = await engine.getSourceObject({ threadId: 'github:acme/repo#1', objectId: 'issue:1' })
  assert.match(issue.text, /Issue #1 edited\.[\s\S]*Edited later\./u)
  assert.match(issue.version.value, /^\d+$/u)
  const replay = await source.poll([event('d2', '2026-01-02T00:00:00Z#issue#0000000001', { action: 'edited', body: 'Edited later.' })])
  assert.equal(replay.processed, 0)
})

test('GitHub source keeps draft and edited native facts in the recorded text', async t => {
  const { engine, source } = await githubFixture(t)
  await source.receive({ deliveryId: 'draft-1', cursor: '2026-01-01T00:00:00Z#pr#000000000002', repo: 'acme/repo', kind: 'pull_request',
    action: 'created', number: 2, id: 'pr-2', authorId: 'alice', title: 'Draft work', body: 'In progress.',
    updatedAt: '2026-01-01T00:00:00Z', draft: true, state: 'open' })
  const draft = await engine.getSourceObject({ threadId: 'github:acme/repo#2', objectId: 'pr:2' })
  assert.match(draft.text, /Pull request #2 created \(draft\)\./u)
  await source.receive({ deliveryId: 'edit-1', cursor: '2026-01-02T00:00:00Z#issue#000000000001', repo: 'acme/repo', kind: 'issue',
    action: 'edited', number: 1, id: 'issue-1', authorId: 'alice', body: 'Edited details.', updatedAt: '2026-01-02T00:00:00Z' })
  const issue = await engine.getSourceObject({ threadId: 'github:acme/repo#1', objectId: 'issue:1' })
  assert.match(issue.text, /Issue #1 edited\.[\s\S]*Edited details\./u)
})

test('Feishu source reception keeps tenant, chat and sender identities separate', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-feishu-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant:chat-a,chat-b', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant:'], versionOrder: 'opaque' })
  const source = new core.FeishuSource(storage, 'private', engine, { tenantKey: 'tenant', chatIds: ['chat-a', 'chat-b'], selfActorIds: ['bot'] })
  const message = (eventId, cursor, overrides = {}) => ({ eventId, cursor, tenantKey: 'tenant', chatId: 'chat-a', messageId: `m-${eventId}`,
    senderId: 'alice', text: 'Feishu details.', createTime: '2026-01-01T00:00:00Z', ...overrides })
  const result = await source.poll([message('f2', '2', { chatId: 'chat-b' }), message('f1', '1')])
  assert.equal(result.processed, 2)
  assert.equal(await source.cursor(), '2')
  assert.equal((await engine.getSourceObject({ threadId: 'feishu:tenant:chat-a', objectId: 'message:m-f1' })).text, 'Feishu details.')
  await assert.rejects(source.receive(message('f3', '3', { chatId: 'chat-c' })), { code: 'SOURCE_SCOPE_DENIED' })
  assert.equal((await source.receive(message('f4', '4', { senderId: 'bot' }))).status, 'filtered')
  const malformed = await source.poll([message('f5', '5', { chatId: 'chat-c' })])
  assert.deepEqual({ processed: malformed.processed, malformed: malformed.malformed, failed: malformed.failed }, { processed: 0, malformed: 1, failed: 0 })
  assert.equal(await source.cursor(), '5')
  const otherEngine = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant2:chat-a', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant2:'], versionOrder: 'opaque' })
  assert.throws(() => otherEngine.getSourceObject({ threadId: 'feishu:tenant:chat-a', objectId: 'message:m-f1' }), { code: 'SOURCE_SCOPE_DENIED' })
})

test('schedule occurrences are stable, catch up within a declared bound and survive pause', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-schedule-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { kind: 'schedule', sourceInstanceId: 'schedule:nightly', actorId: 'schedule',
    allowedActorIds: ['schedule'], allowedThreadPrefixes: ['schedule:'], versionOrder: 'sequence' })
  const source = new core.ScheduleSource(storage, 'private', engine, { ruleId: 'nightly', timezone: 'Asia/Shanghai', intervalMs: 1000,
    text: 'Prepare the nightly review.', catchUp: 'all', maxCatchUp: 10 })
  const first = await source.tick(10_000)
  assert.deepEqual(first.occurrences.map(item => item.occurrence), [10_000])
  const storedRule = await source.rule()
  assert.equal(storedRule.ruleId, 'nightly')
  assert.equal(storedRule.timezone, 'Asia/Shanghai')
  assert.equal(storedRule.intervalMs, 1000)
  const duplicate = await source.tick(10_000)
  assert.deepEqual(duplicate.occurrences, [])
  const catchUp = await source.tick(13_500)
  assert.deepEqual(catchUp.occurrences.map(item => item.occurrence), [11_000, 12_000, 13_000])
  const event = await engine.getSourceObject({ threadId: 'schedule:nightly', objectId: 'occurrence:13000' })
  assert.equal(event.text, 'Prepare the nightly review.')
  await engine.setProcessingPaused({ commandId: 'pause-schedule', paused: true })
  const paused = await source.tick(15_000)
  assert.equal(paused.occurrences.length, 2)
  assert.ok(await engine.getSourceObject({ threadId: 'schedule:nightly', objectId: 'occurrence:15000' }))
  await engine.setProcessingPaused({ commandId: 'resume-schedule', paused: false })
  assert.throws(() => new core.ScheduleSource(storage, 'private', engine, { ruleId: 'bad', timezone: 'Not/AZone', intervalMs: 1000, text: 'x' }), { code: 'INVALID_CONFIG' })
})

async function scheduleFixture(t, config, intake) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-schedule-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { kind: 'schedule', sourceInstanceId: `schedule:${config.ruleId}`, actorId: 'schedule',
    allowedActorIds: ['schedule'], allowedThreadPrefixes: ['schedule:'], versionOrder: 'sequence', ...(intake ? { intake } : {}) })
  return { storage, engine, source: new core.ScheduleSource(storage, 'private', engine, config) }
}

test('a schedule rule is revisioned and each occurrence keeps the rule revision that produced it', async t => {
  const config = { ruleId: 'nightly', timezone: 'Asia/Shanghai', intervalMs: 1000, text: 'Prepare the review.', catchUp: 'all', maxCatchUp: 5 }
  const { storage, engine, source } = await scheduleFixture(t, config)
  await source.tick(10_000)
  assert.equal((await source.rule()).revision, 1)
  const changed = new core.ScheduleSource(storage, 'private', engine, { ...config, text: 'Prepare the new review.' })
  assert.equal((await changed.tick(11_000)).revision, 2)
  assert.deepEqual((await changed.ruleHistory()).items.map(rule => rule.revision), [1, 2])
  assert.equal((await changed.ruleHistory()).items[1].text, 'Prepare the new review.')
  const occurrences = (await changed.occurrences()).items
  assert.deepEqual(occurrences.map(item => item.occurrence), [11_000, 10_000])
  assert.deepEqual(occurrences.map(item => item.revision), [2, 1])
  const event = await engine.getSourceObject({ threadId: 'schedule:nightly', objectId: 'occurrence:11000' })
  assert.equal(event.text, 'Prepare the new review.')
  assert.equal(event.eventId, occurrences[0].eventId)
  await assert.rejects(new core.ScheduleSource(storage, 'private', engine, { ...config, timezone: 'UTC' }).tick(12_000), { code: 'SCHEDULE_RULE_CONFLICT' })
})

test('a restarted schedule source keeps its durable cursor and does not repeat an occurrence', async t => {
  const config = { ruleId: 'restart', timezone: 'Asia/Shanghai', intervalMs: 1000, text: 'Run after restart.', catchUp: 'all', maxCatchUp: 5 }
  const { storage, engine, source } = await scheduleFixture(t, config)
  assert.deepEqual((await source.tick(10_000)).occurrences.map(item => item.occurrence), [10_000])
  const reopened = new core.ScheduleSource(storage, 'private', engine, config)
  assert.deepEqual((await reopened.tick(10_000)).occurrences, [])
  assert.deepEqual((await reopened.tick(12_000)).occurrences.map(item => item.occurrence), [11_000, 12_000])
  assert.deepEqual((await reopened.occurrences()).items.map(item => item.occurrence), [12_000, 11_000, 10_000])
})

test('schedule occurrences follow the rule timezone across daylight-saving boundaries', async t => {
  const config = { ruleId: 'dst', timezone: 'America/New_York', intervalMs: 1_800_000, text: 'Check the DST boundary.', catchUp: 'all', maxCatchUp: 6 }
  const { storage, engine, source } = await scheduleFixture(t, config)
  assert.deepEqual((await source.tick(Date.parse('2026-11-01T05:30:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-11-01T05:30:00Z')])
  assert.deepEqual((await source.tick(Date.parse('2026-11-01T06:30:00Z'))).occurrences, [], 'the repeated local hour must not fire twice')
  assert.deepEqual((await source.tick(Date.parse('2026-11-01T07:00:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-11-01T07:00:00Z')])
  const spring = new core.ScheduleSource(storage, 'private', engine, { ...config, ruleId: 'spring' })
  await spring.tick(Date.parse('2026-03-08T06:30:00Z'))
  assert.deepEqual((await spring.tick(Date.parse('2026-03-08T07:30:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-03-08T07:00:00Z'), Date.parse('2026-03-08T07:30:00Z')], 'the skipped local hour never existed')
})

test('a schedule occurrence still needs the intake gate and the timer grants no work by itself', async t => {
  const config = { ruleId: 'gated', timezone: 'UTC', intervalMs: 1000, text: 'Prepare the gated work.', catchUp: 'skip' }
  const rules = [{ id: 'system-slot', actorKinds: ['system'], addressing: ['direct'], mode: 'inferred' }]
  const observe = await scheduleFixture(t, config, { mode: 'observe', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000,
    allowedRequesterIds: ['user'], allowedBotActorIds: [], rules,
    assess: async (events, _signal, onDelivered) => { await onDelivered(); return events.map(event => ({ eventId: event.eventId, outcome: 'accept', reason: 'Within the rule.' })) } })
  const tick = await observe.source.tick(10_000)
  const eventId = tick.occurrences[0].receipt.eventId
  const evaluated = await observe.engine.assessSourceBatch({ commandId: 'observe-eval', threadId: 'schedule:gated', eventIds: [eventId] })
  assert.equal(evaluated.items[0].outcome, 'rejected')
  assert.equal(evaluated.items[0].reason, 'WOULD_ACCEPT')
  assert.equal((await observe.engine.listTickets()).items.length, 0)
})

test('an authorized schedule rule reaches the gate and creates normal work in auto mode', async t => {
  const config = { ruleId: 'auto', timezone: 'UTC', intervalMs: 1000, text: 'Prepare the authorized work.', catchUp: 'skip' }
  const rules = [{ id: 'system-slot', actorKinds: ['system'], addressing: ['direct'], mode: 'inferred' }]
  const auto = await scheduleFixture(t, config, { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000,
    allowedRequesterIds: ['user'], allowedBotActorIds: [], rules,
    assess: async (events, _signal, onDelivered) => { await onDelivered(); return events.map(event => ({ eventId: event.eventId, outcome: 'accept', reason: 'Within the rule.' })) } })
  const tick = await auto.source.tick(10_000)
  const evaluated = await auto.engine.assessSourceBatch({ commandId: 'auto-eval', threadId: 'schedule:auto', eventIds: [tick.occurrences[0].receipt.eventId] })
  assert.equal(evaluated.items[0].outcome, 'accepted')
  assert.equal(evaluated.receipts.length, 1)
  assert.equal((await auto.engine.listTickets()).items.length, 1)
})

test('a rule interval revision realigns the next occurrence instead of reusing the old phase', async t => {
  const base = { ruleId: 'rephase', timezone: 'UTC', intervalMs: 1_800_000, text: 'First phase.', catchUp: 'all', maxCatchUp: 4 }
  const { storage, engine, source } = await scheduleFixture(t, base)
  assert.deepEqual((await source.tick(Date.parse('2026-01-01T11:30:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-01-01T11:30:00Z')])
  const changed = new core.ScheduleSource(storage, 'private', engine, { ...base, intervalMs: 3_600_000 })
  assert.deepEqual((await changed.tick(Date.parse('2026-01-01T12:10:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-01-01T12:00:00Z')])
})

test('once catch-up advances past local times that a DST gap removed', async t => {
  const config = { ruleId: 'once-dst', timezone: 'America/New_York', intervalMs: 1_800_000, text: 'Once.', catchUp: 'once', maxCatchUp: 10 }
  const { source } = await scheduleFixture(t, config)
  assert.deepEqual((await source.tick(Date.parse('2026-03-08T06:30:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-03-08T06:30:00Z')])
  assert.deepEqual((await source.tick(Date.parse('2026-03-08T07:30:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-03-08T07:00:00Z')])
  assert.deepEqual((await source.tick(Date.parse('2026-03-08T07:45:00Z'))).occurrences.map(item => item.occurrence),
    [Date.parse('2026-03-08T07:30:00Z')])
})

test('a legacy schedule rule without a revision is normalized before use', async t => {
  const config = { ruleId: 'legacy', timezone: 'UTC', intervalMs: 1000, text: 'Migrate me.' }
  const { storage, source } = await scheduleFixture(t, config)
  await storage.transaction('private', transaction => transaction.insert('schedule-rule', JSON.stringify(['schedule-rule', 'legacy']),
    { ...config, createdAt: 1 }))
  assert.equal((await source.tick(10_000)).revision, 1)
  assert.equal((await source.rule()).revision, 1)
  assert.equal((await source.occurrences()).items.length, 1)
})
