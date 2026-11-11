import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ds-superagent-t55-cli-'))
  const runner = join(directory, 'superagent/dev/t55-acceptance.mjs')
  const cleanups = []
  mkdirSync(join(directory, 'superagent/dev'), { recursive: true })
  copyFileSync(new URL('../dev/t55-acceptance.mjs', import.meta.url), runner)
  t.after(async () => {
    const errors = []
    for (const cleanup of cleanups) {
      try { await cleanup() } catch (error) { errors.push(error) }
    }
    try {
      assert.ok(directory.startsWith(join(tmpdir(), 'ds-superagent-t55-cli-')))
      rmSync(directory, { recursive: true, force: true })
    } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'CLI fixture cleanup failed.')
  })
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const output = join(directory, '.dsh-test-t55')
  const run = (...args) => spawnSync(process.execPath, [runner, ...args], { cwd: directory, env, encoding: 'utf8', timeout: 10000, windowsHide: true })
  return { directory, runner, output, env, run, cleanups }
}

function previousSuccess(output) {
  mkdirSync(join(output, 'run-previous'), { recursive: true })
  const prior = `${JSON.stringify({ attempt: 'run-previous', automatedStatus: 'passed', acceptanceStatus: 'not-accepted', finishedAt: '2026-01-01T00:00:00.000Z' })}\n`
  writeFileSync(join(output, 'report.json'), prior)
  writeFileSync(join(output, 'run-previous/report.json'), prior)
  return prior
}

test('T55 preflight failure replaces a previous success and archives the failed attempt', t => {
  const { output, run } = fixture(t)
  const prior = previousSuccess(output)
  // No t01 document exists: the public CLI must publish this attempt's failure before building.
  const result = run()
  assert.equal(result.error, undefined, result.stderr)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const latest = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
  assert.equal(latest.automatedStatus, 'failed')
  assert.equal(latest.acceptanceStatus, 'not-accepted')
  assert.equal(latest.error.code, 'ENOENT')
  assert.match(latest.attempt, /^run-[0-9a-f-]{36}$/u)
  assert.notEqual(latest.attempt, 'run-previous')
  assert.ok(Number.isFinite(Date.parse(latest.startedAt)))
  assert.ok(Number.isFinite(Date.parse(latest.finishedAt)))
  assert.deepEqual(latest.results, [])
  assert.deepEqual(JSON.parse(readFileSync(join(output, latest.attempt, 'report.json'), 'utf8')), latest)
  assert.equal(readFileSync(join(output, 'run-previous/report.json'), 'utf8'), prior)
})

test('T55 --plan needs no prerequisites and leaves prior evidence untouched', t => {
  const { directory, output, run } = fixture(t)
  const result = run('--plan')
  assert.equal(result.error, undefined, result.stderr)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.model, 'mock')
  assert.equal(plan.phaseTimeoutMs, 300000)
  assert.equal(plan.testFileConcurrency, 1)
  assert.deepEqual(plan.phases.map(phase => phase.id), ['continuous-mock', 'long-command-stop', 'handoff', 'proactive-supervision', 'client-host', 'migration'])
  assert.equal(plan.phases[0].files.includes('product-scenario'), true)
  assert.ok(plan.unaccepted.some(item => item.startsWith('A26:')))
  assert.equal(existsSync(output), false)
  const prior = previousSuccess(output)
  const before = readdirSync(directory, { recursive: true }).sort()
  const repeat = run('--plan')
  assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr)
  assert.deepEqual(JSON.parse(repeat.stdout), plan)
  assert.deepEqual(readdirSync(directory, { recursive: true }).sort(), before)
  assert.equal(readFileSync(join(output, 'report.json'), 'utf8'), prior)
  assert.equal(readFileSync(join(output, 'run-previous/report.json'), 'utf8'), prior)
})

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    // A group kill can briefly leave an orphan zombie until the OS reaps it; it cannot execute work.
    if (process.platform === 'linux' && /\) Z /u.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false
    return true
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false
    throw error
  }
}

async function until(check, label) {
  const deadline = Date.now() + 10000
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`)
    await sleep(20)
  }
}

test('T55 real SIGTERM aborts the report and terminates its build process tree', {
  skip: process.platform === 'win32' ? 'Windows child.kill(SIGTERM) force-terminates the process; it does not safely exercise the POSIX signal handler.' : false,
  timeout: 30000,
}, async t => {
  const { directory, runner, output, env, run, cleanups } = fixture(t)
  const planResult = run('--plan')
  assert.equal(planResult.status, 0, planResult.stderr)
  const plan = JSON.parse(planResult.stdout)
  const implementation = join(directory, 'docs/superagent/implementation')
  mkdirSync(implementation, { recursive: true })
  for (let number = 1; number <= 54; number++) writeFileSync(join(implementation, `t${String(number).padStart(2, '0')}.md`), `Fixture evidence T${number}.\n`)
  for (const name of ['README.md', 't55-evidence.md']) writeFileSync(join(implementation, name), 'Fixture evidence index.\n')
  mkdirSync(join(directory, 'superagent/test'), { recursive: true })
  for (const phase of plan.phases) for (const name of phase.files) {
    writeFileSync(join(directory, `superagent/test/${name}.test.mjs`), "throw new Error('An interrupted build must never reach a phase.');\n")
  }
  // The runner only queries HEAD; a minimal isolated Git fixture avoids touching the working repo.
  mkdirSync(join(directory, '.git/objects'), { recursive: true })
  mkdirSync(join(directory, '.git/refs'), { recursive: true })
  writeFileSync(join(directory, '.git/HEAD'), `${'1'.repeat(40)}\n`)
  mkdirSync(join(directory, 'superagent/scripts'), { recursive: true })
  writeFileSync(join(directory, 'superagent/scripts/build.mjs'), `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const worker = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 20000)'], { stdio: 'ignore' })
await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject) })
const started = { buildPid: process.pid, workerPid: worker.pid }
writeFileSync('build-started.json', JSON.stringify(started))
console.log(JSON.stringify(started))
setTimeout(() => process.exit(0), 20000)
`)
  const child = spawn(process.execPath, [runner], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const logs = []
  child.stdout.on('data', data => logs.push(data))
  child.stderr.on('data', data => logs.push(data))
  const closed = new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', reject) })
  let started
  cleanups.push(async () => {
    const errors = []
    for (const terminate of [
      () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') },
      ...(started ? [started.workerPid, started.buildPid] : []).map(pid => () => {
        if (isAlive(pid)) process.kill(pid, 'SIGKILL')
      }),
    ]) {
      try { terminate() } catch (error) { if (error.code !== 'ESRCH') errors.push(error) }
    }
    try { await closed } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'CLI process cleanup failed.')
  })
  const marker = join(directory, 'superagent/build-started.json')
  await until(() => existsSync(marker) || child.exitCode !== null || child.signalCode !== null, 'the fixture build process')
  assert.equal(existsSync(marker), true, Buffer.concat(logs).toString('utf8'))
  started = JSON.parse(readFileSync(marker, 'utf8'))
  assert.equal(isAlive(started.buildPid), true)
  assert.equal(isAlive(started.workerPid), true)
  const latestPath = join(output, 'report.json')
  const running = JSON.parse(readFileSync(latestPath, 'utf8'))
  assert.equal(running.automatedStatus, 'running')
  // Let the build's startup log reach the runner before interrupting so archiving is deterministic.
  await sleep(50)
  assert.equal(child.kill('SIGTERM'), true)
  await until(() => child.exitCode !== null || child.signalCode !== null, 'the interrupted runner to exit')
  const exit = await closed
  assert.deepEqual(exit, { code: 1, signal: null }, Buffer.concat(logs).toString('utf8'))
  await until(() => !isAlive(started.buildPid) && !isAlive(started.workerPid), 'the build and its descendant to terminate')
  const latest = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
  assert.equal(latest.automatedStatus, 'aborted')
  assert.equal(latest.acceptanceStatus, 'not-accepted')
  assert.deepEqual(latest.results, [])
  assert.ok(Number.isFinite(Date.parse(latest.finishedAt)))
  assert.deepEqual(JSON.parse(readFileSync(join(output, latest.attempt, 'report.json'), 'utf8')), latest)
  const buildLog = readFileSync(join(output, latest.attempt, 'build.log'), 'utf8')
  assert.ok(buildLog.includes(String(started.workerPid)), 'The archived log must contain the real descendant PID emitted by the fixture build.')
})
