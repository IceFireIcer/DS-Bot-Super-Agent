import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { Activation, HostLease, Switchover } from '../../dist/index.js'
import { SqliteStorage } from '../../dist/storage.js'

const config = JSON.parse(process.argv[2])
const EXIT_NOT_QUIESCED = 2
const EXIT_UNEXPECTED = 3
const storage = await SqliteStorage.open(config.databasePath)
const lease = await new HostLease(storage, 'private', { hostId: 'activation-crash', leaseMs: 600_000 }).acquire()

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
    if (!result?.stopped) throw new Error(result?.code ?? 'old receiver did not stop')
    return { evidence: result.evidence }
  },
  disableRestart: async () => {
    const disabled = `${config.legacyEntry}.disabled`
    if (!existsSync(config.legacyEntry) && existsSync(disabled)) return { evidence: 'launcher already disabled', entry: disabled }
    await rename(config.legacyEntry, disabled)
    return { evidence: 'launcher renamed', entry: disabled }
  },
  restartDisabled: async () => !existsSync(config.legacyEntry) && existsSync(`${config.legacyEntry}.disabled`),
  snapshot: async () => JSON.parse(readFileSync(config.statusFile, 'utf8')),
}

const switchover = new Switchover(storage, 'private')
const prepared = await switchover.begin({ batchId: config.batchId, newEpoch: lease.epoch, archive: { target: config.archiveTarget },
  oldHome: config.oldHome, entry: config.entry, legacy, settleMs: 50, entryWaitMs: 3_000, heartbeatMs: 200 })
if (prepared.state !== 'quiesced') {
  process.stderr.write(`switchover did not quiesce: ${JSON.stringify(prepared.blockers)}\n`)
  process.exit(EXIT_NOT_QUIESCED)
}
const held = {
  sourceInstanceId: 'legacy', threadId: 'thread-1', objectId: 'crash-held', version: { order: 'sequence', value: '1' },
  text: 'Held input at the activation boundary.', cursor: { sourceInstanceId: 'legacy', value: '1' },
  receipt: { commandId: 'crash-held-command', state: 'not-accepted', cursor: '1' },
}
await switchover.ingestGapInput(config.batchId, held)
const facts = JSON.parse(readFileSync(config.statusFile, 'utf8'))
facts.receipts = [...(facts.receipts ?? []), { commandId: 'crash-held-command', eventId: 'crash-held', state: 'not-accepted', cursor: '1' }]
writeFileSync(config.statusFile, JSON.stringify(facts))
const rechecked = await switchover.recheck(config.batchId, { legacy, settleMs: 50 })
if (rechecked.state !== 'quiesced') {
  process.stderr.write(`switchover lost quiescence after gap input: ${JSON.stringify(rechecked.blockers)}\n`)
  process.exit(EXIT_NOT_QUIESCED)
}
const activation = new Activation(storage, 'private', switchover)
await activation.activate({ batchId: config.batchId, commandId: config.commandId, newEpoch: lease.epoch, legacy, settleMs: 50, release: {
  release: async (input, context) => {
    appendFileSync(config.marker, `${JSON.stringify({ commandId: context.commandId, inputId: input.id, ticketId: 'crash-child-ticket' })}\n`)
    process.exit(0)
  },
} })
process.exit(EXIT_UNEXPECTED)
