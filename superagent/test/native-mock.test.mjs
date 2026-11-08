import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nativeContext, textResponse } from '../dev/native-mock.mjs'

test('a Promise-returning mock responder reports its contract error before a Session starts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-mock-contract-'))
  let native
  t.after(async () => { await native?.fiber.dispose() })
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(async () => { native = await nativeContext(directory, async () => textResponse('Invalid responder.')) }, /Mock responder must return an iterable; use an async generator for asynchronous responses/u)
})
