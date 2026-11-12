import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFeed } from '../src/client/feed.js'

test('a disconnected feed retries the last cursor and renders each durable item once', async () => {
  const calls = []
  let fail = false
  const feed = createFeed(async (_endpoint, payload) => {
    calls.push(payload)
    if (fail) { fail = false; throw new Error('offline') }
    return calls.length === 1
      ? { cursor: 'first', tickets: [], items: [{ id: 'request', text: 'hello' }] }
      : { cursor: 'next', tickets: [], items: [{ id: 'request', text: 'hello' }, { id: 'result', text: 'done' }] }
  }, () => {})
  await feed.refresh()
  fail = true
  await assert.rejects(feed.refresh(), /offline/u)
  await feed.refresh()
  assert.deepEqual(calls, [{}, { cursor: 'first' }, { cursor: 'first' }])
  assert.deepEqual(feed.snapshot().items.map(item => item.id), ['request', 'result'])
})
