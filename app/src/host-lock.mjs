// A lock beside the Host's data: a second app must not start a second Host on the same team
// while the first Host is still alive, even when its window (and its shell) is gone.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const processAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

export const hostLockPath = (dataDir) => join(dataDir, 'host.lock')

export function readHostLock(file) {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'))
    return Number.isInteger(record?.pid) && record.pid > 0 ? record : undefined
  } catch { return undefined }
}

const describe = (record) => `Another DS Bot Host is still running on this data (pid ${String(record.pid)}${record.port === undefined ? '' : `, port ${String(record.port)}`}). Close it, then try again.`

/** Refuse a start while another live process owns this data; a dead record is not a Host. */
export function assertHostLockFree(file, { alive = processAlive } = {}) {
  const existing = readHostLock(file)
  // A process may rewrite the record it wrote before its Host child existed.
  if (existing !== undefined && existing.pid !== process.pid && alive(existing.pid)) throw new Error(describe(existing))
  return existing
}

export function writeHostLock(file, { pid, port }) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ pid, ...(port === undefined ? {} : { port }) })}\n`)
  renameSync(`${file}.tmp`, file)
}

export function releaseHostLock(file, pid) {
  if (file === undefined || pid === undefined) return false
  const existing = readHostLock(file)
  if (existing === undefined || existing.pid !== pid) return false
  try { unlinkSync(file); return true } catch { return false }
}
