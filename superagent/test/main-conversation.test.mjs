import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Engine, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const source = { sourceInstanceId: 'desktop', actorId: 'alice', allowedActorIds: ['alice'] }
const routes = { main: { provider: 'mock', model: 'main' }, router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } }

test('one Instance keeps a distinct Main conversation across windows and restart without making work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'r5-main-'))
  const requests = []
  const native = await nativeContext(join(directory, 'sessions'), function* (request) {
    requests.push(request)
    const users = request.messages.filter(message => message.role === 'user')
    yield* textResponse(users.length === 1 ? 'Hello Alice.' : 'Your name is Alice.')
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new NativeSessions(native, routes)
  let engine = new Engine(storage, 'personal', source, {}, sessions)
  t.after(async () => {
    await engine.shutdown(); await sessions.close(); await native.fiber.dispose(); await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  const first = await engine.openMain({ instanceId: 'personal' })
  const otherWindow = await engine.openMain({ instanceId: 'personal' })
  assert.deepEqual(otherWindow, first)
  assert.notEqual(first.mainSessionId, first.routerSessionId)
  await Promise.all([
    engine.sendMainMessage({ instanceId: 'personal', commandId: 'hello', text: 'My name is Alice.' }),
    engine.sendMainMessage({ instanceId: 'personal', commandId: 'hello', text: 'My name is Alice.' }),
  ])
  await engine.shutdown()
  engine = new Engine(storage, 'personal', source, {}, sessions)
  assert.deepEqual(await engine.openMain({ instanceId: 'personal' }), first)
  await engine.sendMainMessage({ instanceId: 'personal', commandId: 'remember', text: 'What is my name?' })
  const history = await engine.getMainConversation({ instanceId: 'personal' })
  assert.deepEqual(history.messages.map(message => [message.role, message.text]), [
    ['user', 'My name is Alice.'], ['main', 'Hello Alice.'], ['user', 'What is my name?'], ['main', 'Your name is Alice.'],
  ])
  assert.equal(new Set(history.messages.map(message => message.id)).size, 4)
  assert.equal(requests.length, 2)
  assert.ok(requests.every(request => request.model === 'main'))
  assert.deepEqual(requests[0].tools.map(tool => tool.name).sort(), ['delegate_work', 'query_work'])
  assert.deepEqual((await engine.getRoleConfigUses(first.mainSessionId)).map(use => [use.role, use.revision, use.main.model]), [['main', 1, 'main'], ['main', 1, 'main']])
  assert.deepEqual((await engine.listTickets()).items, [])
})

test('refresh reconciles a completed native reply after the business projection commit fails', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'r5-main-reconcile-'))
  let calls = 0
  const native = await nativeContext(join(directory, 'sessions'), function* () { calls++; yield* textResponse('A reply already persisted in the native Session.') })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  let failProjection = true
  const interrupted = {
    ...storage,
    transaction: (id, operation) => storage.transaction(id, tx => operation({ ...tx, insert: async (kind, key, value) => {
      if (failProjection && kind === 'main-message' && value.role === 'main') throw new Error('Simulated business projection outage.')
      return tx.insert(kind, key, value)
    } })),
    reconnect: () => storage.reconnect(), close: () => storage.close(),
  }
  const sessions = new NativeSessions(native, routes)
  let engine = new Engine(interrupted, 'personal', source, {}, sessions)
  t.after(async () => {
    await engine.shutdown(); await sessions.close(); await native.fiber.dispose(); await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  const command = { instanceId: 'personal', commandId: 'persist-once', text: 'Keep this reply.' }
  await assert.rejects(engine.sendMainMessage(command), { code: 'MAIN_TURN_FAILED' })
  await engine.shutdown()
  failProjection = false
  engine = new Engine(interrupted, 'personal', source, {}, sessions)
  const history = await engine.getMainConversation({ instanceId: 'personal' })
  assert.deepEqual(history.messages.map(message => message.text), ['Keep this reply.', 'A reply already persisted in the native Session.'])
  await engine.sendMainMessage(command)
  assert.equal((await engine.getMainConversation({ instanceId: 'personal' })).messages.length, 2)
  assert.equal(calls, 1, 'recovery reads the existing native turn instead of calling the model again')
  failProjection = true
  const delayed = { instanceId: 'personal', commandId: 'delayed', text: 'Keep the next reply too.' }
  await assert.rejects(engine.sendMainMessage(delayed), { code: 'MAIN_TURN_FAILED' })
  failProjection = false
  await engine.sendMainMessage({ instanceId: 'personal', commandId: 'followup', text: 'A follow-up before refreshing.' })
  await engine.sendMainMessage(delayed)
  assert.equal((await engine.getMainConversation({ instanceId: 'personal' })).messages.length, 6)
  assert.equal(calls, 3, 'a following input reconciles the previous reply before replacing its active identity')
})

test('Main executes the immutable role revision recorded before a concurrent configuration save', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'r5-main-config-'))
  const native = await nativeContext(join(directory, 'sessions'), function* (request) { yield* textResponse(request.model) })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  let recorded, release
  const ready = new Promise(resolve => { recorded = resolve })
  const resume = new Promise(resolve => { release = resolve })
  let hold = true
  const delayedStore = {
    transaction: async (id, operation) => {
      let pause = false
      const result = await storage.transaction(id, tx => operation({ ...tx, insert: async (kind, key, value) => {
        await tx.insert(kind, key, value)
        if (hold && kind === 'role-config-use' && value.role === 'main') pause = true
      } }))
      if (pause) { hold = false; recorded(); await resume }
      return result
    },
    reconnect: () => storage.reconnect(), close: () => storage.close(),
  }
  const sessions = new NativeSessions(native, routes)
  const engine = new Engine(delayedStore, 'personal', source, {}, sessions)
  t.after(async () => {
    release(); await engine.shutdown(); await sessions.close(); await native.fiber.dispose(); await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  const binding = await engine.openMain({ instanceId: 'personal' })
  const first = engine.sendMainMessage({ instanceId: 'personal', commandId: 'old-config', text: 'Answer with the recorded route.' })
  await ready
  const config = await engine.getRoleConfig()
  await engine.updateRoleConfig({ commandId: 'new-config', expectedRevision: config.revision, roles: {
    ...config.roles, main: { ...config.roles.main, model: { provider: 'mock', model: 'main-next' }, instructions: 'Use the next revision.' },
  } })
  release()
  await first
  await engine.sendMainMessage({ instanceId: 'personal', commandId: 'new-turn', text: 'Now use the next route.' })
  assert.deepEqual((await engine.getMainConversation({ instanceId: 'personal' })).messages.filter(message => message.role === 'main').map(message => message.text), ['main', 'main-next'])
  assert.deepEqual((await engine.getRoleConfigUses(binding.mainSessionId)).sort((left, right) => left.revision - right.revision).map(use => [use.revision, use.main.model]), [[1, 'main'], [2, 'main-next']])
})

test('Main rejects cross-Instance access and conflicting identities, and unavailable delegation starts no work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'r5-main-scope-'))
  const native = await nativeContext(join(directory, 'sessions'), function* (request) {
    const userIndex = request.messages.findLastIndex(message => message.role === 'user')
    const result = request.messages.slice(userIndex + 1).find(message => message.role === 'tool')
    if (result) { yield* textResponse(JSON.stringify(result.content)); return }
    yield* toolResponse('delegate_work', { goal: 'Please edit a file.', constraints: 'Do not use a workspace that has not been authorized.', acceptanceCriteria: 'Read back the completed file.' })
  })
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const sessions = new NativeSessions(native, routes)
  const engine = new Engine(storage, 'personal', source, {}, sessions)
  const other = new Engine(storage, 'team', source, {}, sessions)
  const intruder = new Engine(storage, 'personal', { ...source, actorId: 'mallory' }, {}, sessions)
  t.after(async () => {
    await engine.shutdown(); await other.shutdown(); await intruder.shutdown()
    await sessions.close(); await native.fiber.dispose(); await storage.close()
    await rm(directory, { recursive: true, force: true })
  })
  for (const action of [
    () => engine.openMain({ instanceId: 'team' }),
    () => engine.getMainConversation({ instanceId: 'team' }),
    () => engine.sendMainMessage({ instanceId: 'team', commandId: 'cross', text: 'Read private history.' }),
    () => intruder.openMain({ instanceId: 'personal' }),
  ]) await assert.rejects(action(), { code: 'SOURCE_NOT_AUTHORIZED' })
  await engine.sendMainMessage({ instanceId: 'personal', commandId: 'delegate', text: 'Please edit a file.' })
  await assert.rejects(engine.sendMainMessage({ instanceId: 'personal', commandId: 'delegate', text: 'Publish everything.' }), { code: 'IDENTITY_CONFLICT' })
  const history = await engine.getMainConversation({ instanceId: 'personal', limit: 1 })
  assert.equal(history.messages[0].text, 'Please edit a file.')
  const next = await engine.getMainConversation({ instanceId: 'personal', after: history.cursor })
  assert.match(next.messages[0].text, /DELEGATION_UNAVAILABLE/u)
  assert.deepEqual((await engine.listTickets()).items, [])
  const team = await other.getMainConversation({ instanceId: 'team' })
  assert.deepEqual(team.messages, [])
  assert.notEqual(team.mainId, history.mainId)
  assert.notEqual(team.routerSessionId, history.routerSessionId)
})
