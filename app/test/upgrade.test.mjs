// A DS Bot upgrade changes the app's own place in the profile. The team's business state and
// Sessions are the Host's data, not the profile's, and the user's own bundles and settings
// stay after the app's bundles.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { BUNDLES, claimBundles } from '../src/profile.mjs'

describe('an upgrade on the app data', () => {
  let home
  let profile
  let business
  let session
  let beforeProfile
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'ds-bot-app-upgrade-'))
    profile = join(home, 'profiles', 'ds-bot')
    mkdirSync(join(home, 'bot'), { recursive: true })
    mkdirSync(join(home, 'sessions'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    business = join(home, 'bot', 'state.json')
    session = join(home, 'sessions', 'session-1.jsonl')
    writeFileSync(business, '{"bots":{"chief":{"name":"Chief"}}}\n')
    writeFileSync(session, '{"seq":0,"type":"session/created"}\n')
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
      name: 'dsh-profile-ds-bot', private: true,
      dependencies: { 'a-plugin': '1.0.0' },
      dsh: {
        profile: { bundles: ['@deepseek-ai/dsh-base', 'ds-bot', 'a-plugin'], preset: 'team', settings: { model: 'a-model' } },
        custom: { keep: true },
      },
    }, undefined, 2)}\n`)
    beforeProfile = readFileSync(business)
  })
  after(() => { rmSync(home, { recursive: true, force: true }) })

  test('keeps the user bundles and settings, and does not touch the Host data', () => {
    const beforeSession = readFileSync(session)
    claimBundles(profile)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, [...BUNDLES, 'a-plugin'])
    assert.equal(manifest.dsh.profile.preset, 'team', 'the role preset is kept')
    assert.deepEqual(manifest.dsh.profile.settings, { model: 'a-model' }, 'the user settings are kept')
    assert.deepEqual(manifest.dsh.custom, { keep: true }, 'the rest of the profile manifest is kept')
    assert.deepEqual(manifest.dependencies, { 'a-plugin': '1.0.0' }, 'the user dependencies are kept')
    assert.deepEqual(readFileSync(business), beforeProfile, 'the business state is untouched')
    assert.deepEqual(readFileSync(session), beforeSession, 'the Sessions are untouched')
  })

  test('a second upgrade on the same profile changes nothing', () => {
    const once = readFileSync(join(profile, 'package.json'), 'utf8')
    claimBundles(profile)
    assert.equal(readFileSync(join(profile, 'package.json'), 'utf8'), once)
  })
})
