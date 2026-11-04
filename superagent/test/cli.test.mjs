import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../dist/index.js'

const execute = promisify(execFile)
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

test('separate CLI processes submit and reopen the same durable receipt and work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const config = ['--database', join(directory, 'state.sqlite'), '--instance', 'private', '--source', 'desktop-one', '--actor', 'local-user', '--allow-actor', 'local-user']
  const run = async args => JSON.parse((await execute(process.execPath, [cli, ...args, ...config], { timeout: 10000 })).stdout)
  const request = ['submit', '--command', 'cli-command', '--event', 'cli-event', '--text', 'Check the supplied files.']
  const receipt = await run(request)
  assert.equal(receipt.status, 'pending')
  assert.deepEqual(await run(['receipt', '--command', 'cli-command']), receipt)
  assert.deepEqual(await run(request), receipt)
  const work = await run(['query', '--ticket', receipt.ticketId])
  assert.equal(work.trigger.text, 'Check the supplied files.')
  assert.equal(work.intent.reason, 'worker-not-enabled')
})

test('real process exits before and after commit preserve the correct acceptance facts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-superagent-crash-'))
  const databasePath = join(directory, 'state.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = fileURLToPath(new URL('./fixtures/crash.mjs', import.meta.url))
  const config = { databasePath, instanceId: 'private', source: { sourceInstanceId: 'desktop-one', actorId: 'local-user', allowedActorIds: ['local-user'] } }
  await assert.rejects(execute(process.execPath, [fixture, databasePath, 'before'], { timeout: 10000 }), { code: 17 })
  const before = new Context()
  await before.plugin(plugin, config)
  try {
    assert.equal(await before.get('superagent').getReceipt('crash-command'), undefined)
    assert.deepEqual(await before.get('superagent').listTickets(), { items: [], hasMore: false })
  } finally { await before.fiber.dispose() }
  await assert.rejects(execute(process.execPath, [fixture, databasePath, 'after'], { timeout: 10000 }), { code: 18 })
  const after = new Context()
  await after.plugin(plugin, config)
  try {
    const receipt = await after.get('superagent').getReceipt('crash-command')
    assert.equal(receipt.status, 'pending')
    assert.equal((await after.get('superagent').getTicket(receipt.ticketId)).mandate.scope, 'Preserve the original request.')
    assert.equal((await after.get('superagent').listTickets()).items.length, 1)
  } finally { await after.fiber.dispose() }
})
