import type { Context } from '@deepseek-ai/cordis'
import { Engine } from './engine.js'
import { CoreError, identifier } from './model.js'
import { NativeSessions } from './native-sessions.js'
import { SqliteStorage } from './storage.js'
import type { RoleModel } from './config.js'

export interface ProductHostConfig { databasePath: string; instanceId?: string; actorId?: string; main?: RoleModel; router?: RoleModel; worker?: RoleModel; timeoutMs?: number }
export interface ProductHost {
  dispatch(endpoint: string, payload?: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}
declare module '@deepseek-ai/cordis' { interface Context { superagentProduct: ProductHost } }

export async function createProductHost(context: Context, config: ProductHostConfig): Promise<ProductHost> {
  const instanceId = config.instanceId ?? 'personal'
  const actorId = config.actorId ?? 'local-user'
  identifier(instanceId, 'instanceId'); identifier(actorId, 'actorId')
  const route = (configured?: RoleModel): RoleModel => {
    const value = configured ?? context.get('agentDefaultModel')?.currentSelection?.()
    if (!value?.provider || !value.model) return { provider: 'unconfigured', model: 'unconfigured' }
    return { provider: value.provider, model: value.model }
  }
  const sessions = new NativeSessions(context, { main: route(config.main), router: route(config.router), worker: route(config.worker), ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }) })
  const storage = await SqliteStorage.open(config.databasePath)
  const engine = new Engine(storage, instanceId, { sourceInstanceId: 'product-desktop', actorId, allowedActorIds: [actorId] }, {}, sessions)
  let closing: Promise<void> | undefined
  try {
    await engine.acquireHost()
    await engine.openMain({ instanceId })
    return {
      async dispatch(endpoint, payload = {}) {
        if (closing) throw new CoreError('RUNTIME_CLOSED', 'The product Host is closed.')
        // The Host supplies identity; a window can only address this authorization scope.
        if (endpoint === 'open' && Object.keys(payload).length === 0) return engine.openMain({ instanceId })
        if (payload.instanceId !== instanceId) throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This request is outside the authorized Instance.')
        const fields = endpoint === 'send' ? ['instanceId', 'commandId', 'text'] : ['instanceId', 'after', 'limit']
        if (Object.keys(payload).some(key => !fields.includes(key))) throw new CoreError('INVALID_INPUT', 'The product request contains unsupported fields.')
        if (endpoint === 'history') return engine.getMainConversation({ instanceId, ...(payload.after === undefined ? {} : { after: payload.after as number }), ...(payload.limit === undefined ? {} : { limit: payload.limit as number }) })
        if (endpoint === 'send') return engine.sendMainMessage({ instanceId, commandId: payload.commandId as string, text: payload.text as string })
        throw new CoreError('UNAVAILABLE', 'This product capability is not connected yet.')
      },
      close() {
        return closing ??= (async () => {
          try { await engine.shutdown() } finally { try { await sessions.close() } finally { await storage.close() } }
        })()
      },
    }
  } catch (error) {
    await engine.shutdown(); await sessions.close(); await storage.close()
    throw error
  }
}
