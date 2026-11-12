import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatCompletionsEndpoint, createModelBudget, OpenAiCompatibleAdapter, providerMessages, providerTools } from '../dev/real-model-adapter.mjs'

const messages = [
  { role: 'system', content: [{ type: 'text', text: 'System.' }] },
  { role: 'user', content: [{ type: 'text', text: 'Do the work.' }] },
]

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function adapter(fetchImpl, budget = createModelBudget({ maxRequests: 4, maxTokens: 10_000 })) {
  return new OpenAiCompatibleAdapter({ endpoint: 'https://model.example/v1', apiKey: 'test-key', model: 'deepseek-v4.1-flash-1017',
    budget, fetchImpl, now: () => 100 })
}

test('the endpoint normalizer accepts an origin or a versioned base without changing an explicit endpoint', () => {
  assert.equal(chatCompletionsEndpoint('https://pro.pokexiao.com'), 'https://pro.pokexiao.com/v1/chat/completions')
  assert.equal(chatCompletionsEndpoint('https://pro.pokexiao.com/v1'), 'https://pro.pokexiao.com/v1/chat/completions')
  assert.equal(chatCompletionsEndpoint('https://pro.pokexiao.com/v1/chat/completions'), 'https://pro.pokexiao.com/v1/chat/completions')
  assert.equal(chatCompletionsEndpoint('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1/chat/completions')
  assert.throws(() => chatCompletionsEndpoint('http://model.example/v1'), /HTTPS/u)
  assert.throws(() => chatCompletionsEndpoint('https://user:key@model.example/v1'), /credentials/u)
})

test('provider projections carry text, assistant tool calls and tool results in order', () => {
  const projected = providerMessages({ system: 'One-shot system.', messages: [
    { role: 'user', content: [{ type: 'text', text: 'Request.' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'report_ready', arguments: '{"result":"ok"}' }],
      source: { kind: 'model', provider: 'pokexiao', model: 'deepseek' } },
    { role: 'tool', content: [{ type: 'text', text: 'Recorded.' }], toolCallId: 'call-1', source: { kind: 'tool', callId: 'call-1' } },
  ] })
  assert.deepEqual(projected, [
    { role: 'system', content: 'One-shot system.' },
    { role: 'user', content: 'Request.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'report_ready', arguments: '{"result":"ok"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'Recorded.' },
  ])
  assert.deepEqual(providerTools([{ name: 'emit', description: 'Emit.', parameters: { type: 'object' } }]),
    [{ type: 'function', function: { name: 'emit', description: 'Emit.', parameters: { type: 'object' } } }])
})

test('a real-model response becomes public text, tool-call and usage chunks within one budgeted call', async () => {
  let request
  const budget = createModelBudget({ maxRequests: 4, maxTokens: 10_000 })
  const model = adapter(async (url, init) => {
    request = { url, init }
    return response({ choices: [{ message: { role: 'assistant', content: 'Ready.', reasoning_content: 'Checked.',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'report_ready', arguments: '{"result":"ok"}' } }] },
      finish_reason: 'tool_calls' }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 6 } } })
  }, budget)
  const chunks = []
  for await (const chunk of model.stream({ provider: 'pokexiao', model: 'deepseek-v4.1-flash-1017', messages, temperature: 0 })) chunks.push(chunk)
  assert.equal(request.url, 'https://model.example/v1/chat/completions')
  assert.equal(request.init.headers.Authorization, 'Bearer test-key')
  assert.deepEqual(JSON.parse(request.init.body).messages, [{ role: 'system', content: 'System.' }, { role: 'user', content: 'Do the work.' }])
  assert.deepEqual(chunks.map(chunk => chunk.type), ['block-start', 'reasoning-delta', 'block-end', 'block-start', 'text-delta', 'block-end',
    'block-start', 'tool-call-delta', 'block-end', 'usage', 'finish'])
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage, { inputTokens: 100, outputTokens: 30, totalTokens: 150,
    cacheReadTokens: 20, reasoningTokens: 6 })
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  assert.deepEqual(budget.calls[0].toolCalls, ['report_ready'])
  assert.equal(budget.totalTokens, 150)
  assert.equal(budget.exceeded, false)
})

test('the adapter refuses a call once its request or token budget is exhausted', async () => {
  const budget = createModelBudget({ maxRequests: 1, maxTokens: 1 })
  const model = adapter(async () => response({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }), budget)
  for await (const chunk of model.stream({ provider: 'pokexiao', model: 'deepseek', messages })) assert.ok(chunk)
  assert.equal(budget.exceeded, true)
  await assert.rejects(async () => {
    for await (const chunk of model.stream({ provider: 'pokexiao', model: 'deepseek', messages })) assert.ok(chunk)
  }, error => error.code === 'MODEL_BUDGET')
})

test('an authentication failure is a typed LlmError without exposing the key', async () => {
  const model = adapter(async () => response({}, 401))
  await assert.rejects(async () => {
    for await (const chunk of model.stream({ provider: 'pokexiao', model: 'deepseek', messages })) assert.ok(chunk)
  }, error => error.code === 'AUTH' && !error.message.includes('test-key'))
})
