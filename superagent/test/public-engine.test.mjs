import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const source = { sourceInstanceId: 'desktop-one', actorId: 'local-user', allowedActorIds: ['local-user'] }
const command = { commandId: 'request-1', eventId: 'message-1', text: 'Inspect the supplied project.' }
const cleanups = new WeakMap()

async function open(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-'))
  const ctx = new Context()
  if (!cleanups.has(t)) {
    const cleanup = { contexts: [], directories: [] }
    cleanups.set(t, cleanup)
    t.after(async () => {
      const errors = []
      for (const context of cleanup.contexts.reverse()) {
        try { await context.fiber.dispose() } catch (error) { errors.push(error) }
      }
      for (const path of cleanup.directories) {
        try { await rm(path, { recursive: true, force: true }) } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Test resource cleanup failed.')
    })
  }
  cleanups.get(t).contexts.push(ctx)
  cleanups.get(t).directories.push(directory)
  await ctx.plugin(plugin, { databasePath: join(directory, 'state.sqlite'), instanceId: 'private', source, ...options })
  return { engine: ctx.get('superagent'), ctx, directory }
}

test('a trusted explicit request exposes durable authorization and pending work through the plugin', async t => {
  const { engine } = await open(t)
  const receipt = await engine.submit(command)
  assert.equal(receipt.status, 'pending')
  const work = await engine.getTicket(receipt.ticketId)
  assert.equal(work.trigger.text, 'Inspect the supplied project.')
  assert.deepEqual(work.trigger.source, { kind: 'desktop', sourceInstanceId: 'desktop-one', actorId: 'local-user' })
  assert.equal(work.decision.outcome, 'accept')
  assert.equal(work.mandate.scope, 'Inspect the supplied project.')
  assert.equal(work.mandate.strength, 'explicit')
  assert.equal(work.ticket.state, 'open')
  assert.equal(work.intent.state, 'pending')
  assert.equal(work.intent.reason, 'worker-not-enabled')
  assert.equal(work.intent.environment, 'local')
  assert.deepEqual(await engine.getReceipt(command.commandId), receipt)
})

test('request data cannot replace the trusted desktop source, instance or authorization', async t => {
  const { engine } = await open(t)
  for (const field of ['instanceId', 'source', 'actorId', 'allowedActorIds', 'scope']) {
    await assert.rejects(engine.submit({ ...command, [field]: 'forged' }), { code: 'INVALID_INPUT' })
  }
  assert.deepEqual(await engine.listTickets(), { items: [], hasMore: false })
})

test('an awaited transaction accepts the original request snapshot and returns its original receipt on replay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-snapshot-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  let release
  const gate = new Promise(resolve => { release = resolve })
  const delayed = {
    transaction: async (instanceId, operation) => { await gate; return storage.transaction(instanceId, operation) },
    close: () => storage.close(),
  }
  const { engine } = await open(t, { storage: delayed })
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const original = { ...command }
  const accepting = engine.submit(original)
  original.text = 'An unrelated request introduced after acceptance began.'
  original.commandId = 'forged-later-id'
  release()
  const receipt = await accepting
  assert.equal((await engine.getTicket(receipt.ticketId)).mandate.scope, 'Inspect the supplied project.')
  assert.equal(receipt.acceptedCommandId, 'request-1')
  assert.deepEqual(await engine.submit({ execution: 'local', ...command, mode: 'explicit' }), receipt)
  assert.deepEqual(await engine.submit({ ...command, commandId: 'transport-retry' }), receipt)
  assert.equal((await engine.listTickets()).items.length, 1)
  await assert.rejects(engine.submit({ ...command, text: 'Change the accepted scope.' }), { code: 'IDENTITY_CONFLICT' })
  await assert.rejects(engine.submit({ ...command, commandId: 'event-retry', text: 'Change the accepted scope.' }), { code: 'IDENTITY_CONFLICT' })
})

test('unsupported execution and request modes never become accepted local work', async t => {
  const { engine } = await open(t)
  for (const key of ['mode', 'execution']) {
    for (const value of [null, false, 0, '', 'auto', 'remote']) {
      await assert.rejects(engine.submit({ ...command, [key]: value }), { code: 'UNSUPPORTED_CAPABILITY' })
    }
  }
  assert.deepEqual(await engine.listTickets(), { items: [], hasMore: false })
})

test('two instances and two desktop sources cannot collide or borrow another source allowlist', async t => {
  const { engine: first, directory } = await open(t)
  const databasePath = join(directory, 'state.sqlite')
  const { engine: second } = await open(t, { databasePath, instanceId: 'team' })
  const firstReceipt = await first.submit(command)
  assert.equal(await second.getTicket(firstReceipt.ticketId), undefined)
  assert.equal(await second.getReceipt(command.commandId), undefined)
  const secondReceipt = await second.submit(command)
  assert.notEqual(secondReceipt.ticketId, firstReceipt.ticketId)
  const { engine: otherSource } = await open(t, { databasePath, source: { ...source, sourceInstanceId: 'desktop-two' } })
  const sourceReceipt = await otherSource.submit({ ...command, commandId: 'second-source-command' })
  assert.notEqual(sourceReceipt.triggerId, firstReceipt.triggerId)
  const { engine: deniedSource } = await open(t, { databasePath, source: { ...source, sourceInstanceId: 'desktop-denied', allowedActorIds: [] } })
  await assert.rejects(deniedSource.submit(command), { code: 'SOURCE_NOT_AUTHORIZED' })
  assert.equal((await first.listTickets()).items.length, 2)
  assert.equal((await second.listTickets()).items.length, 1)
})

test('parallel delivery retries create one durable work item with the original receipt', async t => {
  const { engine } = await open(t)
  const receipts = await Promise.all(Array.from({ length: 20 }, (_, index) => engine.submit({ ...command, commandId: `delivery-${index}` })))
  for (const receipt of receipts) assert.deepEqual(receipt, receipts[0])
  assert.equal((await engine.listTickets()).items.length, 1)
  for (let i = 0; i < 20; i++) assert.deepEqual(await engine.getReceipt(`delivery-${i}`), receipts[0])
})

test('ill-formed Unicode identifiers cannot collapse instance or receipt identity while valid Unicode remains usable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-unicode-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new plugin.Engine(storage, 'private', source)
  for (const malformed of [String.fromCharCode(0xd800), String.fromCharCode(0xdc00)]) {
    assert.throws(() => new plugin.Engine(storage, malformed, source), { code: 'INVALID_INPUT' })
    for (const field of ['sourceInstanceId', 'actorId']) {
      assert.throws(() => new plugin.Engine(storage, 'private', { ...source, [field]: malformed }), { code: 'INVALID_INPUT' })
    }
    assert.throws(() => new plugin.Engine(storage, 'private', { ...source, allowedActorIds: [malformed] }), { code: 'INVALID_INPUT' })
    for (const field of ['commandId', 'eventId']) {
      await assert.rejects(engine.submit({ ...command, [field]: malformed }), { code: 'INVALID_INPUT' })
    }
    assert.throws(() => engine.getReceipt(malformed), { code: 'INVALID_INPUT' })
  }
  assert.deepEqual(await engine.listTickets(), { items: [], hasMore: false })
  const unicodeSource = { sourceInstanceId: '桌面-🧭', actorId: '用户-😀', allowedActorIds: ['用户-😀'] }
  const unicode = new plugin.Engine(storage, '团队-😀', unicodeSource)
  const unicodeCommand = { commandId: '请求-🧭', eventId: '消息-😀', text: 'Inspect Unicode identity.' }
  const receipt = await unicode.submit(unicodeCommand)
  assert.deepEqual(await unicode.getReceipt('请求-🧭'), receipt)
  const replacement = new plugin.Engine(storage, String.fromCodePoint(0xfffd), source)
  assert.equal(await replacement.getReceipt('请求-🧭'), undefined)
  const replacementReceipt = await engine.submit({ ...command, commandId: String.fromCodePoint(0xfffd) })
  assert.deepEqual(await engine.getReceipt(String.fromCodePoint(0xfffd)), replacementReceipt)
})

test('a precommit adapter failure leaves no acceptance, authorization or pending work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-rollback-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { try { await storage.close() } finally { await rm(directory, { recursive: true, force: true }) } })
  const failing = {
    transaction: (instanceId, operation) => storage.transaction(instanceId, async tx => {
      await operation(tx)
      throw new Error('Injected failure before commit')
    }),
    close: () => storage.close(),
  }
  const { engine } = await open(t, { storage: failing })
  await assert.rejects(engine.submit(command), /Injected failure before commit/u)
  const recovered = new plugin.Engine(storage, 'private', source)
  assert.equal(await recovered.getReceipt(command.commandId), undefined)
  assert.deepEqual(await recovered.listTickets(), { items: [], hasMore: false })
  const receipt = await recovered.submit(command)
  assert.equal((await recovered.getTicket(receipt.ticketId)).intent.reason, 'worker-not-enabled')
})
