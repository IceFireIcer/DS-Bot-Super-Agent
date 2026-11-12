import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import * as core from '../dist/index.js'
import { chatCompletionsEndpoint } from './real-model-adapter.mjs'

const exec = promisify(execFile)
const defaultModelUrl = 'https://pro.pokexiao.com'
const defaultModel = 'deepseek-v4.1-flash-1017'
const defaultRepo = 'IceFireIcer/SuperAgentTest'

export function readEnvironment(env = process.env) {
  const chatIds = (env.FEISHU_CHAT_IDS ?? env.FEISHU_CHAT_ID ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return {
    model: {
      url: env.SUPERAGENT_MODEL_URL ?? defaultModelUrl,
      id: env.SUPERAGENT_MODEL ?? defaultModel,
      provider: env.SUPERAGENT_MODEL_PROVIDER ?? 'pokexiao',
      key: env.SUPERAGENT_MODEL_KEY ?? env.POKEXIAO_API_KEY,
      maxTokens: Number(env.SUPERAGENT_ENV_CHECK_TOKENS ?? 16),
    },
    github: {
      repo: env.SUPERAGENT_GITHUB_REPO ?? defaultRepo,
      token: env.SUPERAGENT_GITHUB_TOKEN ?? env.GH_TOKEN,
    },
    feishu: {
      appId: env.FEISHU_APP_ID,
      appSecret: env.FEISHU_APP_SECRET,
      tenantKey: env.FEISHU_TENANT_KEY,
      chatIds,
      baseUrl: env.FEISHU_BASE_URL,
    },
  }
}

export async function checkModelRoute(config, { fetchImpl = fetch, timeoutMs = 30_000, now = Date.now } = {}) {
  if (!config.key) return { status: 'unverified', reason: 'Set SUPERAGENT_MODEL_KEY or POKEXIAO_API_KEY.' }
  if (!Number.isSafeInteger(config.maxTokens) || config.maxTokens < 1 || config.maxTokens > 256) {
    return { status: 'failed', reason: 'SUPERAGENT_ENV_CHECK_TOKENS must be 1-256.' }
  }
  let endpoint
  try { endpoint = chatCompletionsEndpoint(config.url) }
  catch (error) { return { status: 'failed', reason: error.message } }
  const started = now()
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.id, max_tokens: config.maxTokens, temperature: 0,
          messages: [{ role: 'user', content: 'Reply with OK.' }] }) })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) return { status: 'failed', reason: `The model endpoint returned HTTP ${response.status}.`, httpStatus: response.status }
      if (!Array.isArray(body?.choices) || !body.choices.length) return { status: 'failed', reason: 'The model endpoint returned no choice.' }
      return { status: 'passed', provider: config.provider ?? 'pokexiao', endpoint: new URL(endpoint).host, model: body.model ?? config.id,
        latencyMs: now() - started, usage: safeUsage(body.usage) }
    } catch (error) {
      if (attempt === 1) continue
      return { status: 'failed', reason: error?.name === 'TimeoutError' ? 'The model endpoint timed out.' : 'The model request failed.',
        code: error?.name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'MODEL_TRANSPORT', ...(error?.cause?.code ? { cause: error.cause.code } : {}) }
    }
  }
}

export async function checkGitHub(config, { run = ghJson, now = Date.now } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(config.repo)) return { status: 'failed', reason: 'SUPERAGENT_GITHUB_REPO must be owner/repository.' }
  const started = now()
  try {
    const repo = await run(['api', `repos/${config.repo}`], config.token)
    const actor = await run(['api', 'user'], config.token)
    const permissions = repo?.permissions ?? {}
    const canWrite = permissions.push === true || permissions.maintain === true || permissions.admin === true
    if (!canWrite) return { status: 'failed', reason: 'The authenticated GitHub actor cannot write to the test repository.' }
    return { status: 'passed', repo: repo.full_name, private: repo.private === true, defaultBranch: repo.default_branch,
      actor: actor.login, permissions: { push: permissions.push === true, maintain: permissions.maintain === true, admin: permissions.admin === true },
      credentialSource: config.token ? 'environment-token' : 'gh-cli-keyring', latencyMs: now() - started }
  } catch (error) {
    return { status: 'failed', reason: 'The GitHub repository or token check failed.', code: 'GITHUB_CHECK_FAILED',
      detail: error?.code === 'ENOENT' ? 'The gh CLI is not installed or not on PATH.' : undefined }
  }
}

export async function checkFeishu(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const missing = [
    ['FEISHU_APP_ID', config.appId], ['FEISHU_APP_SECRET', config.appSecret],
    ['FEISHU_TENANT_KEY', config.tenantKey], ['FEISHU_CHAT_IDS', config.chatIds?.length],
  ].filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) return { status: 'unverified', reason: `Missing ${missing.join(', ')}.` }
  const started = now()
  try {
    const transport = new core.FeishuOpenApi({ appId: config.appId, appSecret: config.appSecret,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), fetch: fetchImpl })
    const signal = AbortSignal.timeout(30_000)
    await transport.setup({ tenantKey: config.tenantKey, chatIds: config.chatIds, signal })
    const page = await transport.listEvents({ tenantKey: config.tenantKey, chatIds: config.chatIds, signal })
    return { status: 'passed', tenant: mask(config.tenantKey), chats: config.chatIds.map(chatId => ({ chatId: mask(chatId) })),
      historyEvents: page.events.length, replyProbe: 'acceptance-required', latencyMs: now() - started }
  } catch (error) {
    return { status: 'failed', reason: 'The Feishu tenant or chat check failed.', code: error?.code ?? 'FEISHU_CHECK_FAILED' }
  }
}

export async function runEnvironmentCheck(config = readEnvironment(), dependencies = {}) {
  const [model, github, feishu] = await Promise.all([
    checkModelRoute(config.model, dependencies),
    checkGitHub(config.github, dependencies),
    checkFeishu(config.feishu, dependencies),
  ])
  const checks = { model, github, feishu }
  return { version: 1, checkedAt: new Date().toISOString(), checks,
    status: Object.values(checks).some(check => check.status === 'failed') ? 'failed'
      : Object.values(checks).some(check => check.status === 'unverified') ? 'unverified' : 'passed' }
}

export function mask(value) {
  if (typeof value !== 'string' || !value) return ''
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function safeUsage(value) {
  if (!value || typeof value !== 'object') return undefined
  const result = {}
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key]
  }
  return result
}

async function ghJson(args, token) {
  const env = {}
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'GH_CONFIG_DIR', 'GH_HOST', 'NO_COLOR', 'TERM']) {
    if (process.env[name] !== undefined) env[name] = process.env[name]
  }
  if (token) env.GH_TOKEN = token
  const { stdout } = await exec('gh', args, { env, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  return JSON.parse(stdout)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runEnvironmentCheck()
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'unverified' ? 2 : 1
}
