import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('the generated client mounts the Super-agent page as the full surface', () => {
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  assert.match(source, /id: 'ds-superagent-ui'/u)
  assert.match(source, /\/api\/superagent\/page/u)
  assert.match(source, /iframe/u)
})

test('client.js matches src/client.js', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'build-client.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
