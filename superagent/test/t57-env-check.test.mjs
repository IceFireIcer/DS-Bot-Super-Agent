import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkFeishu, checkGitHub, checkModelRoute, mask, readEnvironment, runEnvironmentCheck } from '../dev/t57-env-check.mjs'

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

test('environment names are read without exposing the credential', () => {
  const config = readEnvironment({ POKEXIAO_API_KEY: 'sk-test', SUPERAGENT_MODEL: 'm', FEISHU_CHAT_IDS: ' c1, c2 ' })
  assert.equal(config.model.key, 'sk-test')
  assert.equal(config.model.id, 'm')
  assert.equal(config.model.provider, 'pokexiao')
  assert.deepEqual(config.feishu.chatIds, ['c1', 'c2'])
  assert.equal(mask('sk-test'), 'sk…st')
  assert.equal(mask('0123456789abcdef'), '0123…cdef')
})

test('the model check reports a real route without echoing the key', async () => {
  let authorization
  const result = await checkModelRoute({ url: 'https://model.example', id: 'deepseek', key: 'secret', maxTokens: 8 }, {
    now: () => 100,
    fetchImpl: async (url, init) => {
      authorization = init.headers.Authorization
      assert.equal(url, 'https://model.example/v1/chat/completions')
      return response({ model: 'deepseek', choices: [{ message: { content: '' } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })
    },
  })
  assert.equal(authorization, 'Bearer secret')
  assert.equal(result.status, 'passed')
  assert.equal(result.provider, 'pokexiao')
  assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 })
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('missing or failed checks are explicit instead of fabricated', async () => {
  assert.deepEqual(await checkModelRoute({ url: 'https://model.example', id: 'm', key: '' }), { status: 'unverified', reason: 'Set SUPERAGENT_MODEL_KEY or POKEXIAO_API_KEY.' })
  const failed = await checkModelRoute({ url: 'https://model.example', id: 'm', key: 'k', maxTokens: 8 }, {
    fetchImpl: async () => response({ error: 'no' }, 401),
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.httpStatus, 401)
})

test('GitHub checks prove repository write permission and actor identity', async () => {
  const calls = []
  const result = await checkGitHub({ repo: 'IceFireIcer/SuperAgentTest', token: 'gh-test' }, {
    now: () => 200,
    run: async (args, token) => {
      calls.push({ args, token })
      return args[1] === 'user' ? { login: 'IceFireIcer' }
        : { full_name: 'IceFireIcer/SuperAgentTest', private: false, default_branch: 'main', permissions: { push: true, admin: false } }
    },
  })
  assert.deepEqual(calls.map(call => call.args), [['api', 'repos/IceFireIcer/SuperAgentTest'], ['api', 'user']])
  assert.equal(result.status, 'passed')
  assert.equal(result.actor, 'IceFireIcer')
  assert.equal(result.permissions.push, true)
  assert.equal(result.credentialSource, 'environment-token')
  assert.equal(JSON.stringify(result).includes('gh-test'), false)
})

test('Feishu checks stay unverified without all four settings and verify tenant and chat when present', async () => {
  const missing = await checkFeishu({ appId: 'cli', appSecret: '', tenantKey: 'tenant', chatIds: ['chat'] })
  assert.equal(missing.status, 'unverified')
  assert.match(missing.reason, /FEISHU_APP_SECRET/u)
  const result = await checkFeishu({ appId: 'cli', appSecret: 'secret', tenantKey: 'tenant-123456', chatIds: ['oc_123456789'] }, {
    now: () => 300,
    fetchImpl: async url => {
      const path = new URL(url).pathname
      if (path.endsWith('/auth/v3/tenant_access_token/internal')) return response({ code: 0, tenant_access_token: 'token', expire: 7200 })
      if (path.endsWith('/tenant/v2/tenant/query')) return response({ code: 0, data: { tenant: { tenant_key: 'tenant-123456' } } })
      if (path.includes('/im/v1/chats/')) return response({ code: 0, data: { chat_id: 'oc_123456789', chat_mode: 'group' } })
      if (path.includes('/im/v1/messages')) return response({ code: 0, data: { items: [], has_more: false } })
      return response({ code: 404 }, 404)
    },
  })
  assert.equal(result.status, 'passed')
  assert.equal(result.tenant, 'tena…3456')
  assert.deepEqual(result.chats, [{ chatId: 'oc_1…6789' }])
  assert.equal(result.historyEvents, 0)
  assert.equal(result.replyProbe, 'acceptance-required')
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('the aggregate check distinguishes failed and unverified environment states', async () => {
  const failed = await runEnvironmentCheck({
    model: { url: 'https://model.example', id: 'm', key: 'k', maxTokens: 8 },
    github: { repo: 'IceFireIcer/SuperAgentTest' },
    feishu: { appId: '', appSecret: '', tenantKey: '', chatIds: [] },
  }, {
    fetchImpl: async () => response({ choices: [{ message: { content: 'OK' } }] }),
    run: async args => args[1] === 'user' ? { login: 'actor' } : { full_name: 'IceFireIcer/SuperAgentTest', default_branch: 'main', permissions: { push: true } },
  })
  assert.equal(failed.checks.model.status, 'passed')
  assert.equal(failed.checks.github.status, 'passed')
  assert.equal(failed.checks.feishu.status, 'unverified')
  assert.equal(failed.status, 'unverified')
})
