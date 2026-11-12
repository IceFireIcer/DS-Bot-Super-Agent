import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const usage = `Usage: npm run test:stress -- <test file...> [--runs <n>] [--concurrency <n>] [--timeout <seconds>] [--out <dir>]
Runs one built test file repeatedly in independent processes and keeps each log for diagnosis.`

export function parseTap(text) {
  const completed = []
  const failed = []
  let trace
  for (const line of text.split(/\r?\n/u)) {
    const test = line.match(/^\s*(?:not\s+)?ok\s+\d+\s+-\s+(.+)$/u)
    if (test) {
      completed.push(test[1])
      if (/^\s*not\s+ok\b/u.test(line)) failed.push(test[1])
    }
    const traced = line.match(/^(?:\s*#\s*)?(?:trace|node|step):\s*(.+)$/iu)
    if (traced) trace = traced[1].trim()
  }
  return { lastCompleted: completed.at(-1), failed, trace }
}

export function summarize(results, { runs, concurrency, files, durationMs }) {
  const failed = results.filter(result => !result.passed)
  const lastCompleted = results.reduce((latest, result) => (
    !latest || (result.finishedAt ?? 0) >= (latest.finishedAt ?? 0) ? result : latest
  ), undefined)?.lastCompleted
  return {
    runs, concurrency, files, durationMs,
    passed: runs - failed.length,
    failed: failed.length,
    failureRate: runs ? failed.length / runs : 0,
    lastCompleted,
    failures: failed.map(result => ({
      run: result.run, log: result.log, exitCode: result.exitCode, timedOut: result.timedOut,
      lastCompleted: result.lastCompleted, trace: result.trace, failedTests: result.failed ?? result.failedTests,
    })),
  }
}

function options(args) {
  const files = args.filter(arg => !arg.startsWith('-') && arg.endsWith('.test.mjs')).map(file => file.replaceAll('\\', '/'))
  const values = new Map()
  const flags = new Set()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (files.includes(arg)) continue
    if (arg === '--help') { flags.add('help'); continue }
    if (['--runs', '--concurrency', '--timeout', '--out'].includes(arg)) {
      if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error(`${arg} needs a value.\n${usage}`)
      values.set(arg, args[++index])
      continue
    }
    throw new Error(`Unknown argument ${arg}.\n${usage}`)
  }
  if (flags.has('help')) return { help: true }
  if (!files.length) throw new Error(`Pass at least one test file.\n${usage}`)
  const number = (name, fallback, minimum) => {
    const value = Number(values.get(name) ?? fallback)
    if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`)
    return value
  }
  return {
    files,
    runs: number('--runs', 20, 1),
    concurrency: number('--concurrency', 4, 1),
    timeoutMs: number('--timeout', 120, 1) * 1000,
    out: values.get('--out') ?? join('.dsh-test-stress', `stress-${new Date().toISOString().replace(/[:.]/gu, '-')}`),
  }
}

function stopTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const stop = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    stop.once('error', () => child.kill())
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill() }
  }
}

async function runOne({ run, files, timeoutMs, out }) {
  const log = join(out, `run-${String(run).padStart(3, '0')}.log`)
  const stream = createWriteStream(log)
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...files], {
    cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  let tail = ''
  let timedOut = false
  const capture = chunk => {
    const text = chunk.toString('utf8')
    tail = (tail + text).slice(-256 * 1024)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.stdout.pipe(stream, { end: false })
  child.stderr.pipe(stream, { end: false })
  const timer = setTimeout(() => { timedOut = true; stopTree(child) }, timeoutMs)
  const exitCode = await new Promise(resolve => {
    child.once('error', () => resolve(null))
    child.once('close', resolve)
  })
  clearTimeout(timer)
  await new Promise(resolve => stream.end(resolve))
  const parsed = parseTap(tail)
  return { run, log, exitCode, timedOut, passed: exitCode === 0 && !timedOut, finishedAt: performance.now(), ...parsed }
}

async function main(args) {
  const config = options(args)
  if (config.help) { console.log(usage); return }
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status ?? 1)
  await mkdir(join(root, config.out), { recursive: true })
  const started = performance.now()
  const results = []
  let next = 0
  const worker = async () => {
    while (next < config.runs) {
      const run = ++next
      const result = await runOne({ run, files: config.files, timeoutMs: config.timeoutMs, out: join(root, config.out) })
      results.push(result)
      console.log(`run ${run}/${config.runs}: ${result.passed ? 'pass' : 'FAIL'} (${result.log})`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.concurrency, config.runs) }, worker))
  results.sort((left, right) => left.run - right.run)
  const summary = summarize(results, { ...config, durationMs: Math.round(performance.now() - started) })
  console.log(`\n${summary.passed}/${summary.runs} passed; ${(summary.failureRate * 100).toFixed(1)}% failed in ${summary.durationMs} ms`)
  if (summary.lastCompleted) console.log(`Last completed test: ${summary.lastCompleted}`)
  if (summary.failures.length) {
    console.log('Failed runs:')
    for (const failure of summary.failures) {
      const reason = failure.timedOut ? 'timeout' : `exit ${failure.exitCode}`
      console.log(`- run ${failure.run}: ${reason}; last ${failure.lastCompleted ?? 'unknown'}; log ${failure.log}`)
      if (failure.trace) console.log(`  trace: ${failure.trace}`)
      for (const test of failure.failedTests ?? []) console.log(`  failed: ${test}`)
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : 'Stress run could not start.')
    process.exitCode = 1
  })
}
