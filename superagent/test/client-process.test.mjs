import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, textResponse, toolResponse } from '../dev/native-mock.mjs'

const runner = fileURLToPath(new URL('./fixtures/client-runner.mjs', import.meta.url))

async function until(check, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await check()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

test('a separate client process catches up the receipt and every result after disconnecting, and a revoke locks it out', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-client-process-'))
  let native, storage, sessions, engine, gateway
  t.after(async () => {
    await gateway?.close().catch(() => {})
    await engine?.effects.stop(); await sessions?.close(); await native?.fiber.dispose(); await storage?.close()
    await rm(directory, { recursive: true, force: true })
  })
  native = await nativeContext(join(directory, 'sessions'), async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (completed < 2) yield* toolResponse('report_ready', { result: completed ? 'Second result while disconnected.' : 'Delivered while disconnected.',
        evidence: 'Recorded by the mock Worker.' })
      else yield* textResponse('Recorded.')
      return
    }
    const tool = options.tools[completed]
    if (!tool) { yield* textResponse('Router complete.'); return }
    if (tool.name.startsWith('deliver_result')) {
      const ready = JSON.parse(text.slice('Ready report:'.length))
      yield* toolResponse(tool.name, { reportId: ready.id }, `router-${completed}`)
    } else yield* toolResponse(tool.name, {}, `router-${completed}`)
  })
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] }, {}, sessions)
  const access = engine.createClientAccess()
  gateway = await core.createClientGateway(engine, access)
  const client = await access.enroll({ commandId: 'desktop-enroll', label: 'Desktop client',
    grants: [{ instanceId: 'private', capabilities: ['read', 'command'] }] })
  engine.effects.start()

  const run = (...args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, gateway.url, client.token, 'private', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => child.kill(), 20000)
    child.once('exit', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`The client process exited with ${code}: ${stderr}`))
      else resolve(JSON.parse(stdout.trim().split('\n').at(-1)))
    })
  })

  // The first client process reads a cursor, submits and exits; the Host keeps the work running.
  const first = await run('submit', 'disconnect-1')
  assert.equal(first.accepted.status, 200)
  const receipt = first.accepted.body
  assert.equal(receipt.status, 'pending')
  await until(async () => (await engine.conversation(receipt.ticketId)).status === 'ready', 'the result to arrive without a client')
  await engine.retryTicket({ commandId: 'retry-while-disconnected', ticketId: receipt.ticketId, reason: 'Produce a second result while the client is offline.' })
  await until(async () => {
    const conversation = await engine.conversation(receipt.ticketId)
    return conversation.status === 'ready' && conversation.reportHistory.length >= 2
  }, 'the second result to arrive without a client')

  // A new process resumes from the stored cursor and receives the missed receipt and both results once.
  const caughtUp = await run('events', first.cursor)
  assert.equal(caughtUp.status, 200)
  const kinds = caughtUp.body.items.map(item => item.kind)
  assert.equal(kinds.includes('receipt'), true, JSON.stringify(caughtUp.body))
  assert.equal(kinds.includes('result'), true, JSON.stringify(caughtUp.body))
  assert.equal(caughtUp.body.items.filter(item => item.kind === 'receipt' && item.data.commandId === 'disconnect-1').length, 1)
  const results = caughtUp.body.items.filter(item => item.kind === 'result')
  assert.equal(results.length, 2, JSON.stringify(caughtUp.body))
  assert.equal(results[0].data.result, 'Delivered while disconnected.')
  assert.equal(new Set(results.map(item => item.data.id)).size, 2)
  const again = await run('events', caughtUp.body.cursor)
  assert.deepEqual(again.body.items, [])

  // Retrying the same command identity still returns the original receipt and does not add a second event.
  const duplicate = await run('submit', 'disconnect-1')
  assert.deepEqual(duplicate.accepted.body, receipt)
  const all = await run('events', '0')
  assert.equal(all.body.items.filter(item => item.kind === 'receipt' && item.data.commandId === 'disconnect-1').length, 1)

  await access.revoke({ commandId: 'desktop-revoke', clientId: client.client.id, reason: 'Desktop retired.' })
  const locked = await run('state')
  assert.equal(locked.status, 401)
  assert.equal(locked.body.code, 'CLIENT_REVOKED')
})
