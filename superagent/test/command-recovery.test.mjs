import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CoreError, Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }
const request = { commandId: 'original', eventId: 'message', text: 'Preserve this request.' }

test('an unknown commit is reconciled on a fresh locked connection using the original command identity', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-reconcile-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  context.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  let loseReply = true
  const uncertain = {
    transaction: async (instanceId, operation) => {
      const result = await storage.transaction(instanceId, operation)
      if (loseReply) { loseReply = false; throw new CoreError('COMMIT_UNKNOWN', 'Commit response lost.') }
      return result
    },
    reconnect: () => storage.reconnect(),
    close: () => storage.close(),
  }
  const engine = new Engine(uncertain, 'private', source)
  const receipt = await engine.submit(request)
  assert.deepEqual(await engine.getReceipt('original'), receipt)
  assert.equal((await engine.listTickets()).items.length, 1)
  loseReply = true
  await assert.rejects(engine.submit({ ...request, text: 'Different scope.' }), { code: 'IDENTITY_CONFLICT' })
})

test('an unverified commit stays unknown when a fresh connection cannot acquire the write lock', async () => {
  const storage = {
    transaction: async () => { throw new CoreError('COMMIT_UNKNOWN', 'Commit response lost.') },
    reconnect: async () => ({
      transaction: async () => { throw new CoreError('LOCK_TIMEOUT', 'Original writer still holds the lock.') },
      close: async () => {},
    }),
    close: async () => {},
  }
  const engine = new Engine(storage, 'private', source)
  await assert.rejects(engine.submit(request), { code: 'COMMIT_UNKNOWN' })
})

test('rolled-back serialization failures retry the whole transaction with a finite budget', async () => {
  let attempts = 0
  const engine = new Engine({
    transaction: async () => { attempts++; throw new CoreError('SERIALIZATION_FAILURE', 'Rolled back.') },
    reconnect: async () => { throw new Error('A rollback must not require reconciliation.') },
    close: async () => {},
  }, 'private', source)
  await assert.rejects(engine.submit(request), { code: 'RETRY_EXHAUSTED' })
  assert.equal(attempts, 3)
})
