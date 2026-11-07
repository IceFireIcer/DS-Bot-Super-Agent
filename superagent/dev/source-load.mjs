import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-source-load-'))
let storage
try {
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  const engine = new Engine(storage, 'load', { sourceInstanceId: 'desktop-load', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence' })
  const durations = []
  const base = { threadId: 'room', objectId: 'message', type: 'edited', text: 'Source content.' }
  for (let index = 1; index <= 150; index++) {
    const start = performance.now()
    await engine.receiveSource({ ...base, commandId: `receive-${index}`, version: String(index) })
    durations.push(performance.now() - start)
  }
  const retries = await Promise.all(Array.from({ length: 20 }, (_, index) => engine.receiveSource({ ...base, commandId: `retry-${index}`, version: '150' })))
  assert.ok(retries.every(receipt => receipt.eventId === retries[0].eventId))
  let cursor, count = 0, pages = 0
  do {
    const page = await engine.getSourceHistory(base, { limit: 50, ...(cursor ? { after: cursor } : {}) })
    count += page.items.length; pages++; cursor = page.cursor
  } while (cursor)
  assert.equal(count, 150); assert.equal(pages, 3)
  assert.equal((await engine.getSourceObject(base)).version.value, '150')
  durations.sort((a, b) => a - b)
  console.log(JSON.stringify({ versions: 150, parallelRetries: 20, historyPages: pages, rows: count, queueLimit: 128, lockWaitMs: 250,
    milliseconds: { p50: durations[74], p95: durations[142], max: durations[149] } }))
} finally { await storage?.close(); await rm(directory, { recursive: true, force: true }) }
