import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Engine } from './engine.js'
import type { ClientAccess, ClientCapability, ClientIdentity } from './client-access.js'
import { CoreError } from './model.js'

export interface ClientGatewayTls { key: string | Buffer; cert: string | Buffer }
export interface ClientGatewayOptions {
  host?: string
  port?: number
  tls?: ClientGatewayTls
  maxEvents?: number
}

const loopback = new Set(['127.0.0.1', '::1', 'localhost'])
const commandRoutes = new Map<string, (engine: Engine, body: Record<string, unknown>) => Promise<unknown>>([
  ['submit', (engine, body) => engine.submit(body as never)],
  ['answer', (engine, body) => engine.answerAttention(body as never)],
  ['stop', (engine, body) => engine.stopTicket(body as never)],
  ['resume', (engine, body) => engine.resumeTicket(body as never)],
  ['retry', (engine, body) => engine.retryTicket(body as never)],
  ['status', (engine, body) => engine.requestStatus(body as never)],
])

function statusOf(error: unknown) {
  if (error instanceof SyntaxError) return 400
  if (!(error instanceof CoreError)) return 500
  if (error.code === 'CLIENT_UNAUTHORIZED' || error.code === 'CLIENT_REVOKED') return 401
  if (['INSTANCE_NOT_AUTHORIZED', 'SOURCE_NOT_AUTHORIZED', 'ENVIRONMENT_DENIED', 'PATH_DENIED'].includes(error.code)) return 403
  if (error.code === 'NOT_FOUND') return 404
  if (['INVALID_INPUT', 'INVALID_CONFIG', 'IDENTITY_CONFLICT', 'UNSUPPORTED_CAPABILITY', 'INVALID_OPTIONS'].includes(error.code)) return 400
  if (error.code === 'CLIENT_JOURNAL_UNAVAILABLE' || error.code === 'STORAGE_UNAVAILABLE' || error.code === 'COMMIT_UNKNOWN') return 503
  return 500
}

function tokenOf(request: IncomingMessage) {
  const header = request.headers.authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/iu.exec(header.trim()) : null
  if (!match) throw new CoreError('CLIENT_UNAUTHORIZED', 'A client bearer credential is required.')
  return match[1]!
}

async function bodyOf(request: IncomingMessage) {
  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') throw new CoreError('INVALID_INPUT', 'Send a JSON request.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 70000) throw new CoreError('INVALID_INPUT', 'The request exceeds the input budget.')
    chunks.push(chunk)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CoreError('INVALID_INPUT', 'Send a JSON object.')
  return body as Record<string, unknown>
}

export async function createClientGateway(engine: Engine, access: ClientAccess, options: ClientGatewayOptions = {}) {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 0
  const instanceId = engine.getInstanceId()
  access.assertEngine(engine)
  if (access.getInstanceId() !== instanceId) throw new CoreError('INVALID_CONFIG', 'Client access and the Engine must serve the same Instance.')
  const secure = options.tls !== undefined
  if (!loopback.has(host) && !secure) {
    throw new CoreError('TRANSPORT_INSECURE', 'A client gateway may bind outside loopback only with TLS configured.')
  }
  const maxEvents = options.maxEvents ?? 100
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 500) throw new CoreError('INVALID_CONFIG', 'The client event page must be between 1 and 500 items.')
  if (secure && (!options.tls!.key || !options.tls!.cert)) throw new CoreError('INVALID_CONFIG', 'TLS needs both a key and a certificate.')

  const authorize = (request: IncomingMessage, capability: ClientCapability): Promise<ClientIdentity> =>
    access.authorize(tokenOf(request), instanceId, capability)

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const url = new URL(request.url ?? '/', 'http://client.invalid')
      const prefix = `/instances/${instanceId}/`
      if (!url.pathname.startsWith(prefix)) throw new CoreError('INSTANCE_NOT_AUTHORIZED', 'This client gateway serves one explicit Instance.')
      const route = url.pathname.slice(prefix.length)
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (request.method === 'GET' && route === 'state') {
        const client = await authorize(request, 'read')
        const supervision = await engine.getSupervision()
        response.end(JSON.stringify({ ...supervision, instanceId, client, cursor: await access.cursor() }))
        return
      }
      if (request.method === 'GET' && route === 'events') {
        await authorize(request, 'read')
        await access.reconcile(engine)
        const page = await access.readEvents(url.searchParams.get('after') ?? undefined,
          url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : maxEvents)
        response.end(JSON.stringify(page))
        return
      }
      if (request.method === 'GET' && route.startsWith('tickets/')) {
        await authorize(request, 'read')
        const ticket = await engine.getTicket(decodeURIComponent(route.slice('tickets/'.length)))
        if (!ticket) throw new CoreError('NOT_FOUND', 'The Ticket does not exist.')
        response.end(JSON.stringify(ticket))
        return
      }
      if (request.method === 'GET' && route.startsWith('conversations/')) {
        await authorize(request, 'read')
        response.end(JSON.stringify(await engine.conversation(decodeURIComponent(route.slice('conversations/'.length)))))
        return
      }
      if (request.method === 'GET' && route.startsWith('receipts/')) {
        await authorize(request, 'read')
        const receipt = await engine.getReceipt(decodeURIComponent(route.slice('receipts/'.length)))
        if (!receipt) throw new CoreError('NOT_FOUND', 'No receipt exists for that command ID.')
        response.end(JSON.stringify(receipt))
        return
      }
      const command = request.method === 'POST' && route.startsWith('commands/') ? commandRoutes.get(route.slice('commands/'.length)) : undefined
      if (command) {
        const client = await authorize(request, 'command')
        const body = await bodyOf(request)
        const result = await command(engine, body)
        try {
          await access.recordReceipt(String(body.commandId ?? ''), result, client.id)
        } catch {
          throw new CoreError('CLIENT_JOURNAL_UNAVAILABLE', 'The command committed but its client event was not recorded; retry the same command ID.')
        }
        response.end(JSON.stringify(result))
        return
      }
      throw new CoreError('NOT_FOUND', 'Client route not found.')
    } catch (error) {
      const status = statusOf(error)
      const code = error instanceof CoreError ? error.code : error instanceof SyntaxError ? 'INVALID_INPUT' : 'REQUEST_FAILED'
      const message = error instanceof SyntaxError ? 'Send a valid JSON object.' : status === 500 ? 'The client request failed.' : error instanceof Error ? error.message : 'Invalid request.'
      response.writeHead(status).end(JSON.stringify({ code, message }))
    }
  }

  const server = secure
    ? createHttpsServer({ key: options.tls!.key, cert: options.tls!.cert }, (request, response) => { void handler(request, response) })
    : createHttpServer((request, response) => { void handler(request, response) })
  server.requestTimeout = 15000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The client gateway did not bind a TCP port.')
  const url = `${secure ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${address.port}`
  return { url, instanceId, secure, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeIdleConnections()
  }) }
}
