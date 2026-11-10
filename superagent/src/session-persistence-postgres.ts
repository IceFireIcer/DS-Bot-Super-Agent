import type { Context } from '@deepseek-ai/cordis'
import { CoreError } from './model.js'
import { PostgresStorage, type PostgresOptions } from './postgres-storage.js'
import { mountSessionPersistence } from './session-persistence.js'

export type Config = Omit<PostgresOptions, 'backupDirectory'>
export const name = 'session-persistence-postgres'

export async function apply(ctx: Context, config: Config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new CoreError('INVALID_CONFIG', 'PostgreSQL Session persistence configuration is required.')
  }
  const storage = await PostgresStorage.open(config)
  await mountSessionPersistence(ctx, storage, name)
}
