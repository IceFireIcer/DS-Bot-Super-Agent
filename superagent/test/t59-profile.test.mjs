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

test('the product profile keeps one Main across windows and process restarts in its own home', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-process-'))
  try {
    const home = join(root, 'home')
    const sessions = join(root, 'sessions')
    const first = await run(home, sessions)
    assert.equal(first.code, 0, first.stderr)
    const result = JSON.parse(first.stdout)
    assert.equal(result.userMessages, 1)
    assert.equal(result.mainMessages, 1)
    assert.equal(result.sameMain, true)
    assert.equal(result.legacyAdapter, false)
    assert.equal(result.crossInstanceDenied, true)
    assert.ok(existsSync(join(home, 'core', 'state.sqlite')), 'the business store follows DSH_HOME')

    const again = await run(home, sessions)
    assert.equal(again.code, 0, again.stderr)
    assert.equal(JSON.parse(again.stdout).mainId, result.mainId)
    assert.equal(JSON.parse(again.stdout).userMessages, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
