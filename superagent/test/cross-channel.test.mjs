import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Engine, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'
import { completedToolCount, lastUserText } from './input-support.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-cross-channel-'))
  let storage, native, sessions, desktop, github
  const deliveries = []
  const turns = []
  t.after(async () => {
    const errors = []
    for (const dispose of [() => desktop?.effects.stop(), () => github?.effects.stop(), () => desktop?.shutdown(), () => github?.shutdown(),
      () => sessions?.close(), () => native?.fiber.dispose(), () => storage?.close(), async () => {
        assert.ok(directory.startsWith(join(tmpdir(), 'ds-superagent-cross-channel-')))
        await rm(directory, { recursive: true, force: true })
      }]) {
      try { await dispose() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Cross-source fixture cleanup failed.')
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  native = await nativeContext(join(directory, 'sessions'), function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const text = lastUserText(options)
    const completed = completedToolCount(options)
    if (!completed) turns.push(text)
    if (text.includes('Return this unrelated input.') && !completed) {
      yield* toolResponse('handback_input', { reason: 'This input is unrelated to the authorized work.' })
    } else if (text.includes('Ask for confirmation.') && !completed) {
      yield* toolResponse('ask_human', { question: 'Approve this PR correction?', options: 'Yes\nNo' })
    } else if ((text.includes('Use revision B.') || text === 'Approve revision B.') && !completed) {
      yield* toolResponse('report_ready', { result: 'Revision B prepared.', evidence: 'Used the authorized PR correction in the retained Session.' })
    } else yield* textResponse('Revision A is a draft; waiting for a human correction.')
  })
  sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  desktop = new Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'desktop-owner', allowedActorIds: ['desktop-owner'] },
    {}, sessions, [], {}, {}, {}, { channel: { deliver: async delivery => { deliveries.push(structuredClone(delivery)); return { type: 'success' } } } })
  github = new Engine(storage, 'private', { kind: 'github', sourceInstanceId: 'github:acme/repo', actorId: 'github-receiver',
    allowedActorIds: ['github-receiver'], allowedThreadIds: ['github:acme/repo#12'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [], rules: [] } })
  const receive = (text, overrides = {}) => github.receiveSource({ commandId: 'receive-pr', threadId: 'github:acme/repo#12', objectId: 'pr:12:comment:41',
    type: 'created', version: '1', text, authorId: 'alice', authorKind: 'human', addressing: 'direct', ...overrides })
  const drain = async () => { for (let index = 0; index < 8; index++) await desktop.effects.drain() }
  return { desktop, github, storage, receive, drain, deliveries, turns }
}

test('an owner-authorized native PR reference continues the original Ticket and Session from A to B and explicitly retargets only its result', { timeout: 20000 }, async t => {
  const { desktop, github, receive, drain, deliveries, turns } = await fixture(t)
  const accepted = await desktop.submit({ commandId: 'A', eventId: 'desktop-message', text: 'Prepare revision A within the supplied project.' })
  await drain()
  const before = await desktop.conversation(accepted.ticketId)
  const original = await desktop.getTicket(accepted.ticketId)
  const reference = await desktop.getTicketReference(accepted.ticketId)
  const text = `${reference}\nUse revision B.`
  const event = await receive(text)
  assert.equal(event.status, 'recorded')
  await drain()
  assert.equal((await desktop.getTicketDirection(accepted.ticketId)).directionVersion, 1, 'Reception alone must not change direction or destination.')
  assert.equal(await desktop.getDeliveryTarget(accepted.ticketId, 'result'), undefined)
  const command = { commandId: 'associate-pr', ticketId: accepted.ticketId, eventId: event.eventId, reference,
    reason: 'The desktop owner explicitly approved this native PR correction.', retargetResult: true }
  const associated = await desktop.associateSourceEvent(command, github)
  assert.equal(associated.input.directionVersion, 2)
  assert.equal(associated.input.association.source.sourceInstanceId, 'github:acme/repo')
  assert.equal(associated.input.association.sourceActorId, 'alice')
  assert.equal(associated.input.association.authorizedBy, 'desktop-owner')
  assert.equal(associated.input.association.reference, reference)
  assert.deepEqual(await desktop.associateSourceEvent(command, github), associated)
  await drain()
  const after = await desktop.conversation(accepted.ticketId)
  assert.equal(after.status, 'ready')
  assert.equal(after.assignments[0].id, before.assignments[0].id)
  assert.equal(after.assignments[0].sessionId, before.assignments[0].sessionId)
  assert.deepEqual((await desktop.getTicket(accepted.ticketId)).mandate, original.mandate)
  assert.deepEqual(turns, ['Prepare revision A within the supplied project.', text])
  assert.equal((await desktop.listTickets()).items.length, 1)
  assert.deepEqual(deliveries.map(item => [item.purpose, item.destination.sourceInstanceId]), [['acknowledgement', 'desktop'], ['result', 'github:acme/repo']])
  assert.equal(deliveries[1].text.includes('Revision B prepared.'), true)
  assert.equal(deliveries[1].text.includes('Prepare revision A within the supplied project.'), false, 'Retargeting must not copy private conversation history.')
  const direction = await desktop.getTicketDirection(accepted.ticketId)
  assert.equal(direction.inputs.length, 1)
  assert.equal(direction.inputs[0].state, 'delivered')
  assert.equal(direction.directionVersion, 2)
  await assert.rejects(desktop.associateSourceEvent({ ...command, reason: 'Different command payload.' }, github), { code: 'IDENTITY_CONFLICT' })
})

test('wrong, ambiguous, stale, robotic and unauthorized references cannot attach, retarget or confer private reads', { timeout: 20000 }, async t => {
  const { desktop, github, storage, receive } = await fixture(t)
  const first = await desktop.submit({ commandId: 'first', eventId: 'first', text: 'Private revision A.' })
  const second = await desktop.submit({ commandId: 'second', eventId: 'second', text: 'Unrelated private task.' })
  const reference = await desktop.getTicketReference(first.ticketId)
  const other = await desktop.getTicketReference(second.ticketId)
  const associate = (eventId, suffix = 'x', source = github) => desktop.associateSourceEvent({ commandId: `attach-${suffix}`, ticketId: first.ticketId,
    eventId, reference, reason: 'Explicit owner association.', retargetResult: true }, source)
  for (const [name, text, overrides, code] of [
    ['similar', 'Private revision A. Use revision B.', {}, 'ASSOCIATION_REFERENCE_INVALID'],
    ['wrong', `${other} Use revision B.`, {}, 'ASSOCIATION_REFERENCE_INVALID'],
    ['ambiguous', `${reference} ${other} Use revision B.`, {}, 'ASSOCIATION_REFERENCE_INVALID'],
    ['actor', `${reference} Use revision B.`, { authorId: 'intruder' }, 'ACTOR_NOT_ALLOWED'],
    ['bot', `${reference} Use revision B.`, { authorKind: 'bot' }, 'ACTOR_NOT_ALLOWED'],
    ['ambient', `${reference} Use revision B.`, { addressing: 'ambient' }, 'ACTOR_NOT_ALLOWED'],
  ]) {
    const event = await receive(text, { commandId: name, objectId: `pr:12:comment:${name}`, ...overrides })
    await assert.rejects(associate(event.eventId, name), { code })
  }
  const stale = await receive(`${reference} Use revision B.`, { commandId: 'stale', objectId: 'pr:12:comment:stale' })
  await receive('The reference was withdrawn.', { commandId: 'new-version', objectId: 'pr:12:comment:stale', type: 'edited', version: '2' })
  await assert.rejects(associate(stale.eventId, 'stale'), { code: 'SOURCE_NOT_CURRENT' })
  const conflicted = await receive(`${reference} Use revision B.`, { commandId: 'conflict-first', objectId: 'pr:12:comment:conflict' })
  await receive('Same native version with a different body.', { commandId: 'conflict-second', objectId: 'pr:12:comment:conflict' })
  await assert.rejects(associate(conflicted.eventId, 'conflict'), { code: 'SOURCE_NOT_CURRENT' })
  const deleted = await receive(`${reference} Use revision B.`, { commandId: 'deleted-first', objectId: 'pr:12:comment:deleted' })
  await github.receiveSource({ commandId: 'deleted-second', threadId: 'github:acme/repo#12', objectId: 'pr:12:comment:deleted',
    type: 'deleted', version: '2', deletionEvidence: 'Native deletion was verified by the source.', authorId: 'alice', authorKind: 'human', addressing: 'direct' })
  await assert.rejects(associate(deleted.eventId, 'deleted'), { code: 'SOURCE_NOT_CURRENT' })
  const current = await receive(`${reference} Use revision B.`, { commandId: 'current', objectId: 'pr:12:comment:current' })
  const foreign = new Engine(storage, 'different-instance', { kind: 'github', sourceInstanceId: 'github:acme/repo', actorId: 'github-receiver', allowedActorIds: ['github-receiver'] })
  t.after(async () => {
    const errors = []
    for (const dispose of [() => foreign.effects.stop(), () => foreign.shutdown()]) {
      try { await dispose() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Foreign Engine cleanup failed.')
  })
  await assert.rejects(associate(current.eventId, 'foreign', foreign), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(github.associateSourceEvent({ commandId: 'self-grant', ticketId: first.ticketId, eventId: current.eventId,
    reference, reason: 'An untrusted source cannot grant itself access.' }, github), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(github.readContext({ ticketId: first.ticketId, ref: { kind: 'trigger', ticketId: first.ticketId } }), { code: 'SOURCE_NOT_AUTHORIZED' })
  await assert.rejects(github.findContextCandidates(first.ticketId, 'Private revision'), { code: 'SOURCE_NOT_AUTHORIZED' })
  for (const read of [() => github.getTicket(first.ticketId), () => github.getTicketDirection(first.ticketId),
    () => github.getTicketDeliveries(first.ticketId), () => github.getDeliveryTarget(first.ticketId, 'result'),
    () => github.getDeliveryConditions(first.ticketId), () => github.getTicketAttention(first.ticketId)]) {
    await assert.rejects(read(), { code: 'SOURCE_NOT_AUTHORIZED' })
  }
  await assert.rejects(desktop.readContext({ ticketId: second.ticketId, ref: { kind: 'source-event', ticketId: second.ticketId, id: current.eventId } }), { code: 'SOURCE_NOT_AUTHORIZED' })
  assert.equal((await desktop.getTicketDirection(first.ticketId)).directionVersion, 1)
  assert.deepEqual((await desktop.getTicketDirection(first.ticketId)).inputs, [])
  assert.equal(await desktop.getDeliveryTarget(first.ticketId, 'result'), undefined)
})

test('cross-source questions return to their own native message without automatically retargeting the result or bypassing human stop', { timeout: 20000 }, async t => {
  const { desktop, github, receive, drain, deliveries } = await fixture(t)
  const accepted = await desktop.submit({ commandId: 'draft', eventId: 'draft', text: 'Private revision A.' })
  await drain()
  const reference = await desktop.getTicketReference(accepted.ticketId)
  const event = await receive(`${reference}\nAsk for confirmation.`)
  await desktop.associateSourceEvent({ commandId: 'question-association', ticketId: accepted.ticketId, eventId: event.eventId, reference,
    reason: 'The owner approved this exact PR question.' }, github)
  await drain()
  const waiting = await desktop.conversation(accepted.ticketId)
  assert.equal(waiting.status, 'waiting-human')
  assert.deepEqual(waiting.attention.destination, { sourceInstanceId: 'github:acme/repo', actorId: 'alice', eventId: 'pr:12:comment:41', threadId: 'github:acme/repo#12' })
  assert.equal(await desktop.getDeliveryTarget(accepted.ticketId, 'result'), undefined)
  assert.deepEqual(deliveries.map(item => [item.purpose, item.destination.sourceInstanceId]), [['acknowledgement', 'desktop'], ['attention', 'github:acme/repo']])
  const next = await receive(`${reference}\nUse revision B.`, { commandId: 'another', objectId: 'pr:12:comment:42' })
  const command = { commandId: 'blocked', ticketId: accepted.ticketId, eventId: next.eventId, reference, reason: 'A new direction cannot bypass a human wait.', retargetResult: true }
  await assert.rejects(desktop.associateSourceEvent(command, github), { code: 'TICKET_BLOCKED' })
  await desktop.answerAttention({ commandId: 'desktop-owner-answer', attentionId: waiting.attention.id, text: 'Approve revision B.' })
  await drain()
  const answered = await desktop.conversation(accepted.ticketId)
  assert.equal(answered.status, 'ready')
  assert.equal(answered.attention.answeredBy, 'desktop-owner', 'The original owner answers as itself, not as the GitHub user alice.')
  assert.equal(answered.assignments[0].sessionId, waiting.assignments[0].sessionId)
  await desktop.stopTicket({ commandId: 'stop', ticketId: accepted.ticketId, reason: 'Explicit human stop.' })
  await assert.rejects(desktop.associateSourceEvent({ ...command, commandId: 'blocked-after-stop' }, github), { code: 'TICKET_BLOCKED' })
  assert.equal((await desktop.getTicketDirection(accepted.ticketId)).directionVersion, 3)
  assert.equal(await desktop.getDeliveryTarget(accepted.ticketId, 'result'), undefined)
})

test('a native answer to a cross-source Attention rechecks source, recipient and current evidence before resuming the same Session', { timeout: 20000 }, async t => {
  const { desktop, github, receive, drain } = await fixture(t)
  const accepted = await desktop.submit({ commandId: 'native-question', eventId: 'native-question', text: 'Private revision A.' })
  await drain()
  const reference = await desktop.getTicketReference(accepted.ticketId)
  const question = await receive(`${reference}\nAsk for confirmation.`)
  await desktop.associateSourceEvent({ commandId: 'native-link', ticketId: accepted.ticketId, eventId: question.eventId, reference,
    reason: 'Owner-authorized native question.' }, github)
  await drain()
  const waiting = await desktop.conversation(accepted.ticketId)
  const wrong = await receive('Approve revision B.', { commandId: 'wrong-answer', objectId: 'pr:12:comment:wrong-answer', authorId: 'intruder' })
  await assert.rejects(desktop.answerAttention({ commandId: 'reject-answer', attentionId: waiting.attention.id, text: 'Ignored transport summary.', sourceEventId: wrong.eventId }, github), { code: 'ACTOR_NOT_ALLOWED' })
  const reply = await receive('Approve revision B.', { commandId: 'answer', objectId: 'pr:12:comment:answer' })
  await desktop.answerAttention({ commandId: 'native-answer', attentionId: waiting.attention.id, text: 'This transport summary must not replace the native answer.', sourceEventId: reply.eventId }, github)
  await drain()
  const after = await desktop.conversation(accepted.ticketId)
  assert.equal(after.attention.answeredBy, 'alice')
  assert.equal(after.attention.answerText, 'Approve revision B.')
  assert.equal(after.assignments[0].sessionId, waiting.assignments[0].sessionId)
  assert.equal(after.status, 'ready')
})

test('a handed-back cross-source input cannot be associated or retargeted by a new command while the original receipt remains replayable', { timeout: 20000 }, async t => {
  const { desktop, github, receive, drain, turns } = await fixture(t)
  const accepted = await desktop.submit({ commandId: 'handback-start', eventId: 'handback-start', text: 'Private revision A.' })
  await drain()
  const reference = await desktop.getTicketReference(accepted.ticketId)
  const event = await receive(`${reference}\nReturn this unrelated input.`)
  const command = { commandId: 'initial-association', ticketId: accepted.ticketId, eventId: event.eventId, reference, reason: 'Owner-approved input for Worker inspection.' }
  const original = await desktop.associateSourceEvent(command, github)
  await drain()
  const before = await desktop.getTicketDirection(accepted.ticketId)
  assert.equal(before.ownerships.find(item => item.sourceEventId === event.eventId).state, 'handed-back')
  const turnsBeforeReplay = turns.length
  assert.deepEqual(await desktop.associateSourceEvent(command, github), original)
  await assert.rejects(desktop.associateSourceEvent({ ...command, commandId: 'new-association-after-handback', retargetResult: true }, github), { code: 'OWNERSHIP_INACTIVE' })
  await drain()
  assert.equal(await desktop.getDeliveryTarget(accepted.ticketId, 'result'), undefined)
  const after = await desktop.getTicketDirection(accepted.ticketId)
  assert.equal(after.ownerships.find(item => item.sourceEventId === event.eventId).state, 'handed-back')
  assert.equal(after.directionVersion, before.directionVersion)
  assert.deepEqual(after.inputs, before.inputs)
  assert.equal(turns.length, turnsBeforeReplay)
})

test('an observed update without a native version invalidates only its source projection without fabricating content or permitting stale association', { timeout: 20000 }, async t => {
  const { desktop, github, receive } = await fixture(t)
  const accepted = await desktop.submit({ commandId: 'unknown-version-start', eventId: 'unknown-version-start', text: 'Private revision A.' })
  const reference = await desktop.getTicketReference(accepted.ticketId)
  const ref = { threadId: 'github:acme/repo#12', objectId: 'pr:12:comment:41' }
  const event = await receive(`${reference}\nUse revision B.`)
  const history = await github.getSourceHistory(ref)
  assert.equal((await github.getSourceCandidate(ref)).id, event.eventId)
  const command = { commandId: 'native-version-unknown', ...ref, type: 'edited', version: 'unverified:observation-1',
    text: 'Unverified new content.', authorId: 'alice', authorKind: 'human', addressing: 'direct' }
  const receipt = await github.receiveUnverifiedSource(command)
  assert.equal(receipt.status, 'recorded')
  assert.notEqual(receipt.eventId, event.eventId)
  assert.deepEqual(await github.receiveUnverifiedSource(command), receipt)
  const projection = await github.getSourceObject(ref)
  assert.equal(projection.state, 'unknown')
  assert.equal(projection.text, undefined)
  assert.equal(projection.eventId, receipt.eventId)
  assert.equal(await github.getSourceCandidate(ref), undefined)
  const updatedHistory = await github.getSourceHistory(ref)
  assert.equal(updatedHistory.items.length, history.items.length + 1)
  assert.ok(updatedHistory.items.some(item => item.id === event.eventId))
  const observation = updatedHistory.items.find(item => item.id === receipt.eventId)
  assert.equal(observation.text, 'Unverified new content.')
  assert.equal(observation.version.order, 'opaque')
  assert.equal(observation.versionVerified, false)
  await assert.rejects(desktop.associateSourceEvent({ commandId: 'no-stale-association', ticketId: accepted.ticketId, eventId: event.eventId,
    reference, reason: 'An unverified update must block stale evidence.', retargetResult: true }, github), { code: 'SOURCE_NOT_CURRENT' })
  await assert.rejects(github.receiveUnverifiedSource({ ...command, text: 'Different content under the same command.' }), { code: 'IDENTITY_CONFLICT' })
  const denied = await github.receiveUnverifiedSource({ ...command, commandId: 'outside-scope', threadId: 'github:acme/other#12' })
  assert.deepEqual(denied, { status: 'filtered', reason: 'SOURCE_SCOPE_DENIED' })
  assert.equal((await github.getSourceHistory(ref)).items.length, updatedHistory.items.length)
  assert.equal((await desktop.getTicketDirection(accepted.ticketId)).directionVersion, 1)
  assert.equal(await desktop.getDeliveryTarget(accepted.ticketId, 'result'), undefined)
})

test('another actor in the same source instance cannot read a Ticket by guessing its ID', async t => {
  const { desktop, storage, drain } = await fixture(t)
  const receipt = await desktop.submit({ commandId: 'private-ticket', eventId: 'private-message', text: 'Keep this work private.' })
  await drain()
  const intruder = new Engine(storage, 'private', {
    sourceInstanceId: 'desktop', actorId: 'intruder', allowedActorIds: ['desktop-owner', 'intruder'],
  })
  t.after(async () => { await intruder.effects.stop(); await intruder.shutdown() })
  assert.equal((await desktop.getTicket(receipt.ticketId)).ticket.id, receipt.ticketId)
  await assert.rejects(intruder.getTicket(receipt.ticketId), { code: 'SOURCE_NOT_AUTHORIZED' })
  assert.deepEqual(await intruder.listTickets(), { items: [], hasMore: false })
})
