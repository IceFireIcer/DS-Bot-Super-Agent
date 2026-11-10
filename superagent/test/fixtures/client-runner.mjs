const [url, token, instance, mode, argument] = process.argv.slice(2)
const base = `${url}/instances/${instance}`
const headers = { authorization: `Bearer ${token}` }

async function call(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}

let result
if (mode === 'state') result = await call('/state')
else if (mode === 'submit') {
  const state = await call('/state')
  const accepted = await call('/commands/submit', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: argument, eventId: `${argument}-event`, text: 'A request from a disconnected client.' }) })
  result = { cursor: state.body.cursor, accepted }
} else if (mode === 'events') {
  result = await call(`/events?after=${encodeURIComponent(argument)}`)
} else if (mode === 'receipt') {
  result = await call(`/receipts/${encodeURIComponent(argument)}`)
} else {
  result = { status: 400, body: { code: 'INVALID_MODE', message: 'Unknown client runner mode.' } }
}

process.stdout.write(`${JSON.stringify(result)}\n`)
