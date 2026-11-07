import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { Engine } from './engine.js'
import { CoreError } from './model.js'
import { chatPage } from './chat-page.js'

export async function createChatServer(engine: Engine) {
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
      if (request.method === 'POST' && (url.pathname === '/request' || url.pathname === '/retry-setup' || url.pathname === '/answer' || url.pathname === '/stop' || url.pathname === '/resume' || url.pathname === '/pause')) {
        if (request.headers['content-type'] !== 'application/json') throw new CoreError('INVALID_INPUT', 'Send a JSON request.')
        let size = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          size += chunk.length
          if (size > 70000) throw new CoreError('INVALID_INPUT', 'The request exceeds the input budget.')
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const receipt = url.pathname === '/request' ? await engine.submit(body)
          : url.pathname === '/retry-setup' ? await engine.retrySetup(body)
            : url.pathname === '/answer' ? await engine.answerAttention(body)
              : url.pathname === '/stop' ? await engine.stopTicket(body)
                : url.pathname === '/resume' ? await engine.resumeTicket(body) : await engine.setProcessingPaused(body)
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
