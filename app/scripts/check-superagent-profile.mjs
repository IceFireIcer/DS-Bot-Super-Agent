// Boot the app's ds-superagent profile without the Electron shell: the real
// profile bundles, the production Engine host and the existing ds-bot chat UI.
// Uses throwaway data and a mock model route; stops the Host before it exits.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { INSTALL_ANCHOR, SUPERAGENT_PROFILE, loadAppProfile } from '../src/profile.mjs'
import { reconcileSuperagentProfile } from '../src/superagent-patch.mjs'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import assert from 'node:assert/strict'

const log = console.log
console.log = (...values) => log(...values.map(value => typeof value === 'string' ? value.replace(/([?&]token=)[^\s]+/gu, '$1[redacted]') : value))

const home = mkdtempSync(join(tmpdir(), 'ds-superagent-profile-check-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'profiles'), { recursive: true })
const routePatch = join(home, 'profiles', 'superagent-mock-route.patch.yml')
writeFileSync(routePatch, [
  '- id: superagent-profile',
  '  config:',
  '    main: { provider: mock, model: main }',
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
  const services = ['superagentProduct', 'webServer', 'connection', 'sessionPersistence']
  const missing = services.filter(name => ctx.get(name) === undefined)
  if (missing.length) throw new Error(`The ds-superagent profile did not start: ${missing.join(', ')}`)
  class MockMain extends LlmAdapter {
    async *stream(request) {
      if (request.model !== 'main') throw new Error('Ordinary chat must call Main only.')
      const text = 'The independent Main answered through the public DSH loop.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['mock'], new MockMain())
  const binding = await ctx.superagentProduct.dispatch('open')
  assert.equal(ctx.get('sessionController'), undefined, 'the native controller is isolated from the product Gateway')
  await assert.rejects(ctx.typertGateway.invoke({ namespace: 'session', method: 'prompt', args: {
    request: { requestId: 'forbidden-native', sessionId: binding.mainSessionId, mode: 'queue', content: [{ type: 'text', text: 'This must be refused.' }] },
  }, peer: ctx.connection.browserPeer }), { code: 'gateway/service-unavailable' })
  await assert.rejects(ctx.typertGateway.stream({ namespace: 'session', method: 'control', args: {}, peer: ctx.connection.browserPeer }), { code: 'gateway/service-unavailable' })
  await ctx.superagentProduct.dispatch('send', { instanceId: binding.instanceId, commandId: 'profile-smoke', text: 'Hello Main.' })
  const history = await ctx.superagentProduct.dispatch('history', { instanceId: binding.instanceId })
  if (history.messages.length !== 2 || history.messages[1].role !== 'main') throw new Error('Main did not produce a durable reply.')
  if (ctx.get('botExecutionAdapter') !== undefined) throw new Error('The old execution adapter must not mount in the product profile.')
  console.log(JSON.stringify({ profile: SUPERAGENT_PROFILE, home, services, messages: history.messages.length, nativeSessionAccessDenied: true }))
} finally {
  try { await application?.shutdown?.shutdown?.(0) } catch {}
  rmSync(home, { recursive: true, force: true })
  console.log = log
}
