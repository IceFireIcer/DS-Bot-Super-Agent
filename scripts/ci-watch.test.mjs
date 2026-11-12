import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactLog, diffJobs, failedSteps, matchingJobs, parseArgs, redact } from './ci-watch.mjs'

const job = (name, status = 'completed', conclusion = 'success', steps = []) => ({ name, status, conclusion, steps })

test('the watcher only reports job state changes', () => {
  const previous = [job('test', 'in_progress', null), job('scan', 'completed', 'success')]
  const current = [job('test', 'completed', 'success'), job('scan', 'completed', 'success')]
  assert.deepEqual(diffJobs(previous, current), [{ name: 'test', state: 'completed/success', previous: 'in_progress/' }])
  assert.deepEqual(diffJobs(current, current), [])
})

test('job filters match names and failures list only failed steps', () => {
  const jobs = [job('Super-agent core · Node 24'), job('Desktop app package (Windows)')]
  assert.deepEqual(matchingJobs(jobs, ['super-agent']).map(entry => entry.name), ['Super-agent core · Node 24'])
  assert.deepEqual(matchingJobs(jobs, []), jobs)
  assert.deepEqual(failedSteps({
    jobs: [
      job('test', 'completed', 'failure', [
        { name: 'npm test', conclusion: 'failure' },
        { name: 'lint', conclusion: 'success' },
      ]),
      job('scan', 'completed', 'success'),
    ],
  }), [{ job: 'test', steps: ['npm test'] }])
})

test('compact logs redact credentials and keep errors plus the tail', () => {
  const log = [
    '##[error]npm test failed',
    'token=abcdefghijklmnopqrstuvwxyz',
    'Bearer abcdefghijklmnopqrstuvwxyz',
    ...Array.from({ length: 20 }, (_, index) => `line ${index}`),
  ].join('\n')
  const compact = compactLog(log, 8)
  assert.ok(compact.length <= 8)
  assert.match(compact.join('\n'), /npm test failed/)
  assert.doesNotMatch(compact.join('\n'), /abcdefghijklmnopqrstuvwxyz/)
  assert.match(redact('ghp_abcdefghijklmnopqrstuvwxyz123456'), /\[redacted\]/)
})

test('arguments accept one run, limits and a job filter', () => {
  assert.deepEqual(parseArgs(['123', '--timeout', '60', '--interval', '5', '--jobs', 'test,scan', '--json']), {
    timeout: 60, interval: 5, jobs: ['test', 'scan'], json: true, repo: undefined, runId: '123',
  })
  for (const args of [['123', '456'], ['--timeout', '0'], ['--jobs'], ['--unknown']]) assert.throws(() => parseArgs(args))
})
