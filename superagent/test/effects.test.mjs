import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

async function setup(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-effects-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  let effects
  context.after(async () => {
    await effects?.stop()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  effects = new core.Effects(storage, 'private', options)
  const enqueue = request => storage.transaction('private', transaction => effects.enqueue(transaction, request))
  return { storage, effects, enqueue, directory }
}

test('effects only dispatch committed intents and a scan recovers a lost wake', async context => {
  const delivered = []
  const { storage, effects, enqueue } = await setup(context, {
    handlers: { notice: { execute: async operation => { delivered.push(operation.payload.text); return { type: 'success' } } } },
  })
  await assert.rejects(storage.transaction('private', async transaction => {
    await effects.enqueue(transaction, { key: 'aborted', stream: 'notice', scope: 'router', payload: { text: 'never' } })
    throw new Error('before commit')
  }), /before commit/u)
  assert.equal((await effects.list()).items.length, 0)
  const operation = await enqueue({ key: 'notice-1', stream: 'notice', scope: 'router', payload: { text: 'committed' } })
  assert.deepEqual(delivered, [])
  await effects.drain()
  assert.deepEqual(delivered, ['committed'])
  assert.equal((await effects.receipt(operation.id, operation.generation)).state, 'done')
  await effects.drain()
  assert.deepEqual(delivered, ['committed'])
})

test('stable delivery keys suppress completed duplicates while explicit deletion permits a new row identity', async context => {
  const delivered = []
  const { effects, enqueue, storage } = await setup(context, {
    handlers: { relay: { execute: async effect => { delivered.push(effect.id); return { type: 'success' } } } },
  })
  const request = { key: 'input-1', stream: 'relay', scope: 'worker-1', payload: { text: 'same input' } }
  const original = await enqueue(request)
  await effects.drain()
  const duplicate = await enqueue(request)
  await effects.drain()
  assert.equal(duplicate.id, original.id)
  assert.equal(delivered.length, 1)
  await storage.transaction('private', transaction => effects.cancel(transaction, request))
  const recreated = await enqueue(request)
  assert.notEqual(recreated.id, original.id)
  await effects.drain()
  assert.equal(delivered.length, 2)
})

test('late success, failure and deferral cannot mutate a newer payload or a deleted and recreated effect', async context => {
  for (const outcome of ['success', 'transient', 'defer', 'permanent']) {
    let release
    let entered
    const gate = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    const { effects, enqueue, storage } = await setup(context, {
      handlers: { notice: { execute: async () => { entered(); await gate; return outcome === 'success' ? { type: outcome } : { type: outcome, reason: 'old attempt' } } } },
    })
    const request = { key: 'update', stream: 'notice', scope: 'router', payload: { revision: 1 } }
    const original = await enqueue(request)
    const running = effects.drain()
    await started
    const updated = await enqueue({ ...request, payload: { revision: 2 } })
    assert.equal(updated.queueKey, original.queueKey)
    assert.equal(updated.id, original.id)
    assert.notEqual(updated.generation, original.generation)
    release()
    await running
    assert.equal((await effects.list()).items[0].generation, updated.generation)
    assert.equal((await effects.list()).items[0].attempts, 0)
    assert.equal((await effects.receipt(original.id, original.generation)).state, 'superseded')
    await storage.transaction('private', transaction => effects.cancel(transaction, request))
    const recreated = await enqueue(request)
    assert.notEqual(recreated.id, original.id)
  }
})

test('relay and notice keep independent order while transient failure is bounded and permanent failure releases the lane', async context => {
  let now = 100
  const delivered = []
  const handler = { execute: async effect => {
    delivered.push(effect.key)
    if (effect.key === 'relay-1') return { type: 'transient', reason: 'temporarily unavailable' }
    if (effect.key === 'notice-1') return { type: 'permanent', reason: 'destination removed' }
    return { type: 'success' }
  } }
  const { effects, enqueue } = await setup(context, { handlers: { relay: handler, notice: handler }, now: () => now, retryDelayMs: 1, maxAttempts: 2 })
  const first = await enqueue({ key: 'relay-1', stream: 'relay', scope: 'worker', payload: {} })
  await enqueue({ key: 'relay-2', stream: 'relay', scope: 'worker', payload: {} })
  await enqueue({ key: 'notice-1', stream: 'notice', scope: 'router', payload: {} })
  await enqueue({ key: 'notice-2', stream: 'notice', scope: 'router', payload: {} })
  await effects.drain()
  assert.deepEqual(delivered, ['relay-1', 'notice-1', 'notice-2'])
  now += 10
  await effects.drain()
  now += 10
  await effects.drain()
  assert.deepEqual(delivered, ['relay-1', 'notice-1', 'notice-2', 'relay-1', 'relay-2'])
  assert.equal((await effects.receipt(first.id, first.generation)).state, 'failed')
})

test('an unknown external outcome only reconciles the original idempotency key and leaves other scopes available', async context => {
  let now = 100
  const keys = []
  const { effects, enqueue } = await setup(context, { now: () => now, retryDelayMs: 1, handlers: { outbox: {
    execute: async (effect, operation) => { keys.push(operation.idempotencyKey); return { type: 'unknown', reason: 'response lost' } },
    reconcile: async (effect, operation) => { keys.push(operation.idempotencyKey); return { type: 'success' } },
  } } })
  const original = await enqueue({ key: 'message', stream: 'outbox', scope: 'thread', payload: { purpose: 'acknowledgement' } })
  await effects.drain()
  assert.equal((await effects.receipt(original.id, original.generation)).state, 'unknown')
  now += 10
  await effects.drain()
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal((await effects.receipt(original.id, original.generation)).state, 'done')
})

test('JSON object key order does not create a new generation and payload mutation after enqueue cannot change it', async context => {
  const { effects, enqueue, storage } = await setup(context)
  const payload = { text: 'original', nested: { first: 1, second: 2 } }
  const original = await storage.transaction('private', async transaction => {
    const submitting = effects.enqueue(transaction, { key: 'canonical', stream: 'relay', scope: 'worker', payload })
    payload.text = 'mutated'
    return submitting
  })
  assert.equal(original.payload.text, 'original')
  const duplicate = await enqueue({ key: 'canonical', stream: 'relay', scope: 'worker', payload: { nested: { second: 2, first: 1 }, text: 'original' } })
  assert.equal(duplicate.generation, original.generation)
  assert.equal((await effects.list()).items.length, 1)
})

test('accepted work exposes its notice, acknowledgement and command receipt atomically through Engine', async context => {
  const { storage } = await setup(context)
  const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }
  const engine = new core.Engine(storage, 'private', source)
  const request = { commandId: 'accept', eventId: 'message', text: 'A durable request.' }
  const receipt = await engine.submit(request)
  const queued = (await engine.effects.list()).items
  assert.deepEqual(queued.map(effect => effect.stream), ['notice', 'outbox'])
  assert.equal(queued[0].payload.ticketId, receipt.ticketId)
  assert.equal(queued[1].payload.purpose, 'acknowledgement')
  assert.equal(queued[1].payload.destination.eventId, 'message')
  await engine.submit(request)
  assert.equal((await engine.effects.list()).items.length, 2)
})

test('queue capacity rejects the whole command and periodic scanning recovers without a wake', async context => {
  const delivered = []
  const { storage, effects, enqueue } = await setup(context, { maxQueuedEffects: 1, scanIntervalMs: 5, handlers: { notice: {
    execute: async effect => { delivered.push(effect.key); return { type: 'success' } },
  } } })
  await enqueue({ key: 'first', stream: 'notice', scope: 'router', payload: {} })
  await assert.rejects(enqueue({ key: 'excess', stream: 'notice', scope: 'router', payload: {} }), { code: 'QUEUE_FULL' })
  effects.start()
  const deadline = Date.now() + 2000
  while (delivered.length < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  await effects.drain()
  await enqueue({ key: 'second', stream: 'notice', scope: 'router', payload: {} })
  while (delivered.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(delivered, ['first', 'second'])
  await effects.stop()
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, { maxQueuedEffects: 1 })
  await assert.rejects(engine.submit({ commandId: 'capacity', eventId: 'message', text: 'Requires two intents.' }), { code: 'QUEUE_FULL' })
  assert.equal(await engine.getReceipt('capacity'), undefined)
  assert.equal((await engine.listTickets()).items.length, 0)
})

test('adapter deadlines keep unknown receipts and do not block unrelated scopes indefinitely', async context => {
  const delivered = []
  const { effects, enqueue } = await setup(context, { operationTimeoutMs: 10, handlers: { outbox: {
    execute: async effect => {
      if (effect.key === 'slow') return new Promise(() => {})
      delivered.push(effect.key)
      return { type: 'success' }
    },
  } } })
  const slow = await enqueue({ key: 'slow', stream: 'outbox', scope: 'one', payload: {} })
  const other = await enqueue({ key: 'other', stream: 'outbox', scope: 'two', payload: {} })
  await effects.drain()
  assert.deepEqual(delivered, ['other'])
  assert.equal((await effects.receipt(slow.id, slow.generation)).state, 'unknown')
  assert.equal((await effects.receipt(slow.id, slow.generation)).delivery, 'pending')
  assert.equal((await effects.receipt(other.id, other.generation)).delivery, 'sent')
})

test('failed reconciliation never authorizes blind execution of an unknown external outcome', async context => {
  let now = 100
  let sends = 0
  let lookups = 0
  const { effects, enqueue } = await setup(context, { now: () => now, retryDelayMs: 1, handlers: { relay: {
    execute: async () => { sends++; return { type: 'unknown', reason: 'response lost' } },
    reconcile: async () => { lookups++; return { type: 'transient', reason: 'lookup unavailable' } },
  } } })
  const original = await enqueue({ key: 'first', stream: 'relay', scope: 'worker', payload: {} })
  await effects.drain()
  now += 10
  await effects.drain()
  now += 10
  await effects.drain()
  assert.equal(sends, 1)
  assert.equal(lookups, 2)
  assert.equal((await effects.receipt(original.id, original.generation)).state, 'unknown')
})

test('a stale successful completion cannot let a successor pass the replaced lane head', async context => {
  let release
  let entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const delivered = []
  const { effects, enqueue } = await setup(context, { handlers: { relay: {
    execute: async effect => {
      delivered.push([effect.key, effect.payload.revision])
      if (effect.payload.revision === 1) { entered(); await gate }
      return { type: 'success' }
    },
  } } })
  const head = { key: 'first', stream: 'relay', scope: 'worker', payload: { revision: 1 } }
  await enqueue(head)
  await enqueue({ ...head, key: 'second', payload: { revision: 3 } })
  const running = effects.drain()
  await started
  await enqueue({ ...head, payload: { revision: 2 } })
  release()
  await running
  assert.deepEqual(delivered, [['first', 1]])
  await effects.drain()
  assert.deepEqual(delivered, [['first', 1], ['first', 2], ['second', 3]])
})

test('a query-confirmed absent action can retry with the original idempotency key within the remaining budget', async context => {
  let now = 100
  const keys = []
  const { effects, enqueue } = await setup(context, { now: () => now, retryDelayMs: 1, handlers: { relay: {
    execute: async (effect, operation) => { keys.push(operation.idempotencyKey); return keys.length === 1 ? { type: 'unknown', reason: 'response lost' } : { type: 'success' } },
    reconcile: async () => ({ type: 'not-applied', reason: 'Authoritative lookup confirms the request was never accepted.' }),
  } } })
  const original = await enqueue({ key: 'first', stream: 'relay', scope: 'worker', payload: {} })
  await effects.drain()
  now += 10
  await effects.drain()
  assert.equal(keys.length, 1)
  now += 10
  await effects.drain()
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal((await effects.receipt(original.id, original.generation)).state, 'done')
})
