// A real hosted Super-agent Host for the T58 composition rehearsal. It uses PostgreSQL for
// both the business store and native Session logs, a real model route, a loopback client
// gateway, a local Environment and one paired remote device. The Watchdog starts and replaces
// this process; it is not a replacement desktop surface.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  Engine, LocalEnvironment, NativeSessions, RemoteEnvironment, createClientGateway,
} from '../dist/index.js'
import { PostgresStorage } from '../dist/postgres-storage.js'
import * as PostgresSessionPersistence from '../dist/session-persistence-postgres.js'
import { createModelBudget, createRealModelRuntime } from './real-model-adapter.mjs'

const args = process.argv.slice(2)
const argument = name => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const required = name => {
  const value = argument(name)
  if (!value) throw new Error(`Use --${name}.`)
  return value
}
const statusPath = required('status')
const tokenPath = required('token-out')
const clientIdPath = required('client-id-out')
const workspace = required('workspace')
const pairingCodePath = argument('pairing-code-file')
const instanceId = argument('instance') ?? 't58'
const hostId = argument('host-id') ?? 't58-host'
const gatewayPort = Number(argument('gateway-port') ?? '18761')
const leaseMs = Number(argument('lease-ms') ?? '5000')
const deviceEndpoint = argument('device-endpoint')
const expectedDeviceId = argument('device-id')
const expectedDeviceKey = argument('device-key')
const modelFile = argument('model-key-file')
const modelUrl = process.env.SUPERAGENT_MODEL_URL ?? 'https://pro.pokexiao.com'
const modelId = process.env.SUPERAGENT_MODEL ?? 'deepseek-v4.1-flash-1017'
const modelKey = modelFile ? (await readFile(modelFile, 'utf8')).trim() : (process.env.SUPERAGENT_MODEL_KEY ?? process.env.POKEXIAO_API_KEY)
if (!modelKey) throw new Error('A model key is required through --model-key-file or POKEXIAO_API_KEY.')
if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error('The gateway port is invalid.')
if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000) throw new Error('The Host lease is invalid.')

const pg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'ds58',
  password: process.env.PGPASSWORD ?? '',
  database: process.env.PGDATABASE ?? 'ds58',
  ssl: false,
}
if (!pg.password) throw new Error('PGPASSWORD is required.')

const writeStatus = async status => {
  const value = { pid: process.pid, at: Date.now(), instanceId, hostId, gatewayPort,
    sources: [], setups: [], normalWaits: 0, ...status }
  await writeFile(`${statusPath}.tmp`, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  await rename(`${statusPath}.tmp`, statusPath)
}

let context, businessStorage, sessions, engine, gateway, localEnvironment, remoteEnvironment
let resourcesClosed
const closeResources = async () => {
  resourcesClosed ??= (async () => {
    await Promise.resolve(gateway?.close()).catch(() => {})
    await Promise.resolve(engine?.effects.stop()).catch(() => {})
    await Promise.resolve(engine?.shutdown()).catch(() => {})
    await Promise.resolve(sessions?.close()).catch(() => {})
    await Promise.resolve(remoteEnvironment?.close?.()).catch(() => {})
    await Promise.resolve(localEnvironment?.close?.()).catch(() => {})
    await Promise.resolve(context?.fiber.dispose()).catch(() => {})
    await Promise.resolve(businessStorage?.close()).catch(() => {})
  })()
  return resourcesClosed
}
try {
  businessStorage = await PostgresStorage.open(pg)
  context = new Context()
  await context.plugin(SessionStore)
  await context.plugin(SessionProjectionRegistry)
  await context.plugin(AgentRegistry)
  await context.plugin(SystemPrompt, {})
  await context.plugin(ToolRuntime, { mode: 'native' })
  await context.plugin(LlmRuntime)
  await context.plugin(PostgresSessionPersistence, pg)
  await context.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

  const runtime = createRealModelRuntime({
    provider: process.env.SUPERAGENT_MODEL_PROVIDER ?? 'pokexiao',
    endpoint: modelUrl, apiKey: modelKey, model: modelId,
    budget: createModelBudget({ maxRequests: Number(process.env.SUPERAGENT_MODEL_MAX_REQUESTS ?? 200),
      maxTokens: Number(process.env.SUPERAGENT_MODEL_MAX_TOKENS ?? 500000) }),
  })
  context.llm.registerAdapter([runtime.provider], runtime.adapter)
  sessions = new NativeSessions(context, { router: { provider: runtime.provider, model: modelId },
    worker: { provider: runtime.provider, model: modelId }, timeoutMs: 55000 })

  localEnvironment = await LocalEnvironment.open({
    id: 't58-local', instanceId, root: workspace, allowedActorIds: ['desktop-user'],
    permissions: ['read', 'write', 'search', 'command'],
    commands: { echo: { argv: ['/bin/echo', 't58-local-ok'], timeoutMs: 5000 } },
  })

  if (deviceEndpoint !== undefined) {
    if (!pairingCodePath || !expectedDeviceId || !expectedDeviceKey) {
      throw new Error('A paired device needs --pairing-code-file, --device-id and --device-key.')
    }
    const pairingCode = (await readFile(pairingCodePath, 'utf8')).trim()
    remoteEnvironment = await RemoteEnvironment.pair({
      id: 't58-ubuntu-device', instanceId, allowedActorIds: ['desktop-user'],
      permissions: ['read', 'write', 'search', 'command'], endpoint: deviceEndpoint,
      pairingCode, expectedDeviceId, expectedDeviceKey, timeoutMs: 15000,
    })
  }

  engine = new Engine(businessStorage, instanceId, {
    sourceInstanceId: 'desktop', actorId: 'desktop-user', allowedActorIds: ['desktop-user'],
  }, { operationTimeoutMs: 60000 }, sessions, [localEnvironment, ...(remoteEnvironment ? [remoteEnvironment] : [])], {}, {}, {}, {},
  { hostId, leaseMs })
  let lease
  const acquireDeadline = Date.now() + 60000
  while (lease === undefined) {
    try { lease = await engine.acquireHost() }
    catch (error) {
      if (error?.code === 'HOST_LEASED' && Date.now() < acquireDeadline) {
        await sleep(250)
        continue
      }
      throw error
    }
  }
  engine.effects.start()

  const access = engine.createClientAccess()
  const enrollment = await access.enroll({
    commandId: `t58-enroll-${randomUUID()}`,
    label: 'T58 Windows desktop client',
    grants: [{ instanceId, capabilities: ['read', 'command'] }],
  })
  if (!enrollment.token) throw new Error('The client enrollment did not issue a credential.')
  await writeFile(tokenPath, `${enrollment.token}\n`, { mode: 0o600 })
  await writeFile(clientIdPath, `${enrollment.client.id}\n`, { mode: 0o600 })
  gateway = await createClientGateway(engine, access, { host: '127.0.0.1', port: gatewayPort })

  const statusBase = { clientId: enrollment.client.id,
    ...(remoteEnvironment ? { deviceId: remoteEnvironment.deviceId, deviceKeyFingerprint: remoteEnvironment.deviceKeyFingerprint } : {}),
    gatewayUrl: gateway.url, model: { provider: runtime.provider, id: modelId, endpoint: new URL(modelUrl).host },
    postgres: { host: pg.host, port: pg.port, database: pg.database }, ...(deviceEndpoint ? { deviceEndpoint } : {}) }
  await writeStatus({ service: 'healthy', epoch: lease.epoch, ...statusBase })
  const timer = setInterval(() => { writeStatus({ service: 'healthy', epoch: lease.epoch, ...statusBase }).catch(() => {}) }, 2000)
  timer.unref()
  console.log(JSON.stringify({ ready: true, pid: process.pid, instanceId, epoch: lease.epoch, gatewayUrl: gateway.url,
    clientId: enrollment.client.id, ...(remoteEnvironment ? { deviceId: remoteEnvironment.deviceId } : {}) }))

  const stop = async () => {
    await writeStatus({ service: 'stopping', epoch: lease.epoch }).catch(() => {})
    clearInterval(timer)
    await closeResources()
  }
  process.on('message', message => { if (message?.type === 'shutdown') void stop().finally(() => process.exit(0)) })
  process.once('SIGINT', () => { void stop().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void stop().finally(() => process.exit(0)) })
  await new Promise(() => {})
} catch (error) {
  await writeStatus({ service: 'failed', detail: error instanceof Error ? error.message : String(error) }).catch(() => {})
  console.error(error)
  await closeResources()
  process.exitCode = 1
}
