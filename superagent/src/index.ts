import type { Context } from '@deepseek-ai/cordis'
import { Engine } from './engine.js'
import { SqliteStorage, type Storage } from './storage.js'
import type { DesktopSource } from './model.js'
import type { EffectsOptions } from './effects.js'
import type { NativeSessions } from './native-sessions.js'

export { Engine } from './engine.js'
export { NativeSessions } from './native-sessions.js'
export type { NativeSessionsOptions, NativeSessionRequest, NativeTool } from './native-sessions.js'
export { createChatServer } from './chat-server.js'
export { Effects } from './effects.js'
export type { Effect, EffectRequest, EffectReceipt, EffectResult, EffectHandler, EffectsOptions } from './effects.js'
export { CoreError } from './model.js'
export type { DesktopSource, Receipt, SubmitRequest, Work } from './model.js'
export type { AsyncTx, Storage } from './storage.js'

export interface Config { databasePath: string; instanceId: string; source: DesktopSource; storage?: Storage; effects?: EffectsOptions; sessions?: NativeSessions }
export const name = 'ds-bot-superagent'

declare module '@deepseek-ai/cordis' { interface Context { superagent: Engine } }

export async function apply(ctx: Context, config: Config) {
  const storage = config.storage ?? await SqliteStorage.open(config.databasePath)
  let engine: Engine | undefined
  ctx.effect(() => async () => { try { await engine?.effects.stop() } finally { await storage.close() } })
  engine = new Engine(storage, config.instanceId, config.source, config.effects, config.sessions)
  ctx.provide('superagent', engine)
  if (config.effects?.handlers || config.sessions) engine.effects.start()
}
