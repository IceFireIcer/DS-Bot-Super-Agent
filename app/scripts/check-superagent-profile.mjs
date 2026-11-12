// Boot the app's ds-superagent profile without the Electron shell: the real
// profile bundles, the production Engine host and the existing chat UI. Uses
// throwaway data and a mock model route; stops the Host before it exits.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { INSTALL_ANCHOR, SUPERAGENT_PROFILE, loadAppProfile } from '../src/profile.mjs'

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
  const patchFiles = [routePatch]
  application = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: SUPERAGENT_PROFILE,
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles,
    args: ['--no-open', '--port', '0'],
  })
  const { ctx } = application
  const services = ['botExecutionAdapter', 'superagentUi', 'webServer', 'connection', 'sessionPersistence', 'sessionController']
  const missing = services.filter(name => ctx.get(name) === undefined)
  if (missing.length) throw new Error(`The ds-superagent profile did not start: ${missing.join(', ')}`)
  const connection = ctx.get('connection')
  const pageRoute = connection.fetchRoutes.get('/api/superagent/page')
  const page = await pageRoute.fetch(new Request('http://host/api/superagent/page'))
  const html = await page.text()
  if (!page.ok || !html.includes('Super-agent')) throw new Error('The Super-agent page did not load.')
  const apiRoute = connection.fetchRoutes.get('/api/superagent')
  const state = await apiRoute.fetch(new Request('http://host/api/superagent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'state' }),
  }))
  const body = await state.json()
  if (!body.ok || body.value?.conversation !== null) {
    console.error(JSON.stringify(body))
    throw new Error('The Super-agent state route did not answer an empty conversation.')
  }
  const sent = await (await apiRoute.fetch(new Request('http://host/api/superagent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'request', payload: { requestId: 't60-check', text: 'Build the T60 check.' } }),
  }))).json()
  if (!sent.ok) throw new Error(`The Super-agent request route failed: ${sent.error?.message ?? 'unknown error'}`)
  let conversation = null
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const current = await (await apiRoute.fetch(new Request('http://host/api/superagent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state' }),
    }))).json()
    conversation = current.value?.conversation ?? null
    if (conversation?.messages?.some(message => message.purpose === 'result')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!conversation?.messages?.some(message => message.purpose === 'result')) {
    console.error(JSON.stringify({ status: conversation?.status, stage: conversation?.stage, reason: conversation?.reason,
      messages: conversation?.messages?.map(message => message.purpose), reports: conversation?.reports?.length,
      reportHistory: conversation?.reportHistory?.map(report => report.id), messageHistory: conversation?.messageHistory?.map(message => [message.purpose, message.state]),
      setup: conversation?.setup, assignments: conversation?.assignments?.length }, null, 2))
    throw new Error('The Super-agent mock request did not reach a result.')
  }
  console.log(JSON.stringify({ profile: SUPERAGENT_PROFILE, home, services, page: true, ticketId: conversation.ticketId }))
} finally {
  try { await application?.shutdown?.shutdown?.(0) } catch {}
  rmSync(home, { recursive: true, force: true })
}
