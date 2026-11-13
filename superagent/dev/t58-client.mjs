// A small independent desktop-client process for the T58 hosted Host. It only speaks the
// public client-gateway protocol; credentials are read from a protected file and never printed.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const argument = name => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const required = name => {
  const value = argument(name)
  if (!value) throw new Error(`Use --${name}.`)
  return value
}
const gateway = required('gateway').replace(/\/$/u, '')
const instance = required('instance')
const tokenFile = required('token-file')
const cursorFile = required('cursor-file')
const mode = required('mode')
const token = (await readFile(tokenFile, 'utf8')).trim()
const base = `${gateway}/instances/${instance}`
const headers = { authorization: `Bearer ${token}` }

const call = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}
const cursor = async () => {
  try { return (await readFile(cursorFile, 'utf8')).trim() } catch { return '0' }
}
const saveCursor = value => writeFile(cursorFile, `${value}\n`, { mode: 0o600 })
const state = async () => {
  const result = await call('/state')
  if (result.status === 200) await saveCursor(result.body.cursor)
  return result
}
const events = async after => {
  const result = await call(`/events?after=${encodeURIComponent(after)}`)
  if (result.status === 200) await saveCursor(result.body.cursor)
  return result
}

let result
if (mode === 'state') result = await state()
else if (mode === 'submit') {
  const before = await state()
  const commandId = argument('command-id') ?? `t58-${randomUUID()}`
  const target = argument('target')
  const accepted = await call('/commands/submit', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId, eventId: `${commandId}-event`,
      text: argument('text') ?? 'Report that the Windows desktop client submitted this request and include the word client in the result.',
      ...(target ? { target } : {}) }) })
  result = { cursor: before.body?.cursor, commandId, accepted }
} else if (mode === 'events') result = await events(argument('after') ?? await cursor())
else if (mode === 'wait') {
  const ticketId = required('ticket-id')
  let after = await cursor()
  const seen = []
  const deadline = Date.now() + Number(argument('timeout-ms') ?? 180000)
  while (Date.now() < deadline) {
    const page = await events(after)
    if (page.status !== 200) { result = page; break }
    seen.push(...page.body.items)
    after = page.body.cursor
    if (seen.some(item => item.kind === 'result' && item.ticketId === ticketId)) {
      result = { status: 200, body: { cursor: after, items: seen } }
      break
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  result ??= { status: 408, body: { cursor: after, items: seen } }
} else throw new Error(`Unknown mode ${mode}.`)

process.stdout.write(`${JSON.stringify(result)}\n`)
