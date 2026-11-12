import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkResults } from './check-ci-result.mjs'

const result = (name, required, value) => ({ name, required, result: value })

test('a docs-only change may skip every product job', () => {
  assert.deepEqual(checkResults({
    changes: 'success', scan: 'success',
    results: [
      result('test', 'false', 'skipped'),
      result('superagent', 'false', 'skipped'),
      result('app-package', 'false', 'skipped'),
    ],
  }), [])
})

test('a required job that was skipped or missing fails the gate', () => {
  assert.deepEqual(checkResults({
    changes: 'success', scan: 'success',
    results: [result('test', 'true', 'skipped'), result('docker', 'true', '')],
  }), [
    'test: the change requires this job, but it was skipped',
    'docker: the change requires this job, but it was missing',
  ])
})

test('failed, cancelled and broken scope jobs always fail the gate', () => {
  assert.deepEqual(checkResults({
    changes: 'failure', scan: 'cancelled',
    results: [result('test', 'false', 'failure'), result('app', 'false', 'cancelled')],
  }), [
    'Change scope: failure',
    'Leak scan: cancelled',
    'test: failure',
    'app: cancelled',
  ])
})
