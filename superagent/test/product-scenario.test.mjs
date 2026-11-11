import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { Engine, LocalEnvironment, NativeSessions, createChatServer } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'
import { completedToolCount, lastUserText } from './input-support.mjs'

async function until(check, label) {
  const deadline = Date.now() + 45_000
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(`Product scenario did not reach ${label} within 45000 ms.`)
    await sleep(20)
  }
}

test('one mock product Ticket keeps its direction, human answer and stop across restart before an evidenced result', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-product-'))
  const root = join(directory, 'work')
  await mkdir(root)
  const request = 'Prepare release-note.txt as revision A; start preparation and wait for direction and human approval.'
  const correction = 'Use revision B for release-note.txt. Ask for approval before writing it.'
  const answer = 'Approve revision B.'
  const workerTurns = []
  const source = { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }
  let environment, native, sessions, storage, engine, chat, github

  async function close() {
    const errors = []
    for (const dispose of [
      () => chat?.close(),
      () => github?.effects.stop(),
      () => github?.shutdown(),
      () => engine?.effects.stop(),
      () => engine?.shutdown(),
      () => sessions?.close(),
      () => native?.fiber.dispose(),
      () => environment?.close(),
      () => storage?.close(),
    ]) {
      try { await dispose() } catch (error) { errors.push(error) }
    }
    chat = github = engine = sessions = native = environment = storage = undefined
    if (errors.length) throw new AggregateError(errors, 'Product scenario cleanup failed.')
  }
  t.after(async () => {
    try { await close() } finally {
      assert.ok(directory.startsWith(join(tmpdir(), 'ds-superagent-product-')))
      await rm(directory, { recursive: true, force: true })
    }
  })

  function* respond(options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const text = lastUserText(options)
    const completed = completedToolCount(options)
    if (!completed) workerTurns.push({ text, messages: structuredClone(options.messages) })
    let plan = []
    if (text === request) plan = [['start_command', { name: 'prepare' }]]
    else if (text === 'Check an independent note while preparation runs.') plan = [
      ['write_file', { path: 'independent.txt', text: 'independent checked\n' }],
      ['run_command', { name: 'verify-independent' }],
      ['report_ready', { result: 'Independent note checked.', evidence: 'The verification command read independent.txt.', artifacts: 'independent.txt' }],
    ]
    else if (text.includes(correction)) plan = [['ask_human', { question: 'Approve revision B?', options: 'Approve\nReject' }]]
    else if (text === answer) plan = [
      ['write_file', { path: 'release-note.txt', text: 'revision B approved\n' }],
      ['read_file', { path: 'release-note.txt' }],
    ]
    else if (text.startsWith('Recovery attempt ') && text.endsWith(answer)) plan = [
      ['read_file', { path: 'release-note.txt' }],
      ['run_command', { name: 'verify-release' }],
      ['report_ready', { result: 'Release note revision B is ready.', evidence: 'verify-release read the approved revision and exited with code 0.', artifacts: 'release-note.txt' }],
    ]
    const next = plan[completed]
    if (next) yield* toolResponse(next[0], next[1], `scenario-${completed}`)
    else yield* textResponse('Turn recorded; no result unless report_ready succeeded.')
  }

  async function open() {
    environment = await LocalEnvironment.open({ id: 'project', instanceId: 'product-scenario', root,
      allowedActorIds: ['user'], permissions: ['read', 'write', 'command'], commands: {
        prepare: { argv: [process.execPath, '-e', "const fs=require('node:fs');fs.writeFileSync('preparation-started.txt','started');setInterval(()=>{},1000);setTimeout(()=>process.exit(1),45000)"], timeoutMs: 5000, backgroundTimeoutMs: 50000 },
        'verify-independent': { argv: [process.execPath, '-e', "const fs=require('node:fs');if(fs.readFileSync('independent.txt','utf8')!=='independent checked\\n')process.exit(1);console.log('verified independent note')"], timeoutMs: 5000 },
        'verify-release': { argv: [process.execPath, '-e', "const fs=require('node:fs');if(fs.readFileSync('release-note.txt','utf8')!=='revision B approved\\n')process.exit(1);console.log('verified revision B approved')"], timeoutMs: 5000 },
      } })
    native = await nativeContext(join(directory, 'sessions'), respond)
    sessions = new NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
    storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
    engine = new Engine(storage, 'product-scenario', source, { scanIntervalMs: 20, retryDelayMs: 10 }, sessions, [environment], { maxSlots: 2 })
    chat = await createChatServer(engine)
    engine.effects.start()
  }

  async function post(path, body) {
    const response = await fetch(`${chat.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result
  }

  await open()
  const receipt = await post('/request', { commandId: 'primary-request', eventId: 'desktop-message', text: request, environmentId: 'project' })
  const ticketId = receipt.ticketId
  assert.equal((await engine.getTicket(ticketId)).trigger.source.kind, 'desktop')
  await until(async () => (await engine.conversation(ticketId)).reason === 'worker-background', 'preparation running in the background')
  const firstAssignment = (await engine.conversation(ticketId)).assignments[0]
  const [job] = await engine.listJobs(ticketId)
  assert.ok(job)
  assert.equal(job.state, 'running')
  assert.equal(job.settled, false)
  assert.deepEqual((await engine.conversation(ticketId)).reports, [])

  const second = await post('/request', { commandId: 'independent-request', eventId: 'second-message', text: 'Check an independent note while preparation runs.', environmentId: 'project' })
  assert.notEqual(second.ticketId, ticketId)
  await until(async () => (await engine.conversation(second.ticketId)).status === 'ready', 'the overlapping Ticket result')
  const independent = await engine.conversation(second.ticketId)
  assert.equal(independent.reports[0].result, 'Independent note checked.')
  assert.equal(independent.reports[0].toolFacts.at(-1).output.stdout, 'verified independent note\n')
  assert.equal((await engine.getJob(ticketId, job.id)).state, 'running')
  assert.equal(independent.assignments[0].sessionId === firstAssignment.sessionId, false)

  github = new Engine(storage, 'product-scenario', { kind: 'github', sourceInstanceId: 'github:product/scenario', actorId: 'user',
    allowedActorIds: ['user'], allowedThreadIds: ['product/scenario#83'], versionOrder: 'sequence' })
  const reference = await engine.getTicketReference(ticketId)
  const correctionInput = `${reference}\n${correction}`
  const event = await github.receiveSource({ commandId: 'github-direction', threadId: 'product/scenario#83', objectId: 'comment-1',
    type: 'created', version: '1', text: correctionInput, authorId: 'user', authorKind: 'human', addressing: 'direct' })
  assert.equal(event.status, 'recorded')
  await assert.rejects(github.attachSourceEvent({ commandId: 'cross-channel-attach', eventId: event.eventId, ticketId,
    reason: 'The human explicitly referenced the desktop Ticket.' }), {
    code: 'SOURCE_NOT_AUTHORIZED', message: 'The Ticket belongs to a different source instance.',
  })
  assert.equal((await engine.getTicketDirection(ticketId)).directionVersion, 1)
  assert.deepEqual((await engine.getTicketDirection(second.ticketId)).inputs, [])
  const association = await engine.associateSourceEvent({ commandId: 'owner-authorized-github-direction', ticketId,
    eventId: event.eventId, reference, reason: 'The desktop owner approved this native GitHub correction and its result destination.', retargetResult: true }, github)
  assert.equal(association.input.directionVersion, 2)
  assert.equal(association.input.sourceEventId, event.eventId)
  assert.equal(association.input.association.source.sourceInstanceId, 'github:product/scenario')
  await until(async () => {
    const view = await engine.conversation(ticketId)
    return view.status === 'waiting-human' && view.messages.some(message => message.purpose === 'attention')
  }, 'the delivered revision B Attention')
  const waiting = await engine.conversation(ticketId)
  assert.equal(waiting.attention.question, 'Approve revision B?')
  assert.deepEqual(waiting.attention.options, ['Approve', 'Reject'])
  assert.equal(waiting.assignments[0].sessionId, firstAssignment.sessionId)
  assert.equal(waiting.messages.some(message => message.purpose === 'attention' && message.text === 'Approve revision B?'), true)
  assert.deepEqual(waiting.reports, [])
  assert.equal((await engine.getTicket(ticketId)).mandate.scope, request)

  await post('/answer', { commandId: 'human-answer', attentionId: waiting.attention.id, text: answer })
  await until(async () => (await engine.getTicketDirection(ticketId)).inputs.some(input => input.text === answer && input.delivery?.persistedAt !== undefined)
    && (await engine.conversation(ticketId)).reason === 'worker-idle', 'the authorized answer to persist its draft turn')
  const answered = await engine.conversation(ticketId)
  assert.equal(answered.attention.status, 'answered')
  assert.equal(answered.attention.answerText, answer)
  assert.deepEqual(answered.reports, [])
  await assert.rejects(engine.answerAttention({ commandId: 'stale-answer', attentionId: waiting.attention.id, text: 'Approve revision A.' }), { code: 'ATTENTION_STALE' })

  await post('/stop', { commandId: 'human-stop', ticketId, reason: 'Keep this draft stopped until I explicitly resume.' })
  await until(async () => (await engine.conversation(ticketId)).status === 'stopped', 'confirmed manual stop')
  const stopped = await engine.conversation(ticketId)
  assert.ok(stopped.stop.cancellationConfirmedAt)
  assert.equal((await engine.getJob(ticketId, job.id)).settled, true)
  const turnsBeforeRestart = workerTurns.length
  await close()
  await open()
  for (let index = 0; index < 5; index++) await engine.effects.drain()
  const persisted = await engine.conversation(ticketId)
  assert.equal(persisted.status, 'stopped')
  assert.equal(persisted.stop.id, stopped.stop.id)
  assert.equal(persisted.attention.answerText, answer)
  assert.equal(persisted.resumeHistory.length, 0)
  assert.deepEqual(persisted.reports, [])
  assert.equal(workerTurns.length, turnsBeforeRestart)
  assert.equal((await engine.conversation(second.ticketId)).reports[0].id, independent.reports[0].id)

  const resumed = await post('/resume', { commandId: 'explicit-resume', ticketId })
  assert.notEqual(resumed.assignments[0].id, firstAssignment.id)
  assert.equal(resumed.assignments[0].sessionId, firstAssignment.sessionId)
  await until(async () => {
    const view = await engine.conversation(ticketId)
    return view.status === 'ready' && view.messages.some(message => message.purpose === 'result')
  }, 'the delivered resumed revision B result')
  const result = await engine.conversation(ticketId)
  assert.equal(result.ticketId, ticketId)
  assert.equal(result.reports.length, 1)
  assert.equal(result.reports[0].result, 'Release note revision B is ready.')
  assert.equal(result.reports[0].evidence, 'verify-release read the approved revision and exited with code 0.')
  assert.deepEqual(result.reports[0].toolFacts.map(fact => fact.tool), ['read_file', 'run_command'])
  assert.equal(result.reports[0].toolFacts.at(-1).output.exitCode, 0)
  assert.equal(result.reports[0].toolFacts.at(-1).output.stdout, 'verified revision B approved\n')
  assert.equal(result.reports[0].artifacts[0].path, 'release-note.txt')
  assert.equal(result.reports[0].artifacts[0].bytes, 20)
  assert.equal(result.reports[0].artifacts[0].reference.kind, 'artifact')
  assert.equal(result.messages.filter(message => message.purpose === 'result').length, 1)
  assert.deepEqual(result.messages.find(message => message.purpose === 'result').destination,
    { sourceInstanceId: 'github:product/scenario', eventId: 'comment-1', threadId: 'product/scenario#83', actorId: 'user' })
  assert.equal(result.resumeHistory.length, 1)
  assert.equal((await engine.listTickets()).items.length, 2)
  const resumeTurn = workerTurns.find(turn => turn.text.startsWith('Recovery attempt ') && turn.text.endsWith(answer))
  assert.ok(resumeTurn)
  const retainedText = resumeTurn.messages.filter(message => message.role === 'user')
    .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  for (const originalText of [request, correctionInput, answer]) assert.ok(retainedText.includes(originalText), `The reopened DSH Session must retain: ${originalText}`)
  assert.equal((await engine.getTicket(ticketId)).mandate.scope, request)
})
