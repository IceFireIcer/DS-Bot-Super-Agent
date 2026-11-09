import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

test('an unexpired Host lease blocks another writer, and only explicit expiry takeover gets a new epoch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-lease-'))
  let now = 1000
  const firstStorage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const secondStorage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await firstStorage.close(); await secondStorage.close(); await rm(directory, { recursive: true, force: true }) })
  const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }
  const first = new core.Engine(firstStorage, 'private', source, {}, undefined, [], {}, {}, {}, {}, { hostId: 'host-a', leaseMs: 100, now: () => now })
  const second = new core.Engine(secondStorage, 'private', source, {}, undefined, [], {}, {}, {}, {}, { hostId: 'host-b', leaseMs: 100, now: () => now })

  const receipt = await first.submit({ commandId: 'first-request', eventId: 'first-message', text: 'Own the instance.' })
  const initialLease = await first.getHostLease()
  assert.equal(initialLease.hostId, 'host-a')
  assert.equal(initialLease.epoch, 1)
  await assert.rejects(second.submit({ commandId: 'second-request', eventId: 'second-message', text: 'Compete for writes.' }), { code: 'HOST_LEASED' })
  await assert.rejects(second.getReceipt('first-request'), { code: 'HOST_LEASED' })

  now += 50
  await first.getReceipt('first-request')
  assert.equal((await first.getHostLease()).expiresAt, now + 100)
  await assert.rejects(second.submit({ commandId: 'second-request', eventId: 'second-message', text: 'Compete for writes.' }), { code: 'HOST_LEASED' })

  now += 200
  await assert.rejects(second.submit({ commandId: 'second-request', eventId: 'second-message', text: 'Compete for writes.' }), { code: 'HOST_LEASE_EXPIRED' })
  const acquired = await second.acquireHost()
  assert.equal(acquired.epoch, 2)
  const accepted = await second.submit({ commandId: 'second-request', eventId: 'second-message', text: 'Take over explicitly.' })
  assert.equal(accepted.status, 'pending')
  await assert.rejects(first.getReceipt('first-request'), { code: 'HOST_LEASED' })
  await assert.rejects(first.submit({ commandId: 'old-request', eventId: 'old-message', text: 'Old host resumes.' }), { code: 'HOST_LEASED' })
  await assert.rejects(first.getTicket(receipt.ticketId), { code: 'HOST_LEASED' })

  const visible = await second.getTicket(receipt.ticketId)
  assert.equal(visible.trigger.text, 'Own the instance.')
  await second.shutdown()
  assert.ok((await second.getHostLease()).releasedAt !== undefined || (await second.getHostLease()).expiresAt <= now)
})
