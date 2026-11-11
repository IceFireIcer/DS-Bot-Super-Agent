// The lock beside the Host's data: a live Host blocks another one; a dead record does not.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { assertHostLockFree, hostLockPath, readHostLock, releaseHostLock, writeHostLock } from '../src/host-lock.mjs'

describe('the Host lock', () => {
  let directory
  let file
  before(() => { directory = mkdtempSync(join(tmpdir(), 'ds-bot-host-lock-')); file = hostLockPath(directory) })
  after(() => { rmSync(directory, { recursive: true, force: true }) })

  test('records the Host process and its port, and releases only its own record', () => {
    writeHostLock(file, { pid: 4321, port: 9010 })
    assert.deepEqual(readHostLock(file), { pid: 4321, port: 9010 })
    assert.equal(releaseHostLock(file, 9999), false, 'another process cannot release it')
    assert.equal(releaseHostLock(file, 4321), true)
    assert.equal(readHostLock(file), undefined)
  })

  test('a live Host blocks a second one, and the message names the process', () => {
    writeHostLock(file, { pid: 4321, port: 9010 })
    assert.throws(() => assertHostLockFree(file, { alive: () => true }), /pid 4321, port 9010/u)
    assert.equal(assertHostLockFree(file, { alive: () => false }).pid, 4321)
  })

  test('a dead Host or a malformed record does not block the next start', () => {
    writeHostLock(file, { pid: 4321 })
    assert.doesNotThrow(() => assertHostLockFree(file, { alive: () => false }))
    writeHostLock(file, { port: 9010 })
    assert.equal(readHostLock(file), undefined)
    assert.doesNotThrow(() => assertHostLockFree(file))
  })

  test('a rewrite is atomic: no temporary file is left behind', () => {
    writeHostLock(file, { pid: 4321, port: 9010 })
    writeHostLock(file, { pid: 4322, port: 9010 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: 4322, port: 9010 })
    assert.equal(existsSync(`${file}.tmp`), false, 'the temporary file is renamed away')
  })
})
