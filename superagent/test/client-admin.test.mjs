import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

test('the loopback administration entry enrolls, lists and revokes clients without exposing their secret', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-client-admin-'))
  let storage, engine, access, chat, bare
  t.after(async () => {
    await chat?.close(); await bare?.close(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  access = engine.createClientAccess()
  chat = await core.createChatServer(engine, { clients: access })
  await assert.rejects(core.createChatServer(engine, { clients: new core.ClientAccess(storage, 'private') }), { code: 'INVALID_CONFIG' })
  const post = (path, body) => fetch(`${chat.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  assert.deepEqual(await (await fetch(`${chat.url}/clients`)).json(), [])
  const enrolled = await post('/clients', { commandId: 'admin-enroll', label: 'Read-only desktop', capabilities: ['read'] })
  assert.equal(enrolled.status, 200)
  const enrollment = await enrolled.json()
  assert.match(enrollment.token, /^sc1\./u)
  assert.deepEqual(enrollment.client.grants, [{ instanceId: 'private', capabilities: ['read'] }])
  assert.equal((await access.authorize(enrollment.token, 'private', 'read')).id, enrollment.client.id)
  await assert.rejects(access.authorize(enrollment.token, 'private', 'command'), { code: 'INSTANCE_NOT_AUTHORIZED' })

  const listed = await (await fetch(`${chat.url}/clients`)).json()
  assert.equal(listed.length, 1)
  assert.equal('token' in listed[0], false)
  assert.equal('tokenHash' in listed[0], false)
  const replay = await post('/clients', { commandId: 'admin-enroll', label: 'Read-only desktop', capabilities: ['read'] })
  assert.equal((await replay.json()).token, undefined)

  assert.equal((await post('/clients', { commandId: 'missing-label' })).status, 400)
  assert.equal((await post('/clients', { commandId: 'bad-capabilities', label: 'Bad', capabilities: ['device'] })).status, 400)

  const revoked = await post('/clients/revoke', { commandId: 'admin-revoke', clientId: enrollment.client.id, reason: 'Retired.' })
  assert.equal(revoked.status, 200)
  assert.equal((await revoked.json()).revokedReason, 'Retired.')
  await assert.rejects(access.authenticate(enrollment.token), { code: 'CLIENT_REVOKED' })
  assert.equal((await post('/clients/revoke', { commandId: 'missing-reason', clientId: enrollment.client.id })).status, 400)

  bare = await core.createChatServer(engine)
  assert.equal((await fetch(`${bare.url}/clients`)).status, 400)
  const unavailable = await fetch(`${bare.url}/clients`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(unavailable.status, 400)
  assert.equal((await unavailable.json()).code, 'UNSUPPORTED_CAPABILITY')
})
