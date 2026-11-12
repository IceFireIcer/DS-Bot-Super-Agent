import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8')
const SESSION_ID = 'superagent-desktop'
const BOT_ID = 'superagent'

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

const failure = (error) => json({ ok: false, error: {
  code: typeof error?.code === 'string' ? error.code : 'ui/error',
  message: error?.message ?? String(error),
} }, 400)

export const name = 'ds-superagent-ui'
export const inject = ['botExecutionAdapter', 'connection']

export function apply(ctx) {
  const adapter = ctx.get('botExecutionAdapter')
  if (adapter === undefined) throw new Error('The Super-agent UI needs the production botExecutionAdapter service.')
  const connection = ctx.get('connection')
  if (connection === undefined) throw new Error('The Super-agent UI needs the Host connection service.')
  const owner = { kind: 'bot', botId: BOT_ID }
  const rt = {
    ctx,
    chatOwners: new Map([[SESSION_ID, BOT_ID]]),
    groupOwners: new Map(),
    roomOf: () => undefined,
    state: { questions: {} },
    chatOf: () => SESSION_ID,
    displayItems: () => [],
  }
  const context = { ctx, rt }
  const requestId = value => typeof value === 'string' && value !== '' ? value : randomUUID()

  const read = async () => {
    const conversation = await adapter.conversation({ sessionId: SESSION_ID, owner }, context)
    return { sessionId: SESSION_ID, botId: BOT_ID, conversation: conversation ?? null }
  }

  const command = async (endpoint, payload) => {
    const body = payload && typeof payload === 'object' ? payload : {}
    switch (endpoint) {
      case 'state':
        return read()
      case 'request': {
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text === '') throw new Error('A request needs text.')
        const receipt = await adapter.prompt({ requestId: requestId(body.requestId), sessionId: SESSION_ID, owner,
          content: [{ type: 'text', text }] }, context)
        return { ticketId: receipt.ticketId }
      }
      case 'answer': {
        const attentionId = typeof body.attentionId === 'string' ? body.attentionId : ''
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (attentionId === '' || text === '') throw new Error('An answer needs an attention ID and text.')
        await adapter.answer({ requestId: requestId(body.requestId), sessionId: SESSION_ID, owner, attentionId, text }, context)
        return { ok: true }
      }
      case 'stop':
        await adapter.stop({ requestId: requestId(body.requestId), sessionId: SESSION_ID, owner,
          reason: typeof body.reason === 'string' && body.reason !== '' ? body.reason : 'Stopped from the Super-agent UI.' }, context)
        return { ok: true }
      case 'resume':
        await adapter.resume({ requestId: requestId(body.requestId), sessionId: SESSION_ID, owner }, context)
        return { ok: true }
      default:
        throw new Error(`Unknown endpoint ${endpoint}`)
    }
  }

  ctx.provide('superagentUi', { sessionId: SESSION_ID, botId: BOT_ID })
  ctx.effect(() => connection.fetch.register({
    path: '/api/superagent',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json()
        return json({ ok: true, value: await command(String(body?.endpoint ?? ''), body?.payload) })
      } catch (error) {
        return failure(error)
      }
    },
  }), 'ds-superagent-ui: api route')
  ctx.effect(() => connection.fetch.register({
    path: '/api/superagent/page',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => new Response(PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    }),
  }), 'ds-superagent-ui: page route')
}
