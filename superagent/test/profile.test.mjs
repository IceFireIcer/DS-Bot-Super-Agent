import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { profilePaths } from '../dist/profile.js'

test('the ds-superagent profile keeps its business store under the profile home', () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-'))
  try {
    assert.deepEqual(profilePaths({ DSH_HOME: home }), {
      root: join(home, 'core'),
      databasePath: join(home, 'core', 'state.sqlite'),
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the ds-superagent profile fails closed without a DSH home', () => {
  assert.throws(() => profilePaths({}), /DSH_HOME/u)
})

test('the package mounts the profile host as a DSH bundle', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /name: ds-superagent\/profile/u)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['./profile'].default, './dist/profile.js')
})
