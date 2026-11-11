import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'
import { completedToolCount, lastUserText } from './input-support.mjs'

const delivery = { id: 'result-1', instanceId: 'private', ticketId: 'ticket-1', purpose: 'result', text: 'Revision B verified.',
  destination: { sourceInstanceId: 'github:acme/repo', actorId: 'alice', eventId: 'pr:12:comment:41', threadId: 'github:acme/repo#12' },
  basis: { kind: 'ready-report', reportId: 'report-1', directionVersion: 2 }, state: 'pending', effectId: 'effect-1', effectGeneration: 'generation-1', sequence: 1, createdAt: 1 }
const context = { idempotencyKey: 'effect-1:generation-1', signal: new AbortController().signal }

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-github-delivery-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const cleanups = []
  t.after(async () => {
    const errors = []
    for (const dispose of [...cleanups, () => storage.close(), async () => {
      assert.ok(directory.startsWith(join(tmpdir(), 'ds-superagent-github-delivery-')))
      await rm(directory, { recursive: true, force: true })
    }]) { try { await dispose() } catch (error) { errors.push(error) } }
    if (errors.length) throw new AggregateError(errors, 'GitHub delivery fixture cleanup failed.')
  })
  const comments = []
  const posts = []
  let lost = options.lost
  const transport = {
    getActor: async () => 'agent',
    getTarget: async request => {
      assert.equal(request.objectId, 'pr:12:comment:41')
      return { number: 12, url: 'https://github.com/acme/repo/pull/12#issuecomment-41' }
    },
    listComments: async () => ({ items: comments, hasMore: false }),
    createComment: async request => {
      posts.push(request)
      const reply = { id: '9001', url: 'https://github.com/acme/repo/issues/12#issuecomment-9001', body: request.body, authorId: 'agent' }
      comments.push(reply)
      if (lost) { lost = false; throw new Error('Response lost after GitHub accepted the comment.') }
      return reply
    },
  }
  const channelOptions = { storage, instanceId: 'private', sources: [{ sourceInstanceId: 'github:acme/repo', owner: 'acme', repo: 'repo', host: 'github.com', actorId: 'agent' }] }
  return { channel: new core.GitHubDeliveryChannel(transport, channelOptions), transport, channelOptions, comments, posts, storage, directory, cleanups }
}

test('GitHub outbound persists a native receipt and replays by its original marker without another POST', async t => {
  const { channel, transport, channelOptions, posts } = await fixture(t)
  assert.deepEqual(await channel.deliver(delivery, context), { type: 'success' })
  assert.equal(posts.length, 1)
  assert.match(posts[0].body, /Revision B verified\./u)
  assert.match(posts[0].body, /<!-- ds-superagent:[a-f0-9]{64} -->/u)
  assert.equal(posts[0].number, 12)
  const receipt = await channel.getReceipt(context.idempotencyKey)
  assert.equal(receipt.messageId, '9001')
  assert.equal(receipt.url, 'https://github.com/acme/repo/issues/12#issuecomment-9001')
  assert.equal(receipt.sourceInstanceId, 'github:acme/repo')
  const restarted = new core.GitHubDeliveryChannel(transport, channelOptions)
  assert.deepEqual(await restarted.deliver(delivery, context), { type: 'success' })
  assert.equal(posts.length, 1)
  assert.deepEqual(await restarted.getReceipt(context.idempotencyKey), receipt)
  const collision = await restarted.deliver({ ...delivery, text: 'Different private content.' }, context)
  assert.equal(collision.type, 'permanent')
  assert.match(collision.reason, /IDENTITY_CONFLICT/u)
  assert.equal(posts.length, 1)
})

test('GitHub reconciles an accepted-but-lost POST by authenticated author, marker and exact body', async t => {
  const { channel, transport, channelOptions, posts } = await fixture(t, { lost: true })
  assert.equal((await channel.deliver(delivery, context)).type, 'unknown')
  assert.equal(await channel.getReceipt(context.idempotencyKey), undefined)
  const restarted = new core.GitHubDeliveryChannel(transport, channelOptions)
  assert.deepEqual(await restarted.reconcile(delivery, context), { type: 'success' })
  assert.equal(posts.length, 1)
  assert.equal((await restarted.getReceipt(context.idempotencyKey)).messageId, '9001')
})

test('GitHub unknown reconciliation never reposts, trusts a foreign marker, changes a destination or silently truncates', async t => {
  const { channel, transport, posts } = await fixture(t)
  const missing = await channel.reconcile(delivery, context)
  assert.equal(missing.type, 'unknown')
  assert.equal(posts.length, 0)
  transport.listComments = async () => ({ items: [], hasMore: true })
  assert.equal((await channel.deliver(delivery, context)).type, 'unknown')
  assert.equal(posts.length, 0)
  assert.equal((await channel.deliver({ ...delivery, destination: { ...delivery.destination, sourceInstanceId: 'github:acme/private' } }, context)).type, 'permanent')
  assert.equal((await channel.deliver({ ...delivery, destination: { ...delivery.destination, threadId: 'github:acme/repo#99' } }, context)).type, 'permanent')
  assert.equal((await channel.deliver({ ...delivery, text: 'x'.repeat(70000) }, context)).type, 'permanent')
  assert.equal(posts.length, 0)
})

test('GitHub refuses forged receipts and mismatched posting actors before any outbound write', async t => {
  const { channel, transport, comments, posts } = await fixture(t, { lost: true })
  assert.equal((await channel.deliver(delivery, context)).type, 'unknown')
  comments[0].authorId = 'intruder'
  assert.equal((await channel.reconcile(delivery, context)).type, 'unknown')
  assert.equal(await channel.getReceipt(context.idempotencyKey), undefined)
  assert.equal(posts.length, 1)
  transport.getActor = async () => 'other-account'
  const mismatch = await channel.deliver({ ...delivery, id: 'another-result' }, { ...context, idempotencyKey: 'another-effect' })
  assert.equal(mismatch.type, 'permanent')
  assert.match(mismatch.reason, /GITHUB_ACTOR_MISMATCH/u)
  assert.equal(posts.length, 1)
})

test('GitHub transport resolves exact native targets and uses the public API with structured POST data', async () => {
  const calls = []
  const transport = new core.GitHubCliReplyTransport({ runner: async (path, request) => {
    calls.push({ path, request })
    if (path === 'repos/acme/repo/issues/comments/41') return { id: 41, issue_url: 'https://api.github.com/repos/acme/repo/issues/12', html_url: 'https://github.com/acme/repo/pull/12#issuecomment-41' }
    if (path.includes('/comments?')) return []
    if (request?.method === 'POST') return { id: 9001, html_url: 'https://github.com/acme/repo/issues/12#issuecomment-9001', body: request.body.body, user: { login: 'agent' } }
    throw new Error(`Unexpected request ${path}`)
  } })
  const target = await transport.getTarget({ owner: 'acme', repo: 'repo', host: 'github.com', objectId: 'pr:12:comment:41', signal: context.signal })
  assert.equal(target.number, 12)
  const body = 'Original text\n\n<!-- ds-superagent:marker -->'
  const result = await transport.createComment({ owner: 'acme', repo: 'repo', host: 'github.com', number: 12, body, signal: context.signal })
  assert.equal(result.id, '9001')
  assert.equal(result.authorId, 'agent')
  assert.equal(calls[1].path, 'repos/acme/repo/issues/12/comments')
  assert.deepEqual(calls[1].request.body, { body })
  assert.equal(calls[1].request.method, 'POST')
  await assert.rejects(transport.getTarget({ owner: 'acme', repo: 'other', host: 'github.com', objectId: 'pr:12:comment:41', signal: context.signal }), /Unexpected request/u)
})

test('GitHub permanent target failure produces no receipt or POST and does not fall back to another discussion', async t => {
  const { channel, transport, posts } = await fixture(t)
  transport.getTarget = async () => { throw new core.CoreError('GITHUB_HTTP_404', 'Native object was removed.') }
  assert.deepEqual(await channel.deliver(delivery, context), { type: 'permanent', reason: 'GITHUB_HTTP_404' })
  assert.equal(posts.length, 0)
  assert.equal(await channel.getReceipt(context.idempotencyKey), undefined)
})

test('a retargeted Engine result reconciles its actual outbound view and original Effect key without another POST', { timeout: 20000 }, async t => {
  const { channel, transport, channelOptions, posts, storage, directory, cleanups } = await fixture(t)
  let native, sessions, owner, receiver
  cleanups.push(async () => {
    const errors = []
    for (const dispose of [() => owner?.effects.stop(), () => receiver?.effects.stop(), () => owner?.shutdown(), () => receiver?.shutdown(),
      () => sessions?.close(), () => native?.fiber.dispose()]) {
      try { await dispose() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Outbound integration cleanup failed.')
  })
  native = await nativeContext(join(directory, 'sessions'), function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    if (lastUserText(options).includes('Use revision B.') && !completedToolCount(options)) {
      yield* toolResponse('report_ready', { result: 'Revision B verified.', evidence: 'The native Session used the verified PR correction.' })
    } else yield* textResponse('Revision A remains a draft.')
  })
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  let outbound
  const composed = { deliver: async (item, receipt) => {
    if (item.destination.sourceInstanceId === 'desktop') return { type: 'success' }
    outbound = { delivery: structuredClone(item), idempotencyKey: receipt.idempotencyKey }
    return channel.deliver(item, receipt)
  } }
  owner = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'owner', allowedActorIds: ['owner'] }, {}, sessions, [], {}, {}, {}, { channel: composed })
  receiver = new core.Engine(storage, 'private', { kind: 'github', sourceInstanceId: 'github:acme/repo', actorId: 'receiver', allowedActorIds: ['receiver'],
    allowedThreadIds: ['github:acme/repo#12'], versionOrder: 'sequence', intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1,
      timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [], rules: [] } })
  const accepted = await owner.submit({ commandId: 'start', eventId: 'start', text: 'Prepare revision A.' })
  for (let index = 0; index < 8; index++) await owner.effects.drain()
  const reference = await owner.getTicketReference(accepted.ticketId)
  const received = await receiver.receiveSource({ commandId: 'native-correction', threadId: 'github:acme/repo#12', objectId: 'pr:12:comment:41',
    type: 'created', version: '1', text: `${reference}\nUse revision B.`, authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await owner.associateSourceEvent({ commandId: 'associate', ticketId: accepted.ticketId, eventId: received.eventId, reference,
    reason: 'Owner approved this native correction and destination.', retargetResult: true }, receiver)
  for (let index = 0; index < 12; index++) await owner.effects.drain()
  const history = await owner.getTicketDeliveries(accepted.ticketId)
  const originalView = history.find(item => item.purpose === 'result')
  assert.equal(originalView.destination.sourceInstanceId, 'desktop', 'The immutable pre-redirect history is still first; it is not the actual GitHub send.')
  assert.deepEqual(await channel.reconcile(originalView, { idempotencyKey: outbound.idempotencyKey, signal: new AbortController().signal }),
    { type: 'permanent', reason: 'DESTINATION_DENIED: no grant for this Instance and GitHub source.' })
  const result = (await owner.conversation(accepted.ticketId)).messages.find(item => item.purpose === 'result')
  assert.equal(result.destination.sourceInstanceId, 'github:acme/repo')
  assert.deepEqual(result.destination, outbound.delivery.destination)
  assert.equal(result.text, outbound.delivery.text)
  const idempotencyKey = JSON.stringify([result.effectId, result.effectGeneration])
  assert.equal(idempotencyKey, outbound.idempotencyKey)
  assert.equal((await channel.getReceipt(idempotencyKey)).messageId, '9001')
  const restarted = new core.GitHubDeliveryChannel(transport, channelOptions)
  assert.deepEqual(await restarted.reconcile(result, { idempotencyKey, signal: new AbortController().signal }), { type: 'success' })
  assert.equal(posts.length, 1)
})
