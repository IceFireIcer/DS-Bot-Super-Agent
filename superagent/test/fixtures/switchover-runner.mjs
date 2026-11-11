import { existsSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { SqliteStorage } from '../../dist/storage.js'
import { Switchover } from '../../dist/switchover.js'

const config = JSON.parse(process.argv[2])
const storage = await SqliteStorage.open(config.databasePath)
const switchover = new Switchover(storage, 'private')

function admin(command) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.admin.host, port: config.admin.port })
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5_000, () => { socket.destroy(); reject(new Error('admin timeout')) })
    socket.on('error', reject)
    socket.on('data', chunk => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      socket.destroy()
      try { resolve(JSON.parse(buffer.slice(0, newline))) } catch (error) { reject(error) }
    })
    socket.on('connect', () => socket.write(`${JSON.stringify(command)}\n`))
  })
}

const legacy = {
  stop: async () => {
    const result = await admin({ command: 'stop' })
    if (!result?.stopped) throw new Error(result?.code ?? 'the old receiver did not stop')
    return { evidence: result.evidence }
  },
  disableRestart: async () => {
    const disabled = `${config.legacyEntry}.disabled`
    if (!existsSync(config.legacyEntry) && existsSync(disabled)) return { evidence: `renamed ${config.legacyEntry}`, entry: disabled }
    await rename(config.legacyEntry, disabled)
    return { evidence: `renamed ${config.legacyEntry}`, entry: disabled }
  },
  restartDisabled: async () => !existsSync(config.legacyEntry) && existsSync(`${config.legacyEntry}.disabled`),
  snapshot: async () => JSON.parse(await readFile(config.statusFile, 'utf8')),
}

const report = value => process.stdout.write(`${JSON.stringify(value)}\n`)
let keepAlive
let control
const close = async (code = 0) => {
  if (keepAlive) clearInterval(keepAlive)
  if (control) {
    control.closeAllConnections?.()
    await new Promise(resolve => control.close(() => resolve()))
    control = undefined
  }
  await switchover.close().catch(() => {})
  await storage.close().catch(() => {})
  process.exit(code)
}
process.on('SIGTERM', () => { void close(0) })
process.on('SIGINT', () => { void close(0) })

try {
  if (config.mode === 'begin') {
    const record = await switchover.begin({ batchId: config.batchId, newEpoch: config.newEpoch, archive: { target: config.archiveTarget },
      oldHome: config.oldHome, entry: config.entry, legacy, settleMs: config.settleMs, entryWaitMs: config.entryWaitMs, heartbeatMs: config.heartbeatMs })
    if (config.control) {
      control = createServer(socket => {
        let buffer = ''
        socket.setEncoding('utf8')
        socket.on('data', chunk => {
          buffer += chunk
          const newline = buffer.indexOf('\n')
          if (newline < 0) return
          const line = buffer.slice(0, newline).trim()
          try {
            if (JSON.parse(line).command === 'close') {
              socket.write(`${JSON.stringify({ ok: true })}\n`)
              setTimeout(() => { void close(0) }, 10)
            }
          } catch { socket.write(`${JSON.stringify({ ok: false })}\n`) }
        })
        socket.on('error', () => {})
      })
      await new Promise((resolve, reject) => { control.once('error', reject); control.listen({ host: config.control.host, port: config.control.port }, resolve) })
    }
    report({ ok: true, record })
    keepAlive = setInterval(() => {}, 60_000)
  } else if (config.mode === 'status') {
    const status = await switchover.status(config.batchId)
    report({ ok: true, status })
    await close()
  } else if (config.mode === 'recheck') {
    const record = await switchover.recheck(config.batchId, { legacy, settleMs: config.settleMs })
    report({ ok: true, record })
    await close()
  } else if (config.mode === 'list') {
    const items = []
    let after
    for (;;) {
      const page = await switchover.listGapInputs(config.batchId, { limit: 100, ...(after ? { after } : {}) })
      items.push(...page.items)
      if (!page.cursor) break
      after = page.cursor
    }
    report({ ok: true, items })
    await close()
  } else {
    throw new Error(`unknown mode: ${config.mode}`)
  }
} catch (error) {
  report({ ok: false, code: error?.code ?? 'SWITCHOVER_FAILED', message: String(error?.message ?? error) })
  await close(1)
}
