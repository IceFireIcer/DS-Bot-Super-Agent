import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SqliteStorage } from '../dist/storage.js'

test('transaction changes and bounded cursor reads survive a new connection and roll back together', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-contract-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  let fresh
  context.after(async () => {
    await fresh?.close()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  await storage.transaction('private', async transaction => {
    await transaction.insert('command', 'first', { value: 1 })
    await transaction.insert('command', 'second', { value: 2 })
    assert.equal(await transaction.replace('command', 'first', { value: 3 }), true)
    assert.equal(await transaction.replace('command', 'missing', {}), false)
  })
  fresh = await storage.reconnect()
  const first = await fresh.transaction('private', transaction => transaction.scan('command', { limit: 1 }))
  assert.deepEqual(first.items, [{ id: 'first', value: { value: 3 } }])
  const second = await fresh.transaction('private', transaction => transaction.scan('command', { limit: 1, after: first.cursor }))
  assert.deepEqual(second.items, [{ id: 'second', value: { value: 2 } }])
  assert.deepEqual(await fresh.transaction('other', transaction => transaction.scan('command', { limit: 1 })), { items: [] })
  await assert.rejects(storage.transaction('private', async transaction => {
    await transaction.remove('command', 'first')
    await transaction.replace('command', 'second', { value: 4 })
    throw new Error('abort')
  }), /abort/u)
  assert.deepEqual(await fresh.transaction('private', transaction => transaction.get('command', 'first')), { value: 3 })
  assert.deepEqual(await fresh.transaction('private', transaction => transaction.get('command', 'second')), { value: 2 })
  await fresh.transaction('private', async transaction => {
    assert.equal(await transaction.remove('command', 'first'), true)
    assert.equal(await transaction.remove('command', 'first'), false)
    await assert.rejects(transaction.scan('command', { limit: 102 }), { code: 'INVALID_INPUT' })
  })
})
