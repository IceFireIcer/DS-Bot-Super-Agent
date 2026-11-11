import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SqliteStorage } from '../dist/storage.js'
import { Supervisor } from '../dist/supervisor.js'

const base = () => ({
  ticketId: 't1', request: 'Inspect the project.', bucket: 'running', state: 'running', reason: 'worker-running', lifecycle: 'open',
  health: { effectsUnknown: 0, jobsUnknown: 0, attention: 'none', stop: 'none', setup: 'ready' },
  attention: { status: 'none' }, setup: { state: 'ready' },
  assignment: { id: 'a1', generation: 'g1', state: 'running', sessionId: 's1' },
  reports: [{ id: 'r1', result: 'Working.', evidence: 'Read the original request.', toolFacts: [{ tool: 'read_file', outcome: 'success', output: {} }], createdAt: 1_000 }],
  reportHistory: [], messages: [{ id: 'm1', state: 'sent', purpose: 'acknowledgement' }], jobs: [], subagents: [],
})

async function open(t, { assess, maxProposals = 2 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-supervisor-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close().catch(() => {}); await rm(directory, { recursive: true, force: true }) })
  let item = base()
  let paused = false
  let clock = 1_000
  const calls = { directions: [], stops: [], assess: 0, remoteReconcile: [], stopReconcile: [] }
  const engine = {
    async getSupervision() { return { items: [structuredClone(item)], processingPaused: paused } },
    async getTicket() { return { mandate: { id: 'mandate-1', scope: 'Inspect the project.' } } },
    async getTicketDirection() { return { directionVersion: 1 } },
    async correctTicket(command) { calls.directions.push(command); return { id: 'input-1', directionVersion: 2 } },
    async stopTicket(command) { calls.stops.push(command); return { state: 'stopping' } },
    async reconcileRemoteWork(command) { calls.remoteReconcile.push(command); return { state: 'reconciled' } },
    async reconcileStop(command) { calls.stopReconcile.push(command); return { state: 'reconciled-stop' } },
  }
  const supervisor = new Supervisor({
    engine, storage, instanceId: 'private', actorId: 'user', stallMs: 1_000, stallObservations: 3, loopObservations: 3,
    proposalWindowMs: 60_000, maxProposals, version: 't48-test', now: () => clock,
    ...(assess === undefined ? {} : { assess: async (snapshot, signal) => { calls.assess += 1; return assess(snapshot, signal) } }),
  })
  return {
    supervisor, storage, calls, item: () => item, setItem(next) { item = next }, setPaused(value) { paused = value },
    advance(ms = 1_000) { clock += ms },
  }
}

test('normal waiting, unknown, ready and ended are not semantic failures', async t => {
  const app = await open(t, { assess: async () => { throw new Error('the assessor must not be called') } })
  app.setItem({ ...base(), attention: { status: 'waiting' }, bucket: 'needsHuman' })
  assert.equal((await app.supervisor.inspect()).observations[0].finding, 'normal-wait')
  app.setItem({ ...base(), health: { ...base().health, effectsUnknown: 1 }, bucket: 'blocked' })
  assert.equal((await app.supervisor.inspect()).observations[0].finding, 'unknown')
  app.setItem({ ...base(), bucket: 'ready', state: 'ready' })
  assert.equal((await app.supervisor.inspect()).observations[0].finding, 'ready')
  app.setItem({ ...base(), lifecycle: 'ended', state: 'ended' })
  assert.equal((await app.supervisor.inspect()).observations[0].finding, 'ended')
  app.setItem({ ...base(), reason: 'handoff-pending' })
  assert.equal((await app.supervisor.inspect()).observations[0].finding, 'normal-wait')
  assert.equal(app.calls.assess, 0)
  assert.deepEqual(await app.supervisor.listProposals(), [])
})

test('a changing report is progress and creates no proposal', async t => {
  const app = await open(t)
  for (let index = 0; index < 4; index++) {
    app.setItem({ ...base(), reports: [{ ...base().reports[0], id: `r${index + 1}`, createdAt: 1_000 + index * 500 }] })
    app.advance(500)
    assert.equal((await app.supervisor.inspect()).observations[0].finding, 'normal')
  }
  assert.deepEqual(await app.supervisor.listProposals(), [])
})

test('an unchanged Ticket without a new report or delivery becomes a pause proposal', async t => {
  const app = await open(t)
  app.setItem({ ...base(), reports: [{ ...base().reports[0], toolFacts: [] }] })
  await app.supervisor.inspect()
  app.advance(500)
  await app.supervisor.inspect()
  app.advance(500)
  const report = await app.supervisor.inspect()
  const observation = report.observations[0]
  assert.equal(observation.finding, 'no-progress')
  assert.equal(report.proposals.length, 1)
  const proposal = report.proposals[0]
  assert.equal(proposal.kind, 'pause')
  assert.equal(proposal.status, 'proposed')
  assert.equal(proposal.version, 't48-test')
  assert.equal(proposal.impact.stopsNewWork, true)
  assert.equal(proposal.evidence.snapshot.mandateScope, 'Inspect the project.')
  assert.equal(app.calls.stops.length, 0, 'a proposal does not stop anything')
})

test('repeated tool facts become a loop proposal', async t => {
  const app = await open(t)
  await app.supervisor.inspect()
  app.advance(500)
  await app.supervisor.inspect()
  app.advance(500)
  const report = await app.supervisor.inspect()
  assert.equal(report.observations[0].finding, 'loop')
  assert.equal(report.proposals[0].kind, 'pause')
  assert.match(report.proposals[0].recommendation, /repeated/u)
})

test('a semantic deviation is a correct proposal and still executes nothing', async t => {
  const app = await open(t, { assess: async () => ({ kind: 'deviation', reason: 'The report changed a file outside the requested scope.', recommendation: 'Return to the requested file set and verify it.', action: 'correct' }) })
  const report = await app.supervisor.inspect()
  assert.equal(report.observations[0].finding, 'deviation')
  assert.equal(report.proposals[0].kind, 'correct')
  assert.equal(report.proposals[0].impact.wakesWorker, true)
  assert.equal(report.proposals[0].evidence.assessment.reason, 'The report changed a file outside the requested scope.')
  assert.deepEqual(app.calls.directions, [])
  assert.deepEqual(app.calls.stops, [])
})

test('approval of a pause runs the existing stop command once and is idempotent', async t => {
  const app = await open(t)
  await app.supervisor.inspect()
  app.advance(500)
  await app.supervisor.inspect()
  app.advance(500)
  const proposal = (await app.supervisor.inspect()).proposals[0]
  const approved = await app.supervisor.decide({ commandId: 'decision-1', proposalId: proposal.id, decision: 'approve' })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.decision, 'approved')
  assert.equal(approved.action.kind, 'stop')
  assert.equal(app.calls.stops.length, 1)
  assert.equal(app.calls.stops[0].reason, proposal.recommendation)
  const replay = await app.supervisor.decide({ commandId: 'decision-1', proposalId: proposal.id, decision: 'approve' })
  assert.deepEqual(replay, approved)
  await assert.rejects(app.supervisor.decide({ commandId: 'decision-2', proposalId: proposal.id, decision: 'reject' }), { code: 'PROPOSAL_CLOSED' })
})

test('approval of a correction adds an authorized direction input and records it', async t => {
  const app = await open(t, { assess: async () => ({ kind: 'deviation', reason: 'The direction drifted.', recommendation: 'Return to the original request.', action: 'correct' }) })
  const proposal = (await app.supervisor.inspect()).proposals[0]
  const approved = await app.supervisor.decide({ commandId: 'decision-correct', proposalId: proposal.id, decision: 'approve' })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.action.kind, 'direction')
  assert.equal(approved.action.id, 'input-1')
  assert.deepEqual(app.calls.directions, [{ commandId: 'decision-correct:direction', ticketId: 't1', text: 'Return to the original request.', reason: 'The direction drifted.' }])
})

test('rejection executes nothing and keeps the reason', async t => {
  const app = await open(t)
  await app.supervisor.inspect()
  app.advance(500)
  await app.supervisor.inspect()
  app.advance(500)
  const proposal = (await app.supervisor.inspect()).proposals[0]
  const rejected = await app.supervisor.decide({ commandId: 'reject-1', proposalId: proposal.id, decision: 'reject', reason: 'This is expected investigation.' })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.decisionReason, 'This is expected investigation.')
  assert.deepEqual(app.calls.directions, [])
  assert.deepEqual(app.calls.stops, [])
})

test('an open proposal is deduplicated and the proposal budget stops repeated suggestions', async t => {
  const app = await open(t, { maxProposals: 1 })
  await app.supervisor.inspect()
  app.advance(500)
  await app.supervisor.inspect()
  app.advance(500)
  const first = await app.supervisor.inspect()
  assert.equal(first.proposals.length, 1)
  const duplicate = await app.supervisor.inspect()
  assert.equal(duplicate.observations[0].finding, 'duplicate')
  assert.equal((await app.supervisor.listProposals()).length, 1)
  await app.supervisor.decide({ commandId: 'reject-first', proposalId: first.proposals[0].id, decision: 'reject' })
  app.setItem({ ...base(), reports: [{ ...base().reports[0], id: 'r2', result: 'A different report.', createdAt: 2_000 }] })
  for (let index = 0; index < 3; index++) { app.advance(500); await app.supervisor.inspect() }
  const exhausted = await app.supervisor.inspect()
  assert.equal(exhausted.observations[0].finding, 'budget-exhausted')
  assert.equal((await app.supervisor.listProposals()).length, 1)
})

test('a rejected proposal can be proposed again only after the evidence changes', async t => {
  const app = await open(t)
  app.setItem({ ...base(), reports: [{ ...base().reports[0], toolFacts: [] }] })
  await app.supervisor.inspect()
  app.advance(500)
  await app.supervisor.inspect()
  app.advance(500)
  const first = (await app.supervisor.inspect()).proposals[0]
  await app.supervisor.decide({ commandId: 'reject-1', proposalId: first.id, decision: 'reject' })
  const duplicate = await app.supervisor.inspect()
  assert.equal(duplicate.observations[0].finding, 'duplicate')
  app.setItem({ ...base(), reports: [{ ...base().reports[0], id: 'r2', result: 'New evidence.', createdAt: 2_000 }] })
  await app.supervisor.inspect()
  app.advance(1_000)
  await app.supervisor.inspect()
  assert.equal((await app.supervisor.inspect()).proposals.length, 1)
})

test('unknown outcomes are reconciled before any semantic proposal', async t => {
  const app = await open(t)
  app.setItem({ ...base(), health: { ...base().health, effectsUnknown: 1 }, bucket: 'blocked' })
  const report = await app.supervisor.inspect()
  assert.equal(report.observations[0].finding, 'unknown')
  assert.deepEqual(report.proposals, [])
  assert.equal(app.calls.remoteReconcile.length, 1)
  assert.equal(report.observations[0].reconciliation.kind, 'remote-work')
  assert.deepEqual(report.observations[0].reconciliation.result, { state: 'reconciled' })
})

test('a decision command ID cannot be reused for another proposal', async t => {
  const app = await open(t)
  const proposal = (id) => ({
    id, instanceId: 'private', ticketId: 't1', kind: 'pause', status: 'proposed', version: 't48-test', fingerprint: `f-${id}`,
    evidence: { snapshot: {}, assessment: { kind: 'no-progress', reason: 'stalled' }, finding: 'no-progress' },
    recommendation: 'Pause.', impact: { stopsNewWork: true, wakesWorker: false, summary: 'Pause.' }, createdAt: 1,
  })
  await app.storage.transaction('private', async transaction => {
    for (const id of ['p1', 'p2']) await transaction.insert('supervisor-proposal', JSON.stringify(['supervisor-proposal', id]), proposal(id))
  })
  await app.supervisor.decide({ commandId: 'shared-decision', proposalId: 'p1', decision: 'reject' })
  await assert.rejects(app.supervisor.decide({ commandId: 'shared-decision', proposalId: 'p2', decision: 'reject' }), { code: 'IDENTITY_CONFLICT' })
})

test('concurrent decisions claim the proposal once and execute one action', async t => {
  const app = await open(t)
  const proposal = {
    id: 'race', instanceId: 'private', ticketId: 't1', kind: 'pause', status: 'proposed', version: 't48-test', fingerprint: 'race',
    evidence: { snapshot: {}, assessment: { kind: 'no-progress', reason: 'stalled' }, finding: 'no-progress' },
    recommendation: 'Pause.', impact: { stopsNewWork: true, wakesWorker: false, summary: 'Pause.' }, createdAt: 1,
  }
  await app.storage.transaction('private', transaction => transaction.insert('supervisor-proposal', JSON.stringify(['supervisor-proposal', 'race']), proposal))
  const results = await Promise.allSettled([
    app.supervisor.decide({ commandId: 'race-a', proposalId: 'race', decision: 'approve' }),
    app.supervisor.decide({ commandId: 'race-b', proposalId: 'race', decision: 'approve' }),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'PROPOSAL_CLOSED')
  assert.equal(app.calls.stops.length, 1)
})

test('proposal queries do not lose records after the first hundred', async t => {
  const app = await open(t)
  const proposal = (id) => ({
    id, instanceId: 'private', ticketId: 't1', kind: 'pause', status: 'proposed', version: 't48-test', fingerprint: `f-${id}`,
    evidence: { snapshot: {}, assessment: { kind: 'no-progress', reason: 'stalled' }, finding: 'no-progress' },
    recommendation: 'Pause.', impact: { stopsNewWork: true, wakesWorker: false, summary: 'Pause.' }, createdAt: 1,
  })
  await app.storage.transaction('private', async transaction => {
    for (let index = 0; index < 105; index++) await transaction.insert('supervisor-proposal', JSON.stringify(['supervisor-proposal', `p${index}`]), proposal(`p${index}`))
  })
  assert.equal((await app.supervisor.listProposals()).length, 105)
  assert.equal((await app.supervisor.getProposal('p104')).id, 'p104')
})
