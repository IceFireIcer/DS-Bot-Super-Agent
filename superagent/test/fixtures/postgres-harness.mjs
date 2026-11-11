import { randomBytes } from 'node:crypto'
import { fork } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import pg from 'pg'
import { PostgresStorage } from '../../dist/postgres-storage.js'

async function freePort() {
  const temporary = net.createServer()
  await new Promise(resolve => temporary.listen(0, '127.0.0.1', resolve))
  const port = temporary.address().port
  await new Promise(resolve => temporary.close(resolve))
  return port
}

async function removeFixture(directory) {
  const target = await realpath(directory)
  const temporary = await realpath(tmpdir())
  if (!target.startsWith(`${temporary}${sep}`)) throw new Error('The PostgreSQL fixture directory escaped the temporary root.')
  await rm(target, { recursive: true, force: true })
}

export async function startPostgres(prefix = 'ds-superagent-postgres-') {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  const port = await freePort()
  const password = randomBytes(24).toString('hex')
  const owner = fork(new URL('./postgres-owner.mjs', import.meta.url), [], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  let exited = false
  const exit = new Promise(resolve => {
    owner.once('exit', code => { exited = true; resolve(code) })
    owner.once('error', () => { exited = true; resolve(1) })
  })
  async function stopOwner(allowStartupFailure = false) {
    if (!exited && owner.connected) owner.send({ type: 'stop' }, () => {})
    let timer
    const stopped = await Promise.race([exit.then(code => ({ code })), new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 35_000) })])
    clearTimeout(timer)
    if (!stopped || (!allowStartupFailure && stopped.code !== 0)) throw new Error('The PostgreSQL owner did not close cleanly.')
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PostgreSQL fixture startup timed out.')), 60_000)
      owner.once('message', message => {
        clearTimeout(timer)
        if (message.type === 'ready') resolve()
        else reject(new Error('PostgreSQL fixture startup failed.'))
      })
      void exit.then(() => { clearTimeout(timer); reject(new Error('PostgreSQL fixture owner exited before startup.')) })
      owner.send({ type: 'start', directory, port, password })
    })
  } catch (error) {
    await stopOwner(true)
    await removeFixture(directory)
    throw error
  }
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
    const admin = await client()
    try { await admin.query(`CREATE DATABASE "${name}"`) } finally { await admin.end() }
    return name
  }
  const database = async () => {
    const name = await createDatabase()
    return { name, client: await client(name) }
  }
  let closing
  const server = { stop: stopOwner }
  return {
    directory, port, password, server, configuration, client, createDatabase, database,
    async newStorage(options = {}) {
      const name = await createDatabase()
      const storage = await PostgresStorage.open({ ...configuration, database: name, ...options })
      opened.push(storage)
      return { storage, database: name }
    },
    register(storage) { opened.push(storage); return storage },
    close() {
      closing ??= (async () => {
        await Promise.allSettled(opened.map(storage => storage.close()))
        await Promise.allSettled(clients.map(connection => connection.end()))
        await stopOwner()
        await removeFixture(directory)
      })()
      return closing
    },
  }
}
