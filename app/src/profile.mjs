// The app's own DSH profile: its name, its bundles and its installation.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { LEGACY_ENGINE } from './legacy.mjs'
import { initProfile, loadProfileDirectory, readProfileManifest, resolveProfileDir, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'

export const PROFILE = 'ds-bot'
export const SUPERAGENT_PROFILE = 'ds-superagent'
// DSH's shared core, DSH's web front end (the window) and voice input, then the Bot team.
// Bundles the user installs follow.
export const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-voice-input-bundle', 'ds-bot']
// The Super-agent profile keeps the existing chat UI, but mounts the production
// Engine host first so the UI's execution adapter is present when ds-bot starts.
export const SUPERAGENT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'ds-superagent', 'ds-bot']
// The first-run check reads a copy of the team's chats without the Bot team running on them.
// DSH reads a log the same way whatever the profile mounts.
export const CHECK_PROFILE = 'import-check'
export const CHECK_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
// Bundles that earlier builds of the app put in its profile: the engine layer of its own window (../engine).
const RETIRED_BUNDLES = [LEGACY_ENGINE, 'dsbot-engine']
// The app's own manifest is the installation: DSH imports plugins only from the installation's dependency
// graph, resolves bundles there first, and keeps the bundles it names as direct dependencies from removal.
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/**
 * Put the app's bundles at the head of a profile's bundle list and keep the user's after them.
 * initProfile writes the list only into a new profile, so a profile from an earlier build keeps its old list.
 * @param {string} dir - the profile directory
 * @param {readonly string[]} [bundles] - the bundles this app claims
 */
export function claimBundles(dir, bundles = BUNDLES) {
  const manifest = readProfileManifest('dsh', dir)
  const listed = manifest.dsh?.profile?.bundles ?? []
  const next = [...bundles, ...listed.filter((name) => !bundles.includes(name) && !RETIRED_BUNDLES.includes(name))]
  if (next.join('\n') !== listed.join('\n')) writeProfileBundles(dir, manifest, next)
}

/**
 * Create or update the profile under the current DSH_HOME and load it.
 * @param {string} [profile] - the profile name
 * @returns {import('@deepseek-ai/dsh-app-boot').Profile} the loaded profile
 * @throws when one of the app's own bundles does not load
 */
export function loadAppProfile(profile = PROFILE) {
  const bundles = bundlesFor(profile)
  const dir = resolveProfileDir(profile)
  initProfile(dir, bundles)
  claimBundles(dir, bundles)
  return loadOwnBundles(dir, bundles)
}

/** The profile the app should start. */
export function activeProfile(env = process.env) {
  return env.DS_BOT_PROFILE === SUPERAGENT_PROFILE ? SUPERAGENT_PROFILE : PROFILE
}

/** The DSH home for a profile; the Super-agent profile keeps its data apart from ds-bot. */
export function profileHome(dataDir, profile = PROFILE) {
  return profile === SUPERAGENT_PROFILE ? join(dataDir, 'superagent') : dataDir
}

function bundlesFor(profile) {
  if (profile === PROFILE) return BUNDLES
  if (profile === SUPERAGENT_PROFILE) return SUPERAGENT_BUNDLES
  throw new Error(`Unknown app profile ${profile}.`)
}

/** The profile of the first-run check, under the current DSH_HOME. */
export function loadCheckProfile() {
  const dir = resolveProfileDir(CHECK_PROFILE)
  initProfile(dir, CHECK_BUNDLES)
  return loadOwnBundles(dir, CHECK_BUNDLES)
}

function loadOwnBundles(dir, bundles) {
  const profile = loadProfileDirectory('dsh', dir, INSTALL_ANCHOR)
  const lost = profile.skippedBundles.filter(({ packageName }) => bundles.includes(packageName))
  if (lost.length > 0) throw new Error(`The app could not load its own bundles:\n${lost.map(({ packageName, reason }) => `${packageName}: ${reason}`).join('\n')}`)
  return profile
}
