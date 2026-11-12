import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { reconcileSuperagentProfile } from '../src/superagent-patch.mjs'

test('the Super-agent profile requires the Engine adapter instead of falling back', () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-superagent-patch-'))
  try {
    const dir = join(home, 'profiles', 'ds-superagent')
    mkdirSync(dir, { recursive: true })
    const patchFiles = reconcileSuperagentProfile({ dir }, true)
    assert.deepEqual(patchFiles, [join(home, 'profiles', 'superagent.patch.yml')])
    assert.deepEqual(parse(readFileSync(patchFiles[0], 'utf8')), [
      { id: 'bot', config: { executionAdapterRequired: true } },
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the ds-bot profile drops a stale Super-agent overlay', () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-superagent-patch-off-'))
  try {
    const dir = join(home, 'profiles', 'ds-bot')
    mkdirSync(dir, { recursive: true })
    const file = join(home, 'profiles', 'superagent.patch.yml')
    reconcileSuperagentProfile({ dir }, true)
    assert.ok(existsSync(file))
    assert.deepEqual(reconcileSuperagentProfile({ dir }, false), [])
    assert.equal(existsSync(file), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
