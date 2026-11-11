import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import { getLegacyArchive, listLegacyArchives, prepareLegacyArchive, publishLegacyArchive, readLegacyObject, verifyLegacyArchive } from '../dist/legacy-archive.js'

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const json = (path, value) => write(path, JSON.stringify(value))
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

const TEAM = {
  version: 1, revision: 7, mainBotIds: ['session-a'],
  bots: {
    'session-a': { id: 'session-a', name: 'Chief', roleLabel: 'Lead', sessionId: 'session-a2', segments: [{ sessionId: 'session-a' }] },
    'session-b': { id: 'session-b', name: 'Writer' },
  },
  rooms: {
    'session-r1': { id: 'session-r1', name: 'Ops', members: ['session-a', 'session-b'], sessions: { 'session-a': 'session-g' }, segments: { 'session-a': [{ sessionId: 'session-g0' }] } },
  },
  works: { w1: { state: 'running' }, w2: { state: 'done' }, w3: { state: 'stopped' }, w4: { state: 'unknown' } },
  requests: { r1: { state: 'pending' } },
  questions: { q1: { status: 'waiting' } },
  agents: { a1: { state: 'running', sessionId: 'session-a' } },
  privateArchives: [],
}

const sessions = [['--team--', 'session-a'], ['--team--', 'session-a2'], ['--site--', 'session-b'], ['--team--', 'session-r1'], ['--team--', 'session-g'], ['--team--', 'session-g0']]

function source(root, { missing = false, newer = false } = {}) {
  const from = join(root, 'legacy')
  json(join(from, 'bot', 'state.json'), TEAM)
  write(join(from, 'bot', 'state.lock'), '{}')
  json(join(from, 'bot', 'inflight.json'), { a1: { state: 'running' } })
  write(join(from, 'memory', 'team', 'MEMORY.md'), 'The team remembers the old project.\n')
  write(join(from, 'memory', 'groups', 'session-r1', 'MEMORY.md'), 'The group remembers its decisions.\n')
  write(join(from, 'memory', 'bots', 'session-a', 'MEMORY.md'), 'The chief remembers.\n')
  write(join(from, 'profiles', 'desktop', 'cordis.patch.yml'), '- id: llm-deepseek\n')
  write(join(from, 'attachments', 'aa', 'file.txt'), 'attachment body\n')
  write(join(from, 'bot', 'workspace', 'notes.txt'), 'old workspace notes\n')
  write(join(from, '.credentials.yaml'), 'DEEPSEEK_API_KEY: fake\n')
  write(join(from, '.env'), 'X=1\n')
  for (const [group, id] of sessions) {
    if (missing && id === 'session-b') continue
    write(join(from, 'sessions', group, id, newer && id === 'session-a' ? 'session.v5.jsonl' : 'session.v4.jsonl'), '{"seq":0,"type":"session/created"}\n{"seq":1,"type":"user/message","data":{"text":"old"}}\n')
  }
  return from
}

const mapping = {
  roles: [{ sourceBotId: 'session-a', name: 'Chief', roleLabel: 'Lead', instructions: 'Use {{goal}} and the archive evidence.' }],
  sharedMemory: ['team', 'group:session-r1'],
}

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-archive-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, source: source(root), target: join(root, 'archive-store') }
}

test('prepare stages a verified read-only archive without touching the source or publishing', async t => {
  const { source: from, target } = setup(t)
  const before = treeHash(from)
  const prepared = await prepareLegacyArchive({ source: from, target, batchId: 'batch-1', mapping, profile: 'desktop', sourceIdentity: 'legacy-team' })
  assert.equal(prepared.status, 'prepared')
  assert.equal(prepared.counts.bots, 2)
  assert.equal(prepared.counts.rooms, 1)
  assert.equal(prepared.counts.missingSessions, 0)
  assert.equal(prepared.counts.invalidSessions, 0)
  assert.equal(prepared.source.profile, 'desktop')
  assert.equal(prepared.source.identity, 'legacy-team')
  assert.deepEqual(prepared.roles[0].permissions, [])
  assert.equal(prepared.roles[0].sourceMainBot, true)
  assert.equal(prepared.roles[0].readOnly, true)
  assert.equal(prepared.review.some(item => item.id === 'w1'), true)
  assert.equal(prepared.review.some(item => item.id === 'w2'), false)
  assert.equal(prepared.review.some(item => item.id === 'w3'), true)
  assert.equal(prepared.review.some(item => item.id === 'w4'), true)
  assert.equal(prepared.review.some(item => item.kind === 'inflight'), true)
  assert.deepEqual(prepared.mappedMemory.map(entry => entry.scope), ['team', 'group:session-r1'])
  assert.equal(existsSync(join(target, 'archives', 'batch-1')), false)
  assert.equal(existsSync(join(target, '.staging', 'batch-1', '.credentials.yaml')), false)
  assert.equal(existsSync(join(target, '.staging', 'batch-1', 'profiles')), false)
  assert.equal(treeHash(from), before, 'the source directory is unchanged')
  const verified = await verifyLegacyArchive(target, 'batch-1')
  assert.equal(verified.status, 'verified')
  const published = await publishLegacyArchive(target, 'batch-1')
  assert.equal(published.status, 'published')
  assert.equal(getLegacyArchive(target, 'batch-1').status, 'published')
  assert.equal(listLegacyArchives(target).length, 1)
  assert.equal(treeHash(from), before, 'publish did not write the source')
})

test('the published archive reads the old team by original references without an old queue', async t => {
  const { source: from, target } = setup(t)
  await prepareLegacyArchive({ source: from, target, batchId: 'read-1', mapping, include: { workspace: true, attachments: true } })
  await verifyLegacyArchive(target, 'read-1')
  await publishLegacyArchive(target, 'read-1')
  const bot = await readLegacyObject({ target, batchId: 'read-1', ref: 'bot:session-a' })
  assert.equal(bot.data.name, 'Chief')
  const role = await readLegacyObject({ target, batchId: 'read-1', ref: 'role:session-a' })
  assert.deepEqual(role.data.permissions, [])
  assert.equal(role.data.readOnly, true)
  const review = await readLegacyObject({ target, batchId: 'read-1', ref: 'review:w1' })
  assert.equal(review.data.kind, 'work')
  assert.equal((await readLegacyObject({ target, batchId: 'read-1', ref: 'work:w2' })).data.state, 'done')
  assert.equal((await readLegacyObject({ target, batchId: 'read-1', ref: 'request:r1' })).data.state, 'pending')
  assert.equal((await readLegacyObject({ target, batchId: 'read-1', ref: 'question:q1' })).data.status, 'waiting')
  assert.equal((await readLegacyObject({ target, batchId: 'read-1', ref: 'agent:a1' })).data.state, 'running')
  assert.equal((await readLegacyObject({ target, batchId: 'read-1', ref: 'inflight:state' })).data.a1.state, 'running')
  const memory = await readLegacyObject({ target, batchId: 'read-1', ref: 'memory:team/MEMORY.md' })
  assert.match(memory.data, /team remembers/u)
  assert.equal(memory.shared, true)
  assert.equal((await readLegacyObject({ target, batchId: 'read-1', ref: 'memory:bots/session-a/MEMORY.md' })).shared, false)
  const file = await readLegacyObject({ target, batchId: 'read-1', ref: 'file:notes.txt' })
  assert.match(file.data, /old workspace/u)
  const attachment = await readLegacyObject({ target, batchId: 'read-1', ref: 'attachment:aa/file.txt' })
  assert.match(attachment.data, /attachment body/u)
  const session = await readLegacyObject({ target, batchId: 'read-1', ref: 'session:session-a', offset: 0, limit: 1 })
  assert.equal(session.data.length, 1)
  assert.equal(session.hasMore, true)
  await assert.rejects(readLegacyObject({ target, batchId: 'read-1', ref: 'file:../.credentials.yaml' }), { code: 'ARCHIVE_NOT_FOUND' })
})

test('the same batch is idempotent and a changed source conflicts without overwriting', async t => {
  const { source: from, target } = setup(t)
  const first = await prepareLegacyArchive({ source: from, target, batchId: 'same', mapping })
  await verifyLegacyArchive(target, 'same')
  const published = await publishLegacyArchive(target, 'same')
  const again = await prepareLegacyArchive({ source: from, target, batchId: 'same', mapping })
  assert.deepEqual(again, published)
  write(join(from, 'memory', 'team', 'MEMORY.md'), 'changed after publish\n')
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: 'same', mapping }), { code: 'ARCHIVE_CONFLICT' })
  assert.equal(getLegacyArchive(target, 'same').source.digest, first.source.digest)
})

test('missing or newer history remains unpublished', async t => {
  const missingRoot = mkdtempSync(join(tmpdir(), 'ds-superagent-archive-missing-'))
  const newerRoot = mkdtempSync(join(tmpdir(), 'ds-superagent-archive-newer-'))
  t.after(() => { rmSync(missingRoot, { recursive: true, force: true }); rmSync(newerRoot, { recursive: true, force: true }) })
  const missingSource = source(missingRoot, { missing: true })
  const missingTarget = join(missingRoot, 'store')
  await prepareLegacyArchive({ source: missingSource, target: missingTarget, batchId: 'missing', mapping })
  const missing = await verifyLegacyArchive(missingTarget, 'missing')
  assert.equal(missing.status, 'invalid')
  assert.match(missing.errors.join(','), /MISSING_HISTORY/u)
  await assert.rejects(publishLegacyArchive(missingTarget, 'missing'), { code: 'ARCHIVE_NOT_VERIFIED' })
  const newerSource = source(newerRoot, { newer: true })
  const newerTarget = join(newerRoot, 'store')
  await prepareLegacyArchive({ source: newerSource, target: newerTarget, batchId: 'newer', mapping })
  const newer = await verifyLegacyArchive(newerTarget, 'newer')
  assert.equal(newer.status, 'invalid')
  assert.match(newer.errors.join(','), /INVALID_HISTORY/u)
  await assert.rejects(publishLegacyArchive(newerTarget, 'newer'), { code: 'ARCHIVE_NOT_VERIFIED' })
})

test('a cancelled prepare leaves no published archive and retry succeeds with the source unchanged', async t => {
  const { source: from, target } = setup(t)
  const before = treeHash(from)
  let checks = 0
  const signal = {
    get aborted() { return checks > 4 },
    throwIfAborted() { if (++checks > 4) throw new Error('cancelled') },
  }
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: 'cancel', mapping, signal }), /cancelled/u)
  assert.equal(existsSync(join(target, 'archives', 'cancel')), false)
  assert.equal(treeHash(from), before)
  await prepareLegacyArchive({ source: from, target, batchId: 'cancel', mapping })
  await verifyLegacyArchive(target, 'cancel')
  assert.equal((await publishLegacyArchive(target, 'cancel')).status, 'published')
})

test('a source change between prepare and verify is a conflict, not a published archive', async t => {
  const { source: from, target } = setup(t)
  await prepareLegacyArchive({ source: from, target, batchId: 'late', mapping })
  write(join(from, 'memory', 'team', 'MEMORY.md'), 'changed between prepare and verify\n')
  const verified = await verifyLegacyArchive(target, 'late')
  assert.equal(verified.status, 'invalid')
  assert.match(verified.errors.join(','), /SOURCE_CHANGED/u)
  await assert.rejects(publishLegacyArchive(target, 'late'), { code: 'ARCHIVE_NOT_VERIFIED' })
})

test('mapping and target paths are explicit and bounded', async t => {
  const { source: from, target, root } = setup(t)
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: 'bad-role', mapping: { roles: [{ sourceBotId: 'missing' }], sharedMemory: [] } }), { code: 'ARCHIVE_MAPPING' })
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: 'bad-role-path', mapping: { roles: [{ sourceBotId: '../escape' }], sharedMemory: [] } }), { code: 'ARCHIVE_MAPPING' })
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: '../escape', mapping }), { code: 'ARCHIVE_INPUT' })
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: 'bad-memory', mapping: { roles: [], sharedMemory: ['group:missing'] } }), { code: 'ARCHIVE_MAPPING' })
  await assert.rejects(prepareLegacyArchive({ source: from, target: join(from, 'inside'), batchId: 'inside', mapping }), { code: 'ARCHIVE_TARGET' })
  write(join(root, 'not-an-archive', 'file'), 'x')
  await assert.rejects(prepareLegacyArchive({ source: from, target: join(root, 'not-an-archive'), batchId: 'nonempty', mapping }), { code: 'ARCHIVE_TARGET' })
})

test('the archive budget and a tampered staging copy fail before publish', async t => {
  const { source: from, target } = setup(t)
  await assert.rejects(prepareLegacyArchive({ source: from, target, batchId: 'budget', mapping, limits: { maxFiles: 1 } }), { code: 'ARCHIVE_LIMIT' })
  await prepareLegacyArchive({ source: from, target, batchId: 'tamper', mapping })
  write(join(target, '.staging', 'tamper', 'state.json'), 'tampered\n')
  const verified = await verifyLegacyArchive(target, 'tamper')
  assert.equal(verified.status, 'invalid')
  assert.match(verified.errors.join(','), /COPY_MISMATCH/u)
  await assert.rejects(publishLegacyArchive(target, 'tamper'), { code: 'ARCHIVE_NOT_VERIFIED' })
})

test('a compressed zstd Session is validated and readable', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-archive-zstd-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const from = source(root)
  rmSync(join(from, 'sessions', '--team--', 'session-a', 'session.v4.jsonl'))
  write(join(from, 'sessions', '--team--', 'session-a', 'session.v4.jsonl.zstd'),
    zstdCompressSync(Buffer.from('{"seq":0,"type":"session/created"}\n{"seq":1,"type":"user/message","data":{"text":"zip"}}\n')))
  const target = join(root, 'store')
  await prepareLegacyArchive({ source: from, target, batchId: 'zstd', mapping })
  assert.equal((await verifyLegacyArchive(target, 'zstd')).status, 'verified')
  await publishLegacyArchive(target, 'zstd')
  const session = await readLegacyObject({ target, batchId: 'zstd', ref: 'session:session-a' })
  assert.equal(session.data.length, 2)
  assert.equal(session.data[1].data.text, 'zip')
})
