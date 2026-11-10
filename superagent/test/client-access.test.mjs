import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ClientAccess } from '../dist/client-access.js'
import { SqliteStorage } from '../dist/storage.js'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-client-access-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }) })
  return { storage, access: new ClientAccess(storage, 'private') }
}

const grants = [{ instanceId: 'private', capabilities: ['read', 'command'] }]

test('a client credential is issued once, authorizes only its granted Instance and never exposes its secret', async t => {
  const { access } = await fixture(t)
  const enrolled = await access.enroll({ commandId: 'enroll-1', label: 'Desktop', grants })
  assert.match(enrolled.token, /^sc1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u)
  assert.equal(enrolled.client.label, 'Desktop')
  assert.deepEqual(enrolled.client.grants, grants)
  assert.equal((await access.authenticate(enrolled.token)).id, enrolled.client.id)
  assert.deepEqual(await access.authorize(enrolled.token, 'private', 'read'), await access.authenticate(enrolled.token))
  await assert.rejects(access.authorize(enrolled.token, 'other', 'read'), { code: 'INSTANCE_NOT_AUTHORIZED' })
  await assert.rejects(access.authenticate('sc1.not-a-client.' + 'x'.repeat(43)), { code: 'CLIENT_UNAUTHORIZED' })
  await assert.rejects(access.authenticate('nonsense'), { code: 'CLIENT_UNAUTHORIZED' })
  await assert.rejects(access.enroll({ commandId: 'elsewhere', label: 'Elsewhere',
    grants: [{ instanceId: 'other', capabilities: ['read'] }] }), { code: 'INVALID_INPUT' })

  const listed = await access.list()
  assert.equal(listed.length, 1)
  assert.equal('token' in listed[0], false)
  assert.equal('tokenHash' in listed[0], false)

  const replay = await access.enroll({ commandId: 'enroll-1', label: 'Desktop', grants })
  assert.equal(replay.client.id, enrolled.client.id)
  assert.equal(replay.token, undefined)
  await assert.rejects(access.enroll({ commandId: 'enroll-1', label: 'Other', grants }), { code: 'IDENTITY_CONFLICT' })
})

test('a read-only grant cannot issue commands and revocation takes effect on the next request', async t => {
  const { access } = await fixture(t)
  const viewer = await access.enroll({ commandId: 'viewer', label: 'Viewer', grants: [{ instanceId: 'private', capabilities: ['read'] }] })
  assert.equal((await access.authorize(viewer.token, 'private', 'read')).id, viewer.client.id)
  await assert.rejects(access.authorize(viewer.token, 'private', 'command'), { code: 'INSTANCE_NOT_AUTHORIZED' })

  const revoked = await access.revoke({ commandId: 'revoke-1', clientId: viewer.client.id, reason: 'Device lost.' })
  assert.equal(revoked.revokedReason, 'Device lost.')
  await assert.rejects(access.authenticate(viewer.token), { code: 'CLIENT_REVOKED' })
  await assert.rejects(access.authorize(viewer.token, 'private', 'read'), { code: 'CLIENT_REVOKED' })
  const replay = await access.revoke({ commandId: 'revoke-1', clientId: viewer.client.id, reason: 'Device lost.' })
  assert.equal(replay.revokedAt, revoked.revokedAt)
  const enrollmentReplay = await access.enroll({ commandId: 'viewer', label: 'Viewer', grants: [{ instanceId: 'private', capabilities: ['read'] }] })
  assert.equal(enrollmentReplay.client.revokedAt, revoked.revokedAt)
  await assert.rejects(access.revoke({ commandId: 'revoke-1', clientId: viewer.client.id, reason: 'Other reason.' }), { code: 'IDENTITY_CONFLICT' })
  await assert.rejects(access.revoke({ commandId: 'revoke-missing', clientId: 'missing', reason: 'No such client.' }), { code: 'NOT_FOUND' })
})

test('the journal exposes one ordered event per fact and pages by cursor without duplicates', async t => {
  const { access } = await fixture(t)
  assert.equal(await access.cursor(), '0')
  assert.deepEqual((await access.readEvents()).items, [])

  const receipt = { ticketId: 'ticket-1', status: 'pending' }
  await access.recordReceipt('command-1', receipt, 'client-1')
  await access.record([
    { key: 'state:ticket-1:pending', kind: 'state', ticketId: 'ticket-1', data: { bucket: 'pending' } },
    { key: 'state:ticket-1:pending', kind: 'state', ticketId: 'ticket-1', data: { bucket: 'pending' } },
  ])
  const first = await access.readEvents('0', 2)
  assert.deepEqual(first.items.map(item => item.seq), [1, 2])
  assert.equal(first.items[0].kind, 'receipt')
  assert.equal(first.items[0].ticketId, 'ticket-1')
  assert.equal(first.hasMore, false)
  assert.equal(first.cursor, '2')
  assert.deepEqual(await access.readEvents(first.cursor), { items: [], cursor: '2', hasMore: false })
  await assert.rejects(access.readEvents('later'), { code: 'INVALID_INPUT' })
  await assert.rejects(access.readEvents('0000000000000'), { code: 'INVALID_INPUT' })
  await assert.rejects(access.readEvents('0', 0), { code: 'INVALID_INPUT' })

  await access.recordReceipt('command-1', receipt, 'client-1')
  assert.equal((await access.readEvents()).items.length, 2)
})

test('reconciling supervision records attention and result transitions once', async t => {
  const { access } = await fixture(t)
  const supervision = { items: [{ ticketId: 'ticket-1', bucket: 'pending', state: 'pending', reason: 'router-pending',
    lifecycle: 'open', nextAction: 'Wait.' }] }
  const engine = { getSupervision: async () => supervision }
  await access.reconcile(engine)
  await access.reconcile(engine)
  assert.deepEqual((await access.readEvents()).items.map(item => item.kind), ['state'])

  supervision.items[0] = { ticketId: 'ticket-1', bucket: 'needsHuman', state: 'waiting-human', lifecycle: 'open',
    nextAction: 'Answer the question.', attention: { id: 'attention-1', status: 'waiting', question: 'Which color?', options: ['Blue'] },
    reports: [{ id: 'report-1', result: 'Used blue.', evidence: 'Applied the answer.' }] }
  await access.reconcile(engine)
  const page = await access.readEvents()
  assert.deepEqual(page.items.map(item => item.kind), ['state', 'state', 'attention', 'result'])
  assert.deepEqual(page.items.at(-1).data, { id: 'report-1', result: 'Used blue.', evidence: 'Applied the answer.' })
})

test('reconciling supervision replays every historical result and Attention, not only the current ones', async t => {
  const { access } = await fixture(t)
  const reports = [
    { id: 'report-1', result: 'First result.', evidence: 'First evidence.' },
    { id: 'report-2', result: 'Second result.', evidence: 'Second evidence.' },
  ]
  const attentions = [
    { id: 'attention-1', status: 'waiting', question: 'First question?', options: ['Yes'] },
    { id: 'attention-1', status: 'answered', question: 'First question?', options: ['Yes'], answerText: 'Yes', answeredAt: 1 },
  ]
  const engine = { getSupervision: async () => ({ items: [{ ticketId: 'ticket-1', bucket: 'ready', state: 'ready',
    lifecycle: 'open', nextAction: 'Review the result.', reports: [reports[1]], reportHistory: reports,
    attention: attentions[1], attentionHistory: attentions }] }) }
  await access.reconcile(engine)
  await access.reconcile(engine)
  const page = await access.readEvents()
  assert.deepEqual(page.items.map(item => item.kind), ['state', 'attention', 'attention', 'result', 'result'])
  assert.deepEqual(page.items.filter(item => item.kind === 'result').map(item => item.data.id), ['report-1', 'report-2'])
  assert.deepEqual(page.items.filter(item => item.kind === 'attention').map(item => item.data.status), ['waiting', 'answered'])
})
