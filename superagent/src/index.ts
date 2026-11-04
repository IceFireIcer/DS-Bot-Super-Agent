import type { Context } from '@deepseek-ai/cordis'
import { Engine } from './engine.js'
import { SqliteStorage, type Storage } from './storage.js'
import type { DesktopSource } from './model.js'

export { Engine } from './engine.js'
export { CoreError } from './model.js'
export type { DesktopSource, Receipt, SubmitRequest, Work } from './model.js'
export type { AsyncTx, Storage } from './storage.js'

export interface Config { databasePath: string; instanceId: string; source: DesktopSource; storage?: Storage }
export const name = 'ds-bot-superagent'

declare module '@deepseek-ai/cordis' { interface Context { superagent: Engine } }

export async function apply(ctx: Context, config: Config) {
  const storage = config.storage ?? await SqliteStorage.open(config.databasePath)
  ctx.effect(() => () => storage.close())
  ctx.provide('superagent', new Engine(storage, config.instanceId, config.source))
}
