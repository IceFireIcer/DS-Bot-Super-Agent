import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { Engine, MemoryRepositories, followupOwners } from '../dsh-superagent-prototype/src/core/index.ts'

// Exploration of the reference Engine only: policy and execution ports are deliberately fake.
const at = '2026-11-02T00:00:00.000Z'
function fixture() {
  const repo = new MemoryRepositories()
  const candidates: any[] = [], launches: any[] = [], replies = new Map<string, any>()
  const policy = {
    version: 'audit-v1', paused: false, evalTimeoutMs: 60000,
    gate: (trigger: any) => trigger.human && trigger.actor.id === 'owner'
      ? { admissible: true, strength: 'explicit', basis: { via: 'addressed' } }
      : { admissible: false, reason: 'probe-denied' },
    revalidate: () => true, admitsInferred: () => false,
  }
  const engine = new Engine({ repo, now: () => at, policy: () => policy,
    scope: { scope: () => ({ listened: true, observed: true }) },
    assessor: { request: candidate => candidates.push(candidate) },
    executor: { start: (ticket, assignment) => launches.push({ ticket, assignment }), deliver() {}, stop() {} },
    outbox: { send: message => { if (!replies.has(message.id)) replies.set(message.id, message) },
      status: id => replies.has(id) ? 'pending' : undefined, withdraw: id => { replies.delete(id) } },
  } as any)
  const trigger = (id: string, human = true, actor = 'owner') => ({ id, source: 'audit',
    threads: [{ source: 'audit', id: 'discussion' }], actor: { source: 'audit', id: actor }, human,
    addressed: 'mention', at, text: `Original request ${id}`,
    channel: { source: 'audit', thread: 'audit:discussion', address: { message: id } }, meta: {} })
  function accept(id = 'start') {
    engine.receive(trigger(id) as any); engine.evaluateDue()
    const candidate = candidates.at(-1)
    const outcome = { kind: 'accept', title: 'Audit work', scope: 'Inspect this discussion', reason: 'explicit probe', acknowledgement: 'Inspecting this discussion.' }
    const decision = engine.decide(id, { ...outcome, evalId: candidate.evalId } as any)
    const launch = launches.at(-1)
    engine.assignmentStarted(launch.ticket.id, launch.assignment.id)
    return { id: decision.ticketId!, outcome }
  }
  return { repo, engine, candidates, launches, trigger, accept }
}

const checks: string[] = []
function check(name: string, run: () => void) { run(); checks.push(name) }

check('Trigger ID deduplicates before evaluation', () => {
  const f = fixture()
  assert.equal(f.engine.receive(f.trigger('same') as any), 'stored')
  assert.equal(f.engine.receive(f.trigger('same') as any), 'duplicate')
  assert.equal(f.repo.threads.get('audit:discussion')!.pending.length, 1)
})
check('Denied new work never reaches the assessor', () => {
  const f = fixture(); f.engine.receive(f.trigger('denied', true, 'stranger') as any); f.engine.evaluateDue()
  assert.equal(f.candidates.length, 0)
  assert.equal(f.repo.tickets.list().length, 0)
})
check('Repeated acceptance reuses the Ticket and Assignment', () => {
  const f = fixture(), accepted = f.accept()
  const repeated = f.engine.decide('start', accepted.outcome as any)
  assert.equal(repeated.ticketId, accepted.id)
  assert.equal(f.repo.tickets.list().length, 1)
  assert.equal(f.launches.length, 1)
})
check('Subscribed human follow-up bypasses the new-work gate; Router rerouting is refused', () => {
  const f = fixture(), accepted = f.accept()
  const followup = f.trigger('followup', true, 'stranger')
  f.engine.receive(followup as any); f.engine.evaluateDue()
  assert.equal(f.candidates.length, 1)
  assert.deepEqual(followupOwners(followup as any, f.repo), [accepted.id])
  assert.ok(f.repo.tickets.get(accepted.id)!.inputs.some(input => input.kind === 'trigger' && input.triggerId === 'followup'))
  assert.throws(() => f.engine.decide('followup', { kind: 'ignore', reason: 'Router attempt' }))
})
check('Handback releases follow-up ownership for a fresh evaluation', () => {
  const f = fixture(), accepted = f.accept(), followup = f.trigger('another-request')
  f.engine.receive(followup as any)
  assert.equal(f.engine.handback(accepted.id, followup.id, 'Different work'), true)
  assert.deepEqual(followupOwners(followup as any, f.repo), [])
  f.engine.evaluateDue()
  assert.equal(f.candidates.length, 2)
})
check('A human-stopped Ticket cannot be resumed by CI or a later message', () => {
  const f = fixture(), accepted = f.accept()
  f.engine.stopTicket(accepted.id, 'Explicit stop')
  f.engine.receive(f.trigger('ci', false, 'ci') as any)
  f.engine.receive(f.trigger('later') as any)
  assert.equal(f.repo.tickets.get(accepted.id)!.ended!.by, 'human')
  assert.deepEqual(f.repo.triggers.disposition('later')!.fanout, [])
})
check('Ready without followed delivery Threads ends work; a human follow-up resumes the same Ticket', () => {
  const f = fixture(), accepted = f.accept()
  f.engine.report(accepted.id, { state: 'ready', summary: 'Inspection complete' })
  assert.equal(f.repo.tickets.get(accepted.id)!.ended!.outcome, 'completed')
  f.engine.receive(f.trigger('resume') as any)
  assert.equal(f.repo.tickets.get(accepted.id)!.ended, undefined)
  assert.equal(f.repo.tickets.list().length, 1)
})

const result = { evidence: 'In-memory reference Engine probe with fake Policy/Assessor/Executor/Outbox; not full tests, DSH or real-model validation', checks, passed: checks.length }
writeFileSync(new URL('./core-probe-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
