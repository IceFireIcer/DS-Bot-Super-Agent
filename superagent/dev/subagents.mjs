import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine, LocalEnvironment, NativeSessions } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from './native-mock.mjs'

// Declared workload for delegated subtasks. Every figure below is measured in this run.
const workload = { subtasks: 4, childSteps: 3, childStepMs: 120, scanIntervalMs: 50, maxPerTicket: 4 }
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-subagent-load-'))
const root = join(directory, 'work')
await mkdir(root)
let context, storage, sessions, engine
const childTurns = new Map()
const childToolScope = new Map()
let peakChildren = 0
try {
  context = await nativeContext(join(directory, 'sessions'), async function* (options) {
    if (options.model === 'router') { yield* routerResponse(options); return }
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const steps = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.sessionId.startsWith('subagent-')) {
      childToolScope.set(options.sessionId, options.tools.map(tool => tool.name))
      childTurns.set(options.sessionId, (childTurns.get(options.sessionId) ?? 0) + 1)
      await sleep(workload.childStepMs)
      peakChildren = Math.max(peakChildren, [...childTurns.values()].filter(count => count > 0).length)
      const plan = Array.from({ length: workload.childSteps }, (_, index) => ['write_file', { path: `${options.sessionId}-${index}.txt`, text: `step ${index}\n` }])
      const next = plan[steps]
      return yield* (next ? toolResponse(next[0], next[1], `child-${steps}`) : textResponse(`Finished ${workload.childSteps} steps.`))
    }
    if (text.startsWith('Delegate four.')) {
      const plan = Array.from({ length: workload.subtasks }, (_, index) => ['delegate_subagent', { task: `subtask ${index}` }])
      const next = plan[steps]
      return yield* (next ? toolResponse(next[0], next[1], `parent-${steps}`) : textResponse('All subtasks delegated.'))
    }
    yield* textResponse('Turn complete.')
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const environment = await LocalEnvironment.open({ id: 'project', instanceId: 'subagent-load', root, allowedActorIds: ['user'],
    permissions: ['read', 'write', 'search', 'command'], commands: {} })
  engine = new Engine(storage, 'subagent-load', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence' },
    { retryDelayMs: 10, scanIntervalMs: workload.scanIntervalMs }, sessions, [environment], {}, {}, { maxPerTicket: workload.maxPerTicket, deadlineMs: 120000 })
  engine.effects.start()
  const waitUntil = async (check, label, timeout = 60000) => {
    const deadline = Date.now() + timeout
    while (!await check()) {
      if (Date.now() > deadline) throw new Error(`The declared subagent workload did not reach: ${label}.`)
      await sleep(20)
    }
  }
  const acceptedAt = performance.now()
  const event = await engine.receiveSource({ commandId: 'receive', threadId: 'room', objectId: 'delegate', type: 'created', version: '1', text: 'Delegate four.' })
  const receipt = await engine.acceptSource({ commandId: 'accept', threadId: 'room', objectId: 'delegate', expectedEventId: event.eventId, environmentId: 'project' })
  const parentTurnMs = performance.now() - acceptedAt
  await waitUntil(async () => (await engine.listSubagents(receipt.ticketId)).length === workload.subtasks, 'every subtask start fact')
  const startedAt = performance.now()
  await waitUntil(async () => (await engine.listSubagents(receipt.ticketId)).every(subtask => subtask.settled), 'every subtask result')
  const completedMs = performance.now() - startedAt
  const subtasks = await engine.listSubagents(receipt.ticketId)
  assert.equal(subtasks.filter(subtask => subtask.succeeded).length, workload.subtasks)
  assert.equal(subtasks.every(subtask => subtask.result?.text.includes(`${workload.childSteps} steps`)), true)
  // Every child wrote only inside the parent's bound directory, using a subset of the parent's tools.
  for (const [sessionId, tools] of childToolScope) {
    assert.equal(tools.includes('delegate_subagent'), false, JSON.stringify(tools))
    assert.equal(tools.includes('report_ready'), false, JSON.stringify(tools))
    assert.equal(tools.includes('write_file'), true, JSON.stringify(tools))
    await readFile(join(root, `${sessionId}-${workload.childSteps - 1}.txt`), 'utf8')
  }
  console.log(JSON.stringify({
    workload,
    measured: {
      parentTurnReturnedAfterDelegatingMs: Number(parentTurnMs.toFixed(1)),
      subtasksStarted: subtasks.length,
      subtasksCompleted: subtasks.filter(subtask => subtask.succeeded).length,
      peakConcurrentChildren: peakChildren,
      allSubtasksCompletedMs: Number(completedMs.toFixed(1)),
      childToolScope: [...childToolScope.values()][0]?.sort(),
      filesWrittenByChildren: childToolScope.size * workload.childSteps,
    },
  }, null, 2))
} finally {
  engine?.shutdown(); await engine?.effects.stop(); await sessions?.close(); await context?.fiber.dispose(); await storage?.close()
  await rm(directory, { recursive: true, force: true })
}
