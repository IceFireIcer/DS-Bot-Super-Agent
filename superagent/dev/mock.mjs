import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../dist/index.js'

const execFileAsync = promisify(execFile)
const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-mock-'))
const databasePath = join(directory, 'state.sqlite')
const source = { sourceInstanceId: 'desktop-demo', actorId: 'local-user', allowedActorIds: ['local-user'] }
const context = new Context()

try {
  await context.plugin(plugin, { databasePath, instanceId: 'demo', source })
  const engine = context.get('superagent')
  const samples = []
  for (let index = 0; index < 50; index++) {
    const start = performance.now()
    await engine.submit({ commandId: `baseline-command-${index}`, eventId: `baseline-event-${index}`, text: `Inspect isolated sample ${index}.` })
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  const parallel = await Promise.all(Array.from({ length: 20 }, (_, index) => engine.submit({ commandId: `retry-${index}`, eventId: 'parallel-event', text: 'Inspect the parallel sample.' })))
  for (const receipt of parallel) assert.deepEqual(receipt, parallel[0])

  const args = ['--database', databasePath, '--instance', 'demo', '--source', 'desktop-demo', '--actor', 'local-user', '--allow-actor', 'local-user']
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
  const readReceipt = async () => JSON.parse((await execFileAsync(process.execPath, [cli, 'receipt', '--command', 'baseline-command-0', ...args], { timeout: 10000 })).stdout)
  assert.deepEqual(await readReceipt(), await engine.getReceipt('baseline-command-0'))
  const work = await engine.getTicket(parallel[0].ticketId)
  assert.equal(work.intent.reason, 'worker-not-enabled')
  console.log(JSON.stringify({
    test: 'isolated-local-explicit-intake', modelCalls: 0, acceptedRequests: 51, retryDeliveries: 20,
    serialSubmitMs: { p50: Number(samples[24].toFixed(2)), p95: Number(samples[47].toFixed(2)), max: Number(samples[49].toFixed(2)) },
    parallelAcceptances: new Set(parallel.map(receipt => receipt.ticketId)).size,
    reopenedReceipt: 'matches', intent: work.intent.reason,
  }, null, 2))
} finally {
  try { await context.fiber.dispose() } finally { await rm(directory, { recursive: true, force: true }) }
}
