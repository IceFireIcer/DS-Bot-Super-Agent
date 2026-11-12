// Boot the app's ds-superagent profile without the Electron shell: the real
// profile bundles, the copied DS Bot UI host and the production Engine. Uses
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
  '- insert:',
  '    - id: t60-mock-llm',
  `      name: ${JSON.stringify(new URL('./t60-mock-llm.mjs', import.meta.url).href)}`,
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
  const connection = ctx.get('connection')
  const apiRoute = connection.fetchRoutes.get('/api/bot')
  const call = async (endpoint, payload) => {
    const response = await apiRoute.fetch(new Request('http://host/api/bot', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json()
  }
  const state = await call('state', {})
  if (!state.ok || !state.value?.bots?.length) throw new Error('The copied DS Bot UI did not get a Bot state.')
  const bot = state.value.bots[0]
  const before = await call('chat', { botId: bot.id })
  if (!before.ok) throw new Error('The copied DS Bot UI chat route failed.')
  const sent = await call('send', { sessionId: bot.sessionId, text: 'Build the T60 copy check.' })
  if (!sent.ok) throw new Error(`The copied DS Bot UI send route failed: ${sent.error?.message ?? 'unknown error'}`)
  const adapter = ctx.get('botExecutionAdapter')
  const adapterScope = await adapter.scopes.get(bot.sessionId)
  if (!adapterScope) throw new Error('The copied DS Bot UI did not create an Engine scope.')
  const rt = adapterScope.rt
  const adapterCtx = adapterScope.ctx
  let conversation = null
  let after = null
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    await adapterScope.runtime.engine.effects.drain()
    conversation = await adapter.conversation({ sessionId: bot.sessionId, owner: { kind: 'bot', botId: bot.id } }, { ctx: adapterCtx, rt })
    after = await call('chat', { botId: bot.id })
    if (after.ok && after.value?.items?.some(item => item.kind === 'bot'
      && typeof item.text === 'string' && item.text.includes('Completed the T60 copy check.'))) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const hasResult = conversation?.messages?.some(message => message.purpose === 'result')
    || conversation?.reports?.some(report => typeof report.result === 'string' && report.result.trim() !== '')
  if (!hasResult) {
    throw new Error('The copied DS Bot UI request did not reach a result.')
  }
  if (!after.ok) throw new Error('The copied DS Bot UI chat read failed after the result.')
  const items = after.value?.items ?? []
  if (!items.some(item => item.kind === 'user' && item.text === 'Build the T60 copy check.')
    || !items.some(item => item.kind === 'bot' && item.text === 'Completed the T60 copy check.')) {
    throw new Error('The copied DS Bot UI chat did not show the request and result.')
  }
  console.log(JSON.stringify({ profile: SUPERAGENT_PROFILE, home, services, botId: bot.id, sessionId: bot.sessionId,
    ticketId: conversation.ticketId, chatItems: items.length }))
} finally {
  try { await application?.shutdown?.shutdown?.(0) } catch {}
  rmSync(home, { recursive: true, force: true })
}
