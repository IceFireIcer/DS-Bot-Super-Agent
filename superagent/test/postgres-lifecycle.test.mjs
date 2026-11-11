import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { startPostgres } from './fixtures/postgres-harness.mjs'

test('loading the PostgreSQL fixture does not install a process exit hook or emit a synchronous termination notice', () => {
  const entry = new URL('./fixtures/postgres-harness.mjs', import.meta.url).href
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(entry)}); process.exit(0)`],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  assert.doesNotMatch(child.stderr, /SYNCHRONOUS TERMINATION NOTICE|triggerUncaughtException/u)
})

test('the PostgreSQL owner stops its real database and releases its temporary directory on close', { timeout: 60000 }, async t => {
  const fixture = await startPostgres('ds-superagent-pg-lifecycle-')
  t.after(() => fixture.close())
  const client = await fixture.client()
  assert.equal((await client.query('SELECT 42 AS answer')).rows[0].answer, 42)
  const database = await fixture.createDatabase()
  const separate = await fixture.client(database)
  assert.equal((await separate.query('SELECT current_database() AS name')).rows[0].name, database)
  await fixture.close()
  await fixture.close()
  assert.equal(existsSync(fixture.directory), false)
})
