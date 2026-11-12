import type { Context } from '@deepseek-ai/cordis'
import { DsBotExecutionAdapter, type DsBotEngineFactory, type DsBotEngineFactoryResult } from './ds-bot-adapter.js'
import { Engine } from './engine.js'
import { CoreError } from './model.js'
import { NativeSessions } from './native-sessions.js'
import { SqliteStorage } from './storage.js'
import type { DeliveryOptions } from './deliveries.js'
import type { EffectsOptions } from './effects.js'
import type { RoleModel } from './config.js'

export interface DsBotHostConfig {
  databasePath: string
  sourceInstanceId?: string
  actorId?: string
  allowedActorIds?: string[]
  instanceIdPrefix?: string
  hostId?: string
  leaseMs?: number
  timeoutMs?: number
  router?: RoleModel
  worker?: RoleModel
  effects?: EffectsOptions
  delivery?: DeliveryOptions
}

function routeOf(context: Context, configured: DsBotHostConfig['router']) {
  if (configured) {
    if (!configured.provider || !configured.model) throw new CoreError('INVALID_CONFIG', 'The Router route needs a provider and model.')
    return { provider: configured.provider, model: configured.model }
  }
  const selection = context.get?.('agentDefaultModel')?.currentSelection?.()
  if (!selection?.provider || !selection.model) {
    throw new CoreError('INVALID_CONFIG', 'The production factory needs a profile default model or explicit Router/Worker routes.')
  }
  return { provider: selection.provider, model: selection.model }
}

/**
 * Build the production adapter used by the existing ds-bot Host. Each UI Session gets
 * one Engine over the shared business store; the Host's public Session provider owns
 * the native Agent logs. The adapter is closed by the ds-bot plugin effect.
 */
export async function createDsBotHostAdapter(context: Context, config: DsBotHostConfig) {
  if (!config || typeof config.databasePath !== 'string' || config.databasePath.trim() === '') {
    throw new CoreError('INVALID_CONFIG', 'The production factory needs an absolute database path.')
  }
  const router = routeOf(context, config.router)
  const worker = routeOf(context, config.worker)
  const actorId = config.actorId ?? 'local-user'
  const source = {
    kind: 'desktop' as const,
    sourceInstanceId: config.sourceInstanceId ?? 'ds-bot-host',
    actorId,
    allowedActorIds: [...(config.allowedActorIds ?? [actorId])],
    versionOrder: 'sequence' as const,
  }
  if (!source.allowedActorIds.includes(actorId)) throw new CoreError('INVALID_CONFIG', 'The configured actor must be allowed by the source.')
  const storage = await SqliteStorage.open(config.databasePath)
  const factory: DsBotEngineFactory = async ({ sessionId }): Promise<DsBotEngineFactoryResult> => {
    const sessions = new NativeSessions(context, { router, worker, ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }) })
    let engine: Engine | undefined
    try {
      engine = new Engine(storage, `${config.instanceIdPrefix ?? 'ds-bot-ui'}:${sessionId}`, {
        ...source, allowedThreadIds: [sessionId],
      }, config.effects ?? {}, sessions, [], {}, {}, {}, config.delivery ?? {}, {
        hostId: config.hostId ?? 'ds-bot-host',
        ...(config.leaseMs === undefined ? {} : { leaseMs: config.leaseMs }),
      })
      await engine.acquireHost()
      engine.effects.start()
      return {
        engine, sessions, actorId,
        dispose: async () => {
          const errors: unknown[] = []
          try { await engine?.effects.stop() } catch (error) { errors.push(error) }
          try { await engine?.shutdown() } catch (error) { errors.push(error) }
          try { await sessions.close() } catch (error) { errors.push(error) }
          if (errors.length) throw new AggregateError(errors, 'The production factory did not close cleanly.')
        },
      }
    } catch (error) {
      await Promise.allSettled([engine?.shutdown(), sessions.close()])
      throw error
    }
  }
  const adapter = new DsBotExecutionAdapter({ factory, dispose: () => storage.close() })
  return adapter
}

export const name = 'ds-bot-host'
export const inject = ['sessionPersistence', 'agents', 'sessions']

/** Publish one adapter and close it with the owning Host effect. */
export function mountBotExecutionAdapter(context: Context, adapter: DsBotExecutionAdapter) {
  context.provide('botExecutionAdapter', adapter)
  context.effect(() => () => adapter.close())
}

export async function apply(context: Context, config: DsBotHostConfig) {
  const adapter = await createDsBotHostAdapter(context, config)
  mountBotExecutionAdapter(context, adapter)
}
