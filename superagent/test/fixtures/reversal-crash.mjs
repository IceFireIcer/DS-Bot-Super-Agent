import { appendFileSync } from 'node:fs'
import { HostLease, Reversal } from '../../dist/index.js'
import { SqliteStorage } from '../../dist/storage.js'

const config = JSON.parse(process.argv[2])
const storage = await SqliteStorage.open(config.databasePath)
await new HostLease(storage, 'private', { hostId: 'reversal-crash', leaseMs: config.leaseMs ?? 500 }).acquire()

const reversal = new Reversal(storage, 'private', {})
await reversal.reverse({ batchId: config.batchId, commandId: config.commandId, reason: 'Interrupted reverse drill.', control: {
  stopAndSnapshot: async () => {
    appendFileSync(config.marker, `${JSON.stringify({ commandId: config.commandId, stoppedAt: Date.now() })}\n`)
    process.exit(0)
  },
} })
process.exit(1)
