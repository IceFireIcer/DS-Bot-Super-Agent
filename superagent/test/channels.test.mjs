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
