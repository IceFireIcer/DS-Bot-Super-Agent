import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const fixture = fileURLToPath(new URL('./fixtures/host-lease.mjs', import.meta.url))
const firstLine = child => new Promise((resolve, reject) => {
  const lines = createInterface({ input: child.stdout })
  lines.once('line', line => { lines.close(); resolve(JSON.parse(line)) })
  child.once('exit', code => reject(new Error(`Host process exited before reporting its lease: ${code}`)))
})
const run = (databasePath, hostId, mode = 'try') => spawn(process.execPath, [fixture, databasePath, hostId, mode, '5000'], { stdio: ['ignore', 'pipe', 'inherit'] })

test('two real Host processes cannot both write until the old lease expires', { timeout: 25000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-host-process-'))
  const databasePath = join(directory, 'state.sqlite')
  const holder = run(databasePath, 'process-holder', 'hold')
  t.after(async () => {
    holder.kill()
    await rm(directory, { recursive: true, force: true })
  })
  const held = await firstLine(holder)
  assert.equal(held.ok, true)
  assert.equal(held.hostId, 'process-holder')

  const contender = run(databasePath, 'process-contender')
  const blocked = await firstLine(contender)
  assert.deepEqual(blocked, { ok: false, code: 'HOST_LEASED' })
  await new Promise(resolve => contender.once('exit', resolve))

  holder.kill()
  await new Promise(resolve => holder.once('exit', resolve))
  await new Promise(resolve => setTimeout(resolve, 5500))
  const replacement = run(databasePath, 'process-replacement')
  const acquired = await firstLine(replacement)
  assert.equal(acquired.ok, true)
  assert.equal(acquired.hostId, 'process-replacement')
  assert.equal(acquired.epoch, held.epoch + 1)
  await new Promise(resolve => replacement.once('exit', resolve))
})
