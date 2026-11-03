import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'

// Each worker owns a separate real SQLite connection; no SQL runs on the probe's event loop.
const db = new DatabaseSync(workerData.path)
db.exec('PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;')
parentPort.on('message', ({ id, op, sql, args = [] }) => {
  try {
    let value
    if (op === 'exec') value = db.exec(sql)
    else if (op === 'close') { db.close(); parentPort.postMessage({ id }); parentPort.close(); return }
    else {
      const stmt = db.prepare(sql)
      value = stmt[op](...args)
    }
    parentPort.postMessage({ id, value })
  } catch (error) { parentPort.postMessage({ id, error: String(error) }) }
})
