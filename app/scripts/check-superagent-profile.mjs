// Boot the app's ds-superagent profile without the Electron shell: the real
// profile bundles, the copied DS Bot UI host and the production Engine. Uses
// throwaway data and a mock model route; stops the Host before it exits.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
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
  '- id: web-runtime',
  '  config: { printUrl: false, openBrowser: false }',
  '- insert:',
  '    - id: t60-mock-llm',
  `      name: ${JSON.stringify(new URL('./t60-mock-llm.mjs', import.meta.url).href)}`,
  '',
].join('\n'))

let application
let launcher
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
  const services = ['superagentUi', 'webServer', 'connection', 'sessionPersistence', 'sessionController']
  const missing = services.filter(name => ctx.get(name) === undefined)
  if (missing.length) throw new Error(`The ds-superagent profile did not start: ${missing.join(', ')}`)
  if (process.argv.includes('--serve')) {
    let stop
    const stopped = new Promise(resolve => { stop = resolve })
    launcher = createServer((_request, response) => {
      if (_request.method === 'POST' && _request.url === '/stop') { response.writeHead(204).end(); stop(); return }
      response.writeHead(302, { location: ctx.get('connection').authenticatedUrl(ctx.get('webServer').getOrigin()), 'cache-control': 'no-store' }).end()
    })
    await new Promise(resolve => launcher.listen(0, '127.0.0.1', resolve))
    console.log(JSON.stringify({ url: `http://127.0.0.1:${launcher.address().port}`, mode: 'mock' }))
    process.stdin.resume()
    process.stdin.once('data', stop)
    await stopped
    process.exitCode = 0
  } else {
  const connection = ctx.get('connection')
  const apiRoute = connection.fetchRoutes.get('/api/superagent')
  if (!apiRoute || connection.fetchRoutes.has('/api/bot')) throw new Error('The profile needs only the narrow Super-agent route.')
  const call = async (endpoint, payload) => {
    const response = await apiRoute.fetch(new Request('http://host/api/superagent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json()
  }
  const state = await call('state', {})
  if (!state.ok || state.value.version !== 1) throw new Error('The copied UI did not get a v1 state.')
  const sent = await call('send', { requestId: 't60-check', text: 'Build the T60 copy check.' })
  if (!sent.ok) throw new Error(`The copied DS Bot UI send route failed: ${sent.error?.message ?? 'unknown error'}`)
  let after = null
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    after = await call('state', {})
    if (after.ok && after.value?.items?.some(item => item.kind === 'bot'
      && typeof item.text === 'string' && item.text.includes('Completed the T60 copy check.'))) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!after.ok) throw new Error('The copied DS Bot UI chat read failed after the result.')
  const items = after.value?.items ?? []
  if (!items.some(item => item.kind === 'user' && item.text === 'Build the T60 copy check.')
    || !items.some(item => item.kind === 'bot' && item.text === 'Completed the T60 copy check.')) {
    throw new Error('The copied DS Bot UI chat did not show the request and result.')
  }
  const result = items.find(item => item.purpose === 'result')
  const evidence = await call('evidence', { ticketId: result.ticketId, ref: result.evidence })
  if (!evidence.ok || !evidence.value.text.includes('The real profile completed the mock request.')) throw new Error('Evidence was not readable.')
  const unchanged = await call('state', { cursor: after.value.cursor })
  if (!unchanged.ok || unchanged.value.items.length) throw new Error('A caught-up cursor repeated messages.')
  const refused = await call('team/create', {})
  if (refused.ok || refused.error.code !== 'superagent/unsupported') throw new Error('Unsupported controls must be refused.')
  console.log(JSON.stringify({ profile: SUPERAGENT_PROFILE, home, services,
    ticketId: sent.value.ticketId, chatItems: items.length, evidence: true }))
  }
} finally {
  launcher?.close()
  try { await application?.shutdown?.shutdown?.(0) } catch {}
  rmSync(home, { recursive: true, force: true })
}
