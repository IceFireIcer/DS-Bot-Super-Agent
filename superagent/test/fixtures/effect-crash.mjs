import { appendFile } from 'node:fs/promises'
import { Effects } from '../../dist/index.js'
import { SqliteStorage } from '../../dist/storage.js'

const [databasePath, marker, phase] = process.argv.slice(2)
const storage = await SqliteStorage.open(databasePath)
const effects = new Effects(storage, 'private', { handlers: { relay: {
  execute: async (effect, operation) => {
    await appendFile(marker, `${operation.idempotencyKey}\n`)
    process.exit(23)
  },
} } })
await storage.transaction('private', async transaction => {
  await effects.enqueue(transaction, { key: 'durable-input', stream: 'relay', scope: 'worker', payload: { text: 'original input' } })
  if (phase === 'before') process.exit(21)
})
if (phase === 'after') process.exit(22)
await effects.drain()
