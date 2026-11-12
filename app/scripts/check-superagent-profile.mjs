// Boot the app's ds-superagent profile without the Electron shell: the real
// profile bundles, the production Engine host and the existing chat UI. Uses
// throwaway data and a mock model route; stops the Host before it exits.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { INSTALL_ANCHOR, SUPERAGENT_PROFILE, loadAppProfile } from '../src/profile.mjs'
import { reconcileSuperagentProfile } from '../src/superagent-patch.mjs'

const home = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-check-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'profiles'), { recursive: true })
const routePatch = join(home, 'profiles', 'superagent-mock-route.patch.yml')
writeFileSync(routePatch, [
  '- id: superagent-profile',
  '  config:',
  '    router: { provider: mock, model: router }',
  '    worker: { provider: mock, model: worker }',
  '',
].join('\n'))

let application
try {
  const profile = loadAppProfile(SUPERAGENT_PROFILE)
  const patchFiles = [reconcileSuperagentProfile(profile, true)[0], routePatch]
  application = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: SUPERAGENT_PROFILE,
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles,
    args: ['--no-open', '--port', '0'],
  })
  const { ctx } = application
  const services = ['botExecutionAdapter', 'webServer', 'connection', 'sessionPersistence', 'sessionController']
  const missing = services.filter(name => ctx.get(name) === undefined)
  if (missing.length) throw new Error(`The ds-superagent profile did not start: ${missing.join(', ')}`)
  console.log(JSON.stringify({ profile: SUPERAGENT_PROFILE, home, services }))
} finally {
  await application?.shutdown?.shutdown?.(0).catch?.(() => {})
  rmSync(home, { recursive: true, force: true })
}
