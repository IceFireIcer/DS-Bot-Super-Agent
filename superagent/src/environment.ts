import type { Artifact, LocalCommand, LocalJob, LocalPermission, RemoteJobObservation } from './local-environment.js'
import type { RemoteJobRecovery } from './remote-protocol.js'
import type { EnvironmentAssetCapabilities, EnvironmentAssetPage, EnvironmentAssetReference, EnvironmentAssetSupport, EnvironmentSkillSummary, SpillStream } from './environment-assets.js'
import type { CapabilityId } from './capability-locations.js'

export type EnvironmentKind = 'local' | 'remote'

export interface EnvironmentConfig {
  id: string
  instanceId: string
  root: string
  allowedActorIds: string[]
  permissions: LocalPermission[]
  commands: Record<string, LocalCommand>
  /** Names of device-side commands whose argv never leaves the device. */
  commandNames?: readonly string[]
  /** Deployment-owned verbatim asset store; it must live outside the exposed working directory. */
  assetsPath?: string
  /** Deployment-owned skill root scanned through the public DSH skill provider. */
  skillsPath?: string
  setup?: string
}

export interface EnvironmentLocation {
  id: string
  kind: EnvironmentKind
  root: string
  deviceId?: string
  deviceIncarnation?: string
  version?: string
  fingerprint?: string
}

export interface EnvironmentProbe {
  online: boolean
  root: string
  version: string
  fingerprint: string
  capabilities: LocalPermission[]
  capacity: 'available' | 'unknown' | { active: number; max: number }
  /** Product capabilities this exact execution world can serve. Absent means undeclared, not available. */
  productCapabilities?: Partial<Record<CapabilityId, boolean>>
  reason?: string
}

export interface PreparedEnvironment {
  readonly cwd: string
  invoke(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>>
  artifact(path: string, signal?: AbortSignal): Promise<Artifact>
  assetCapabilities?(signal?: AbortSignal): Promise<EnvironmentAssetCapabilities>
  saveAttachment?(input: { name: string; data: Uint8Array; mediaType?: string }, signal?: AbortSignal): Promise<EnvironmentAssetReference>
  readAsset?(reference: EnvironmentAssetReference, options?: { offset?: number; maxBytes?: number }, signal?: AbortSignal): Promise<EnvironmentAssetPage>
  spillReference?(jobId: string, stream: SpillStream, signal?: AbortSignal): Promise<EnvironmentAssetReference>
  listSkills?(signal?: AbortSignal): Promise<EnvironmentSkillSummary[]>
  sanitize(text: string): string
  planCommand?(name: string, mode?: 'foreground' | 'background'): { jobId: string; remote: RemoteJobObservation }
  startCommand?(name: string, jobId?: string): Promise<LocalJob>
  attachCommand?(jobId: string): Promise<LocalJob>
  inspectRange?(jobId: string): Promise<{ jobId: string; state: string; settled: boolean; cancelled: boolean
    ownerId: string | null; deadlineAt: number | null; recovery?: RemoteJobRecovery
    exitCode: number | null; signal: string | null
    stdout: { text: string; nextOffset: number; lossy: boolean }; stderr: { text: string; nextOffset: number; lossy: boolean } }>
  cancelRange?(jobId: string): Promise<void>
}

export interface ExecutionEnvironment {
  readonly kind: EnvironmentKind
  readonly config: Readonly<EnvironmentConfig>
  readonly deviceId?: string
  readonly deviceIncarnation?: string
  readonly online?: boolean
  readonly assetSupport?: EnvironmentAssetSupport
  probe?(identity: { instanceId: string; actorId: string }, signal?: AbortSignal): Promise<EnvironmentProbe>
  assetCapabilities?(identity: { instanceId: string; actorId: string }): Promise<EnvironmentAssetCapabilities>
  authorize(identity: { instanceId: string; actorId: string }): void
  prepare(identity: { instanceId: string; actorId: string }, signal?: AbortSignal): Promise<PreparedEnvironment>
  close(): Promise<void>
}

export function environmentLocation(environment: ExecutionEnvironment): EnvironmentLocation {
  return { id: environment.config.id, kind: environment.kind, root: environment.config.root,
    ...(environment.kind === 'remote' && environment.deviceId ? { deviceId: environment.deviceId } : {}),
    ...(environment.kind === 'remote' && environment.deviceIncarnation ? { deviceIncarnation: environment.deviceIncarnation } : {}) }
}

export function environmentCommandNames(environment: ExecutionEnvironment): string[] {
  return [...(environment.config.commandNames ?? Object.keys(environment.config.commands))]
}

export function environmentHasCommand(environment: ExecutionEnvironment | undefined): boolean {
  if (!environment || !environment.config.permissions.includes('command')) return false
  return environmentCommandNames(environment).some(name => name !== environment.config.setup)
}

export function sameEnvironment(location: EnvironmentLocation | undefined, environment: ExecutionEnvironment) {
  if (!location) return true
  if (location.id !== environment.config.id || location.kind !== environment.kind || location.root !== environment.config.root) return false
  if (environment.kind !== 'remote') return true
  return location.deviceId === environment.deviceId && location.deviceIncarnation === environment.deviceIncarnation
}
