import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-client-gateway-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const access = engine.createClientAccess()
  const closed = []
  t.after(async () => {
    for (const gateway of closed) await gateway.close().catch(() => {})
    await storage.close(); await rm(directory, { recursive: true, force: true })
  })
  const open = async (options = {}) => {
    const gateway = await core.createClientGateway(engine, access, options)
    closed.push(gateway)
    return gateway
  }
  return { engine, access, storage, open }
}

function send(url, { method = 'GET', token, body, ca } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const secure = target.protocol === 'https:'
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const request = (secure ? httpsRequest : httpRequest)(target, {
      method,
      ...(secure ? { ca } : {}),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: response.statusCode, body: text ? JSON.parse(text) : undefined })
      })
    })
    request.once('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

function openssl() {
  const candidates = [process.env.OPENSSL, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'].filter(Boolean)
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' })
    if (probe.status === 0 && /OpenSSL/u.test(probe.stdout)) return candidate
  }
  return undefined
}

test('the dedicated entry authenticates, authorizes read and command per Instance and rejects crossed access', async t => {
  const { access, engine, storage, open } = await fixture(t)
  await assert.rejects(core.createClientGateway(engine, new core.ClientAccess(storage, 'other')), { code: 'INVALID_CONFIG' })
  await assert.rejects(core.createClientGateway(engine, new core.ClientAccess(storage, 'private')), { code: 'INVALID_CONFIG' })
  const gateway = await open()
  const full = await access.enroll({ commandId: 'full', label: 'Desktop', grants: [{ instanceId: 'private', capabilities: ['read', 'command'] }] })
  const state = await send(`${gateway.url}/instances/private/state`, { token: full.token })
  assert.equal(state.status, 200)
  assert.equal(state.body.instanceId, 'private')
  assert.equal(state.body.client.id, full.client.id)
  assert.match(state.body.cursor, /^\d+$/u)
  assert.deepEqual(state.body.items, [])

  const submit = { commandId: 'client-request', eventId: 'client-message', text: 'A request from the client.' }
  const accepted = await send(`${gateway.url}/instances/private/commands/submit`, { method: 'POST', token: full.token, body: submit })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.status, 'pending')
  const replay = await send(`${gateway.url}/instances/private/commands/submit`, { method: 'POST', token: full.token, body: submit })
  assert.deepEqual(replay.body, accepted.body)
  const charsetReplay = await fetch(`${gateway.url}/instances/private/commands/submit`, { method: 'POST',
    headers: { authorization: `Bearer ${full.token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(submit) })
  assert.equal(charsetReplay.status, 200)
  assert.deepEqual(await charsetReplay.json(), accepted.body)
  const malformed = await fetch(`${gateway.url}/instances/private/commands/submit`, { method: 'POST',
    headers: { authorization: `Bearer ${full.token}`, 'content-type': 'application/json' }, body: '{' })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).code, 'INVALID_INPUT')
  const receipt = await send(`${gateway.url}/instances/private/receipts/client-request`, { token: full.token })
  assert.deepEqual(receipt.body, accepted.body)
  const ticket = await send(`${gateway.url}/instances/private/tickets/${accepted.body.ticketId}`, { token: full.token })
  assert.equal(ticket.status, 200)
  assert.equal(ticket.body.trigger.text, submit.text)
  const later = await send(`${gateway.url}/instances/private/state`, { token: full.token })
  assert.equal(later.body.items.length, 1)
  assert.equal(later.body.items[0].ticketId, accepted.body.ticketId)

  const events = await send(`${gateway.url}/instances/private/events?after=0`, { token: full.token })
  assert.equal(events.status, 200)
  assert.deepEqual(events.body.items.filter(item => item.kind === 'receipt').map(item => item.data.commandId), ['client-request'])
  const caughtUp = await send(`${gateway.url}/instances/private/events?after=${events.body.cursor}`, { token: full.token })
  assert.deepEqual(caughtUp.body.items, [])
  assert.equal((await send(`${gateway.url}/instances/private/events?after=later`, { token: full.token })).status, 400)

  const viewer = await access.enroll({ commandId: 'viewer', label: 'Viewer', grants: [{ instanceId: 'private', capabilities: ['read'] }] })
  assert.equal((await send(`${gateway.url}/instances/private/state`, { token: viewer.token })).status, 200)
  const refusedCommand = await send(`${gateway.url}/instances/private/commands/submit`, { method: 'POST', token: viewer.token, body: submit })
  assert.equal(refusedCommand.status, 403)
  assert.equal(refusedCommand.body.code, 'INSTANCE_NOT_AUTHORIZED')

  const commander = await access.enroll({ commandId: 'commander', label: 'Commander', grants: [{ instanceId: 'private', capabilities: ['command'] }] })
  assert.equal((await send(`${gateway.url}/instances/private/state`, { token: commander.token })).status, 403)
  assert.equal((await send(`${gateway.url}/instances/private/commands/submit`, { method: 'POST', token: commander.token,
    body: { ...submit, commandId: 'commander-request', eventId: 'commander-message' } })).status, 200)

  await assert.rejects(access.enroll({ commandId: 'elsewhere', label: 'Elsewhere',
    grants: [{ instanceId: 'other', capabilities: ['read', 'command'] }] }), { code: 'INVALID_INPUT' })
  assert.equal((await send(`${gateway.url}/instances/other/state`, { token: full.token })).status, 403)
  assert.equal((await send(`${gateway.url}/instances/private/devices`, { token: full.token })).status, 404)
  assert.equal((await send(`${gateway.url}/instances/private/state`)).status, 401)
  assert.equal((await send(`${gateway.url}/instances/private/state`, { token: 'sc1.nope.' + 'x'.repeat(43) })).status, 401)

  await access.revoke({ commandId: 'revoke-full', clientId: full.client.id, reason: 'Desktop retired.' })
  const revoked = await send(`${gateway.url}/instances/private/state`, { token: full.token })
  assert.equal(revoked.status, 401)
  assert.equal(revoked.body.code, 'CLIENT_REVOKED')
  assert.equal((await send(`${gateway.url}/instances/private/commands/stop`, { method: 'POST', token: full.token, body: {} })).status, 401)
  assert.equal((await engine.getReceipt('client-request')).ticketId, accepted.body.ticketId)
})

test('the gateway refuses a public bind without TLS and serves a self-signed protected listener when configured', async t => {
  const { access, open } = await fixture(t)
  await assert.rejects(open({ host: '0.0.0.0' }), { code: 'TRANSPORT_INSECURE' })
  const tool = openssl()
  if (!tool) return t.skip('OpenSSL is needed to generate the isolated TLS fixture.')
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-client-tls-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keyPath = join(directory, 'key.pem'); const certPath = join(directory, 'cert.pem')
  const generated = spawnSync(tool, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  const key = await readFile(keyPath, 'utf8'); const cert = await readFile(certPath, 'utf8')
  const client = await access.enroll({ commandId: 'tls-client', label: 'TLS Desktop', grants: [{ instanceId: 'private', capabilities: ['read'] }] })
  const gateway = await open({ tls: { key, cert } })
  assert.equal(gateway.secure, true)
  const secure = await send(`${gateway.url}/instances/private/state`, { token: client.token, ca: cert })
  assert.equal(secure.status, 200)
  await assert.rejects(send(`${gateway.url.replace('https:', 'http:')}/instances/private/state`, { token: client.token }))
})
