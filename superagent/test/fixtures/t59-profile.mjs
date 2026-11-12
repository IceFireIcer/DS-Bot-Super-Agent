import { mkdir } from 'node:fs/promises'
import * as Profile from '../../dist/profile.js'
import { nativeContext, routerResponse, toolResponse } from '../../dev/native-mock.mjs'

const args = process.argv.slice(2)
const argument = name => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const home = argument('home')
const sessionsPath = argument('sessions')
const sessionId = argument('session') ?? 'ui-chat-chief'
const requestId = argument('request') ?? 't59-profile'
const text = argument('text') ?? 'Build the profile result.'
const stop = args.includes('--stop')
if (!home || !sessionsPath) {
  console.error('usage: node test/fixtures/t59-profile.mjs --home <dir> --sessions <dir> [--session <id>] [--request <id>] [--stop]')
  process.exit(2)
}
process.env.DSH_HOME = home
await mkdir(sessionsPath, { recursive: true })

let native
try {
  native = await nativeContext(sessionsPath, async function* (request) {
    const user = request.messages.filter(message => message.role === 'user').at(-1)
    const input = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (request.model === 'router') { yield* routerResponse(request); return }
    yield* toolResponse('report_ready', { result: `Completed: ${input}`, evidence: 'The ds-superagent profile completed the mock request.' })
  })
  await native.plugin(Profile, {
    router: { provider: 'mock', model: 'router' },
    worker: { provider: 'mock', model: 'worker' },
  })
  const adapter = native.get('botExecutionAdapter')
  const rt = {
    ctx: native,
    chatOwners: new Map([[sessionId, 'chief']]),
    groupOwners: new Map(),
    roomOf: () => undefined,
    state: { questions: {} },
    chatOf: () => sessionId,
    displayItems: (_id, events) => events.map(event => ({ seq: event.seq, type: event.type })),
  }
  const owner = { kind: 'bot', botId: 'chief' }
  const receipt = await adapter.prompt({ requestId, sessionId, owner,
    content: [{ type: 'text', text }] }, { ctx: native, rt })
  if (stop) await adapter.stop({ requestId: `${requestId}-stop`, sessionId, owner, reason: 'The profile test stopped the work.' }, { ctx: native, rt })
  const deadline = Date.now() + 10000
  let items = []
  while (!stop && Date.now() < deadline) {
    const page = await adapter.chatPage({ botId: 'chief', sessionId }, { ctx: native, rt })
    items = page.items
    if (items.some(item => item.type === 'assistant/message')) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  if (!stop) {
    const all = []
    let cursor
    do {
      const page = await adapter.chatPage({ botId: 'chief', sessionId, ...(cursor ? { cursor } : {}) }, { ctx: native, rt })
      all.push(...page.items)
      cursor = page.cursor
    } while (cursor)
    items = all
  }
  console.log(JSON.stringify({ ticketId: receipt.ticketId, items: items.length,
    userMessages: items.filter(item => item.type === 'user/message').length,
    assistantMessages: items.filter(item => item.type === 'assistant/message').length, sessionId }))
} catch (error) {
  console.error(error?.stack ?? String(error))
  process.exitCode = 1
} finally {
  await native?.fiber.dispose().catch(() => {})
}
