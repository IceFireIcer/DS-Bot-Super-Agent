import { mkdir } from 'node:fs/promises'
import * as DsBotHost from '../../dist/ds-bot-host.js'
import { install } from '../../../ds-bot/src/host/execution-adapter.js'
import { nativeContext, routerResponse, toolResponse } from '../../dev/native-mock.mjs'

const args = process.argv.slice(2)
const argument = name => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const databasePath = argument('database')
const sessionsPath = argument('sessions')
const sessionId = argument('session') ?? 'ui-chat-chief'
const requestId = argument('request') ?? 't56-process'
const text = argument('text') ?? 'Build the production process result.'
const stop = args.includes('--stop')
if (!databasePath || !sessionsPath) {
  console.error('usage: node test/fixtures/t56-host.mjs --database <path> --sessions <dir> [--session <id>] [--request <id>]')
  process.exit(2)
}
await mkdir(sessionsPath, { recursive: true })

let native
try {
  native = await nativeContext(sessionsPath, async function* (request) {
    const user = request.messages.filter(message => message.role === 'user').at(-1)
    const input = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (request.model === 'router') { yield* routerResponse(request); return }
    yield* toolResponse('report_ready', { result: `Completed: ${input}`, evidence: 'The real Host process completed the mock request.' })
  })
  await native.plugin(DsBotHost, {
    databasePath,
    sourceInstanceId: 'ds-bot-process',
    actorId: 'ui-user',
    allowedActorIds: ['ui-user'],
    router: { provider: 'mock', model: 'router' },
    worker: { provider: 'mock', model: 'worker' },
    hostId: 't56-process',
  })
  const rt = { ctx: native, config: { executionAdapterRequired: true },
    chatOwners: new Map([[sessionId, 'chief']]), groupOwners: new Map(), roomOf: () => undefined,
    state: { questions: {} }, chatOf: () => sessionId, chatPage: async () => ({ items: [], cursor: null }),
    displayItems: (_id, events) => events.map(event => ({ seq: event.seq, type: event.type })) }
  install(rt)
  const signal = new AbortController().signal
  const receipt = await rt.executionDispatch('prompt', { requestId, sessionId, content: [{ type: 'text', text }] }, signal)
  const delivered = await rt.executionDispatch('deliver', { exchangeId: `${requestId}-deliver`, sessionId,
    message: { content: [{ type: 'text', text: `${text} Follow up.` }] }, fromId: 'chief', toId: 'chief', role: 'request' }, signal)
  const agent = await rt.executionDispatch('resolveAgent', { sessionId }, signal)
  if (stop) await rt.executionDispatch('stop', { requestId: `${requestId}-stop`, sessionId, reason: 'The Host stopped the process work.' }, signal)
  const deadline = Date.now() + 10000
  let page = { items: [] }
  while (Date.now() < deadline) {
    page = await rt.executionChatPage('chief')
    const live = await rt.executionLive({ work: {}, activity: {} })
    if (!live.activity.chief && page.items.some(item => item.type === 'assistant/message')) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const all = []
  let cursor
  do {
    const current = await rt.executionChatPage('chief', cursor)
    all.push(...current.items)
    cursor = current.cursor
  } while (cursor)
  console.log(JSON.stringify({ ticketId: receipt.ticketId, delivered: delivered.ticketId, items: all.length,
    userMessages: all.filter(item => item.type === 'user/message').length,
    seqs: all.map(item => item.seq), sessionId: agent.session.id, status: agent.status }))
} catch (error) {
  console.error(error?.stack ?? String(error))
  process.exitCode = 1
} finally {
  await native?.fiber.dispose().catch(() => {})
}
