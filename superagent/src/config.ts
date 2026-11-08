import { randomUUID } from 'node:crypto'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export interface RoleModel { provider: string; model: string }
export interface RoleProfile { name: string; model: RoleModel; instructions: string; skills: string[] }
export interface RoleConfig { router: RoleProfile; worker: RoleProfile }
export interface StoredRoleConfig { revision: number; roles: RoleConfig; updatedAt: number }
export interface RoleConfigView { revision: number; roles: RoleConfig; updatedAt: number }
export interface RoleConfigUse {
  id: string
  instanceId: string
  sessionId: string
  role: 'router' | 'worker'
  revision: number
  router: RoleModel
  worker: RoleModel
  createdAt: number
}

const configKey = 'role-config'
const historyKey = (revision: number) => `${JSON.stringify(['role-config-history'])}:${String(revision).padStart(10, '0')}`
const usePrefix = (sessionId: string) => `${JSON.stringify(['role-config-use', sessionId])}:`
const allowedPlaceholders = new Set(['goal', 'constraints', 'evidence'])
const reservedSkills = new Set(['superagent-role', 'superagent-skills'])

function validateModel(model: RoleModel, label: string) {
  if (!model || Object.keys(model).some(key => !['provider', 'model'].includes(key))) throw new CoreError('INVALID_CONFIG', `${label} model accepts provider and model only.`)
  identifier(model.provider, `${label} provider`); identifier(model.model, `${label} model`)
}

function validateProfile(profile: RoleProfile, label: string) {
  if (!profile || Object.keys(profile).some(key => !['name', 'model', 'instructions', 'skills'].includes(key))) {
    throw new CoreError('INVALID_CONFIG', `${label} accepts name, model, instructions and skills only.`)
  }
  if (typeof profile.name !== 'string' || !profile.name.trim() || Buffer.byteLength(profile.name) > 128) throw new CoreError('INVALID_CONFIG', `${label} needs a bounded nonempty name.`)
  validateModel(profile.model, label)
  if (typeof profile.instructions !== 'string' || Buffer.byteLength(profile.instructions) > 16384) throw new CoreError('INVALID_CONFIG', `${label} instructions exceed the 16384-byte budget.`)
  for (const match of profile.instructions.matchAll(/\{\{([^}]+)\}\}/gu)) {
    if (!allowedPlaceholders.has(match[1]!)) throw new CoreError('INVALID_CONFIG', `${label} instructions use an unknown placeholder.`)
  }
  if (!Array.isArray(profile.skills) || profile.skills.length > 20 || new Set(profile.skills).size !== profile.skills.length) {
    throw new CoreError('INVALID_CONFIG', `${label} needs at most 20 distinct skills.`)
  }
  for (const skill of profile.skills) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(skill)) throw new CoreError('INVALID_CONFIG', `${label} skill names must be lowercase identifiers.`)
    if (reservedSkills.has(skill)) throw new CoreError('INVALID_CONFIG', `${label} cannot override the reserved ${skill} skill.`)
  }
}

export function validateRoleConfig(roles: RoleConfig) {
  if (!roles || Object.keys(roles).some(key => !['router', 'worker'].includes(key))) throw new CoreError('INVALID_CONFIG', 'Role configuration accepts router and worker only.')
  validateProfile(roles.router, 'Router'); validateProfile(roles.worker, 'Worker')
}

export class RoleConfigStore {
  private current: StoredRoleConfig | undefined
  constructor(
    private readonly storage: Storage,
    private readonly instanceId: string,
    private readonly defaults: RoleConfig,
    private readonly now: () => number = Date.now,
  ) { validateRoleConfig(defaults) }

  async ensure(): Promise<RoleConfigView> {
    const stored = await this.storage.transaction(this.instanceId, transaction => transaction.get<StoredRoleConfig>('role-config', configKey))
    if (stored) { this.current = stored; return this.view(stored) }
    const initial: StoredRoleConfig = { revision: 1, roles: structuredClone(this.defaults), updatedAt: this.now() }
    const committed = await this.storage.transaction(this.instanceId, async transaction => {
      const existing = await transaction.get<StoredRoleConfig>('role-config', configKey)
      if (existing) return existing
      await transaction.insert('role-config', configKey, initial)
      await transaction.insert('role-config-history', historyKey(1), initial)
      return initial
    })
    this.current = committed
    return this.view(committed)
  }

  async currentView(): Promise<RoleConfigView> {
    if (!this.current) return this.ensure()
    return this.view(this.current)
  }

  async write(transaction: AsyncTx, expectedRevision: number, roles: RoleConfig): Promise<RoleConfigView> {
    validateRoleConfig(roles)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new CoreError('INVALID_CONFIG', 'Role configuration needs a positive expected revision.')
    const current = await transaction.get<StoredRoleConfig>('role-config', configKey)
    if (!current) throw new CoreError('INCOMPLETE_STATE', 'The role configuration snapshot is missing.')
    if (current.revision !== expectedRevision) throw new CoreError('CONFIG_REVISION_CONFLICT', 'The role configuration changed after this update was prepared.')
    const next: StoredRoleConfig = { revision: current.revision + 1, roles: structuredClone(roles), updatedAt: this.now() }
    await transaction.replace('role-config', configKey, next)
    await transaction.insert('role-config-history', historyKey(next.revision), next)
    this.current = next
    return this.view(next)
  }

  async recordUse(transaction: AsyncTx, request: { sessionId: string; role: 'router' | 'worker'; revision: number; router: RoleModel; worker: RoleModel }) {
    const use: RoleConfigUse = { id: `${usePrefix(request.sessionId)}${randomUUID()}`, instanceId: this.instanceId, ...request, createdAt: this.now() }
    await transaction.insert('role-config-use', use.id, use)
    return use
  }

  async uses(sessionId: string): Promise<RoleConfigUse[]> {
    identifier(sessionId, 'sessionId')
    return this.storage.transaction(this.instanceId, async transaction => {
      const items: RoleConfigUse[] = []
      let cursor = usePrefix(sessionId)
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await transaction.scan<RoleConfigUse>('role-config-use', { limit: 100, after: cursor })
        items.push(...page.items.map(item => item.value).filter(use => use.sessionId === sessionId))
        if (!page.cursor || !page.cursor.startsWith(usePrefix(sessionId))) return items
        cursor = page.cursor
      }
      throw new CoreError('CONFIG_BUDGET', 'The Session role-config history exceeds its 1000-record budget.')
    })
  }

  private view(stored: StoredRoleConfig): RoleConfigView {
    return { revision: stored.revision, roles: structuredClone(stored.roles), updatedAt: stored.updatedAt }
  }
}
