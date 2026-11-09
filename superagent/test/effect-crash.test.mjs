import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { Effects } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL('./fixtures/effect-crash.mjs', import.meta.url))

test('real process exits before commit, after commit and after external acceptance recover without blind replay', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-effect-crash-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  for (const [phase, code] of [['before', 21], ['after', 22], ['external', 23]]) {
    const databasePath = join(directory, `${phase}.sqlite`)
    const marker = join(directory, `${phase}.jsonl`)
    await assert.rejects(execute(process.execPath, [fixture, databasePath, marker, phase], { timeout: 10000 }), { code })
    const storage = await SqliteStorage.open(databasePath)
    let sends = 0
    let checks = 0
    const effects = new Effects(storage, 'private', { now: () => Date.now() + 20000, handlers: { relay: {
      execute: async () => { sends++; return { type: 'success' } },
      reconcile: async (effect, operation) => {
        checks++
        assert.equal((await readFile(marker, 'utf8')).trim(), operation.idempotencyKey)
        return { type: 'success' }
      },
    } } })
    try {
      const pending = (await effects.list()).items
      assert.equal(pending.length, phase === 'before' ? 0 : 1)
      await effects.drain()
      assert.equal(sends, phase === 'after' ? 1 : 0)
      assert.equal(checks, phase === 'external' ? 1 : 0)
      assert.equal((await effects.list()).items.length, 0)
      if (pending[0]) assert.equal((await effects.receipt(pending[0].id, pending[0].generation)).state, 'done')
      if (phase !== 'external') await assert.rejects(readFile(marker), { code: 'ENOENT' })
    } finally { await effects.stop(); await storage.close() }
  }
})
