import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/t59-profile.mjs', import.meta.url))

function run(home, sessions, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, '--home', home, '--sessions', sessions, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout, stderr }))
  })
}

test('the ds-superagent profile creates an Engine adapter and keeps its store under DSH_HOME', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-process-'))
  try {
    const home = join(root, 'home')
    const sessions = join(root, 'sessions')
    const first = await run(home, sessions)
    assert.equal(first.code, 0, first.stderr)
    const result = JSON.parse(first.stdout)
    assert.equal(result.userMessages, 1)
    assert.ok(result.assistantMessages > 0, 'the mock Worker result reached the chat projection')
    assert.ok(existsSync(join(home, 'core', 'state.sqlite')), 'the business store follows DSH_HOME')

    const again = await run(home, sessions)
    assert.equal(again.code, 0, again.stderr)
    assert.equal(JSON.parse(again.stdout).ticketId, result.ticketId)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the ds-superagent profile accepts a durable stop through the adapter', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-stop-'))
  try {
    const result = await run(join(root, 'home'), join(root, 'sessions'), ['--stop'])
    assert.equal(result.code, 0, result.stderr)
    assert.ok(JSON.parse(result.stdout).ticketId)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the ds-superagent profile resumes the same stopped Ticket', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-resume-'))
  try {
    const result = await run(join(root, 'home'), join(root, 'sessions'), ['--stop', '--resume'])
    assert.equal(result.code, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.ok(output.ticketId)
    assert.ok(output.assistantMessages > 0, 'the resumed Worker turn reached the chat projection')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
