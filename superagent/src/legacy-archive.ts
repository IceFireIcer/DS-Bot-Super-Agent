import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from 'node:zlib'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CoreError } from './model.js'

const CURRENT_SESSION_VERSION = 4
const sessionLog = /^session\.v(\d+)\.jsonl(?:\.(zstd|zst|gz|br))?$/u
const batchPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const safeSegment = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
const assertBatchId = (batchId: string) => { if (!batchPattern.test(batchId)) throw new CoreError('ARCHIVE_INPUT', 'A batch id is a bounded path-safe identifier.') }

export interface LegacyArchiveMapping {
  roles: Array<{ sourceBotId: string; name?: string; roleLabel?: string; instructions?: string; model?: string }>
  /** `team` or `group:<roomId>`; only reviewed, shareable memory scopes. */
  sharedMemory: string[]
}

export interface LegacyArchiveSession {
  id: string
  group: string
  files: string[]
  digest: string
  compressed: boolean
  formatVersion?: number
}

export interface LegacyArchiveReviewItem {
  id: string
  kind: 'work' | 'request' | 'question' | 'agent' | 'inflight'
  sourceRef: string
  state: string
  reason: string
  data?: unknown
}

export interface LegacyArchiveRole {
  sourceBotId: string
  name: string
  roleLabel?: string
  instructions?: string
  model?: string
  /** Whether the source Bot was a Main Bot; the archive never grants that authority. */
  sourceMainBot: boolean
  permissions: []
  readOnly: true
  sourceDigest?: string
}

export interface LegacyArchiveMappedMemory {
  scope: string
  path: string
  files: string[]
  digest: string
}

export interface LegacyArchiveManifest {
  batchId: string
  version: 1
  status: 'prepared' | 'verified' | 'published' | 'invalid'
  source: { path: string; digest: string; stateRevision?: number; identity?: string; profile?: string }
  mapping: LegacyArchiveMapping
  mappingDigest: string
  counts: { bots: number; rooms: number; sessions: number; missingSessions: number; invalidSessions: number; reviewItems: number; files: number; bytes: number }
  sessions: LegacyArchiveSession[]
  missingSessions: string[]
  invalidSessions: Array<{ id: string; reason: string }>
  review: LegacyArchiveReviewItem[]
  roles: LegacyArchiveRole[]
  mappedMemory: LegacyArchiveMappedMemory[]
  include: { workspace: boolean; attachments: boolean }
  checksums: Record<string, string>
  limits: { maxFiles: number; maxBytes: number }
  createdAt: number
  verifiedAt?: number
  publishedAt?: number
  errors?: string[]
}

export interface LegacyArchiveOptions {
  source: string
  target: string
  batchId: string
  mapping: LegacyArchiveMapping
  sourceIdentity?: string
  profile?: string
  include?: { workspace?: boolean; attachments?: boolean }
  limits?: { maxFiles?: number; maxBytes?: number }
  signal?: AbortSignal
}

export interface LegacyArchiveReadOptions {
  target: string
  batchId: string
  ref: string
  offset?: number
  limit?: number
}

const within = (inner: string, outer: string) => {
  const path = relative(resolve(outer), resolve(inner))
  return path === '' || (!path.startsWith('..') && !path.startsWith(sep) && !/^[a-z]:/iu.test(path))
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) => {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new CoreError('ARCHIVE_LIMIT', `${name} must be between ${String(minimum)} and ${String(maximum)}.`)
  return result
}

const archivePaths = (target: string, batchId: string) => ({
  root: resolve(target), staging: join(resolve(target), '.staging', batchId), final: join(resolve(target), 'archives', batchId),
})

const manifestPath = (dir: string) => join(dir, 'manifest.json')

const decompress = (path: string, compressed: string | undefined, content: Buffer): Buffer => {
  if (compressed === undefined) return content
  try {
    if (compressed === 'zstd' || compressed === 'zst') return zstdDecompressSync(content)
    if (compressed === 'br') return brotliDecompressSync(content)
    return gunzipSync(content)
  } catch { throw new CoreError('MALFORMED_SESSION', 'A compressed Session log could not be decompressed.') }
}
const readManifest = (dir: string): LegacyArchiveManifest | undefined => {
  const path = manifestPath(dir)
  if (!existsSync(path)) return undefined
  try { return JSON.parse(readFileSync(path, 'utf8')) as LegacyArchiveManifest } catch { return undefined }
}

const writeManifest = async (dir: string, manifest: LegacyArchiveManifest) => {
  await mkdir(dir, { recursive: true })
  await writeFile(manifestPath(dir), `${JSON.stringify(manifest, null, 2)}\n`)
}

const listFiles = async (root: string, limits: { maxFiles: number; maxBytes: number }, signal?: AbortSignal) => {
  const files: Array<{ path: string; bytes: number; digest: string; link?: string }> = []
  let bytes = 0
  const walk = async (at: string, prefix: string) => {
    signal?.throwIfAborted()
    if (!existsSync(at)) return
    for (const name of readdirSync(at).sort()) {
      signal?.throwIfAborted()
      const full = join(at, name)
      const rel = prefix === '' ? name : `${prefix}/${name}`
      const info = lstatSync(full)
      if (info.isSymbolicLink()) {
        files.push({ path: rel, bytes: 0, digest: hash(`link:${readlinkSync(full)}`), link: readlinkSync(full) })
      } else if (info.isDirectory()) await walk(full, rel)
      else if (info.isFile()) {
        bytes += info.size
        if (files.length + 1 > limits.maxFiles || bytes > limits.maxBytes) throw new CoreError('ARCHIVE_LIMIT', 'The legacy archive exceeds its declared file or byte budget.')
        files.push({ path: rel, bytes: info.size, digest: hash(readFileSync(full)) })
      }
    }
  }
  await walk(root, '')
  return files
}

const digestEntries = (entries: Array<{ path: string; digest: string; link?: string }>) => hash(entries.map(entry => `${entry.path}:${entry.digest}`).sort().join('\n'))

const teamSessionIds = (state: Record<string, unknown>) => {
  const ids = new Set<string>()
  const add = (value: unknown) => { if (typeof value === 'string' && value !== '') ids.add(value) }
  for (const bot of Object.values(state.bots as Record<string, unknown> ?? {})) {
    const value = bot as Record<string, unknown>
    add(value.id); add(value.sessionId)
    for (const segment of Array.isArray(value.segments) ? value.segments : []) add((segment as Record<string, unknown>)?.sessionId)
  }
  for (const room of Object.values(state.rooms as Record<string, unknown> ?? {})) {
    const value = room as Record<string, unknown>
    add(value.id)
    for (const session of Object.values(value.sessions as Record<string, unknown> ?? {})) add(session)
    for (const segments of Object.values(value.segments as Record<string, unknown> ?? {})) {
      for (const segment of Array.isArray(segments) ? segments : []) add((segment as Record<string, unknown>)?.sessionId)
    }
  }
  return [...ids]
}

const findSession = (source: string, id: string) => {
  const root = join(source, 'sessions')
  if (!existsSync(root)) return undefined
  for (const group of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)) {
    if (existsSync(join(root, group, id))) return { group, dir: join(root, group, id) }
  }
  return undefined
}

const memoryScopes = (source: string) => {
  const groups = [join(source, 'memory', 'groups'), join(source, 'bot', 'memory', 'groups')]
    .filter(path => existsSync(path))
    .flatMap(path => readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `group:${entry.name}`))
  const team = existsSync(join(source, 'memory', 'team')) || existsSync(join(source, 'bot', 'memory', 'team'))
  return [...(team ? ['team'] : []), ...new Set(groups)]
}

const validateMapping = (source: string, state: Record<string, unknown>, mapping: LegacyArchiveMapping) => {
  if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).some(key => !['roles', 'sharedMemory'].includes(key))) throw new CoreError('ARCHIVE_MAPPING', 'A legacy mapping accepts roles and sharedMemory only.')
  if (!Array.isArray(mapping.roles) || !Array.isArray(mapping.sharedMemory)) throw new CoreError('ARCHIVE_MAPPING', 'A legacy mapping needs roles and sharedMemory arrays.')
  const bots = state.bots as Record<string, unknown> ?? {}
  const seen = new Set<string>()
  for (const role of mapping.roles) {
    if (!role || Object.keys(role).some(key => !['sourceBotId', 'name', 'roleLabel', 'instructions', 'model'].includes(key))) throw new CoreError('ARCHIVE_MAPPING', 'A mapped role accepts sourceBotId, name, roleLabel, instructions and model only.')
    if (typeof role.sourceBotId !== 'string' || !safeSegment(role.sourceBotId) || !bots[role.sourceBotId]) throw new CoreError('ARCHIVE_MAPPING', 'A mapped role must name a safe Bot id in the source.')
    if (seen.has(role.sourceBotId)) throw new CoreError('ARCHIVE_MAPPING', 'A Bot can be mapped only once.')
    seen.add(role.sourceBotId)
    for (const [key, value] of Object.entries(role)) {
      if (key !== 'sourceBotId' && value !== undefined && (typeof value !== 'string' || Buffer.byteLength(value) > (key === 'instructions' ? 16_384 : 2_048))) throw new CoreError('ARCHIVE_MAPPING', `A mapped role ${key} is bounded text.`)
    }
  }
  const available = new Set(memoryScopes(source))
  for (const scope of mapping.sharedMemory) {
    if (typeof scope !== 'string' || !(scope === 'team' || /^group:[^/\\]+$/u.test(scope))) throw new CoreError('ARCHIVE_MAPPING', 'A shared memory scope is team or group:<roomId>.')
    if (!available.has(scope)) throw new CoreError('ARCHIVE_MAPPING', `The source has no ${scope} memory.`)
  }
}

const reviewItems = (state: Record<string, unknown>, source: string): LegacyArchiveReviewItem[] => {
  const items: LegacyArchiveReviewItem[] = []
  const add = (kind: LegacyArchiveReviewItem['kind'], id: string, value: unknown, reason: string) => items.push({ id, kind, sourceRef: `${kind}:${id}`, state: String((value as Record<string, unknown>)?.state ?? (value as Record<string, unknown>)?.status ?? 'unknown'), reason, data: value })
  for (const [id, value] of Object.entries(state.works as Record<string, unknown> ?? {})) {
    const status = String((value as Record<string, unknown>)?.state ?? (value as Record<string, unknown>)?.status ?? 'unknown')
    if (!['done', 'ended', 'completed', 'cancelled'].includes(status)) add('work', id, value, 'Old work is not replayed; inspect it before creating a new Ticket.')
  }
  for (const [id, value] of Object.entries(state.requests as Record<string, unknown> ?? {})) {
    add('request', id, value, 'Old request remains historical; it is not a new intake.')
  }
  for (const [id, value] of Object.entries(state.questions as Record<string, unknown> ?? {})) {
    const status = String((value as Record<string, unknown>)?.status ?? 'unknown')
    if (status !== 'answered') add('question', id, value, 'Old question remains historical; answer it in the archive, not a new queue.')
  }
  for (const [id, value] of Object.entries(state.agents as Record<string, unknown> ?? {})) {
    add('agent', id, value, 'A live old Agent is not restored or given Main Bot authority.')
  }
  const inflight = join(source, 'bot', 'inflight.json')
  if (existsSync(inflight)) {
    try {
      const value = JSON.parse(readFileSync(inflight, 'utf8'))
      if (value !== null && (typeof value !== 'object' || Object.keys(value).length > 0)) add('inflight', 'inflight', value, 'Old in-flight work is read-only and requires review.')
    } catch {
      add('inflight', 'inflight', {}, 'Old in-flight state is unreadable; inspect the source before migration.')
    }
  }
  return items
}

const validateSession = (files: string[], dir: string) => {
  if (files.length === 0) return { invalid: 'EMPTY_SESSION' as const }
  let compressed = false
  let formatVersion: number | undefined
  const events: number[] = []
  for (const file of files) {
    const match = sessionLog.exec(file)
    if (!match) return { invalid: 'UNKNOWN_SESSION_FORMAT' as const }
    const version = Number(match[1])
    formatVersion = formatVersion === undefined ? version : Math.max(formatVersion, version)
    if (version > CURRENT_SESSION_VERSION) return { invalid: 'NEWER_SESSION_FORMAT' as const }
    if (match[2] !== undefined) compressed = true
    const text = decompress(file, match[2], readFileSync(join(dir, file))).toString('utf8')
    for (const line of text.split(/\r?\n/u).filter(line => line.trim() !== '')) {
      try {
        const event = JSON.parse(line) as { seq?: unknown }
        if (!Number.isSafeInteger(event.seq) || Number(event.seq) < 0) return { invalid: 'MALFORMED_SESSION' as const }
        events.push(Number(event.seq))
      } catch { return { invalid: 'MALFORMED_SESSION' as const } }
    }
  }
  events.sort((left, right) => left - right)
  if (events.some((seq, index) => seq !== index)) return { invalid: 'SESSION_GAP' as const }
  return { compressed, ...(formatVersion === undefined ? {} : { formatVersion }) }
}

const sourceEntries = async (source: string, state: Record<string, unknown>, limits: { maxFiles: number; maxBytes: number }, include: { workspace: boolean; attachments: boolean }, signal?: AbortSignal) => {
  const sessionIds = teamSessionIds(state)
  const sessions: LegacyArchiveSession[] = []
  const missing: string[] = []
  const invalid: Array<{ id: string; reason: string }> = []
  for (const id of sessionIds) {
    if (!safeSegment(id)) { invalid.push({ id, reason: 'UNSAFE_SESSION_ID' }); continue }
    const found = findSession(source, id)
    if (!found) { missing.push(id); continue }
    const files = readdirSync(found.dir).sort()
    const checked = validateSession(files, found.dir)
    if ('invalid' in checked) { invalid.push({ id, reason: checked.invalid }); continue }
    const entries = await listFiles(found.dir, limits, signal)
    sessions.push({ id, group: found.group, files: entries.map(entry => entry.path), digest: digestEntries(entries), compressed: checked.compressed === true, ...(checked.formatVersion === undefined ? {} : { formatVersion: checked.formatVersion }) })
  }
  const entries: Array<{ path: string; bytes: number; digest: string; link?: string }> = []
  const collectFile = (path: string, prefix: string) => {
    const info = lstatSync(path)
    if (info.isSymbolicLink()) entries.push({ path: prefix, bytes: 0, digest: hash(`link:${readlinkSync(path)}`), link: readlinkSync(path) })
    else entries.push({ path: prefix, bytes: info.size, digest: hash(readFileSync(path)) })
  }
  const collect = async (path: string, prefix: string) => {
    const files = await listFiles(path, limits, signal)
    entries.push(...files.map(file => ({ ...file, path: `${prefix}/${file.path}` })))
  }
  collectFile(join(source, 'bot', 'state.json'), 'state.json')
  for (const session of sessions) collect(join(source, 'sessions', session.group, session.id), `sessions/${session.group}/${session.id}`)
  for (const memory of ['memory', join('bot', 'memory')]) if (existsSync(join(source, memory))) await collect(join(source, memory), memory === 'memory' ? 'memory' : 'memory-legacy')
  if (include.attachments && existsSync(join(source, 'attachments'))) await collect(join(source, 'attachments'), 'attachments')
  if (include.workspace && existsSync(join(source, 'bot', 'workspace'))) await collect(join(source, 'bot', 'workspace'), 'workspace')
  if (existsSync(join(source, 'bot', 'inflight.json'))) collectFile(join(source, 'bot', 'inflight.json'), 'review/inflight.json')
  return { entries, sessions, missing, invalid }
}

const assertPaths = (sourceInput: string, targetInput: string) => {
  if (!isAbsolute(sourceInput) || !isAbsolute(targetInput)) throw new CoreError('ARCHIVE_TARGET', 'Source and target must be absolute paths.')
  const source = resolve(sourceInput)
  const target = resolve(targetInput)
  if (!existsSync(join(source, 'bot', 'state.json'))) throw new CoreError('ARCHIVE_SOURCE', 'The source has no bot/state.json.')
  if (within(target, source) || within(source, target)) throw new CoreError('ARCHIVE_TARGET', 'The archive target and source cannot contain each other.')
  if (existsSync(target)) {
    const entries = readdirSync(target)
    const archiveRoot = entries.includes('archives') || entries.includes('.staging')
    if (entries.length > 0 && !archiveRoot) throw new CoreError('ARCHIVE_TARGET', 'The archive target must be empty or an existing archive store.')
  }
  return { source, target }
}

export async function prepareLegacyArchive(options: LegacyArchiveOptions): Promise<LegacyArchiveManifest> {
  assertBatchId(options.batchId)
  const { source, target } = assertPaths(options.source, options.target)
  const limits = { maxFiles: bounded(options.limits?.maxFiles, 50_000, 1, 500_000, 'maxFiles'), maxBytes: bounded(options.limits?.maxBytes, 8 * 1024 * 1024 * 1024, 1, 32 * 1024 * 1024 * 1024, 'maxBytes') }
  const include = { workspace: options.include?.workspace === true, attachments: options.include?.attachments === true }
  const paths = archivePaths(target, options.batchId)
  const existing = readManifest(paths.final)
  const state = JSON.parse(readFileSync(join(source, 'bot', 'state.json'), 'utf8')) as Record<string, unknown>
  validateMapping(source, state, options.mapping)
  if (options.profile !== undefined && !safeSegment(options.profile)) throw new CoreError('ARCHIVE_SOURCE', 'A source profile is a safe profile name.')
  if (options.profile !== undefined && !existsSync(join(source, 'profiles', options.profile))) throw new CoreError('ARCHIVE_SOURCE', 'The source profile does not exist.')
  const mappingDigest = hash(JSON.stringify({ mapping: options.mapping, sourceIdentity: options.sourceIdentity ?? 'legacy-team', profile: options.profile ?? null }))
  const entries = await sourceEntries(source, state, limits, include, options.signal)
  const sourceDigest = digestEntries(entries.entries)
  if (existing) {
    if (existing.source.digest === sourceDigest && existing.mappingDigest === mappingDigest) return existing
    throw new CoreError('ARCHIVE_CONFLICT', 'This batch already published different source content or mapping.')
  }
  const staged = readManifest(paths.staging)
  if (staged) {
    if (staged.source.digest !== sourceDigest || staged.mappingDigest !== mappingDigest) throw new CoreError('ARCHIVE_CONFLICT', 'This batch has different prepared source content.')
    return staged
  }
  await rm(paths.staging, { recursive: true, force: true })
  try {
    await mkdir(paths.staging, { recursive: true })
    await cp(join(source, 'bot', 'state.json'), join(paths.staging, 'state.json'))
    for (const session of entries.sessions) {
      options.signal?.throwIfAborted()
      await cp(join(source, 'sessions', session.group, session.id), join(paths.staging, 'sessions', session.group, session.id), { recursive: true })
    }
    const copies: Array<[string, string]> = [['memory', 'memory'], [join('bot', 'memory'), 'memory-legacy'],
      ...(include.attachments ? [['attachments', 'attachments'] as [string, string]] : []),
      ...(include.workspace ? [[join('bot', 'workspace'), 'workspace'] as [string, string]] : [])]
    for (const [from, to] of copies) {
      options.signal?.throwIfAborted()
      if (existsSync(join(source, from))) await cp(join(source, from), join(paths.staging, to), { recursive: true })
    }
    if (existsSync(join(source, 'bot', 'inflight.json'))) {
      await mkdir(join(paths.staging, 'review'), { recursive: true })
      await cp(join(source, 'bot', 'inflight.json'), join(paths.staging, 'review', 'inflight.json'))
    }
    const roles: LegacyArchiveRole[] = options.mapping.roles.map(role => {
      const bot = (state.bots as Record<string, unknown>)[role.sourceBotId] as Record<string, unknown>
      return { sourceBotId: role.sourceBotId, name: role.name ?? String(bot?.name ?? role.sourceBotId), ...(role.roleLabel ?? bot?.roleLabel ?? bot?.role ? { roleLabel: String(role.roleLabel ?? bot?.roleLabel ?? bot?.role) } : {}),
        ...(role.instructions ?? bot?.instructions ? { instructions: String(role.instructions ?? bot?.instructions) } : {}), ...(role.model ?? bot?.model ? { model: String(role.model ?? bot?.model) } : {}),
        sourceMainBot: Array.isArray(state.mainBotIds) && state.mainBotIds.includes(role.sourceBotId), permissions: [], readOnly: true,
        ...(typeof bot?.digest === 'string' ? { sourceDigest: bot.digest } : {}) }
    })
    await mkdir(join(paths.staging, 'mapped-roles'), { recursive: true })
    for (const role of roles) await writeFile(join(paths.staging, 'mapped-roles', `${role.sourceBotId}.json`), `${JSON.stringify(role, null, 2)}\n`)
    await writeFile(join(paths.staging, 'mapping.json'), `${JSON.stringify(options.mapping, null, 2)}\n`)
    const mappedMemory: LegacyArchiveMappedMemory[] = []
    for (const scope of options.mapping.sharedMemory) {
      const id = scope === 'team' ? 'team' : scope.slice('group:'.length)
      const candidates = scope === 'team'
        ? [{ dir: join(source, 'memory', 'team'), relative: 'memory/team' }, { dir: join(source, 'bot', 'memory', 'team'), relative: 'memory-legacy/team' }]
        : [{ dir: join(source, 'memory', 'groups', id), relative: `memory/groups/${id}` }, { dir: join(source, 'bot', 'memory', 'groups', id), relative: `memory-legacy/groups/${id}` }]
      const found = candidates.find(candidate => existsSync(candidate.dir))
      if (!found) throw new CoreError('ARCHIVE_MAPPING', `The source has no ${scope} memory.`)
      const files = await listFiles(found.dir, limits, options.signal)
      mappedMemory.push({ scope, path: found.relative, files: files.map(file => file.path), digest: digestEntries(files) })
    }
    await writeFile(join(paths.staging, 'mapped-memory.json'), `${JSON.stringify(mappedMemory, null, 2)}\n`)
    const review = reviewItems(state, source)
    await writeFile(join(paths.staging, 'review.json'), `${JSON.stringify(review, null, 2)}\n`)
    const checksums: Record<string, string> = {}
    for (const entry of entries.entries) checksums[entry.path] = entry.digest
    for (const file of ['mapping.json', 'mapped-memory.json', 'review.json']) checksums[file] = hash(readFileSync(join(paths.staging, file)))
    for (const role of roles) checksums[`mapped-roles/${role.sourceBotId}.json`] = hash(readFileSync(join(paths.staging, 'mapped-roles', `${role.sourceBotId}.json`)))
    const manifest: LegacyArchiveManifest = {
      batchId: options.batchId, version: 1, status: 'prepared',
      source: { path: source, digest: sourceDigest, ...(typeof state.revision === 'number' ? { stateRevision: state.revision } : {}),
        identity: options.sourceIdentity ?? 'legacy-team', ...(options.profile === undefined ? {} : { profile: options.profile }) },
      mapping: options.mapping, mappingDigest,
      counts: { bots: Object.keys(state.bots as Record<string, unknown> ?? {}).length, rooms: Object.keys(state.rooms as Record<string, unknown> ?? {}).length,
        sessions: entries.sessions.length, missingSessions: entries.missing.length, invalidSessions: entries.invalid.length, reviewItems: review.length,
        files: entries.entries.length, bytes: entries.entries.reduce((sum, entry) => sum + entry.bytes, 0) },
      sessions: entries.sessions, missingSessions: entries.missing, invalidSessions: entries.invalid, review, roles, mappedMemory, include, checksums, limits, createdAt: Date.now(),
    }
    await writeManifest(paths.staging, manifest)
    return manifest
  } catch (error) {
    await rm(paths.staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function verifyLegacyArchive(targetInput: string, batchId: string): Promise<LegacyArchiveManifest> {
  assertBatchId(batchId)
  const target = resolve(targetInput)
  const paths = archivePaths(target, batchId)
  const manifest = readManifest(paths.staging)
  if (!manifest) throw new CoreError('ARCHIVE_NOT_FOUND', 'The prepared archive does not exist.')
  if (manifest.status === 'published') return manifest
  const errors: string[] = []
  if (manifest.missingSessions.length > 0) errors.push(`MISSING_HISTORY: ${manifest.missingSessions.join(', ')}`)
  if (manifest.invalidSessions.length > 0) errors.push(`INVALID_HISTORY: ${manifest.invalidSessions.map(item => `${item.id}:${item.reason}`).join(', ')}`)
  for (const [path, digest] of Object.entries(manifest.checksums)) {
    const file = join(paths.staging, path)
    const info = existsSync(file) ? lstatSync(file) : undefined
    const actual = info === undefined ? undefined : info.isSymbolicLink() ? hash(`link:${readlinkSync(file)}`) : hash(readFileSync(file))
    if (actual !== digest) errors.push(`COPY_MISMATCH: ${path}`)
  }
  const statePath = join(manifest.source.path, 'bot', 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
  const sourceEntriesNow = await sourceEntries(manifest.source.path, state, manifest.limits, manifest.include)
  if (digestEntries(sourceEntriesNow.entries) !== manifest.source.digest) errors.push('SOURCE_CHANGED')
  const next: LegacyArchiveManifest = { ...manifest, status: errors.length === 0 ? 'verified' : 'invalid', verifiedAt: Date.now(), ...(errors.length === 0 ? {} : { errors }) }
  await writeManifest(paths.staging, next)
  return next
}

export async function publishLegacyArchive(targetInput: string, batchId: string): Promise<LegacyArchiveManifest> {
  assertBatchId(batchId)
  const target = resolve(targetInput)
  const paths = archivePaths(target, batchId)
  let manifest = readManifest(paths.staging)
  if (!manifest) throw new CoreError('ARCHIVE_NOT_FOUND', 'The prepared archive does not exist.')
  const existing = readManifest(paths.final)
  if (existing) {
    if (existing.source.digest !== manifest.source.digest || existing.mappingDigest !== manifest.mappingDigest) throw new CoreError('ARCHIVE_CONFLICT', 'This batch already published different content.')
    return existing
  }
  if (manifest.status !== 'verified' && manifest.status !== 'published') throw new CoreError('ARCHIVE_NOT_VERIFIED', 'The archive must be verified before it is published.')
  if (manifest.status === 'verified') {
    manifest = await verifyLegacyArchive(target, batchId)
    if (manifest.status !== 'verified') throw new CoreError('ARCHIVE_NOT_VERIFIED', 'The archive changed after verification; it was not published.')
  }
  await mkdir(dirname(paths.final), { recursive: true })
  const published: LegacyArchiveManifest = manifest.status === 'published' ? manifest : { ...manifest, status: 'published', publishedAt: Date.now() }
  await writeManifest(paths.staging, published)
  try { await rename(paths.staging, paths.final) } catch (error) {
    const raced = readManifest(paths.final)
    if (raced) return raced
    throw error
  }
  return published
}

export function getLegacyArchive(targetInput: string, batchId: string): LegacyArchiveManifest | undefined {
  assertBatchId(batchId)
  return readManifest(join(resolve(targetInput), 'archives', batchId))
}

export function listLegacyArchives(targetInput: string): LegacyArchiveManifest[] {
  const root = join(resolve(targetInput), 'archives')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const manifest = readManifest(join(root, entry.name))
    return manifest === undefined ? [] : [manifest]
  }).sort((left, right) => (right.publishedAt ?? right.createdAt) - (left.publishedAt ?? left.createdAt))
}

export async function readLegacyObject(options: LegacyArchiveReadOptions) {
  assertBatchId(options.batchId)
  const target = resolve(options.target)
  const manifest = getLegacyArchive(target, options.batchId)
  if (!manifest) throw new CoreError('ARCHIVE_NOT_FOUND', 'The published archive does not exist.')
  const dir = join(target, 'archives', options.batchId)
  const offset = bounded(options.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const limit = bounded(options.limit, 64, 1, 1_024, 'limit')
  const [kind, ...rest] = options.ref.split(':')
  const id = rest.join(':')
  if (kind === 'bot' || kind === 'room') {
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as Record<string, unknown>
    const table = kind === 'bot' ? state.bots : state.rooms
    return { batchId: options.batchId, ref: options.ref, kind, data: (table as Record<string, unknown>)?.[id] }
  }
  if (kind === 'work' || kind === 'request' || kind === 'question' || kind === 'agent') {
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as Record<string, unknown>
    const table = { work: 'works', request: 'requests', question: 'questions', agent: 'agents' }[kind]
    return { batchId: options.batchId, ref: options.ref, kind, data: (state[table] as Record<string, unknown> | undefined)?.[id] }
  }
  if (kind === 'inflight') {
    const path = join(dir, 'review', 'inflight.json')
    if (!existsSync(path)) throw new CoreError('ARCHIVE_NOT_FOUND', 'The archive has no old inflight state.')
    return { batchId: options.batchId, ref: options.ref, kind, data: JSON.parse(readFileSync(path, 'utf8')) }
  }
  if (kind === 'role') {
    const path = join(dir, 'mapped-roles', `${id}.json`)
    if (!within(path, dir) || !existsSync(path)) throw new CoreError('ARCHIVE_NOT_FOUND', 'The mapped role does not exist.')
    return { batchId: options.batchId, ref: options.ref, kind, data: JSON.parse(readFileSync(path, 'utf8')) }
  }
  if (kind === 'review') {
    const item = manifest.review.find(review => review.id === id)
    return { batchId: options.batchId, ref: options.ref, kind, data: item }
  }
  if (kind === 'file' || kind === 'attachment') {
    const root = kind === 'file' ? join(dir, 'workspace') : join(dir, 'attachments')
    const path = join(root, id)
    if (!within(path, root) || !existsSync(path) || !lstatSync(path).isFile()) throw new CoreError('ARCHIVE_NOT_FOUND', 'The archived file does not exist.')
    const content = readFileSync(path)
    const page = content.subarray(offset, offset + limit * 1024)
    return { batchId: options.batchId, ref: options.ref, kind, offset, nextOffset: offset + page.length, hasMore: offset + page.length < content.length, sha256: hash(content), data: page.toString('utf8') }
  }
  if (kind === 'memory') {
    const root = [join(dir, 'memory'), join(dir, 'memory-legacy')].find(candidate => existsSync(join(candidate, id)))
    if (root === undefined) throw new CoreError('ARCHIVE_NOT_FOUND', 'The archived memory does not exist.')
    const path = join(root, id)
    if (!within(path, root) || !existsSync(path) || !lstatSync(path).isFile()) throw new CoreError('ARCHIVE_NOT_FOUND', 'The archived memory does not exist.')
    const content = readFileSync(path)
    const page = content.subarray(offset, offset + limit * 1024)
    const shared = manifest.mappedMemory.some(entry => {
      const relative = entry.path.replace(/^memory(-legacy)?\//u, '')
      return id === relative || id.startsWith(`${relative}/`)
    })
    return { batchId: options.batchId, ref: options.ref, kind, shared, offset, nextOffset: offset + page.length, hasMore: offset + page.length < content.length, sha256: hash(content), data: page.toString('utf8') }
  }
  if (kind === 'session') {
    const session = manifest.sessions.find(entry => entry.id === id)
    if (!session) throw new CoreError('ARCHIVE_NOT_FOUND', 'The archived Session does not exist.')
    const events: unknown[] = []
    for (const file of session.files) {
      const path = join(dir, 'sessions', session.group, session.id, file)
      if (!existsSync(path)) continue
      const match = sessionLog.exec(file)
      const text = decompress(file, match?.[2], readFileSync(path)).toString('utf8')
      for (const line of text.split(/\r?\n/u).filter(line => line.trim() !== '')) events.push(JSON.parse(line))
    }
    const page = events.slice(offset, offset + limit)
    return { batchId: options.batchId, ref: options.ref, kind, offset, nextOffset: offset + page.length, hasMore: offset + page.length < events.length, data: page }
  }
  throw new CoreError('ARCHIVE_INPUT', 'Use bot, room, role, review, file, attachment, memory or session references.')
}
