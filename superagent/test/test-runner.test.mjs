import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

function fixture(t, build) {
  const directory = mkdtempSync(join(tmpdir(), 'ds-bot-test-runner-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'scripts')); mkdirSync(join(directory, 'test'))
  copyFileSync(new URL('../scripts/test.mjs', import.meta.url), join(directory, 'scripts/test.mjs'))
  writeFileSync(join(directory, 'scripts/build.mjs'), build)
  writeFileSync(join(directory, 'test/selected.test.mjs'), "import {test} from 'node:test';import {writeFileSync,readFileSync} from 'node:fs';test('selected case',()=>writeFileSync('ran',readFileSync('built')));test('excluded case',()=>{throw new Error('must be filtered')})")
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return { directory, run: (...args) => spawnSync(process.execPath, [join(directory, 'scripts/test.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8', env }) }
}

test('the test runner rebuilds before selected tests and accepts filters after filenames', t => {
  const { directory, run } = fixture(t, "import {writeFileSync} from 'node:fs';writeFileSync('built','new build')")
  const result = run('test/selected.test.mjs', '--test-name-pattern=selected case')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(readFileSync(join(directory, 'ran'), 'utf8'), 'new build')
})

test('a failed build prevents test execution and preserves its exit status', t => {
  const { directory, run } = fixture(t, 'process.exit(23)')
  const result = run('--test-name-pattern=selected case', 'test/selected.test.mjs')
  assert.equal(result.status, 23)
  assert.equal(existsSync(join(directory, 'ran')), false)
})
