import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../../dist/index.js'
import { SqliteStorage } from '../../dist/storage.js'

const [databasePath, phase] = process.argv.slice(2)
const storage = await SqliteStorage.open(databasePath)
const boundary = phase === 'before' ? {
  transaction: (instanceId, operation) => storage.transaction(instanceId, async tx => {
    await operation(tx)
    process.exit(17)
  }),
  close: () => storage.close(),
} : storage
const ctx = new Context()
await ctx.plugin(plugin, { databasePath, instanceId: 'private', source: { sourceInstanceId: 'desktop-one', actorId: 'local-user', allowedActorIds: ['local-user'] }, storage: boundary })
await ctx.get('superagent').submit({ commandId: 'crash-command', eventId: 'crash-event', text: 'Preserve the original request.' })
process.exit(18)
