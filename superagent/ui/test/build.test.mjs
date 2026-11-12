import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('the copied client builds as the ds-superagent-ui bundle', () => {
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  assert.match(source, /id: 'ds-superagent-ui'/u)
  assert.match(source, /conversation\.session\.header/u)
})

test('client.js matches the copied src/client', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'build-client.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('the copied source still uses the existing /api/bot route', () => {
  const api = readFileSync(join(root, 'src', 'client', 'api.js'), 'utf8')
  assert.match(api, /const ROUTE = 'api\/bot'/u)
})
