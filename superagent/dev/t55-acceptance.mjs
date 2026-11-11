import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const repository = fileURLToPath(new URL('../../', import.meta.url))
const outputRoot = join(repository, '.dsh-test-t55')
const output = join(outputRoot, `run-${randomUUID()}`)
let activeChild
let interrupted
let report
const stops = []
const onInterrupt = () => { interrupted = 'SIGINT'; if (activeChild) stopTree(activeChild) }
const onTerminate = () => { interrupted = 'SIGTERM'; if (activeChild) stopTree(activeChild) }

// Freeze the scope before execution. These component rehearsals supplement the continuous mock
// scenario; none is evidence of a real second device, real-model judgement or hosted deployment.
const phases = [
  { id: 'continuous-mock', files: ['product-scenario', 'delivery-conditions'], scope: 'One mock DSH conversation, concurrent work, direction, question, stop and explicit resume; separate delivery-target contracts.' },
  { id: 'long-command-stop', files: ['jobs', 'remote-stop', 'remote-recovery'], scope: 'Actual local commands and loopback device faults; no second device.' },
  { id: 'handoff', files: ['execution-target', 'handoff', 'handoff-recovery'], scope: 'Local/loopback target selection, both handoff directions and interruption boundaries.' },
  { id: 'proactive-supervision', files: ['proactive', 'supervisor-session', 'supervisor'], scope: 'Rule-bound preparation and semantic proposals through deterministic mock Sessions.' },
  { id: 'client-host', files: ['client-process', 'watchdog-process', 'host-takeover-process'], scope: 'Independent client and Host processes, revocation, fault recovery and real isolated PostgreSQL; no hosted server.' },
  { id: 'migration', files: ['activation-process', 'reversal-process'], scope: 'Isolated mock legacy/new entry activation, crash and reverse handoff; no production app cutover.' },
]
const unaccepted = [
  'A26: one continuous real desktop/GitHub/second-device/Host/Watchdog product scenario',
  'A27-A30: a current run on the operator-designated real second device',
  'A34: current real-model and real-channel direction and privacy checks',
  'A36: a hosted server with desktop disconnect/reconnect, plus real OS sleep/shutdown recovery',
  'Real-model proactive false-trigger and semantic-supervision judgement',
]
const plan = { version: 1, model: 'mock', phaseTimeoutMs: 300_000, testFileConcurrency: 1, phases, unaccepted }
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--plan')) {
  throw new Error('Usage: node dev/t55-acceptance.mjs [--plan]')
}
if (process.argv[2] === '--plan') {
  console.log(JSON.stringify(plan, null, 2))
} else {
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  try { await main() } catch (error) {
    report ??= { version: 1, acceptanceStatus: 'not-accepted' }
    report.automatedStatus = interrupted ? 'aborted' : 'failed'
    report.error = { name: error.name, code: error.code ?? 'ACCEPTANCE_FAILED' }
    report.finishedAt = new Date().toISOString()
    await save()
    console.error(`Acceptance attempt ${report.automatedStatus}: ${report.error.code}.`)
    process.exitCode = 1
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
  }
}

async function main() {
  await mkdir(output, { recursive: true })
  report = { ...plan, startedAt: new Date().toISOString(), attempt: output.slice(outputRoot.length + 1),
    automatedStatus: 'preflight', acceptanceStatus: 'not-accepted', results: [] }
  await save()
  const evidence = []
  for (let number = 1; number <= 54; number++) {
    const ticket = `t${String(number).padStart(2, '0')}`
    const path = `docs/superagent/implementation/${ticket}.md`
    evidence.push({ ticket: ticket.toUpperCase(), path, sha256: await digest(join(repository, path)) })
  }
  const inputs = []
  for (const phase of phases) {
    for (const name of phase.files) {
      const path = `superagent/test/${name}.test.mjs`
      inputs.push({ path, sha256: await digest(join(repository, path)) })
    }
  }
  Object.assign(report, {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim(),
    environment: { platform: process.platform, arch: process.arch, node: process.version, model: 'mock', device: 'local machine and loopback only' },
    evidenceIndex: { path: 'docs/superagent/implementation/README.md', sha256: await digest(join(repository, 'docs/superagent/implementation/README.md')) },
    evidenceAudit: { path: 'docs/superagent/implementation/t55-evidence.md', sha256: await digest(join(repository, 'docs/superagent/implementation/t55-evidence.md')) },
    runnerSha256: await digest(fileURLToPath(import.meta.url)),
    evidence, inputs, automatedStatus: 'running',
  })
  await save()
  const build = await run('build', ['scripts/build.mjs'])
  report.build = build
  await save()
  if (build.status === 'passed') {
    for (const phase of phases) {
      console.log(`Running ${phase.id}: ${phase.scope}`)
      const result = await run(phase.id, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...phase.files.map(name => `test/${name}.test.mjs`)])
      report.results.push(result)
      await save()
      console.log(`${phase.id}: ${result.status}; ${result.counts?.pass ?? 0} pass, ${result.counts?.fail ?? 0} fail, ${result.counts?.skipped ?? 0} skipped`)
    }
  }
  report.automatedStatus = interrupted ? 'aborted' : build.status === 'passed' && report.results.length === phases.length && report.results.every(result => result.status === 'passed') ? 'passed' : 'failed'
  report.finishedAt = new Date().toISOString()
  await save()
  console.log(`Automated rehearsal: ${report.automatedStatus}. Full product acceptance: ${report.acceptanceStatus}.`)
  console.log('Report and local diagnostic logs: .dsh-test-t55/ (logs must not be published).')
  // An incomplete acceptance is a distinct non-success outcome even when every mock check passes.
  process.exitCode = report.automatedStatus === 'passed' ? 2 : 1
}

async function save() {
  const json = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(join(output, 'report.json'), json)
  await writeFile(join(outputRoot, 'report.json'), json)
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function run(id, args) {
  if (interrupted) throw new Error('Acceptance interrupted.')
  const started = performance.now()
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  activeChild = child
  const chunks = []
  let size = 0
  let timedOut = false
  let overflow = false
  let startFailed = false
  const capture = data => {
    size += data.length
    if (size <= 8 * 1024 * 1024) chunks.push(data)
    else if (!overflow) { overflow = true; stopTree(child) }
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const timer = setTimeout(() => { timedOut = true; stopTree(child) }, plan.phaseTimeoutMs)
  const code = await new Promise(resolve => {
    child.once('error', () => { startFailed = true; resolve(null) })
    child.once('close', resolve)
  })
  clearTimeout(timer)
  await Promise.all(stops)
  activeChild = undefined
  const log = Buffer.concat(chunks).toString('utf8')
  await writeFile(join(output, `${id}.log`), log)
  const counts = id === 'build' ? undefined : Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const match = log.match(new RegExp(`^# ${key} (\\d+)\\r?$`, 'm'))
    return [key, match ? Number(match[1]) : null]
  }))
  const verified = !counts || (counts.tests > 0 && counts.pass > 0 && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0)
  return { id, status: code === 0 && !timedOut && !overflow && !startFailed && !interrupted && verified ? 'passed' : 'failed', exitCode: code,
    timedOut, overflow, startFailed, durationMs: Math.round(performance.now() - started), ...(counts ? { counts } : {}) }
}

function stopTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const stop = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    stops.push(new Promise(resolve => {
      stop.once('error', () => { child.kill(); resolve() })
      stop.once('close', code => { if (code !== 0) child.kill(); resolve() })
    }))
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill() }
  }
}
