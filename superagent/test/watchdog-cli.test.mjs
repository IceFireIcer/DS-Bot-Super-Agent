import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/watchdog-cli.js', import.meta.url))
const hostEntry = fileURLToPath(new URL('../dev/t47-host.mjs', import.meta.url))

function run(args) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return { child, output: () => ({ stdout, stderr }), exited: new Promise(resolve => child.once('exit', (code, signal) => { resolve({ code, signal }) })) }
}

test('the Watchdog CLI refuses an incomplete command', async () => {
  const result = run([])
  const outcome = await result.exited
  assert.equal(outcome.code, 1)
  assert.match(result.output().stderr, /Usage/u)
})

test('the Watchdog CLI is its own process and restarts a real Host', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-watchdog-cli-'))
  const database = join(directory, 'state.sqlite')
  const status = join(directory, 'status.json')
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  const result = run([
    '--database', database, '--instance', 'private', '--status', status,
    '--host-command', process.execPath,
    '--host-arg', hostEntry, '--host-arg', '--database', '--host-arg', database,
    '--host-arg', '--instance', '--host-arg', 'private',
    '--host-arg', '--host-id', '--host-arg', 't47-cli', '--host-arg', '--status', '--host-arg', status,
    '--grace-ms', '10000', '--version', 't47-cli-1', '--once',
  ])
  const outcome = await result.exited
  const { stdout, stderr } = result.output()
  assert.equal(outcome.code, 0, stderr)
  const inspection = JSON.parse(stdout.trim().split('\n').at(-1))
  assert.equal(inspection.kind, 'recovered')
  assert.equal(inspection.action, 'restart')
  assert.equal(inspection.version, 't47-cli-1')
  assert.equal(inspection.epoch, 1)
  const after = JSON.parse(await readFile(status, 'utf8'))
  assert.throws(() => process.kill(after.pid, 0), 'the diagnostic CLI stopped the Host it started')
})
