import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

test('Feishu member sync merges chats under a monotonic revision', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-feishu-sync-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant:chat-a,chat-b', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant:'], versionOrder: 'opaque' })
  const api = { listMembers: async ({ chatId }) => chatId === 'chat-a'
    ? [{ nativeActorId: 'ou_a', kind: 'human', displayName: 'Ada', active: true }]
    : [{ nativeActorId: 'ou_a', kind: 'human', active: true }, { nativeActorId: 'ou_b', kind: 'human', displayName: 'Bob', active: true }] }
  const sync = new core.FeishuMemberSync(api, engine, ['chat-a', 'chat-b'])
  const first = await sync.sync({ commandId: 'sync-first', signal: new AbortController().signal })
  assert.deepEqual(first.members.map(member => member.nativeActorId).sort(), ['ou_a', 'ou_b'])
  assert.equal(first.members.find(member => member.nativeActorId === 'ou_a').displayName, 'Ada')
  const second = await sync.sync({ commandId: 'sync-second', origin: 'startup', signal: new AbortController().signal })
  assert.ok(second.revision > first.revision)
  assert.deepEqual(await engine.getSourceMembers(), second)
  await assert.rejects(engine.syncSourceMembers({ commandId: 'stale-sync', revision: first.revision,
    members: first.members, origin: 'manual' }), { code: 'STALE_MEMBERSHIP_SYNC' })
})
