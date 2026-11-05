import type { Context } from '@deepseek-ai/cordis'
import { Engine } from './engine.js'
import { SqliteStorage, type Storage } from './storage.js'
import type { DesktopSource } from './model.js'
import type { EffectsOptions } from './effects.js'

export { Engine } from './engine.js'
export { Effects } from './effects.js'
export type { Effect, EffectRequest, EffectReceipt, EffectResult, EffectHandler, EffectsOptions } from './effects.js'
export { CoreError } from './model.js'
export type { DesktopSource, Receipt, SubmitRequest, Work } from './model.js'
export type { AsyncTx, Storage } from './storage.js'

export interface Config { databasePath: string; instanceId: string; source: DesktopSource; storage?: Storage; effects?: EffectsOptions }
export const name = 'ds-bot-superagent'

declare module '@deepseek-ai/cordis' { interface Context { superagent: Engine } }

export async function apply(ctx: Context, config: Config) {
  const storage = config.storage ?? await SqliteStorage.open(config.databasePath)
  ctx.effect(() => () => storage.close())
  const engine = new Engine(storage, config.instanceId, config.source, config.effects)
  ctx.effect(() => () => engine.effects.stop())
  ctx.provide('superagent', engine)
  if (config.effects?.handlers) engine.effects.start()
}
