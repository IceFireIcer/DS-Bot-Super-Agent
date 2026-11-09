import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-schedule-acceptance-'))
const database = join(directory, 'state.sqlite')
const config = { ruleId: 'acceptance', timezone: 'Asia/Shanghai', intervalMs: 1000, text: 'Prepare the scheduled review.', catchUp: 'all', maxCatchUp: 5 }
const sourceConfig = { kind: 'schedule', sourceInstanceId: 'schedule:acceptance', actorId: 'schedule',
  allowedActorIds: ['schedule'], allowedThreadPrefixes: ['schedule:'], versionOrder: 'sequence',
  intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['user'], allowedBotActorIds: [],
    rules: [{ id: 'system-slot', actorKinds: ['system'], addressing: ['direct'], mode: 'inferred' }],
    assess: async (events, _signal, onDelivered) => { await onDelivered(); return events.map(event => ({ eventId: event.eventId, outcome: 'accept', reason: 'Within the schedule rule.' })) } } }
let storage, engine, source, runner
const open = async () => {
  storage = await SqliteStorage.open(database)
  engine = new core.Engine(storage, 'private', sourceConfig)
  source = new core.ScheduleSource(storage, 'private', engine, config)
}
try {
  await open()
  runner = new core.ScheduleRunner(source, 400)
  const startedAt = new Date().toISOString()
  await runner.start()
  await new Promise(resolve => setTimeout(resolve, 3400))
  await runner.stop()
  const stoppedAt = new Date().toISOString()

  const recorded = (await source.occurrences()).items
  const occurrences = recorded.map(item => item.occurrence).reverse()
  if (occurrences.length < 3) throw new Error(`The real schedule produced too few occurrences: ${JSON.stringify(occurrences)}`)
  if (new Set(occurrences).size !== occurrences.length) throw new Error('The real schedule repeated an occurrence.')
  if (occurrences.some((value, index) => index > 0 && value - occurrences[index - 1] !== config.intervalMs)) {
    throw new Error(`The real schedule skipped or duplicated a slot: ${JSON.stringify(occurrences)}`)
  }
  const rule = await source.rule()
  if (rule.revision !== 1 || rule.timezone !== config.timezone) throw new Error('The persisted schedule rule is not the active one.')
  for (const item of recorded) {
    const event = await engine.getSourceObject({ threadId: 'schedule:acceptance', objectId: `occurrence:${item.occurrence}` })
    if (!event || event.eventId !== item.eventId) throw new Error(`Occurrence ${item.occurrence} has no matching source event.`)
  }
  const latest = recorded.find(item => item.occurrence === occurrences.at(-1))
  const gated = await engine.assessSourceBatch({ commandId: 'acceptance-eval', threadId: 'schedule:acceptance', eventIds: [latest.eventId] })
  if (gated.items[0].outcome !== 'accepted' || gated.receipts.length !== 1) throw new Error('The schedule occurrence did not pass the intake gate.')

  await storage.close()
  storage = undefined
  await open()
  const afterRestart = await source.tick(occurrences.at(-1))
  if (afterRestart.occurrences.length !== 0) throw new Error('A restarted schedule repeated an occurrence.')

  await engine.setProcessingPaused({ commandId: 'acceptance-pause', paused: true })
  const paused = await source.tick(occurrences.at(-1) + config.intervalMs)
  if (paused.occurrences.length < 1) throw new Error('A paused schedule did not record its pending occurrence.')
  const pausedItem = (await source.occurrences({ limit: 1 })).items[0]
  try {
    await engine.assessSourceBatch({ commandId: 'acceptance-paused-eval', threadId: 'schedule:acceptance', eventIds: [pausedItem.eventId] })
    throw new Error('A paused Engine accepted scheduled work.')
  } catch (error) {
    if (!(error instanceof core.CoreError) || error.code !== 'PROCESSING_PAUSED') throw error
  }
  await engine.setProcessingPaused({ commandId: 'acceptance-resume', paused: false })
  const accepted = await engine.assessSourceBatch({ commandId: 'acceptance-paused-eval', threadId: 'schedule:acceptance', eventIds: [pausedItem.eventId] })
  if (accepted.items[0].outcome !== 'accepted' || accepted.receipts.length !== 1) throw new Error('The resumed schedule did not create work.')
  const tickets = await engine.listTickets()

  console.log(JSON.stringify({ startedAt, stoppedAt, ruleId: config.ruleId, timezone: rule.timezone, revision: rule.revision,
    occurrences, evidence: recorded, restart: { newOccurrences: afterRestart.occurrences.length },
    gate: { occurrence: gated.receipts[0].ticketId, ticketCount: tickets.items.length },
    pause: { recordedOccurrence: pausedItem.occurrence, rejectedBeforeResume: true, acceptedTicket: accepted.receipts[0].ticketId } }, null, 2))
} finally {
  await runner?.stop().catch(() => {})
  await storage?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true }).catch(() => {})
}
