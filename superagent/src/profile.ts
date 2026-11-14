import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createProductHost, type ProductHostConfig } from './product-host.js'
import { CoreError } from './model.js'

export interface SuperagentProfilePaths {
  root: string
  databasePath: string
}

export type SuperagentProfileConfig = Omit<ProductHostConfig, 'databasePath'>

/**
 * The profile home is the app's isolated DSH home for this profile. Keeping the
 * business store below it leaves the old ds-bot team and DSH session data apart.
 */
export function profilePaths(env: NodeJS.ProcessEnv = process.env): SuperagentProfilePaths {
  const home = env.DSH_HOME
  if (typeof home !== 'string' || home.trim() === '') {
    throw new CoreError('INVALID_CONFIG', 'The ds-superagent profile needs DSH_HOME.')
  }
  const root = join(home, 'core')
  return { root, databasePath: join(root, 'state.sqlite') }
}

export const name = 'ds-superagent-profile'
export const inject = ['sessionPersistence', 'agents', 'sessions']

export async function apply(context: Context, config: SuperagentProfileConfig = {}) {
  const paths = profilePaths()
  mkdirSync(paths.root, { recursive: true })
  const host = await createProductHost(context, {
    ...config,
    databasePath: paths.databasePath,
  })
  context.provide('superagentProduct', host)
  context.effect(() => () => host.close())
}
