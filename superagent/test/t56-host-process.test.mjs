import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const fixture = fileURLToPath(new URL('./fixtures/t56-host.mjs', import.meta.url))

test('a real Host process recovers the same Ticket and does not duplicate work', { timeout: 60000 }, context => {
  const directory = mkdtempSync(join(tmpdir(), 'ds-bot-t56-process-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const run = (request, extra = []) => spawnSync(process.execPath, [fixture, '--database', join(directory, 'state.sqlite'),
    '--sessions', join(directory, 'sessions'), '--session', 'ui-chat-chief', '--request', request, ...extra], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  const first = run('t56-process-replay')
  assert.equal(first.status, 0, first.stderr)
  const firstResult = JSON.parse(first.stdout)
  assert.equal(typeof firstResult.ticketId, 'string')
  assert.equal(firstResult.delivered, firstResult.ticketId)
  assert.ok(firstResult.items > 0)
  assert.ok(firstResult.userMessages > 0)
  assert.equal(firstResult.sessionId, 'ui-chat-chief')
  assert.ok(['running', 'idle'].includes(firstResult.status))

  const second = run('t56-process-replay')
  assert.equal(second.status, 0, second.stderr)
  const secondResult = JSON.parse(second.stdout)
  assert.equal(secondResult.ticketId, firstResult.ticketId)
  assert.equal(secondResult.delivered, firstResult.delivered)
  assert.equal(secondResult.items, firstResult.items)
  assert.equal(secondResult.userMessages, firstResult.userMessages)
  assert.deepEqual(secondResult.seqs, firstResult.seqs)
  const stopped = run('t56-process-stop', ['--stop'])
  assert.equal(stopped.status, 0, stopped.stderr)
})
