import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { importTeam } from '../../app/src/import.mjs'

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const treeHash = (dir) => {
  const hash = createHash('sha256')
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else hash.update(relative(dir, path)).update(readFileSync(path))
    }
  }
  walk(dir)
  return hash.digest('hex')
}

const team = {
  version: 1, mainBotIds: ['session-a'],
  bots: { 'session-a': { id: 'session-a', name: 'Chief' } },
  rooms: { 'room-1': { id: 'room-1', name: 'Ops', members: ['session-a'], sessions: { 'session-a': 'session-g' } } },
}

function home(root) {
  const from = join(root, 'legacy')
  write(join(from, 'bot', 'state.json'), JSON.stringify(team))
  write(join(from, 'bot', 'workspace', 'notes.txt'), 'old notes\n')
  write(join(from, 'sessions', '--team--', 'session-a', 'session.v4.jsonl'), '{"seq":0,"type":"session/created"}\n')
  write(join(from, 'sessions', '--team--', 'session-g', 'session.v4.jsonl'), '{"seq":0,"type":"session/created"}\n')
  write(join(from, '.credentials.yaml'), 'FAKE=1\n')
  return from
}

test('the real legacy importer path runs on isolated fictional data, cancels, retries and leaves the source unchanged', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-app-import-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const from = home(root)
  const to = join(root, 'app-data')
  const workspace = join(root, 'app-workspace')
  mkdirSync(join(to, 'bot'), { recursive: true })
  write(join(to, 'bot', 'state.json'), JSON.stringify({ version: 1, mainBotIds: [], bots: {}, rooms: {} }))
  mkdirSync(workspace, { recursive: true })
  const before = treeHash(from)
  let checks = 0
  const signal = { get aborted() { return checks > 4 }, throwIfAborted() { if (++checks > 4) throw new Error('cancelled') } }
  await assert.rejects(importTeam({ from, to, workspace, signal }), /cancelled/u)
  assert.equal(treeHash(from), before)
  const summary = await importTeam({ from, to, workspace })
  assert.equal(summary.bots, 1)
  assert.equal(summary.rooms, 1)
  assert.equal(treeHash(from), before)
  assert.equal(JSON.parse(readFileSync(join(to, 'bot', 'state.json'), 'utf8')).bots['session-a'].name, 'Chief')
})
