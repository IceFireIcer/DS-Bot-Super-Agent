import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const endpoint = process.env.PROACTIVE_MODEL_URL ?? 'https://pro.pokexiao.com/v1/chat/completions'
const model = process.env.PROACTIVE_MODEL ?? 'deepseek-v4.1-flash-1017'
const key = process.env.POKEXIAO_API_KEY
let requests = 0
if (!key) {
  console.error('Set POKEXIAO_API_KEY in the environment; the acceptance never reads or prints it from a file.')
  process.exit(2)
}

async function askModel(text) {
  let lastContent = ''
  for (const maxTokens of [1600, 3000]) {
    let response
    for (let attempt = 0; ; attempt++) {
      try {
        requests++
        response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(25000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [
            { role: 'system', content: 'Decide whether a message is a concrete software task worth preparing. Reply only with JSON: {"useful": boolean, "reason": string, "reproduction": string}. Keep the whole JSON under 120 words; reproduction is empty when not useful.' },
            { role: 'user', content: text },
          ] }) })
        break
      } catch (error) {
        if (attempt >= 1) throw error
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    if (!response.ok) throw new Error(`The model endpoint returned HTTP ${response.status}.`)
    const body = await response.json()
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('The model response has no text content.')
    lastContent = content
    const match = content.match(/\{[\s\S]*\}/u)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (typeof parsed.useful === 'boolean') {
          return { useful: parsed.useful, reason: String(parsed.reason ?? ''), reproduction: String(parsed.reproduction ?? '') }
        }
      } catch { /* retry with a larger budget */ }
    }
  }
  throw new Error(`The model did not return complete JSON twice: ${lastContent.slice(0, 200)}`)
}

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-proactive-model-'))
const root = join(directory, 'proactive-root')
let storage
try {
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  let calls = 0
  const answers = []
  const prepare = async ({ candidate, isolatedDirectory }) => {
    calls++
    let answer
    try { answer = await askModel(candidate.text) }
    catch (error) {
      console.error(`The real model preparation failed for ${candidate.eventId}: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    answers.push({ eventId: candidate.eventId, useful: answer.useful, reason: answer.reason })
    if (!answer.useful || !answer.reproduction.trim()) return undefined
    const content = `${answer.reproduction.trim()}\n`
    await writeFile(join(isolatedDirectory, 'reproduction.md'), content)
    return { summary: answer.reason || 'Prepared a reproduction plan.', artifacts: [{ path: 'reproduction.md',
      bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }] }
  }
  const engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'],
    allowedThreadIds: ['room'], versionOrder: 'sequence' },
    {}, undefined, [], {}, {}, {}, {}, { hostId: 'model-acceptance-host', leaseMs: 60000 }, {
      rootDirectory: root,
      prepareTimeoutMs: 60000,
      prepare,
    })
  await engine.updateProactiveRules({ commandId: 'model-rules', expectedRevision: 1, rules: [
    { id: 'model-auto', name: 'Prepare concrete work', mode: 'auto', match: { actorKinds: ['human', 'bot'], addressing: ['direct'] },
      communication: 'notify', budget: { maxRuns: 3, windowMs: 3600000 }, enabled: true },
    { id: 'model-observe', name: 'Observe concrete work', mode: 'observe', match: { actorKinds: ['human'], addressing: ['direct'] },
      communication: 'silent', budget: { maxRuns: 5, windowMs: 3600000 }, enabled: true },
  ] })
  const record = async (objectId, text, authorKind = 'human') => {
    const receipt = await engine.receiveSource({ commandId: `recv-${objectId}`, threadId: 'room', objectId, type: 'created', version: '1',
      text, authorId: authorKind === 'bot' ? 'bot-1' : 'user', authorKind, addressing: 'direct' })
    for (let attempt = 0; attempt < 600; attempt++) {
      const runs = (await engine.listProactiveRuns()).filter(run => run.eventId === receipt.eventId)
      if (runs.length && runs.every(run => run.state !== 'running')) return runs
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`The proactive run for ${objectId} did not settle.`)
  }

  const useful = (await record('model-useful', 'The parser throws when the input is an empty string; find a minimal reproduction.'))
    .find(run => run.ruleId === 'model-auto')
  if (useful.state !== 'prepared') throw new Error(`A concrete task was not prepared: ${JSON.stringify(useful)}`)
  const artifact = useful.artifacts?.[0]
  if (!artifact) throw new Error('The real preparation recorded no verified artifact.')
  const stored = await readFile(join(useful.isolatedDirectory, artifact.path))
  if (createHash('sha256').update(stored).digest('hex') !== artifact.sha256) throw new Error('The recorded artifact digest does not match the file.')

  const noise = (await record('model-noise', 'Lunch is moving to noon tomorrow; no action is needed.'))
    .find(run => run.ruleId === 'model-auto')
  if (noise.state !== 'silent') throw new Error(`Ordinary chatter was not silent: ${JSON.stringify(noise)}`)

  const echo = (await record('model-echo', 'The parser throws when the input is an empty string; find a minimal reproduction.', 'bot'))
    .find(run => run.ruleId === 'model-auto')
  if (echo.state !== 'suppressed') throw new Error(`A bot echo was not suppressed: ${JSON.stringify(echo)}`)

  const second = (await record('model-second', 'The login form loses focus after a validation error; reproduce it.'))
    .find(run => run.ruleId === 'model-auto')
  if (second.state !== 'prepared') throw new Error(`The second budgeted task was not prepared: ${JSON.stringify(second)}`)

  const exhausted = (await record('model-exhausted', 'The export button crashes on an empty selection; reproduce it.'))
    .find(run => run.ruleId === 'model-auto')
  if (exhausted.state !== 'budget-exhausted') throw new Error(`The third task was not budget-exhausted: ${JSON.stringify(exhausted)}`)

  const observed = (await record('model-observed', 'The CLI help text is out of date; suggest a fix.'))
    .find(run => run.ruleId === 'model-observe')
  if (observed.state !== 'observed') throw new Error(`Observe mode did not stay read-only: ${JSON.stringify(observed)}`)

  let scheduledRun
  const scheduleStorage = await SqliteStorage.open(join(directory, 'schedule.sqlite'))
  try {
    const scheduled = new core.Engine(scheduleStorage, 'private', { kind: 'schedule', sourceInstanceId: 'schedule:model', actorId: 'schedule',
      allowedActorIds: ['schedule'], allowedThreadPrefixes: ['schedule:'], versionOrder: 'sequence' }, {}, undefined, [], {}, {}, {}, {}, {}, {
      rootDirectory: root,
      prepareTimeoutMs: 60000,
      prepare,
    })
    await scheduled.updateProactiveRules({ commandId: 'model-schedule-rules', expectedRevision: 1, rules: [{ id: 'model-scheduled', name: 'Prepare scheduled work',
      mode: 'auto', match: { actorKinds: ['system'], addressing: ['direct'] }, communication: 'silent',
      budget: { maxRuns: 1, windowMs: 3600000 }, enabled: true }] })
    const source = new core.ScheduleSource(scheduleStorage, 'private', scheduled, { ruleId: 'model', timezone: 'UTC', intervalMs: 1000,
      text: 'The nightly import job fails on an empty CSV; reproduce it.' })
    await source.tick(Date.now())
    for (let attempt = 0; attempt < 300 && !scheduledRun; attempt++) {
      scheduledRun = (await scheduled.listProactiveRuns()).find(run => run.ruleId === 'model-scheduled' && run.state !== 'running')
      if (!scheduledRun) await new Promise(resolve => setTimeout(resolve, 20))
    }
    if (scheduledRun?.state !== 'prepared') throw new Error(`The scheduled real preparation did not finish: ${JSON.stringify(scheduledRun)}`)
  } finally { await scheduleStorage.close().catch(() => {}) }

  const effects = await engine.effects.list()
  if (effects.items.length !== 0) throw new Error('A proactive preparation enqueued a delivery or publish effect.')
  console.log(JSON.stringify({ endpoint: new URL(endpoint).host, model, prepareCalls: calls, modelRequests: requests, answers,
    scheduled: scheduledRun ? { state: scheduledRun.state, summary: scheduledRun.summary, artifacts: scheduledRun.artifacts } : undefined,
    runs: (await engine.listProactiveRuns()).map(run => ({ ruleId: run.ruleId, eventId: run.eventId, state: run.state, reason: run.reason,
      summary: run.summary, artifacts: run.artifacts })), effects: effects.items.length }, null, 2))
} finally {
  await storage?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true }).catch(() => {})
}
