import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import * as Profile from '../dist/profile.js'
import { installProduct } from '../../ds-bot/src/host/product.js'
import { nativeContext, textResponse } from '../dev/native-mock.mjs'

test('the product HTTP boundary chats with Main and refuses cross-scope and unavailable operations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'r5-product-http-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = directory
  const models = []
  const native = await nativeContext(join(directory, 'sessions'), function* (request) {
    models.push(request.model)
    yield* textResponse('Main answered through the product boundary.')
  })
  t.after(async () => {
    await native.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`))
    await rm(directory, { recursive: true, force: true })
  })
  const routes = new Map()
  native.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } })
  await native.plugin(Profile, { main: { provider: 'mock', model: 'main' }, router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  await native.plugin({ name: 'product-http', inject: ['connection', 'superagentProduct'], apply: installProduct })
  assert.deepEqual([...routes.keys()], ['/api/product'])
  assert.equal(native.get('botExecutionAdapter'), undefined)
  assert.equal(native.get('superagentUi'), undefined)
  const call = async (endpoint, payload = {}) => {
    const response = await routes.get('/api/product').fetch(new Request('http://fixture/api/product', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }),
    }))
    return { status: response.status, ...await response.json() }
  }
  const opened = await call('open')
  const instanceId = opened.value.instanceId
  assert.deepEqual((await call('open')).value, opened.value)
  assert.equal((await call('send', { instanceId, commandId: 'hello', text: 'Hello Main.' })).value.status, 'completed')
  const history = await call('history', { instanceId })
  assert.deepEqual(history.value.messages.map(message => [message.role, message.text]), [
    ['user', 'Hello Main.'], ['main', 'Main answered through the product boundary.'],
  ])
  for (const endpoint of ['history', 'send']) {
    const denied = await call(endpoint, { instanceId: 'another-private-scope', commandId: 'guess', text: 'Guessing does not authorize access.' })
    assert.equal(denied.status, 403)
    assert.equal(denied.error.code, 'SOURCE_NOT_AUTHORIZED')
  }
  const unsupported = await call('delegate', { instanceId })
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.error.code, 'UNAVAILABLE')
  assert.deepEqual(models, ['main'])
})
