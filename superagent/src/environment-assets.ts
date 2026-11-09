import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CoreError } from './model.js'
import { completeUtf8Length } from './remote-output.js'
import type { EnvironmentKind } from './environment.js'

export const maxAssetBytes = 65536
export const maxAssetPageBytes = 65536
export const maxSpillBytes = 1_048_576
export const defaultAssetPageBytes = 8192

export type EnvironmentAssetKind = 'attachment' | 'artifact' | 'spill' | 'skill'
export type SpillStream = 'stdout' | 'stderr'

/**
 * A durable reference to one object in a named execution world. `id` is never a Host path:
 * attachment and artifact content is addressed by digest, and spill content by its job
 * identity plus stream. The environment facts let every later read prove it is still the
 * same world instead of silently substituting a same-named file elsewhere.
 */
export interface EnvironmentAssetReference {
  kind: EnvironmentAssetKind
  environmentId: string
  environmentKind: EnvironmentKind
  environmentFingerprint: string
  deviceId?: string
  deviceIncarnation?: string
  id: string
  name?: string
  /** Working-directory-relative path for an artifact; never a Host path for a remote world. */
  path?: string
  bytes: number
  sha256: string
  mediaType?: string
}

export interface EnvironmentAssetPage {
  reference: EnvironmentAssetReference
  offset: number
  nextOffset: number
  bytes: number
  totalBytes: number
  sha256: string
  encoding: 'utf8' | 'base64'
  text: string
  truncated: boolean
}

export interface EnvironmentAssetCapabilities {
  attachments: { supported: boolean; maxBytes: number; gaps: string[] }
  spill: { supported: boolean; maxBytes: number; gaps: string[] }
  skills: { supported: boolean; gaps: string[] }
}

export interface EnvironmentSkillSummary {
  name: string
  description: string
  path?: string
  source: string
  provider: string
  modelInvocable: boolean
}

export interface EnvironmentAssetSupport {
  attachments: boolean
  spill: boolean
  skills: boolean
}

export interface AssetLimits {
  maxBytes: number
  spillBytes: number
}

/** Stable names for native combinations this build explicitly refuses. */
export const environmentAssetGaps = {
  localStore: 'local-asset-store-unconfigured',
  deviceStore: 'device-asset-store-unconfigured',
  deviceOffline: 'environment-offline',
  localSkillStore: 'local-skill-store-unconfigured',
  deviceSkillStore: 'device-skill-store-unconfigured',
  skillProvider: 'skill-provider-unavailable',
  imageAdmission: 'attachment-image-admission-not-implemented',
  spillUnavailable: 'spill-stream-unavailable',
} as const

export class UnsupportedEnvironmentCombination extends CoreError {
  constructor(message: string, readonly gaps: string[]) {
    super('ENVIRONMENT_UNSUPPORTED', `${message} Gaps: ${gaps.join(', ')}.`)
  }
}

export function unsupportedAssetCapabilities(gaps: string[], skillGaps: string[] = [environmentAssetGaps.skillProvider]): EnvironmentAssetCapabilities {
  return {
    attachments: { supported: false, maxBytes: maxAssetBytes, gaps: [environmentAssetGaps.imageAdmission, ...gaps] },
    spill: { supported: false, maxBytes: maxSpillBytes, gaps: [...gaps] },
    skills: { supported: false, gaps: skillGaps },
  }
}

export function fileAssetId(sha256: string) {
  return `file:sha256:${sha256}`
}

export function assetNamespace(instanceId: string, environmentId: string) {
  return createHash('sha256').update(`${instanceId}\u0000${environmentId}`).digest('hex').slice(0, 32)
}

export function spillAssetId(jobId: string, stream: SpillStream) {
  return `spill:${jobId}:${stream}`
}

export function attachmentBytes(data: string | undefined, encoding: string | undefined) {
  if (!data) throw new CoreError('INVALID_INPUT', 'An attachment needs exact bytes.')
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') {
    throw new CoreError('INVALID_INPUT', 'Attachment encoding is utf8 or base64.')
  }
  const buffer = (encoding ?? 'base64') === 'utf8' ? Buffer.from(data, 'utf8') : Buffer.from(data, 'base64')
  if ((encoding ?? 'base64') === 'base64' && buffer.toString('base64') !== data) {
    throw new CoreError('INVALID_INPUT', 'Attachment bytes must be canonical base64.')
  }
  if (buffer.length > maxAssetBytes) throw new CoreError('INVALID_INPUT', `Attachments are limited to ${maxAssetBytes} bytes.`)
  return buffer
}

export function attachmentToolInput(args: Record<string, string>) {
  return { name: args.name ?? '', data: attachmentBytes(args.data, args.encoding),
    ...(args.mediaType ? { mediaType: args.mediaType } : {}) }
}

export function assetReferenceFromArgs(args: Record<string, string>, environment: {
  id: string; kind: EnvironmentKind; fingerprint: string; deviceId?: string; deviceIncarnation?: string
}): EnvironmentAssetReference {
  const kind = args.kind
  if (kind !== 'attachment' && kind !== 'artifact' && kind !== 'spill' && kind !== 'skill') {
    throw new CoreError('INVALID_INPUT', 'Asset kind is attachment, artifact, spill or skill.')
  }
  const bytes = Number(args.bytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new CoreError('INVALID_INPUT', 'An asset reference needs its byte length.')
  return { kind, environmentId: environment.id, environmentKind: environment.kind,
    environmentFingerprint: environment.fingerprint, ...(environment.deviceId ? { deviceId: environment.deviceId } : {}),
    ...(environment.deviceIncarnation ? { deviceIncarnation: environment.deviceIncarnation } : {}),
    id: args.id ?? '', bytes, sha256: args.sha256 ?? '',
    ...(args.path ? { path: args.path } : {}), ...(args.name ? { name: args.name } : {}) }
}

export function assetPageOptions(args: Record<string, string>) {
  return { offset: args.offset ? Number(args.offset) : 0, maxBytes: args.maxBytes ? Number(args.maxBytes) : defaultAssetPageBytes }
}

export function parseFileAssetId(id: string) {
  const match = /^file:sha256:([a-f0-9]{64})$/u.exec(id)
  if (!match) throw new CoreError('INVALID_INPUT', 'A file asset reference needs its sha256 digest identity.')
  return match[1]!
}

export function parseSpillAssetId(id: string): { jobId: string; stream: SpillStream } {
  const marker = id.lastIndexOf(':')
  if (marker <= 6 || !id.startsWith('spill:')) throw new CoreError('INVALID_INPUT', 'A spill reference needs its job identity and stream.')
  const stream = id.slice(marker + 1)
  if (stream !== 'stdout' && stream !== 'stderr') throw new CoreError('INVALID_INPUT', 'A spill reference names stdout or stderr only.')
  const jobId = id.slice(6, marker)
  if (!jobId) throw new CoreError('INVALID_INPUT', 'A spill reference needs a job identity.')
  return { jobId, stream }
}

export function environmentFingerprint(kind: EnvironmentKind, facts: { local?: string; deviceId?: string; deviceIncarnation?: string }) {
  return kind === 'local' ? `local:${facts.local ?? 'unknown'}` : `device:${facts.deviceId ?? 'unknown'}:${facts.deviceIncarnation ?? 'unknown'}`
}

/**
 * Validates that a retained reference belongs to this exact execution world. A changed root
 * or device incarnation is a stale reference, never an invitation to read a same-named path.
 */
export function matchesEnvironment(reference: EnvironmentAssetReference, environment: {
  id: string; kind: EnvironmentKind; fingerprint: string; deviceId?: string; deviceIncarnation?: string
}) {
  if (reference.environmentId !== environment.id || reference.environmentKind !== environment.kind
    || reference.environmentFingerprint !== environment.fingerprint) return false
  if (environment.kind !== 'remote') return true
  return reference.deviceId === environment.deviceId && reference.deviceIncarnation === environment.deviceIncarnation
}

export function assertReferenceShape(value: unknown): asserts value is EnvironmentAssetReference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ![
    'kind', 'environmentId', 'environmentKind', 'environmentFingerprint', 'deviceId', 'deviceIncarnation',
    'id', 'name', 'path', 'bytes', 'sha256', 'mediaType',
  ].includes(key))) throw new CoreError('INVALID_INPUT', 'The asset reference is malformed.')
  const reference = value as EnvironmentAssetReference
  if (!['attachment', 'artifact', 'spill', 'skill'].includes(reference.kind)
    || typeof reference.environmentId !== 'string' || !reference.environmentId
    || reference.environmentKind !== 'local' && reference.environmentKind !== 'remote'
    || typeof reference.environmentFingerprint !== 'string' || !reference.environmentFingerprint
    || typeof reference.id !== 'string' || !reference.id || Buffer.byteLength(reference.id) > 1024
    || !Number.isSafeInteger(reference.bytes) || reference.bytes < 0
    || reference.kind !== 'skill' && (typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.sha256))
    || reference.kind === 'skill' && typeof reference.sha256 !== 'string'
    || reference.name !== undefined && (typeof reference.name !== 'string' || Buffer.byteLength(reference.name) > 255)
    || reference.path !== undefined && (typeof reference.path !== 'string' || !reference.path || Buffer.byteLength(reference.path) > 1024)
    || reference.mediaType !== undefined && typeof reference.mediaType !== 'string') {
    throw new CoreError('INVALID_INPUT', 'The asset reference is malformed.')
  }
  if (reference.kind === 'attachment' || reference.kind === 'artifact') parseFileAssetId(reference.id)
  if (reference.kind === 'spill') parseSpillAssetId(reference.id)
  if (reference.kind === 'skill' && !/^skill:[a-z0-9][a-z0-9-]{0,63}$/u.test(reference.id)) {
    throw new CoreError('INVALID_INPUT', 'A skill reference needs a lowercase skill name.')
  }
  if (reference.environmentKind === 'remote') {
    if (typeof reference.deviceId !== 'string' || !reference.deviceId
      || typeof reference.deviceIncarnation !== 'string' || !reference.deviceIncarnation) {
      throw new CoreError('INVALID_INPUT', 'A remote asset reference needs its device identity and incarnation.')
    }
  } else if (reference.deviceId !== undefined || reference.deviceIncarnation !== undefined) {
    throw new CoreError('INVALID_INPUT', 'A local asset reference cannot carry a device identity.')
  }
}

export function pageOf(reference: EnvironmentAssetReference, bytes: Uint8Array, offset: number, maxBytes: number,
  sanitize?: (text: string) => string): EnvironmentAssetPage {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > reference.bytes) {
    throw new CoreError('INVALID_INPUT', 'Asset offsets must address bytes already observed.')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > maxAssetPageBytes) {
    throw new CoreError('INVALID_INPUT', `Asset pages are between 1 and ${maxAssetPageBytes} bytes.`)
  }
  const start = 0
  let end = Math.min(bytes.length, maxBytes)
  const slice = bytes.subarray(start, end)
  end = start + completeUtf8Length(slice)
  if (end === 0 && slice.length > 0) end = slice.length
  const window = bytes.subarray(start, end)
  let encoding: 'utf8' | 'base64' = 'utf8'
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(window)
    if (text.includes('\0')) throw new Error('Binary content.')
    if (sanitize) text = sanitize(text)
  } catch {
    encoding = 'base64'
    text = Buffer.from(window).toString('base64')
  }
  if (offset + end > reference.bytes) throw new CoreError('INVALID_INPUT', 'The page exceeds the referenced asset length.')
  return { reference: { ...reference }, offset, nextOffset: offset + end, bytes: window.length,
    totalBytes: reference.bytes, sha256: reference.sha256, encoding, text, truncated: offset + end < reference.bytes }
}

function sanitizedName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new CoreError('INVALID_INPUT', 'An attachment needs a nonempty display name.')
  const leaf = value.split(/[\\/]/u).at(-1)!.trim()
  if (!leaf || leaf === '.' || leaf === '..' || leaf.startsWith('.') || Buffer.byteLength(leaf) > 255 || /\p{Cc}/u.test(leaf)) {
    throw new CoreError('INVALID_INPUT', 'An attachment display name must be a bounded plain filename.')
  }
  return leaf
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Content-addressed verbatim file storage owned by one execution world. Local environments
 * and the device daemon each keep their own store, so a Host file of the same name can never
 * satisfy a reference.
 */
export class FileAssetStore {
  private constructor(readonly root: string, readonly namespace: string) {}

  static async open(root: string, namespace = 'default') {
    await mkdir(join(root, 'files', namespace), { recursive: true, mode: 0o700 })
    await mkdir(join(root, 'index', namespace), { recursive: true, mode: 0o700 })
    await mkdir(join(root, 'spill', namespace), { recursive: true, mode: 0o700 })
    return new FileAssetStore(root, namespace)
  }

  private filePath(sha256: string) { return join(this.root, 'files', this.namespace, sha256) }
  private indexPath(sha256: string) { return join(this.root, 'index', this.namespace, `${sha256}.json`) }
  spillPath(key: string, stream: SpillStream) {
    return join(this.root, 'spill', this.namespace, `${createHash('sha256').update(key).digest('hex')}.${stream}`)
  }

  async save(input: { name: string; data: Uint8Array; mediaType?: string }) {
    if (!(input.data instanceof Uint8Array)) throw new CoreError('INVALID_INPUT', 'An attachment needs exact bytes.')
    if (input.data.length > maxAssetBytes) throw new CoreError('INVALID_INPUT', `Attachments are limited to ${maxAssetBytes} bytes.`)
    const name = sanitizedName(input.name)
    const sha256 = digest(input.data)
    const file = this.filePath(sha256)
    const existing = await stat(file).catch(() => undefined)
    if (!existing) {
      const temporary = `${file}.${randomUUID()}.tmp`
      await writeFile(temporary, input.data, { mode: 0o600 })
      await rename(temporary, file)
    }
    const index = { name, bytes: input.data.length, sha256, mediaType: input.mediaType ?? 'application/octet-stream' }
    await writeFile(this.indexPath(sha256), JSON.stringify(index), { mode: 0o600 })
    return { id: fileAssetId(sha256), name, bytes: input.data.length, sha256, mediaType: index.mediaType }
  }

  async stat(id: string) {
    const sha256 = parseFileAssetId(id)
    const observed = await stat(this.filePath(sha256)).catch(() => undefined)
    if (!observed?.isFile()) return undefined
    let name: string | undefined
    let mediaType: string | undefined
    try {
      const index = JSON.parse(await readFile(this.indexPath(sha256), 'utf8')) as { name?: unknown; mediaType?: unknown }
      if (typeof index.name === 'string') name = index.name
      if (typeof index.mediaType === 'string') mediaType = index.mediaType
    } catch { /* The bytes remain authoritative when the display index is missing. */ }
    return { id, sha256, bytes: observed.size, ...(name ? { name } : {}), ...(mediaType ? { mediaType } : {}) }
  }

  async read(id: string, offset: number, maxBytes: number) {
    const sha256 = parseFileAssetId(id)
    const file = this.filePath(sha256)
    const observed = await stat(file).catch(() => undefined)
    if (!observed?.isFile()) throw new CoreError('NOT_FOUND', 'The attachment object no longer exists in this execution world.')
    const complete = await readFileBytes(file, 0, observed.size)
    if (digest(complete) !== sha256) throw new CoreError('REFERENCE_STALE', 'The stored attachment no longer matches its digest.')
    if (offset > complete.length) throw new CoreError('INVALID_INPUT', 'Asset offsets must address bytes already observed.')
    const window = complete.subarray(offset, Math.min(complete.length, offset + maxBytes))
    return { data: window, bytes: complete.length, sha256 }
  }

  async storeSpill(key: string, stream: SpillStream, sourcePath: string) {
    const target = this.spillPath(key, stream)
    const observed = await stat(sourcePath).catch(() => undefined)
    if (!observed?.isFile()) throw new CoreError('SPILL_UNAVAILABLE', 'The provider did not retain this output stream.')
    if (observed.size > maxSpillBytes) throw new CoreError('SPILL_UNAVAILABLE', 'The complete output exceeded the spill budget.')
    await copyFile(sourcePath, target)
    const bytes = await readFileBytes(target, 0, observed.size)
    const sha256 = digest(bytes)
    return { id: spillAssetId(key, stream), bytes: bytes.length, sha256 }
  }

  async spillInfo(key: string, stream: SpillStream) {
    const file = this.spillPath(key, stream)
    const observed = await stat(file).catch(() => undefined)
    if (!observed?.isFile()) return undefined
    const bytes = await readFileBytes(file, 0, observed.size)
    return { bytes: bytes.length, sha256: digest(bytes) }
  }

  async readSpill(key: string, stream: SpillStream, offset: number, maxBytes: number,
    expected: { bytes: number; sha256: string }) {
    const file = this.spillPath(key, stream)
    const observed = await stat(file).catch(() => undefined)
    if (!observed?.isFile() || observed.size < expected.bytes) {
      throw new CoreError('REFERENCE_STALE', 'The spill object no longer exists at the referenced length.')
    }
    const prefix = await readFileBytes(file, 0, expected.bytes)
    if (digest(prefix) !== expected.sha256) throw new CoreError('REFERENCE_STALE', 'The spill content no longer matches its reference.')
    const window = prefix.subarray(offset, Math.min(prefix.length, offset + maxBytes))
    return { data: window, bytes: prefix.length, sha256: expected.sha256 }
  }

}

async function readFileBytes(path: string, offset: number, length: number) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const result = await handle.read(buffer, read, length - read, offset + read)
      if (!result.bytesRead) break
      read += result.bytesRead
    }
    return buffer.subarray(0, read)
  } finally { await handle.close() }
}
