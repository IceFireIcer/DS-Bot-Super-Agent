import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { PostgresStorage } from '../../dist/postgres-storage.js'

async function freePort() {
  const temporary = net.createServer()
  await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve))
  const port = temporary.address().port
  await new Promise(resolve => temporary.close(resolve))
  return port
}

export async function startPostgres(prefix = 'ds-superagent-postgres-') {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  const port = await freePort()
  const password = randomBytes(24).toString('hex')
  const server = new EmbeddedPostgres({
    databaseDir: join(directory, 'cluster'), port, user: 'postgres', password, persistent: true,
    createPostgresUser: false, onLog: () => {}, onError: () => {},
    postgresFlags: ['-h', '127.0.0.1', '-c', 'fsync=on', '-c', 'synchronous_commit=on'],
  })
  await server.initialise()
  await server.start()
  const configuration = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false }
  const opened = []
  const clients = []
  let sequence = 0
  const client = async (database = 'postgres') => {
    const connection = new pg.Client({ ...configuration, database })
    connection.on('error', () => {})
    await connection.connect()
    clients.push(connection)
    return connection
  }
  const createDatabase = async () => {
    const name = `t_${++sequence}`
    await server.createDatabase(name)
    return name
  }
  const database = async () => {
    const name = await createDatabase()
    return { name, client: await client(name) }
  }
  return {
    directory, port, password, server, configuration, client, createDatabase, database,
    async newStorage(options = {}) {
      const name = await createDatabase()
      const storage = await PostgresStorage.open({ ...configuration, database: name, ...options })
      opened.push(storage)
      return { storage, database: name }
    },
    register(storage) { opened.push(storage); return storage },
    async close() {
      await Promise.allSettled(opened.map(storage => storage.close()))
      await Promise.allSettled(clients.map(connection => connection.end()))
      await server.stop().catch(() => {})
      await rm(directory, { recursive: true, force: true })
    },
  }
}
