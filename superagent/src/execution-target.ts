import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import type { EnvironmentLocation, EnvironmentProbe, ExecutionEnvironment } from './environment.js'
import type { LocalPermission } from './local-environment.js'
import { capabilityLocations, type CapabilityId, type CapabilityResolutionView, type HostCapabilities } from './capability-locations.js'

export type ExecutionTarget = 'local-only' | 'remote-only' | 'auto'
export type ExecutionDefaultTarget = 'local' | 'remote-only' | 'auto'

export interface ExecutionPolicyConfig {
  defaultTarget: ExecutionDefaultTarget
  preferredEnvironmentId?: string
  requiredPermissions: LocalPermission[]
}

export interface ExecutionPolicyView extends ExecutionPolicyConfig {
  revision: number
  updatedAt: number
}

interface StoredExecutionPolicy extends ExecutionPolicyView { version: 1 }

export interface ExecutionCandidateView {
  id: string
  kind: 'local' | 'remote'
  eligible: boolean
  reasons: string[]
  online: boolean
  root: string
  permissions: LocalPermission[]
  version?: string
  fingerprint?: string
  capacity: EnvironmentProbe['capacity']
  productCapabilities?: Partial<Record<CapabilityId, boolean>>
  deviceId?: string
  deviceIncarnation?: string
}

export interface ExecutionSelectionView {
  version: 1
  ticketId: string
  source: 'default' | 'ticket' | 'explicit'
  target: ExecutionTarget
  policyRevision: number
  status: 'selected' | 'waiting'
  answerOnly?: boolean
  selected?: EnvironmentLocation
  requiredCapabilities?: CapabilityId[]
  capabilities?: CapabilityResolutionView[]
  hostId: string
  reason?: string
  candidates: ExecutionCandidateView[]
  decidedAt: number
}

const policyKey = JSON.stringify(['execution-policy'])
const historyPrefix = JSON.stringify(['execution-policy-history'])
const selectionPrefix = JSON.stringify(['execution-selection'])
const permissions = new Set<LocalPermission>(['read', 'write', 'search', 'command'])
const defaultPolicy: ExecutionPolicyConfig = { defaultTarget: 'local', requiredPermissions: ['read'] }

export function validateExecutionPolicy(value: ExecutionPolicyConfig) {
  if (!value || Object.keys(value).some(key => !['defaultTarget', 'preferredEnvironmentId', 'requiredPermissions'].includes(key))) {
    throw new CoreError('INVALID_CONFIG', 'Execution policy accepts defaultTarget, preferredEnvironmentId and requiredPermissions only.')
  }
  if (!['local', 'remote-only', 'auto'].includes(value.defaultTarget)) {
    throw new CoreError('INVALID_CONFIG', 'The default execution target is local, remote-only or auto.')
  }
  if (value.preferredEnvironmentId !== undefined) identifier(value.preferredEnvironmentId, 'preferredEnvironmentId')
  if (!Array.isArray(value.requiredPermissions) || !value.requiredPermissions.length
    || new Set(value.requiredPermissions).size !== value.requiredPermissions.length
    || value.requiredPermissions.some(permission => !permissions.has(permission))) {
    throw new CoreError('INVALID_CONFIG', 'Auto selection needs at least one distinct supported permission.')
  }
  return { defaultTarget: value.defaultTarget, requiredPermissions: [...value.requiredPermissions],
    ...(value.preferredEnvironmentId ? { preferredEnvironmentId: value.preferredEnvironmentId } : {}) }
}

export class ExecutionPolicyStore {
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly now: () => number = Date.now) {}

  async get(): Promise<ExecutionPolicyView> {
    const stored = await this.storage.transaction(this.instanceId, transaction => transaction.get<StoredExecutionPolicy>('execution-policy', policyKey))
    return stored ? this.view(stored) : { ...defaultPolicy, requiredPermissions: [...defaultPolicy.requiredPermissions], revision: 0, updatedAt: 0 }
  }

  async currentIn(transaction: AsyncTx): Promise<ExecutionPolicyView> {
    const stored = await transaction.get<StoredExecutionPolicy>('execution-policy', policyKey)
    return stored ? this.view(stored)
      : { ...defaultPolicy, requiredPermissions: [...defaultPolicy.requiredPermissions], revision: 0, updatedAt: 0 }
  }

  async write(transaction: AsyncTx, expectedRevision: number, config: Partial<ExecutionPolicyConfig>): Promise<ExecutionPolicyView> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new CoreError('INVALID_CONFIG', 'Execution policy expectedRevision must be a nonnegative integer.')
    const stored = await transaction.get<StoredExecutionPolicy>('execution-policy', policyKey)
    const current = stored?.revision ?? 0
    if (current !== expectedRevision) throw new CoreError('POLICY_REVISION_CONFLICT', 'The execution policy changed after this update was prepared.')
    const validated = validateExecutionPolicy({ ...defaultPolicy,
      ...(stored ? { defaultTarget: stored.defaultTarget,
        ...(stored.preferredEnvironmentId ? { preferredEnvironmentId: stored.preferredEnvironmentId } : {}),
        requiredPermissions: stored.requiredPermissions } : {}), ...config })
    const next: StoredExecutionPolicy = { version: 1, revision: current + 1, ...validated, updatedAt: this.now() }
    if (!await transaction.replace('execution-policy', policyKey, next)) await transaction.insert('execution-policy', policyKey, next)
    await transaction.insert('execution-policy-history', `${historyPrefix}:${String(next.revision).padStart(10, '0')}`, next)
    return this.view(next)
  }

  private view(stored: StoredExecutionPolicy): ExecutionPolicyView {
    return { revision: stored.revision, defaultTarget: stored.defaultTarget,
      ...(stored.preferredEnvironmentId ? { preferredEnvironmentId: stored.preferredEnvironmentId } : {}),
      requiredPermissions: [...stored.requiredPermissions], updatedAt: stored.updatedAt }
  }
}

export async function saveExecutionSelection(transaction: AsyncTx, selection: ExecutionSelectionView) {
  const key = `${selectionPrefix}:${selection.ticketId}`
  if (!await transaction.replace('execution-selection', key, selection)) await transaction.insert('execution-selection', key, selection)
  return selection
}

export async function loadExecutionSelection(transaction: AsyncTx, ticketId: string) {
  return transaction.get<ExecutionSelectionView>('execution-selection', `${selectionPrefix}:${ticketId}`)
}

export async function selectExecutionTarget(options: {
  ticketId: string
  instanceId: string
  actorId: string
  hostId: string
  environments: readonly ExecutionEnvironment[]
  policy: ExecutionPolicyView
  ticketTarget?: ExecutionTarget
  explicitEnvironmentId?: string
  requiredCapabilities?: CapabilityId[]
  hostCapabilities?: HostCapabilities
  source?: 'default' | 'ticket' | 'explicit'
  signal?: AbortSignal
  now?: () => number
}): Promise<ExecutionSelectionView> {
  const explicit = options.explicitEnvironmentId
    ? options.environments.find(environment => environment.config.id === options.explicitEnvironmentId)
    : undefined
  if (options.explicitEnvironmentId && (!explicit || explicit.config.instanceId !== options.instanceId
    || !explicit.config.allowedActorIds.includes(options.actorId))) {
    throw new CoreError('ENVIRONMENT_DENIED', 'The requested Environment is not configured for this Instance and actor.')
  }
  if (explicit && options.ticketTarget && !targetMatches(explicit.kind, options.ticketTarget)) {
    throw new CoreError('ENVIRONMENT_DENIED', 'The requested Environment does not match the Ticket execution target.')
  }
  const target: ExecutionTarget = options.ticketTarget
    ?? (explicit ? explicit.kind === 'remote' ? 'remote-only' : 'local-only'
      : options.policy.defaultTarget === 'local' ? 'local-only' : options.policy.defaultTarget)
  const source = options.source ?? (options.explicitEnvironmentId ? 'explicit' : options.ticketTarget ? 'ticket' : 'default')
  const candidates: ExecutionCandidateView[] = []
  const required = options.requiredCapabilities ?? []
  const catalog = capabilityLocations(options.hostCapabilities ?? {})

  for (const environment of options.environments) {
    if (environment.config.instanceId !== options.instanceId) continue
    if (options.explicitEnvironmentId && environment.config.id !== options.explicitEnvironmentId) continue
    const reasons: string[] = []
    const authorized = environment.config.allowedActorIds.includes(options.actorId)
    if (!authorized) reasons.push('actor is not authorized for this Environment')
    if (!targetMatches(environment.kind, target)) reasons.push(`target ${target} excludes ${environment.kind} Environments`)
    let probe: EnvironmentProbe
    if (reasons.length) {
      probe = { online: false, root: environment.config.root, version: 'not-probed', fingerprint: 'not-probed',
        capabilities: [], capacity: 'unknown', reason: 'not probed because static eligibility failed' }
    } else if (!environment.probe) {
      probe = { online: false, root: environment.config.root, version: 'not-probed', fingerprint: 'not-probed',
        capabilities: [], capacity: 'unknown', reason: 'Environment has no probe contract' }
    } else {
      try {
        const timeout = AbortSignal.timeout(5000)
        probe = await environment.probe({ instanceId: options.instanceId, actorId: options.actorId },
          options.signal ? AbortSignal.any([options.signal, timeout]) : timeout)
      } catch (error) {
        probe = { online: false, root: environment.config.root, version: 'unknown', fingerprint: 'unknown',
          capabilities: [], capacity: 'unknown', reason: bounded(error instanceof CoreError ? error.message : 'Environment inspection failed.') }
      }
    }
    if (!probe.online) reasons.push(`Environment is offline${probe.reason ? `: ${probe.reason}` : ''}`)
    if (probe.root !== environment.config.root) reasons.push('probe directory does not match the configured Environment root')
    if (!probe.version || probe.version === 'unknown' || probe.version === 'not-probed') reasons.push('Environment version is unverified')
    if (!probe.fingerprint || probe.fingerprint === 'unknown' || probe.fingerprint === 'not-probed') reasons.push('Environment fingerprint is unverified')
    for (const permission of options.policy.requiredPermissions) {
      if (!probe.capabilities.includes(permission)) reasons.push(`missing capability: ${permission}`)
    }
    for (const id of required) {
      const location = catalog.find(candidate => candidate.id === id)!
      if (location.location === 'host') {
        if (environment.kind === 'remote') reasons.push(`${location.label} runs on the Host and cannot run in a remote Environment`)
        else if (location.local.support === 'unavailable') reasons.push(`Host capability ${location.label} is not declared`)
      } else if (environment.kind === 'remote') {
        reasons.push(`${location.label} has no verified remote contract (${location.remote.gaps.join(', ')})`)
      } else {
        if (probe.productCapabilities?.[id] !== true) {
          reasons.push(`missing capability: ${location.label} (${location.local.requirements.join(', ')})`)
        }
        for (const permission of location.local.permissions) {
          if (!probe.capabilities.includes(permission)) reasons.push(`missing capability: ${location.label} permission ${permission}`)
        }
      }
    }
    const capacity = probe.capacity
    if (capacity === 'unknown') reasons.push('Environment capacity is unknown')
    if (typeof capacity === 'object' && capacity.active >= capacity.max) reasons.push(`capacity is full (${capacity.active}/${capacity.max})`)
    const boundedReasons = reasons.slice(0, 8).map(bounded)
    candidates.push({ id: environment.config.id, kind: environment.kind, eligible: boundedReasons.length === 0, reasons: boundedReasons,
      online: probe.online, root: probe.root, permissions: [...probe.capabilities], version: probe.version,
      fingerprint: probe.fingerprint, capacity,
      ...(probe.productCapabilities ? { productCapabilities: { ...probe.productCapabilities } } : {}),
      ...(environment.deviceId ? { deviceId: environment.deviceId } : {}),
      ...(environment.deviceIncarnation ? { deviceIncarnation: environment.deviceIncarnation } : {}) })
  }

  if (!options.environments.length && !options.explicitEnvironmentId && source === 'default'
    && target === 'local-only' && !required.length) {
    return { version: 1, ticketId: options.ticketId, source, target, policyRevision: options.policy.revision,
      status: 'selected', answerOnly: true, hostId: options.hostId, reason: 'No Environment is configured; this is an answer-only Ticket.',
      candidates, decidedAt: (options.now ?? Date.now)() }
  }
  const eligible = candidates.filter(candidate => candidate.eligible).sort((left, right) => {
    if (options.explicitEnvironmentId) {
      if (left.id === options.explicitEnvironmentId) return -1
      if (right.id === options.explicitEnvironmentId) return 1
    }
    if (options.policy.preferredEnvironmentId) {
      if (left.id === options.policy.preferredEnvironmentId) return -1
      if (right.id === options.policy.preferredEnvironmentId) return 1
    }
    const rank = (kind: 'local' | 'remote') => kind === 'local' ? 0 : 1
    return rank(left.kind) - rank(right.kind) || left.id.localeCompare(right.id)
  })
  const chosen = eligible[0]
  if (!chosen) {
    const failures = candidates.filter(candidate => !candidate.eligible).slice(0, 3)
      .map(candidate => `${candidate.id}: ${candidate.reasons.join(', ')}`).join('; ')
    return { version: 1, ticketId: options.ticketId, source, target, policyRevision: options.policy.revision,
      status: 'waiting', hostId: options.hostId, requiredCapabilities: required,
      capabilities: resolveCapabilities(required, catalog, undefined, candidates, target),
      reason: `No eligible Environment matches ${target}${failures ? `: ${failures}` : ''}.`,
      candidates, decidedAt: (options.now ?? Date.now)() }
  }
  return { version: 1, ticketId: options.ticketId, source, target, policyRevision: options.policy.revision,
    status: 'selected', hostId: options.hostId, requiredCapabilities: required,
    capabilities: resolveCapabilities(required, catalog, chosen, candidates, target),
    selected: { id: chosen.id, kind: chosen.kind, root: chosen.root, ...(chosen.deviceId ? { deviceId: chosen.deviceId } : {}),
      ...(chosen.deviceIncarnation ? { deviceIncarnation: chosen.deviceIncarnation } : {}),
      version: chosen.version ?? 'unknown', fingerprint: chosen.fingerprint ?? 'unknown' },
    candidates, decidedAt: (options.now ?? Date.now)() }
}

export function targetMatches(kind: 'local' | 'remote', target: ExecutionTarget) {
  return target === 'auto' || target === 'local-only' && kind === 'local' || target === 'remote-only' && kind === 'remote'
}

function bounded(reason: string) {
  return reason.slice(0, 300)
}

function resolveCapabilities(required: CapabilityId[], catalog: ReturnType<typeof capabilityLocations>,
  chosen: ExecutionCandidateView | undefined, candidates: ExecutionCandidateView[], target: ExecutionTarget): CapabilityResolutionView[] {
  return required.map(id => {
    const location = catalog.find(candidate => candidate.id === id)!
    const base = { id, label: location.label, location: location.location, requirements: [...location.local.requirements],
      credentials: location.local.credentials, privacy: location.local.privacy, gaps: [...location.remote.gaps] }
    if (chosen) return { ...base, status: 'available' as const,
      ...(location.location === 'environment' ? { environmentId: chosen.id } : {}), reasons: [] }
    const relevant = candidates.filter(candidate => targetMatches(candidate.kind, target))
    const specific = relevant.flatMap(candidate => candidate.reasons).filter(reason => reason.toLowerCase().includes(id))
    const reasons = [...new Set(specific.length ? specific : relevant.flatMap(candidate => candidate.reasons))].slice(0, 3)
    if (!reasons.length) reasons.push(location.location === 'host'
      ? `${location.label} runs on the Host; no eligible local Environment was selected.`
      : `${location.label} has no eligible Environment that declares it.`)
    return { ...base, status: 'blocked' as const, reasons }
  })
}
