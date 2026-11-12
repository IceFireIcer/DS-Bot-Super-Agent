import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkCoverage, checkLinks, checkRecord, classifyReference, localLinks } from './check-implementation-records.mjs'

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'dsbot-records-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs/superagent/implementation/reviews'), { recursive: true })
  mkdirSync(join(root, 'docs/superagent/issues'), { recursive: true })
  return root
}

test('implementation evidence reports unfinished placeholders and unresolved commits with source lines', () => {
  const text = '# T05\n实现提交：待提交。\n审查目标：`abcdef0`。'
  assert.deepEqual(checkRecord(text, () => false).map(problem => problem.line), [2, 3])
})

test('record checks support shallow CI history while local checks verify commit references', () => {
  const text = '实现提交：`50d9ad2`；验收：82/82；CI run `42736394312`；摘要 `' + 'a'.repeat(64) + '`。'
  assert.deepEqual(checkRecord(text), [])
  assert.deepEqual(checkRecord(text, ref => ref === '50d9ad2'), [])
  assert.deepEqual(checkRecord(text, () => false).map(problem => problem.line), [1])
  assert.equal(classifyReference('42736394312'), 'number')
  assert.equal(classifyReference('82'), 'number')
  assert.equal(classifyReference('50d9ad2'), 'commit')
  assert.equal(classifyReference('a'.repeat(64)), 'other')
})

test('relative links are checked and historical debt stays explicit', context => {
  const root = fixture(context)
  const file = join(root, 'docs/superagent/implementation/t01.md')
  writeFileSync(file, 'ok [issue](../issues/T01.md)\nbroken [old](../issues/T99.md)\n')
  writeFileSync(join(root, 'docs/superagent/issues/T01.md'), '# T01\n')
  const result = checkLinks(file, 'ok [issue](../issues/T01.md)\nbroken [old](../issues/T99.md)\n', root)
  assert.deepEqual(result.problems.map(problem => problem.line), [2])
  const debt = new Set(['docs/superagent/implementation/t01.md:../issues/T99.md'])
  assert.deepEqual(checkLinks(file, 'broken [old](../issues/T99.md)\n', root, debt).problems, [])
  assert.deepEqual(localLinks('`[inline](missing.md)`\n[real](ok.md)\n'), [{ line: 2, target: 'ok.md' }])
})

test('coverage requires a ticket, implementation record and review unless the gap is explicit debt', context => {
  const root = fixture(context)
  for (const ticket of ['T01', 'T02']) {
    writeFileSync(join(root, 'docs/superagent/issues', `${ticket}.md`), `# ${ticket}\n`)
    writeFileSync(join(root, 'docs/superagent/implementation', `${ticket.toLowerCase()}.md`), `# ${ticket}\n`)
  }
  writeFileSync(join(root, 'docs/superagent/implementation/reviews/t01.md'), '# T01 review\n')
  const problems = checkCoverage(root)
  assert.ok(problems.some(problem => problem.includes('t02') && problem.includes('review')))
  assert.equal(problems.some(problem => problem.includes('T01')), false)
  writeFileSync(join(root, 'docs/superagent/issues/T58.md'), '# T58\n')
  assert.equal(checkCoverage(root).some(problem => problem.includes('T58')), false)
  writeFileSync(join(root, 'docs/superagent/implementation/t99.md'), '# T99\n')
  assert.ok(checkCoverage(root).some(problem => problem.includes('t99') && problem.includes('allowlist')))
})
