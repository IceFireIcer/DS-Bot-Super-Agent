import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

test('member sync is revisioned, replayable and isolated by source instance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-members-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant-a:chat', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant-a:'], versionOrder: 'opaque' })
  const members = [{ nativeActorId: 'alice', kind: 'human', displayName: 'Alice', active: true },
    { nativeActorId: 'helper-bot', kind: 'bot', active: true }]
  const first = await engine.syncSourceMembers({ commandId: 'sync-5', revision: 5, members, origin: 'startup' })
  assert.equal(first.revision, 5)
  assert.deepEqual(first.members, members)
  assert.equal((await engine.getSourceMembers()).revision, 5)
  await assert.rejects(engine.syncSourceMembers({ commandId: 'sync-4', revision: 4, members: [], origin: 'manual' }), { code: 'STALE_MEMBERSHIP_SYNC' })
  await assert.rejects(engine.syncSourceMembers({ commandId: 'sync-5-again', revision: 5, members: [], origin: 'manual' }), { code: 'STALE_MEMBERSHIP_SYNC' })
  const replay = await engine.syncSourceMembers({ commandId: 'sync-5', revision: 5, members, origin: 'startup' })
  assert.deepEqual(replay, first)
  await assert.rejects(engine.syncSourceMembers({ commandId: 'sync-5', revision: 5, members: [], origin: 'startup' }), { code: 'IDENTITY_CONFLICT' })
  const newer = await engine.syncSourceMembers({ commandId: 'sync-6', revision: 6, members: [{ nativeActorId: 'alice', kind: 'human', active: true }], origin: 'manual' })
  assert.equal(newer.revision, 6)
  assert.equal(newer.members.length, 1)
  assert.equal(newer.origin, 'manual')
  await assert.rejects(engine.syncSourceMembers({ commandId: 'duplicate', revision: 7,
    members: [{ nativeActorId: 'alice', kind: 'human', active: true }, { nativeActorId: 'alice', kind: 'bot', active: true }], origin: 'manual' }), { code: 'INVALID_CONFIG' })

  const other = new core.Engine(storage, 'private', { kind: 'feishu', sourceInstanceId: 'feishu:tenant-b:chat', actorId: 'bot',
    allowedActorIds: ['bot'], allowedThreadPrefixes: ['feishu:tenant-b:'], versionOrder: 'opaque' })
  assert.equal(await other.getSourceMembers(), undefined)
  await other.syncSourceMembers({ commandId: 'other-sync', revision: 1, members: [{ nativeActorId: 'alice', kind: 'human', active: true }], origin: 'manual' })
  assert.equal((await other.getSourceMembers()).revision, 1)
  assert.equal((await engine.getSourceMembers()).revision, 6)
  const membership = new core.SourceMembership(storage, 'private', 'feishu:tenant-a:chat')
  const history = await membership.history()
  assert.deepEqual(history.map(snapshot => snapshot.revision).sort((left, right) => left - right), [5, 6])
})
