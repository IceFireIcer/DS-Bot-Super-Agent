import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseTap, summarize } from '../scripts/stress.mjs'

test('stress parsing keeps the last completed test, failures and an explicit trace node', () => {
  const parsed = parseTap([
    'TAP version 13',
    'ok 1 - first test',
    'ok 2 - second test',
    '# trace: outbox.claim',
    'not ok 3 - third test',
    '  ---',
    '  error: expected running',
    '  ...',
  ].join('\n'))
  assert.equal(parsed.lastCompleted, 'third test')
  assert.deepEqual(parsed.failed, ['third test'])
  assert.equal(parsed.trace, 'outbox.claim')
})

test('stress summary reports failure rate, failing tests and the log path', () => {
  const summary = summarize([
    { run: 1, passed: true, lastCompleted: 'first', failed: [], log: 'run-001.log' },
    { run: 2, passed: false, exitCode: 1, timedOut: false, lastCompleted: 'second', failed: ['outbox'], trace: 'delivery', log: 'run-002.log' },
  ], { runs: 2, concurrency: 2, files: ['test/outbox.test.mjs'], durationMs: 25 })
  assert.equal(summary.passed, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.failureRate, 0.5)
  assert.equal(summary.lastCompleted, 'second')
  assert.deepEqual(summary.failures, [{
    run: 2, log: 'run-002.log', exitCode: 1, timedOut: false,
    lastCompleted: 'second', trace: 'delivery', failedTests: ['outbox'],
  }])
})

test('the stress script builds once and is wired as a package command', () => {
  const script = readFileSync(new URL('../scripts/stress.mjs', import.meta.url), 'utf8')
  assert.match(script, /scripts\/build\.mjs/u)
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts['test:stress'], 'node scripts/stress.mjs')
})
