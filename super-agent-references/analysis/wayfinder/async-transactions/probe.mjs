import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const here = dirname(fileURLToPath(import.meta.url))
const transactionScope = new AsyncLocalStorage()
const schema = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS ticket (id TEXT PRIMARY KEY, direction TEXT NOT NULL, stopped INTEGER NOT NULL DEFAULT 0,
  assignment INTEGER NOT NULL DEFAULT 1, steps INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS effect (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS receipt (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
`
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex')

class Connection {
  constructor(path) {
    this.pending = new Map(); this.next = 0; this.broken = undefined
    this.worker = new Worker(new URL('./sqlite-worker.mjs', import.meta.url), { workerData: { path } })
    this.worker.on('message', ({ id, value, error }) => {
      const request = this.pending.get(id); this.pending.delete(id)
      if (!request) return
      clearTimeout(request.timeout)
      if (error) request.reject(new Error(error)); else request.resolve(value)
    })
    this.worker.on('error', error => this.fail(error))
    this.worker.on('exit', () => this.fail(new Error('SQLite worker exited')))
  }
  fail(error) {
    this.broken = error
    for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(error) }
    this.pending.clear()
  }
  request(op, sql, args = []) {
    if (this.broken) return Promise.reject(this.broken)
    const id = ++this.next; const p = deferred()
    p.timeout = setTimeout(() => { this.fail(new Error('SQLite worker request timed out')); void this.worker.terminate() }, 10000)
    this.pending.set(id, p)
    this.worker.postMessage({ id, op, sql, args }); return p.promise
  }
  async close() { try { if (!this.broken) await this.request('close') } finally { await this.worker.terminate() } }
}

class Tx {
  constructor(connection) { this.connection = connection; this.active = true }
  request(op, sql, args = []) {
    if (!this.active) throw new Error('transaction scope closed')
    return this.connection.request(op, sql, args)
  }
  run(sql, args) { return this.request('run', sql, args) }
  get(sql, args) { return this.request('get', sql, args) }
  all(sql, args) { return this.request('all', sql, args) }
}

class Store {
  constructor(connection) { this.connection = connection; this.tail = Promise.resolve() }
  async atomic(work, { readOnly = false } = {}) {
    if (transactionScope.getStore() === this) throw new Error('nested transaction: pass the existing Tx to internal helpers')
    const previous = this.tail; const release = deferred(); this.tail = release.promise
    await previous
    const tx = new Tx(this.connection)
    try {
      await this.connection.request('exec', readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE')
      try {
        const result = await transactionScope.run(this, () => work(tx))
        await this.connection.request('exec', 'COMMIT')
        return result
      } catch (error) {
        await this.connection.request('exec', 'ROLLBACK')
        throw error
      }
    } finally { tx.active = false; release.resolve() }
  }
}

async function enqueue(tx, id, payload) {
  await tx.run(`INSERT INTO effect(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE
    SET payload=excluded.payload, generation=generation+1, attempts=0, due=0`, [id, JSON.stringify(payload)])
}

// A deliberately small original model of Engine commands, not an asynchronous port of the reference Engine.
class Engine {
  constructor(store, wake = () => {}) { this.store = store; this.wake = wake; this.wakeErrors = [] }
  async command(id, input, hooks = {}) {
    const result = await this.store.atomic(async tx => {
      const old = await tx.get('SELECT * FROM receipt WHERE id=?', [id])
      if (old) {
        if (old.fingerprint !== fingerprint(input)) throw new Error('command ID reused with different input')
        return JSON.parse(old.result)
      }
      const { ticket = 'work', kind, direction = 'A' } = input
      if (kind === 'create') await tx.run('INSERT INTO ticket(id, direction) VALUES (?, ?)', [ticket, direction])
      else if (kind === 'revise') await tx.run('UPDATE ticket SET direction=?, revision=revision+1 WHERE id=? AND stopped=0', [direction, ticket])
      else if (kind === 'increment') {
        const row = await tx.get('SELECT * FROM ticket WHERE id=?', [ticket])
        await hooks.afterRead?.(row)
        await tx.run('UPDATE ticket SET steps=?, revision=revision+1 WHERE id=? AND stopped=0', [row.steps + 1, ticket])
      } else if (kind === 'replace') await tx.run('UPDATE ticket SET assignment=assignment+1, revision=revision+1 WHERE id=? AND stopped=0', [ticket])
      else if (kind === 'stop') await tx.run('UPDATE ticket SET stopped=1, assignment=assignment+1, revision=revision+1 WHERE id=?', [ticket])
      else throw new Error('unknown command')
      await hooks.afterState?.()
      const row = await tx.get('SELECT * FROM ticket WHERE id=?', [ticket])
      if (kind === 'stop') {
        await tx.run('DELETE FROM effect WHERE id=?', [ticket + ':deliver'])
        await enqueue(tx, ticket + ':stop', { assignment: row.assignment })
      } else if (!row.stopped) await enqueue(tx, ticket + ':deliver', row)
      await hooks.afterEffect?.()
      await tx.run('INSERT INTO receipt VALUES (?, ?, ?)', [id, fingerprint(input), JSON.stringify(row)])
      await hooks.beforeCommit?.()
      return row
    })
    // A failed notification cannot roll back a committed command or be its durability mechanism.
    try { await this.wake() } catch (error) { this.wakeErrors.push(String(error)) }
    return result
  }
  inspect() {
    return this.store.atomic(async tx => ({
      tickets: await tx.all('SELECT * FROM ticket ORDER BY id'),
      effects: await tx.all('SELECT * FROM effect ORDER BY seq'),
      receipts: await tx.all('SELECT * FROM receipt ORDER BY id'),
    }), { readOnly: true })
  }
  settle(attempt, outcome = 'success') {
    return this.store.atomic(async tx => {
      const guard = [attempt.id, attempt.seq, attempt.generation]
      const where = 'id=? AND seq=? AND generation=?'
      if (outcome === 'success') return (await tx.run('DELETE FROM effect WHERE ' + where, guard)).changes
      if (outcome === 'failure') return (await tx.run('UPDATE effect SET attempts=attempts+1, due=100 WHERE ' + where, guard)).changes
      return (await tx.run('UPDATE effect SET due=100 WHERE ' + where, guard)).changes
    })
  }
  recordCompletion(ticket, assignment) {
    return this.store.atomic(async tx => (await tx.run(`UPDATE ticket SET direction='completed', revision=revision+1
      WHERE id=? AND assignment=? AND stopped=0`, [ticket, assignment])).changes)
  }
}

async function setup(path) {
  const connection = new Connection(path)
  await connection.request('exec', schema)
  return connection
}

async function crashChild(phase, path) {
  const connection = await setup(path); const store = new Store(connection)
  if (phase === 'split-enqueue') {
    await store.atomic(tx => tx.run("INSERT INTO ticket(id,direction) VALUES ('split','A')"))
  } else {
    const barrier = async () => { process.send('barrier'); await new Promise(() => {}) }
    const engine = new Engine(store, phase === 'after-commit' ? barrier : () => {})
    await engine.command('crash-command', { kind: 'create', ticket: 'crash' }, phase === 'before-commit' ? { beforeCommit: barrier } : {})
  }
  process.send('barrier')
  await new Promise(() => {})
}

async function killAtBarrier(phase, path) {
  const child = fork(fileURLToPath(import.meta.url), ['--crash', phase, path], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; child.stderr.on('data', x => { stderr += x })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000)
  try {
    const reached = await Promise.race([
      once(child, 'message').then(([message]) => message),
      once(child, 'exit').then(([code]) => { throw new Error(`child exited before barrier: ${code}: ${stderr}`) }),
    ])
    assert.equal(reached, 'barrier')
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL') }
}

async function run() {
  const runDir = await mkdtemp(join(here, '.dsh-test-async-transactions-'))
  const connections = []
  const open = async name => { const c = await setup(join(runDir, name + '.sqlite')); connections.push(c); return c }
  const cases = []
  const check = async (name, evidence, work) => {
    const detail = await work(); cases.push({ name, evidence, passed: true, detail })
    console.log('PASS ' + name)
  }
  const start = Date.now()
  try {
    await check('N1 sync-style RELEASE before async callback settles', 'negative-control', async () => {
      const c = await open('naive'); const gate = deferred(); const entered = deferred()
      await c.request('exec', 'BEGIN IMMEDIATE')
      const work = (async () => {
        await c.request('run', "INSERT INTO ticket(id,direction) VALUES ('bad','A')")
        entered.resolve(); await gate.promise; throw new Error('late rejection')
      })()
      const rejected = assert.rejects(work, /late rejection/)
      await entered.promise; await c.request('exec', 'COMMIT'); gate.resolve(); await rejected
      assert.equal((await c.request('get', 'SELECT COUNT(*) AS n FROM ticket')).n, 1)
      return 'Late rejection leaves committed state: invariant violation reproduced.'
    })

    await check('N2 transaction-local microtask dispatch leaks uncommitted effect', 'negative-control', async () => {
      const c = await open('early'); const store = new Store(c); const emitted = []
      await assert.rejects(store.atomic(async tx => {
        await tx.run("INSERT INTO ticket(id,direction) VALUES ('bad','A')")
        await enqueue(tx, 'bad:deliver', { direction: 'A' })
        const fired = deferred()
        queueMicrotask(async () => { emitted.push(await tx.get('SELECT * FROM effect')); fired.resolve() })
        await fired.promise; throw new Error('rollback after dispatch')
      }), /rollback after dispatch/)
      assert.equal(emitted.length, 1)
      assert.equal((await c.request('get', 'SELECT COUNT(*) AS n FROM effect')).n, 0)
      return 'Handler ran once although durable state/effect rolled back.'
    })

    await check('N3 enqueue only after state commit loses effect on process death', 'negative-control', async () => {
      const path = join(runDir, 'split.sqlite'); await killAtBarrier('split-enqueue', path)
      const c = await setup(path); connections.push(c)
      assert.equal((await c.request('get', 'SELECT COUNT(*) AS n FROM ticket')).n, 1)
      assert.equal((await c.request('get', 'SELECT COUNT(*) AS n FROM effect')).n, 0)
      return 'Actual child process terminated after state commit, before separate enqueue.'
    })

    await check('P1 failures after state, after effect, and before commit roll back everything', 'real-sqlite', async () => {
      const c = await open('rollback'); let wakes = 0
      const e = new Engine(new Store(c), () => { wakes++ })
      for (const hook of ['afterState', 'afterEffect', 'beforeCommit']) {
        await assert.rejects(e.command(hook, { kind: 'create' }, { [hook]: () => { throw new Error(hook) } }), new RegExp(hook))
        assert.deepEqual(await e.inspect(), { tickets: [], effects: [], receipts: [] })
      }
      assert.equal(wakes, 0)
      return 'All three failure windows: no state, intent, receipt, or wake.'
    })

    await check('P2 independent reader sees no partial transaction across await', 'two-real-connections', async () => {
      const c = await open('visibility'); const reader = await open('visibility')
      let wakes = 0; const e = new Engine(new Store(c), () => { wakes++ })
      const query = new Engine(new Store(reader)); const gate = deferred(); const entered = deferred()
      const command = e.command('create', { kind: 'create' }, { afterEffect: async () => { entered.resolve(); await gate.promise } })
      await entered.promise
      try {
        assert.deepEqual(await query.inspect(), { tickets: [], effects: [], receipts: [] })
        assert.equal(wakes, 0)
      } finally { gate.resolve() }
      await command
      assert.equal((await query.inspect()).effects.length, 1); assert.equal(wakes, 1)
      return 'WAL reader standing in for a dispatcher stays responsive and sees only committed rows; no real dispatcher was run.'
    })

    for (const phase of ['before-commit', 'after-commit']) {
      await check('P3 process death ' + phase, 'actual-child-process-termination', async () => {
        const path = join(runDir, phase + '.sqlite'); await killAtBarrier(phase, path)
        const c = await setup(path); connections.push(c); const e = new Engine(new Store(c))
        const state = await e.inspect(); const expected = phase === 'before-commit' ? 0 : 1
        assert.equal(state.tickets.length, expected); assert.equal(state.effects.length, expected); assert.equal(state.receipts.length, expected)
        if (expected) {
          const replay = await e.command('crash-command', { kind: 'create', ticket: 'crash' })
          assert.equal(replay.id, 'crash'); assert.equal((await e.inspect()).effects.length, 1)
          assert.equal(await e.settle(state.effects[0]), 1)
        }
        return expected ? 'Committed intent recovered by scan without wake; same command ID replayed without duplicate enqueue.' : 'Uncommitted state/intent/receipt all absent on fresh connection.'
      })
    }

    await check('P4 two Engine connections serialize concurrent read-await-write commands', 'two-real-connections', async () => {
      const c1 = await open('concurrent'); const c2 = await open('concurrent')
      const a = new Engine(new Store(c1)); const b = new Engine(new Store(c2))
      await a.command('create', { kind: 'create' })
      const gate = deferred(); const entered = deferred()
      const first = a.command('held', { kind: 'increment' }, { afterRead: async () => { entered.resolve(); await gate.promise } })
      await entered.promise
      const second = b.command('second', { kind: 'increment' })
      gate.resolve(); await Promise.all([first, second])
      await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).command('inc-' + i, { kind: 'increment' })))
      const state = await a.inspect()
      assert.equal(state.tickets[0].steps, 26); assert.equal(state.effects[0].generation, 27)
      assert.equal(state.receipts.length, 27)
      return { committedIncrements: 26, lostUpdates: 0, effectGeneration: 27 }
    })

    await check('P5 concurrent duplicate command IDs deduplicate; changed payload is rejected', 'two-real-connections', async () => {
      const a = new Engine(new Store(await open('dedup'))); const b = new Engine(new Store(await open('dedup')))
      const [x, y] = await Promise.all([a.command('same', { kind: 'create' }), b.command('same', { kind: 'create' })])
      assert.deepEqual(x, y)
      assert.equal((await a.inspect()).effects[0].generation, 1)
      await assert.rejects(a.command('same', { kind: 'create', direction: 'B' }), /different input/)
      const original = await a.command('ordered', { kind: 'create', ticket: 'ordered' })
      assert.deepEqual(await b.command('ordered', { ticket: 'ordered', kind: 'create' }), original)
      return 'One durable receipt and enqueue; command identity binds canonical input.'
    })

    await check('P6 old success/failure/defer cannot change a revised effect', 'real-sqlite', async () => {
      const e = new Engine(new Store(await open('generation')))
      await e.command('create', { kind: 'create' }); const old = (await e.inspect()).effects[0]
      await e.command('revise', { kind: 'revise', direction: 'B' }); const current = (await e.inspect()).effects[0]
      for (const outcome of ['success', 'failure', 'defer']) assert.equal(await e.settle(old, outcome), 0)
      assert.deepEqual((await e.inspect()).effects[0], current)
      assert.equal(current.seq, old.seq); assert.equal(current.generation, old.generation + 1)
      return 'Stable queue position, new generation, no stale deletion/backoff/defer.'
    })

    await check('P7 delete/re-enqueue protects against same-key generation ABA', 'real-sqlite', async () => {
      const store = new Store(await open('aba')); const e = new Engine(store)
      await e.command('create', { kind: 'create' }); const old = (await e.inspect()).effects[0]
      await store.atomic(async tx => { await tx.run('DELETE FROM effect WHERE id=?', [old.id]); await enqueue(tx, old.id, { direction: 'new' }) })
      const current = (await e.inspect()).effects[0]
      assert.equal(current.generation, old.generation); assert.notEqual(current.seq, old.seq)
      assert.equal(await e.settle(old), 0); assert.deepEqual((await e.inspect()).effects[0], current)
      return 'New monotonic row incarnation prevents generation reuse from accepting stale completion.'
    })

    await check('P8 replaced Assignment and human stop reject late domain callbacks', 'real-sqlite', async () => {
      const e = new Engine(new Store(await open('stop')))
      await e.command('create', { kind: 'create' })
      await e.command('replace', { kind: 'replace' })
      assert.equal(await e.recordCompletion('work', 1), 0)
      assert.equal(await e.recordCompletion('work', 2), 1)
      await e.command('stop', { kind: 'stop' }); const stopped = await e.inspect()
      assert.equal(await e.recordCompletion('work', 2), 0)
      assert.deepEqual(await e.inspect(), stopped); assert.equal(stopped.tickets[0].stopped, 1)
      assert.deepEqual(stopped.effects.map(x => x.id), ['work:stop'])
      return 'Effect settlement and domain callback fencing are separate checks; no claim that remote execution has stopped.'
    })

    await check('P9 failed post-commit wake cannot turn durable success into rollback', 'real-sqlite', async () => {
      const store = new Store(await open('wake')); const e = new Engine(store, () => { throw new Error('wake unavailable') })
      assert.equal((await e.command('create', { kind: 'create' })).id, 'work')
      assert.equal(e.wakeErrors.length, 1)
      assert.equal((await new Engine(store).inspect()).effects.length, 1)
      return 'Wake is an optimization; startup/periodic scan recovers committed intent.'
    })

    await check('P10 leaked transaction capability is rejected after commit', 'real-sqlite', async () => {
      const store = new Store(await open('scope')); let leaked
      await store.atomic(async tx => {
        leaked = tx; await tx.get('SELECT 1')
        await assert.rejects(store.atomic(() => {}), /nested transaction/)
      })
      assert.throws(() => leaked.get('SELECT 1'), /scope closed/)
      return 'No shared transaction/depth field; nested UoW rejects immediately instead of waiting on its own connection queue.'
    })

    await check('P11 snapshot plus small-model revision CAS detects and replays conflict', 'real-sqlite-alternative', async () => {
      const a = new Engine(new Store(await open('optimistic'))); const b = new Engine(new Store(await open('optimistic')))
      await a.command('create', { kind: 'create' })
      const snapshotA = (await a.inspect()).tickets[0]; const snapshotB = (await b.inspect()).tickets[0]
      const commit = (e, snapshot) => e.store.atomic(async tx => {
        const result = await tx.run('UPDATE ticket SET steps=?, revision=revision+1 WHERE id=? AND revision=?', [snapshot.steps + 1, snapshot.id, snapshot.revision])
        if (!result.changes) return false
        await enqueue(tx, 'work:deliver', { steps: snapshot.steps + 1 }); return true
      })
      assert.equal(await commit(a, snapshotA), true); assert.equal(await commit(b, snapshotB), false)
      assert.equal(await commit(b, (await b.inspect()).tickets[0]), true)
      const state = await a.inspect(); assert.equal(state.tickets[0].steps, 2); assert.equal(state.effects[0].generation, 3)
      return 'Viable small-model alternative; does not prove cross-aggregate snapshot completeness or safe replay of full reference rules.'
    })

    await check('P12 read-only storage rejects command without dispatch', 'real-sqlite-readonly-fault', async () => {
      const c = await open('unavailable'); await c.request('exec', 'PRAGMA query_only = ON')
      let wakes = 0; const e = new Engine(new Store(c), () => { wakes++ })
      await assert.rejects(e.command('create', { kind: 'create' }), /readonly/)
      assert.equal(wakes, 0); assert.deepEqual(await e.inspect(), { tickets: [], effects: [], receipts: [] })
      return 'Read-only storage fault causes no accepted durable state and no wake; not a network-partition experiment.'
    })

    const result = {
      scope: 'Original minimal asynchronous Engine/storage contract experiment; not reference Engine port, DSH integration, PostgreSQL, remote device, or production backend acceptance.',
      environment: { node: process.version, platform: process.platform, sqlite: (await connections[0].request('get', 'SELECT sqlite_version() AS version')).version, journalMode: 'WAL', synchronous: 'FULL' },
      counts: { negativeControls: cases.filter(x => x.evidence === 'negative-control').length, positiveCases: cases.filter(x => x.evidence !== 'negative-control').length, passed: cases.length },
      elapsedMs: Date.now() - start, cases,
    }
    await writeFile(join(here, 'results.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result.counts))
  } finally {
    await Promise.allSettled(connections.map(c => c.close()))
    assert.equal(dirname(resolve(runDir)), resolve(here))
    assert.ok(basename(runDir).startsWith('.dsh-test-async-transactions-'))
    await rm(runDir, { recursive: true, force: true })
  }
}

if (process.argv[2] === '--crash') await crashChild(process.argv[3], process.argv[4])
else await run()
