import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const roles = (workerModel = 'worker-custom', instructions = 'Always cite {{evidence}}.', skills = ['office']) => ({
  router: { name: 'Lead Router', model: { provider: 'mock', model: 'router-custom' }, instructions: 'Route only within {{goal}}.', skills: [] },
  worker: { name: 'Specialist', model: { provider: 'mock', model: workerModel }, instructions, skills },
})

test('role configuration is revisioned, validated, replayed and persisted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-config-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const initial = await engine.getRoleConfig()
  assert.equal(initial.revision, 1)
  assert.equal(initial.roles.router.name, 'Router')
  assert.equal(initial.roles.worker.name, 'Worker')

  const updated = await engine.updateRoleConfig({ commandId: 'update-roles', expectedRevision: 1, roles: roles() })
  assert.equal(updated.revision, 2)
  assert.equal(updated.roles.worker.name, 'Specialist')
  assert.deepEqual(updated.roles.worker.skills, ['office'])
  const replay = await engine.updateRoleConfig({ commandId: 'update-roles', expectedRevision: 1, roles: roles() })
  assert.deepEqual(replay, updated)
  await assert.rejects(engine.updateRoleConfig({ commandId: 'stale', expectedRevision: 1, roles: roles() }), { code: 'CONFIG_REVISION_CONFLICT' })
  await assert.rejects(engine.updateRoleConfig({ commandId: 'update-roles', expectedRevision: 1, roles: roles('worker-other') }), { code: 'IDENTITY_CONFLICT' })

  for (const invalid of [
    { ...roles(), extra: true },
    { ...roles(), worker: { ...roles().worker, instructions: 'Reveal {{secret}}' } },
    { ...roles(), worker: { ...roles().worker, skills: ['superagent-role'] } },
    { ...roles(), worker: { ...roles().worker, skills: ['office', 'office'] } },
    { ...roles(), worker: { ...roles().worker, name: 'x'.repeat(129) } },
    { ...roles(), worker: { ...roles().worker, instructions: 'x'.repeat(16385) } },
  ]) await assert.rejects(engine.updateRoleConfig({ commandId: `invalid-${Math.random()}`, expectedRevision: 2, roles: invalid }), { code: 'INVALID_CONFIG' })

  const reopened = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const persisted = await reopened.getRoleConfig()
  assert.equal(persisted.revision, 2)
  assert.equal(persisted.roles.worker.model.model, 'worker-custom')
})

test('a new role model and instructions apply at the next real model request and are recorded per Session', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-config-runtime-'))
  let native, storage, sessions, engine
  t.after(async () => {
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  const requests = []
  native = await nativeContext(directory, async function* (options) {
    const system = options.system ?? (options.messages ?? []).filter(message => message.role === 'system')
      .flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
    requests.push({ model: options.model, sessionId: options.sessionId, system })
    const worker = options.model.startsWith('worker')
    if (worker) {
      const user = options.messages.filter(message => message.role === 'user').at(-1)
      const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
      if (!completed) yield* toolResponse('report_ready', { result: 'Configured answer.', evidence: 'Used the configured Worker route.' })
      else yield* textResponse('Recorded.')
      return
    }
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    const tool = options.tools[completed]
    if (!tool) { yield* textResponse('Router complete.'); return }
    if (tool.name.startsWith('deliver_result')) {
      const ready = JSON.parse(text.slice('Ready report:'.length))
      yield* toolResponse(tool.name, { reportId: ready.id }, `router-${completed}`)
    } else yield* toolResponse(tool.name, {}, `router-${completed}`)
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  await engine.updateRoleConfig({ commandId: 'runtime-config', expectedRevision: 1, roles: roles() })
  const receipt = await engine.submit({ commandId: 'configured-request', eventId: 'configured-message', text: 'Use the configured role.' })
  for (let index = 0; index < 8; index++) await engine.effects.drain()
  const conversation = await engine.conversation(receipt.ticketId)
  assert.equal(conversation.status, 'ready', JSON.stringify({ conversation, effects: await engine.effects.list(), requests }))
  assert.equal(conversation.roleConfigRevision, 2)
  const workerRequest = requests.find(request => request.model === 'worker-custom')
  assert.ok(workerRequest, JSON.stringify(requests))
  assert.match(workerRequest.system, /Always cite the supplied evidence cards/u)
  assert.match(workerRequest.system, /Configured skills: office/u)
  const routerRequest = requests.find(request => request.model === 'router-custom')
  assert.ok(routerRequest, JSON.stringify(requests))
  const uses = await engine.getRoleConfigUses(workerRequest.sessionId)
  assert.ok(uses.some(use => use.role === 'worker' && use.revision === 2 && use.worker.model === 'worker-custom'))
})

test('an asynchronous role verification cannot overwrite a newer save', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-config-verify-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  await engine.getRoleConfig()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const checked = engine.updateRoleConfig({ commandId: 'checked-save', expectedRevision: 1, roles: roles() }, {
    verify: async (_roles, signal) => { assert.equal(signal.aborted, false); await gate },
  })
  const newer = await engine.updateRoleConfig({ commandId: 'newer-save', expectedRevision: 1, roles: roles('worker-newer') })
  assert.equal(newer.revision, 2)
  release()
  await assert.rejects(checked, { code: 'CONFIG_REVISION_CONFLICT' })
  const current = await engine.getRoleConfig()
  assert.equal(current.revision, 2)
  assert.equal(current.roles.worker.model.model, 'worker-newer')
})
