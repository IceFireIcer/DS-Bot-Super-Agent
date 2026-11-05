import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { SqliteStorage } from '../dist/storage.js'

test('a version-one database survives an interrupted upgrade transaction and upgrades without losing receipts', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-upgrade-'))
  const path = join(directory, 'state.sqlite')
  let storage
  context.after(async () => { await storage?.close(); await rm(directory, { recursive: true, force: true }) })
  const database = new DatabaseSync(path)
  database.exec('CREATE TABLE records(instance_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(instance_id, kind, id)); PRAGMA user_version=1;')
  database.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('private', 'command', 'original', JSON.stringify({ receipt: { status: 'pending' } }))
  database.close()
  const interrupted = `import { DatabaseSync } from 'node:sqlite'; const database = new DatabaseSync(process.argv[1]); database.exec('BEGIN IMMEDIATE; PRAGMA user_version=2;'); process.exit(19);`
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', interrupted, path], { timeout: 10000 }), { code: 19 })
  const afterCrash = new DatabaseSync(path)
  assert.equal(afterCrash.prepare('PRAGMA user_version').get().user_version, 1)
  afterCrash.close()
  storage = await SqliteStorage.open(path)
  assert.deepEqual(await storage.transaction('private', transaction => transaction.get('command', 'original')), { receipt: { status: 'pending' } })
  const upgraded = new DatabaseSync(path)
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 2)
  upgraded.close()
  const backups = (await readdir(directory)).filter(name => name.includes('.before-v2-'))
  assert.equal(backups.length, 1)
  const saved = new DatabaseSync(join(directory, backups[0]), { readOnly: true })
  assert.equal(saved.prepare('PRAGMA user_version').get().user_version, 1)
  assert.equal(saved.prepare('SELECT count(*) AS count FROM records').get().count, 1)
  saved.close()
})
