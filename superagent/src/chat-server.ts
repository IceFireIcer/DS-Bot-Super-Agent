import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { Engine } from './engine.js'
import { CoreError } from './model.js'
import { chatPage } from './chat-page.js'
import type { ClientAccess, ClientCapability } from './client-access.js'

export async function createChatServer(engine: Engine, options: { clients?: ClientAccess } = {}) {
  options.clients?.assertEngine(engine)
  let origin = ''
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin) {
        response.writeHead(403).end(JSON.stringify({ message: 'This local conversation only accepts its own origin.' })); return
      }
      const url = new URL(request.url ?? '/', origin)
      if (request.method === 'GET' && url.pathname === '/') {
        const nonce = randomBytes(18).toString('base64')
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`)
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(chatPage.replaceAll('NONCE', nonce)); return
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (request.method === 'GET' && url.pathname === '/environments') { response.end(JSON.stringify(engine.listEnvironments())); return }
      if (request.method === 'GET' && url.pathname === '/capabilities') { response.end(JSON.stringify(engine.getCapabilityLocations())); return }
      if (request.method === 'GET' && url.pathname === '/slots') { response.end(JSON.stringify(await engine.listSlots())); return }
      if (request.method === 'GET' && url.pathname === '/jobs') { response.end(JSON.stringify(await engine.listJobs(url.searchParams.get('ticket') ?? ''))); return }
      if (request.method === 'GET' && url.pathname === '/job') { response.end(JSON.stringify(await engine.getJob(url.searchParams.get('ticket') ?? '', url.searchParams.get('job') ?? ''))); return }
      if (request.method === 'GET' && url.pathname === '/previews') { response.end(JSON.stringify(await engine.listPreviews(url.searchParams.get('ticket') ?? ''))); return }
      if (request.method === 'GET' && url.pathname === '/preview') { response.end(JSON.stringify(await engine.getPreview(url.searchParams.get('ticket') ?? '', url.searchParams.get('preview') ?? ''))); return }
      if (request.method === 'GET' && url.pathname === '/subagents') { response.end(JSON.stringify(await engine.listSubagents(url.searchParams.get('ticket') ?? ''))); return }
      if (request.method === 'GET' && url.pathname === '/subagent') { response.end(JSON.stringify(await engine.getSubagent(url.searchParams.get('ticket') ?? '', url.searchParams.get('subagent') ?? ''))); return }
      if (request.method === 'GET' && url.pathname === '/supervision') { response.end(JSON.stringify(await engine.getSupervision())); return }
      if (request.method === 'GET' && url.pathname === '/clients') {
        if (!options.clients) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Client access is not configured on this loopback entry.')
        response.end(JSON.stringify(await options.clients.list())); return
      }
      if (request.method === 'GET' && url.pathname === '/context') {
        const kind = url.searchParams.get('kind') ?? ''
        const id = url.searchParams.get('id') ?? ''
        const threadId = url.searchParams.get('thread') ?? ''
        const objectId = url.searchParams.get('object') ?? ''
        const after = url.searchParams.get('after') ?? ''
        const maxBytes = url.searchParams.get('maxBytes')
        response.end(JSON.stringify(await engine.readContext({ ticketId: url.searchParams.get('ticket') ?? '',
          ref: { kind: kind as never, ticketId: url.searchParams.get('ticket') ?? '', ...(id ? { id } : {}),
            ...(threadId ? { threadId } : {}), ...(objectId ? { objectId } : {}) },
          ...(after ? { after } : {}), ...(maxBytes ? { maxBytes: Number(maxBytes) } : {}) })))
        return
      }
      const commands: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
        '/request': body => engine.submit(body as never),
        '/retry-setup': body => engine.retrySetup(body as never),
        '/answer': body => engine.answerAttention(body as never),
        '/stop': body => engine.stopTicket(body as never),
        '/resume': body => engine.resumeTicket(body as never),
        '/retry': body => engine.retryTicket(body as never),
        '/status': body => engine.requestStatus(body as never),
        '/pause': body => engine.setProcessingPaused(body as never),
        '/cancel-job': body => engine.cancelJob(body as never),
        '/cancel-preview': body => engine.cancelPreview(body as never),
        '/resolve-preview': body => engine.resolvePreview(body as never),
        '/cancel-subagent': body => engine.cancelSubagent(body as never),
        '/requeue': body => engine.requeueSourceEvent(body as never),
        '/unsubscribe': body => engine.removeThreadSubscription(body as never),
        '/dismiss-eval': body => engine.dismissEvaluation(body as never),
        '/clients': body => {
          if (!options.clients) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Client access is not configured on this loopback entry.')
          const capabilities = body.capabilities === undefined ? ['read', 'command'] : body.capabilities
          return options.clients.enroll({ commandId: body.commandId as string, label: body.label as string,
            grants: [{ instanceId: engine.getInstanceId(), capabilities: capabilities as ClientCapability[] }] })
        },
        '/clients/revoke': body => {
          if (!options.clients) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Client access is not configured on this loopback entry.')
          return options.clients.revoke({ commandId: body.commandId as string, clientId: body.clientId as string, reason: body.reason as string })
        },
      }
      const command = request.method === 'POST' ? commands[url.pathname] : undefined
      if (command) {
        if (request.headers['content-type'] !== 'application/json') throw new CoreError('INVALID_INPUT', 'Send a JSON request.')
        let size = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          size += chunk.length
          if (size > 70000) throw new CoreError('INVALID_INPUT', 'The request exceeds the input budget.')
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const receipt = await command(body)
        response.end(JSON.stringify(receipt)); return
      }
      if (request.method === 'GET' && url.pathname === '/conversation') {
        response.end(JSON.stringify(await engine.conversation(url.searchParams.get('ticket') ?? ''))); return
      }
      response.writeHead(404).end(JSON.stringify({ message: 'Conversation route not found.' }))
    } catch (error) {
      const status = error instanceof CoreError && error.code === 'NOT_FOUND' ? 404 : error instanceof CoreError || error instanceof SyntaxError ? 400 : 500
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ code: error instanceof CoreError ? error.code : 'REQUEST_FAILED', message: status === 500 ? 'The local conversation is unavailable.' : error instanceof Error ? error.message : 'Invalid request.' }))
    }
  })
  server.requestTimeout = 10000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The local conversation did not bind a TCP port.')
  origin = `http://127.0.0.1:${address.port}`
  return { url: origin, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections() }) }
}
