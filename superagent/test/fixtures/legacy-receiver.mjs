import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'

const config = JSON.parse(process.argv[2])
const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

let activeTurns = [...(config.activeTurns ?? ['turn-1'])]
let activeJobs = [...(config.activeJobs ?? [])]
let pendingOutbound = [...(config.pendingOutbound ?? ['out-1'])]
let receipts = readJson(config.receiptsFile, [])
let sequence = receipts.length
let stopping = false

const stateRevision = () => {
  const state = readJson(join(config.home, 'bot', 'state.json'), {})
  return Number.isInteger(state.revision) ? state.revision : undefined
}

function writeFacts() {
  writeFileSync(config.statusFile, JSON.stringify({
    capturedAt: Date.now(),
    ...(stateRevision() === undefined ? {} : { stateRevision: stateRevision() }),
    activeTurns: [...activeTurns], activeJobs: [...activeJobs], pendingOutbound: [...pendingOutbound],
    increments: { inputs: 0, receipts: 0, events: 0, outbound: 0 },
    cursors: [{ sourceInstanceId: 'legacy', value: String(sequence), complete: true }],
    receipts: [...receipts], review: [],
  }))
  writeFileSync(config.receiptsFile, JSON.stringify(receipts, null, 2))
}

const intake = createServer(socket => {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', chunk => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const body = JSON.parse(line)
          if (typeof body.objectId !== 'string' || !body.objectId) throw new Error('missing object')
          sequence++
          const receipt = { commandId: `old-${body.objectId}`, eventId: body.eventId ?? body.objectId, state: 'accepted', cursor: String(sequence) }
          receipts.push(receipt)
          writeFacts()
          socket.write(`${JSON.stringify({ accepted: true, receipt })}\n`)
        } catch {
          socket.write(`${JSON.stringify({ accepted: false })}\n`)
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  socket.on('error', () => {})
})

const admin = createServer(socket => {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', chunk => {
    buffer += chunk
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline).trim()
    try {
      const command = JSON.parse(line)
      if (command.command === 'release-job') {
        activeJobs = []
        writeFacts()
        socket.write(`${JSON.stringify({ ok: true, released: true })}\n`)
      } else if (command.command === 'stop') {
        activeTurns = []
        pendingOutbound = []
        if (!config.stubbornJob) activeJobs = []
        writeFacts()
        socket.write(`${JSON.stringify({ stopped: true, evidence: 'legacy receiver stopped' })}\n`)
        stopping = true
        setTimeout(() => {
          intake.closeAllConnections?.()
          admin.closeAllConnections?.()
          intake.close()
          admin.close()
          setTimeout(() => process.exit(0), 50)
        }, 50)
      } else {
        socket.write(`${JSON.stringify({ ok: false, code: 'UNKNOWN_COMMAND' })}\n`)
      }
    } catch {
      socket.write(`${JSON.stringify({ ok: false, code: 'INVALID_COMMAND' })}\n`)
    }
  })
  socket.on('error', () => {})
})

const close = () => {
  if (stopping) return
  stopping = true
  intake.closeAllConnections?.()
  admin.closeAllConnections?.()
  intake.close()
  admin.close()
  process.exit(0)
}
process.on('SIGTERM', close)
process.on('SIGINT', close)

await Promise.all([
  new Promise((resolve, reject) => { intake.once('error', reject); intake.listen({ host: config.intake.host, port: config.intake.port }, resolve) }),
  new Promise((resolve, reject) => { admin.once('error', reject); admin.listen({ host: config.admin.host, port: config.admin.port }, resolve) }),
])
if (!existsSync(config.statusFile)) writeFacts()
process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid })}\n`)
