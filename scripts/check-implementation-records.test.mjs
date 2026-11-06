import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRecord } from './check-implementation-records.mjs'

test('implementation evidence reports unfinished placeholders and unresolved commits with source lines', () => {
  const text = '# T05\n实现提交：待提交。\n审查目标：`abcdef0`。'
  assert.deepEqual(checkRecord(text, () => false).map(problem => problem.line), [2, 3])
})

test('record checks support shallow CI history while local checks verify commit references', () => {
  const text = '实现提交：`50d9ad2`；验收：82/82；剩余审查：未复审。'
  assert.deepEqual(checkRecord(text), [])
  assert.deepEqual(checkRecord(text, ref => ref === '50d9ad2'), [])
})
