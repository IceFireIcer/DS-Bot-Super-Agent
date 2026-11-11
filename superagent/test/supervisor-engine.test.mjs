import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

test('the public Engine exposes the semantic Supervisor without executing on inspection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-supervisor-engine-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close().catch(() => {}); await rm(directory, { recursive: true, force: true }) })
  const engine = new Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const receipt = await engine.submit({ commandId: 't48-request', eventId: 't48-event', text: 'Inspect the project.' })
  const supervisor = engine.createSupervisor({ stallMs: 1_000, stallObservations: 3, version: 't48-engine' })
  const report = await supervisor.inspect()
  assert.equal(report.version, 't48-engine')
  assert.equal(report.observations[0].ticketId, receipt.ticketId)
  assert.equal(report.observations[0].finding, 'normal-wait')
  assert.deepEqual(report.proposals, [])
  assert.deepEqual(await engine.getSupervisorProposals(), [])
  const state = await engine.getSupervisorState(receipt.ticketId)
  assert.equal(state.last.finding, 'normal-wait')
})

test('an approved correction becomes a real direction input and the proposal is visible before the decision', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-supervisor-correct-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close().catch(() => {}); await rm(directory, { recursive: true, force: true }) })
  const engine = new Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] })
  const receipt = await engine.submit({ commandId: 't48-correct', eventId: 't48-correct-event', text: 'Inspect the requested file set.' })
  await storage.transaction('private', async transaction => {
    const intent = await transaction.get('intent', receipt.ticketId)
    await transaction.insert('assignment', receipt.ticketId, {
      id: 'assignment-1', generation: 'generation-1', ticketId: receipt.ticketId, sessionId: 'session-1',
      state: 'running', createdAt: Date.now(), runtimeToken: 'runtime-1',
    })
    if (intent !== undefined) await transaction.replace('intent', receipt.ticketId, { ...intent, state: 'running', reason: 'worker-running' })
  })
  const supervisor = engine.createSupervisor({
    assess: async () => ({ kind: 'deviation', reason: 'The report drifted from the requested file set.', recommendation: 'Return to the requested file set.', action: 'correct' }),
    version: 't48-engine',
  })
  const report = await supervisor.inspect()
  const proposal = report.proposals[0]
  assert.equal(proposal.kind, 'correct')
  const supervision = await engine.getSupervision()
  assert.equal(supervision.items[0].supervisorProposals[0].id, proposal.id)
  const approved = await supervisor.decide({ commandId: 'approve-correct', proposalId: proposal.id, decision: 'approve' })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.action.kind, 'direction')
  assert.equal(approved.action.status, 'done')
  const direction = await engine.getTicketDirection(receipt.ticketId)
  assert.ok(direction.inputs.some(input => input.text === 'Return to the requested file set.'))
  assert.equal((await engine.getSupervisorProposals(receipt.ticketId))[0].status, 'approved')
})
