import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Effects } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-effects-load-'))
const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
let delivered = 0
const effects = new Effects(storage, 'private', { handlers: { notice: {
  execute: async () => { delivered++; return { type: 'success' } },
} } })
try {
  const timings = []
  for (let index = 0; index < 100; index++) {
    const start = performance.now()
    await storage.transaction('private', transaction => effects.enqueue(transaction, { key: `notice-${index}`, stream: 'notice', scope: 'router', payload: { index } }))
    timings.push(performance.now() - start)
  }
  const start = performance.now()
  await effects.drain()
  const drainMs = performance.now() - start
  if (delivered !== 100 || (await effects.list()).items.length) throw new Error('The declared workload did not finish.')
  timings.sort((first, second) => first - second)
  console.log(JSON.stringify({ workload: { queued: 100, delivered, queueCapacity: 1000, maxAttempts: 3, adapterTimeoutMs: 10000, scanIntervalMs: 1000 }, enqueueMs: { p50: timings[49], p95: timings[94], max: timings.at(-1) }, drainMs }))
} finally {
  await effects.stop()
  await storage.close()
  await rm(directory, { recursive: true, force: true })
}
