import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('GitHub and Feishu pollers expose setup/per-source failures, keep the cursor and stop cleanly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-pollers-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const githubEngine = new core.Engine(storage, 'private', { kind: 'github', sourceInstanceId: 'github:acme/repo', actorId: 'agent',
    allowedActorIds: ['agent'], allowedThreadPrefixes: ['github:acme/repo#'], versionOrder: 'sequence' })
  const github = new core.GitHubSource(storage, 'private', githubEngine, { owner: 'acme', repo: 'repo' })
  const event = { deliveryId: 'g1', cursor: '1', repo: 'acme/repo', kind: 'issue', action: 'created', number: 1, id: 'issue-1',
    authorId: 'alice', title: 'Issue', body: 'Body', updatedAt: '2026-01-01T00:00:00Z' }
  let githubPages = [{ events: [event], cursor: '1' }]
  const githubPoller = new core.GitHubPoller(github, {
    listEvents: async request => {
      assert.equal(request.owner, 'acme')
      if (!githubPages.length) throw new core.CoreError('SOURCE_FAILED', 'GitHub is unavailable.')
      return githubPages.shift()
    },
  }, 'acme', 'repo', { intervalMs: 20, maxBackoffMs: 40 })
  const first = await githubPoller.pollOnce()
  assert.equal(first.processed, 1)
  assert.equal(githubPoller.health().state, 'polling')
  assert.equal(githubPoller.health().cursor, '1')
  await assert.rejects(githubPoller.pollOnce(), { code: 'SOURCE_FAILED' })
  assert.equal(githubPoller.health().state, 'failed')
  assert.equal(githubPoller.health().cursor, '1')
  const setupFailure = new core.GitHubPoller(github, { listEvents: async () => ({ events: [] }) }, 'acme', 'repo', { setup: async () => { throw new core.CoreError('SETUP_FAILED', 'No account.') } })
  await assert.rejects(setupFailure.start(), { code: 'SETUP_FAILED' })
  assert.equal(setupFailure.health().state, 'failed')
  assert.equal(setupFailure.health().lastError, 'SETUP_FAILED')
  githubPages = []
  const stopping = new core.GitHubPoller(github, { listEvents: async () => ({ events: [] }) }, 'acme', 'repo', { intervalMs: 10, maxBackoffMs: 20 })
  await stopping.start()
  await sleep(35)
  const passes = stopping.health().passes
  assert.ok(passes > 0)
  await stopping.stop()
  assert.equal(stopping.health().state, 'stopped')
  await sleep(25)
  assert.equal(stopping.health().passes, passes)

  const feishuEngine = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant:chat', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant:'], versionOrder: 'opaque' })
  const feishu = new core.FeishuSource(storage, 'private', feishuEngine, { tenantKey: 'tenant', chatIds: ['chat'] })
  let feishuPages = [{ events: [{ eventId: 'f1', cursor: '1', tenantKey: 'tenant', chatId: 'chat', messageId: 'm1', senderId: 'alice',
    text: 'Hello', createTime: '2026-01-01T00:00:00Z' }] }, undefined]
  const feishuPoller = new core.FeishuPoller(feishu, { listEvents: async () => {
    const page = feishuPages.shift()
    if (!page) throw new core.CoreError('SOURCE_FAILED', 'Feishu is unavailable.')
    return page
  } }, 'tenant', ['chat'])
  const feishuResult = await feishuPoller.pollOnce()
  assert.equal(feishuResult.processed, 1)
  assert.equal(feishuPoller.health().cursor, '1')
  await assert.rejects(feishuPoller.pollOnce(), { code: 'SOURCE_FAILED' })
  assert.equal(feishuPoller.health().lastError, 'SOURCE_FAILED')
})

test('a schedule runner ticks immediately and stops its timer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-schedule-runner-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { kind: 'schedule', sourceInstanceId: 'schedule:runner', actorId: 'schedule',
    allowedActorIds: ['schedule'], allowedThreadPrefixes: ['schedule:'], versionOrder: 'sequence' })
  const source = new core.ScheduleSource(storage, 'private', engine, { ruleId: 'runner', timezone: 'UTC', intervalMs: 60000, text: 'Prepare.' }, () => 120000)
  const runner = new core.ScheduleRunner(source, 60000)
  await runner.start()
  assert.ok(await engine.getSourceObject({ threadId: 'schedule:runner', objectId: 'occurrence:120000' }))
  await runner.stop()
})
