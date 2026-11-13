// Revoke one T58 client through the same durable business store the hosted Host uses.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ClientAccess } from '../dist/index.js'
import { PostgresStorage } from '../dist/postgres-storage.js'

const args = process.argv.slice(2)
const argument = name => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const clientIdFile = argument('client-id-file')
if (!clientIdFile) throw new Error('Use --client-id-file <path>.')
const pg = {
  host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'ds58', password: process.env.PGPASSWORD ?? '',
  database: process.env.PGDATABASE ?? 'ds58', ssl: false,
}
if (!pg.password) throw new Error('PGPASSWORD is required.')
const clientId = (await readFile(clientIdFile, 'utf8')).trim()
const storage = await PostgresStorage.open(pg)
try {
  const access = new ClientAccess(storage, argument('instance') ?? 't58')
  const client = await access.revoke({ commandId: `t58-revoke-${randomUUID()}`, clientId,
    reason: argument('reason') ?? 'T58 desktop client revoked during acceptance.' })
  console.log(JSON.stringify({ clientId: client.id, revokedAt: client.revokedAt, reason: client.revokedReason }))
} finally {
  await storage.close()
}
