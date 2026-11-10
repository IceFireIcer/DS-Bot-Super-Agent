import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join, relative, resolve, matchesGlob, sep } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SkillRegistry, { isSkillName } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { canonicalJson } from './commands.js'
import { CoreError, identifier } from './model.js'
import { BoundedOutput, maxRemoteOutputBytes } from './remote-output.js'
import { assetNamespace, environmentAssetGaps, FileAssetStore, maxAssetBytes, maxAssetPageBytes, maxSpillBytes,
  UnsupportedEnvironmentCombination } from './environment-assets.js'
import { deriveSharedKey, exchangeKeyPair, exportPrivateKey, exportPublicKey, importPrivateKey, importPublicKey,
  openSealed, plainShape, publicKeyFingerprint, remoteProtocolVersion, sameSet, seal, signingKeyPair, signPairingResponse,
  validRemoteCommandSpec, validateRemoteJobId, remoteJobIdPrefix, verifyPairingProof, type KeyPairMaterial,
  type PairingTranscript, type RemoteCommandSpec,
  type RemoteJobRecovery, type RemoteOperation, type RemotePermission, type RemoteRequest } from './remote-protocol.js'
import { protectedPath } from './path-safety.js'
import { sanitizeSecrets } from './sanitize.js'
import { inspectWorkCopy } from './work-copy.js'

export type { RemotePermission } from './remote-protocol.js'

export interface RemoteDeviceGrant {
  instanceId: string
  environmentId: string
  allowedActorIds: string[]
  permissions: RemotePermission[]
}

export interface RemoteDeviceConfig {
  deviceId: string
  root: string
  grants: RemoteDeviceGrant[]
  commands?: Record<string, RemoteDeviceCommand>
  jobsPath?: string
  statePath?: string
  assetsPath?: string
  skillsPath?: string
  listenHost?: string
  advertiseHost?: string
  listenPort?: number
  pairingCode?: string
  pairingTtlMs?: number
}

/** A device-owned command. argv and environment never leave the device; the Host receives only names and limits. */
export interface RemoteDeviceCommand {
  argv: string[]
  timeoutMs: number
  backgroundTimeoutMs?: number
  env?: Record<string, string>
  pty?: boolean
}

export interface RemotePairingView {
  pairingId: string
  instanceId: string
  environmentId: string
  allowedActorIds: string[]
  permissions: RemotePermission[]
  pairedAt: number
  revokedAt?: number
}

interface PairingRecord {
  pairingId: string
  hostExchangeKey: string
  hostNonce: string
  instanceId: string
  environmentId: string
  allowedActorIds: string[]
  permissions: RemotePermission[]
  pairedAt: number
  revokedAt?: number
}

interface DeviceState {
  version: 1
  incarnation: string
  exchangePrivate: string
  exchangePublic: string
  signingPrivate: string
  signingPublic: string
  pairings: PairingRecord[]
}

interface RpcEnvelope {
  v: number
  pairingId: string
  requestId: string
  at: number
  body: string
}

const permissions = new Set<RemotePermission>(['read', 'write', 'search', 'command'])
const operationPermissions: Record<Exclude<RemoteOperation, 'status' | 'revoke'>, RemotePermission[]> = {
  'file.read': ['read'],
  'file.write': ['write'],
  'workcopy.inspect': ['read'],
  'file.glob': ['search'],
  'file.grep': ['read', 'search'],
  'file.artifact': ['read'],
  'file.readRange': ['read'],
  'asset.save': ['write'],
  'asset.read': ['read'],
  'skill.list': ['read'],
  'skill.get': ['read'],
  'command.resolve': ['command'],
  'command.start': ['command'],
  'command.inspect': ['command'],
  'command.cancel': ['command'],
  'command.spillInfo': ['command'],
  'command.spill': ['command'],
  'terminal.write': ['command'],
  'terminal.resize': ['command'],
}

type DeviceJobState = 'running' | 'stopping' | 'exited' | 'cancelled' | 'unknown'
const maxJobs = 64

interface DeviceProcessIdentity {
  kind: 'posix-proc' | 'pid'
  pid: number
  pgrp?: number
  startTime?: string
}

interface DeviceJob {
  id: string
  instanceId: string
  environmentId: string
  incarnation: string
  ownerId?: string
  rootIdentity: string
  name: string
  fingerprint: string
  kind: 'command' | 'terminal'
  state: DeviceJobState
  startedAt: number
  deadlineAt: number
  settled: boolean
  exitCode?: number | null
  signal?: string | null
  cancelled: boolean
  reason?: string
  pid?: number | undefined
  process?: DeviceProcessIdentity
  signalable: boolean
  recoveries: RemoteJobRecovery[]
  pty?: IPty
  rootExited: boolean
  stdout: BoundedOutput
  stderr: BoundedOutput
  stdoutSpillDropped: boolean
  stderrSpillDropped: boolean
  child?: ChildProcess
  timer?: ReturnType<typeof setTimeout> | undefined
  killTimer?: ReturnType<typeof setTimeout> | undefined
  monitorTimer?: ReturnType<typeof setTimeout> | undefined
  writes: Promise<void>
  persisting: Promise<void>
}

interface DeviceJobFile {
  version: 1 | 2
  id: string
  instanceId: string
  environmentId: string
  incarnation: string
  ownerId?: string
  rootIdentity?: string
  name: string
  fingerprint: string
  kind?: 'command' | 'terminal'
  state: DeviceJobState
  startedAt: number
  deadlineAt: number
  settled: boolean
  exitCode: number | null
  signal: string | null
  cancelled: boolean
  stdoutTotal?: number
  stderrTotal?: number
  stdoutSpillDropped?: boolean
  stderrSpillDropped?: boolean
  reason?: string
  pid?: number | null
  process?: DeviceProcessIdentity | null
  recoveries?: RemoteJobRecovery[]
}

function validateGrant(grant: RemoteDeviceGrant) {
  if (!grant || Object.keys(grant).some(key => !['instanceId', 'environmentId', 'allowedActorIds', 'permissions'].includes(key))) {
    throw new CoreError('INVALID_CONFIG', 'A device grant accepts instance, environment, actors and permissions only.')
  }
  identifier(grant.instanceId, 'grant instanceId')
  identifier(grant.environmentId, 'grant environmentId')
  if (!Array.isArray(grant.allowedActorIds) || !grant.allowedActorIds.length) throw new CoreError('INVALID_CONFIG', 'A device grant needs explicit actors.')
  for (const actor of grant.allowedActorIds) identifier(actor, 'grant actorId')
  if (!Array.isArray(grant.permissions) || !grant.permissions.length || new Set(grant.permissions).size !== grant.permissions.length
    || grant.permissions.some(permission => !permissions.has(permission))) {
    throw new CoreError('INVALID_CONFIG', 'A device grant needs distinct read, write or search permissions.')
  }
}

function validateCommandEntry(name: string, candidate: unknown) {
  identifier(name, 'command name')
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || Object.keys(candidate).some(key => !['argv', 'timeoutMs', 'backgroundTimeoutMs', 'env', 'pty'].includes(key))) {
    throw new CoreError('INVALID_CONFIG', 'Each device command accepts argv, deadlines and an explicit environment only.')
  }
  const command = candidate as RemoteDeviceCommand
  if (!Array.isArray(command.argv) || !command.argv[0] || command.argv.length > 64
    || command.argv.some(argument => typeof argument !== 'string' || argument.includes('\0') || Buffer.byteLength(argument) > 16384)) {
    throw new CoreError('INVALID_CONFIG', 'Device commands need a bounded fixed argv.')
  }
  if (!validRemoteCommandSpec(command)) {
    throw new CoreError('INVALID_CONFIG', 'A device command deadline must be between 50 and 10000 ms, and a background deadline between the foreground deadline and one hour.')
  }
  if (command.env !== undefined) {
    if (!command.env || typeof command.env !== 'object' || Array.isArray(command.env) || Object.keys(command.env).length > 32) {
      throw new CoreError('INVALID_CONFIG', 'A device command environment accepts at most 32 explicit entries.')
    }
    for (const [key, entry] of Object.entries(command.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof entry !== 'string' || entry.includes('\0') || Buffer.byteLength(entry) > 16384) {
        throw new CoreError('INVALID_CONFIG', 'A device command environment entry is malformed.')
      }
    }
  }
  return structuredClone(command)
}

function validateCommands(value: unknown): Record<string, RemoteDeviceCommand> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) {
    throw new CoreError('INVALID_CONFIG', 'A device accepts at most sixteen configured commands.')
  }
  const commands = Object.fromEntries(Object.entries(value).map(([name, candidate]) => [name, validateCommandEntry(name, candidate)]))
  for (const command of Object.values(commands)) Object.freeze(command.argv)
  return commands
}

function childEnvironment(explicit: Record<string, string> | undefined) {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^DSH_/iu.test(key) || /(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|authorization|cookie)/iu.test(key)) continue
    base[key] = value
  }
  const merged = { ...base, ...explicit }
  const path = explicit?.PATH ?? explicit?.Path ?? process.env.PATH
  const pathExt = explicit?.PATHEXT ?? explicit?.PathExt ?? process.env.PATHEXT
  for (const key of Object.keys(merged)) {
    if (key.toUpperCase() === 'PATH' || key.toUpperCase() === 'PATHEXT') delete merged[key]
  }
  if (path !== undefined) merged.PATH = path
  if (pathExt !== undefined) merged.PATHEXT = pathExt
  return merged
}

async function readBody(request: IncomingMessage, limit: number) {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new CoreError('INVALID_INPUT', 'The device request exceeds its input budget.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new CoreError('INVALID_INPUT', 'The device request must be JSON.') }
}

async function readPrefix(path: string, limit: number) {
  const handle = await open(path, 'r')
  try {
    const observed = await handle.stat()
    const length = Math.min(observed.size, limit)
    const buffer = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = await handle.read(buffer, offset, length - offset, offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    return buffer.subarray(0, offset)
  } finally { await handle.close() }
}

async function readTail(path: string | undefined) {
  if (!path) return { buffer: Buffer.alloc(0), size: 0 }
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const observed = await handle.stat()
    const length = Math.min(observed.size, maxRemoteOutputBytes)
    const buffer = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = await handle.read(buffer, offset, length - offset, observed.size - length + offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    return { buffer: buffer.subarray(0, offset), size: observed.size }
  } catch {
    return { buffer: Buffer.alloc(0), size: 0 }
  } finally {
    await handle?.close()
  }
}

function parseOffset(value: string | undefined) {
  if (value === undefined) return 0
  if (!/^\d+$/u.test(value)) throw new CoreError('INVALID_INPUT', 'Output offsets must be nonnegative integers.')
  const offset = Number(value)
  if (!Number.isSafeInteger(offset)) throw new CoreError('INVALID_INPUT', 'Output offsets must be safe integers.')
  return offset
}

function parseDimension(value: string | undefined, label: string) {
  if (!value || !/^\d+$/u.test(value)) throw new CoreError('INVALID_INPUT', `Terminal ${label} must be a positive integer.`)
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size < 1 || size > 500) throw new CoreError('INVALID_INPUT', `Terminal ${label} must be between 1 and 500.`)
  return size
}

function parseTerminalType(value: string | undefined) {
  if (value === undefined) return 'xterm-256color'
  if (!value.trim() || Buffer.byteLength(value) > 64 || /\s/u.test(value) || value.includes('\0')) {
    throw new CoreError('INVALID_INPUT', 'The terminal type is malformed.')
  }
  return value
}

async function procIdentity(pid: number): Promise<{ pgrp: number; startTime: string } | 'gone' | 'unknown'> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const end = stat.lastIndexOf(')')
    if (end < 0) return 'unknown'
    const fields = stat.slice(end + 2).trim().split(/\s+/u)
    const pgrp = Number(fields[2])
    const startTime = fields[19]
    if (!Number.isSafeInteger(pgrp) || !startTime || !/^\d+$/u.test(startTime)) return 'unknown'
    return { pgrp, startTime }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'unknown'
  }
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function groupAlive(pid: number) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isRecovery(value: unknown): value is RemoteJobRecovery {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as RemoteJobRecovery).observedAt === 'number'
    && ['live-process', 'log-only', 'identity-changed', 'unverifiable'].includes((value as RemoteJobRecovery).kind)
    && ['alive', 'gone', 'unknown'].includes((value as RemoteJobRecovery).processAlive)
    && ['alive', 'gone', 'unknown'].includes((value as RemoteJobRecovery).rangeAlive)
    && ['posix-proc', 'pid', 'none'].includes((value as RemoteJobRecovery).rangeEvidence)
    && typeof (value as RemoteJobRecovery).reason === 'string'
}

export class RemoteDevice {
  readonly deviceId: string
  readonly deviceKeyFingerprint: string
  readonly pairingCode: string
  readonly pairingExpiresAt: number
  private readonly root: string
  private readonly grants: RemoteDeviceGrant[]
  private readonly commands: Record<string, RemoteDeviceCommand>
  private readonly jobsPath: string | undefined
  private readonly statePath: string | undefined
  private readonly assetsPath: string | undefined
  private readonly assetStores = new Map<string, FileAssetStore>()
  private skillsContext: Context | undefined
  private readonly listenHost: string
  private readonly advertiseHost: string | undefined
  private readonly listenPort: number
  private readonly pairingTtlMs: number
  private identity: KeyPairMaterial
  private signing: KeyPairMaterial
  private incarnation = ''
  private pairings = new Map<string, PairingRecord>()
  private server: ReturnType<typeof createServer> | undefined
  private pairingConsumed = false
  private readonly pairingAttempts: number[] = []
  private readonly seenRequests = new Map<string, number>()
  private readonly jobs = new Map<string, DeviceJob>()
  private rootIdentity = ''

  private constructor(config: Required<Pick<RemoteDeviceConfig, 'deviceId' | 'root' | 'grants'>> & RemoteDeviceConfig,
    state: DeviceState | undefined) {
    this.deviceId = config.deviceId
    this.root = config.root
    this.grants = structuredClone(config.grants)
    this.commands = config.commands ?? {}
    this.jobsPath = config.jobsPath
    this.statePath = config.statePath
    this.assetsPath = config.assetsPath
    this.listenHost = config.listenHost ?? '127.0.0.1'
    this.advertiseHost = config.advertiseHost
    this.listenPort = config.listenPort ?? 0
    this.pairingTtlMs = config.pairingTtlMs ?? 10 * 60_000
    this.pairingCode = config.pairingCode ?? String(randomInt(0, 100_000_000)).padStart(8, '0')
    this.pairingExpiresAt = Date.now() + this.pairingTtlMs
    this.identity = state ? { privateKey: importPrivateKey(state.exchangePrivate), publicKey: importPublicKey(state.exchangePublic) } : exchangeKeyPair()
    this.signing = state ? { privateKey: importPrivateKey(state.signingPrivate), publicKey: importPublicKey(state.signingPublic) } : signingKeyPair()
    this.incarnation = state?.incarnation ?? randomUUID()
    this.deviceKeyFingerprint = publicKeyFingerprint(this.signing.publicKey)
    for (const pairing of state?.pairings ?? []) this.pairings.set(pairing.pairingId, structuredClone(pairing))
  }

  static async open(config: RemoteDeviceConfig): Promise<RemoteDevice> {
    const cloned = structuredClone(config)
    if (!cloned || Object.keys(cloned).some(key => !['deviceId', 'root', 'grants', 'commands', 'jobsPath', 'statePath', 'assetsPath', 'skillsPath', 'listenHost', 'advertiseHost',
      'listenPort', 'pairingCode', 'pairingTtlMs'].includes(key))) {
      throw new CoreError('INVALID_CONFIG', 'A remote device accepts device, root, grants, state and listener options only.')
    }
    identifier(cloned.deviceId, 'deviceId')
    if (typeof cloned.root !== 'string' || !isAbsolute(cloned.root)) throw new CoreError('INVALID_CONFIG', 'The device working directory must be absolute.')
    if (!Array.isArray(cloned.grants) || !cloned.grants.length) throw new CoreError('INVALID_CONFIG', 'A remote device needs at least one grant.')
    for (const grant of cloned.grants) validateGrant(grant)
    const commands = validateCommands(cloned.commands)
    const commandNames = Object.keys(commands)
    if (commandNames.length && !cloned.jobsPath) {
      throw new CoreError('INVALID_CONFIG', 'Configured device commands require a durable jobsPath.')
    }
    if ((commandNames.length || cloned.jobsPath) && !cloned.statePath) {
      throw new CoreError('INVALID_CONFIG', 'Recoverable device jobs require a durable statePath for the device incarnation and pairings.')
    }
    for (const grant of cloned.grants) {
      if (grant.permissions.includes('command') && !commandNames.length) {
        throw new CoreError('INVALID_CONFIG', 'A command grant needs at least one configured command.')
      }
    }
    if (cloned.statePath !== undefined) {
      if (!isAbsolute(cloned.statePath)) throw new CoreError('INVALID_CONFIG', 'The device state path must be absolute.')
      const insideRoot = relative(await realpath(cloned.root), cloned.statePath)
      if (!insideRoot.startsWith('..') && !isAbsolute(insideRoot)) throw new CoreError('INVALID_CONFIG', 'Device key state cannot live inside the exposed working directory.')
    }
    if (cloned.assetsPath !== undefined) {
      if (!isAbsolute(cloned.assetsPath)) throw new CoreError('INVALID_CONFIG', 'The device asset path must be absolute.')
      const insideRoot = relative(await realpath(cloned.root), cloned.assetsPath)
      if (!insideRoot.startsWith('..') && !isAbsolute(insideRoot)) {
        throw new CoreError('INVALID_CONFIG', 'Device assets cannot live inside the exposed working directory.')
      }
      await mkdir(cloned.assetsPath, { recursive: true, mode: 0o700 })
    }
    if (cloned.skillsPath !== undefined) {
      if (!isAbsolute(cloned.skillsPath)) throw new CoreError('INVALID_CONFIG', 'The device skill path must be absolute.')
      await mkdir(cloned.skillsPath, { recursive: true, mode: 0o700 })
    }
    if (cloned.jobsPath !== undefined) {
      if (!isAbsolute(cloned.jobsPath)) throw new CoreError('INVALID_CONFIG', 'The device jobs path must be absolute.')
      const insideRoot = relative(await realpath(cloned.root), cloned.jobsPath)
      if (!insideRoot.startsWith('..') && !isAbsolute(insideRoot)) {
        throw new CoreError('INVALID_CONFIG', 'Device job records cannot live inside the exposed working directory.')
      }
      await mkdir(cloned.jobsPath, { recursive: true, mode: 0o700 })
    }
    if (cloned.pairingCode !== undefined && !/^\d{8}$/u.test(cloned.pairingCode)) throw new CoreError('INVALID_CONFIG', 'A pairing code must be eight digits.')
    if (cloned.pairingTtlMs !== undefined && (!Number.isInteger(cloned.pairingTtlMs) || cloned.pairingTtlMs < 30_000 || cloned.pairingTtlMs > 60 * 60_000)) {
      throw new CoreError('INVALID_CONFIG', 'A pairing code lifetime must be between 30 seconds and one hour.')
    }
    if (cloned.listenPort !== undefined && (!Number.isInteger(cloned.listenPort) || cloned.listenPort < 0 || cloned.listenPort > 65535)) {
      throw new CoreError('INVALID_CONFIG', 'The listener port must be between 0 and 65535.')
    }
    if (cloned.advertiseHost !== undefined && (!cloned.advertiseHost.trim() || Buffer.byteLength(cloned.advertiseHost) > 255
      || /[\s/\\]/u.test(cloned.advertiseHost))) {
      throw new CoreError('INVALID_CONFIG', 'The advertised device host must be a bounded hostname or IP address.')
    }
    const root = await realpath(cloned.root)
    if (!(await stat(root)).isDirectory()) throw new CoreError('INVALID_CONFIG', 'The device working directory must be a real directory.')
    let state: DeviceState | undefined
    if (cloned.statePath !== undefined) {
      try { state = JSON.parse(await readFile(cloned.statePath, 'utf8')) as DeviceState }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CoreError('SETUP_FAILED', 'The device state must be readable JSON.')
      }
      if (state && (state.version !== 1 || typeof state.incarnation !== 'string' || !Array.isArray(state.pairings))) {
        throw new CoreError('SETUP_FAILED', 'The device state has an unsupported format.')
      }
    }
    const observed = await stat(root, { bigint: true })
    if (!observed.isDirectory() || observed.ino === 0n) throw new CoreError('INVALID_CONFIG', 'A stable device working directory identity is required.')
    const device = new RemoteDevice({ ...cloned, root, commands }, state)
    device.rootIdentity = `${observed.dev}:${observed.ino}:${observed.birthtimeNs}`
    await device.loadJobs()
    if (!state) await device.persist()
    if (cloned.skillsPath) {
      const context = new Context()
      try {
        await context.plugin(LocalFileSystem, { cwd: root })
        await context.plugin(SkillRegistry)
        context.skills.registerProvider(control => new FileSystemSkillProvider(context, control,
          { includeDefaultRoots: false, customSkillDirs: [cloned.skillsPath!], watch: false }))
        device.skillsContext = context
      } catch {
        await context.fiber.dispose()
        throw new CoreError('SETUP_FAILED', 'The device skill provider could not be mounted.')
      }
    }
    return device
  }

  private async persist() {
    if (!this.statePath) return
    const state: DeviceState = { version: 1, incarnation: this.incarnation, exchangePrivate: exportPrivateKey(this.identity.privateKey),
      exchangePublic: exportPublicKey(this.identity.publicKey), signingPrivate: exportPrivateKey(this.signing.privateKey),
      signingPublic: exportPublicKey(this.signing.publicKey), pairings: [...this.pairings.values()] }
    const temporary = `${this.statePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await rename(temporary, this.statePath)
  }

  private jobFile(jobId: string, extension: string) {
    if (!this.jobsPath) return undefined
    return join(this.jobsPath, `${createHash('sha256').update(jobId).digest('hex')}${extension}`)
  }

  private async persistJob(job: DeviceJob) {
    const file = this.jobFile(job.id, '.json')
    if (!file) return
    const write = async () => {
      const state: DeviceJobFile = { version: 2, id: job.id, instanceId: job.instanceId, environmentId: job.environmentId,
        incarnation: job.incarnation, ...(job.ownerId === undefined ? {} : { ownerId: job.ownerId }), rootIdentity: job.rootIdentity,
        name: job.name, fingerprint: job.fingerprint, kind: job.kind, state: job.state, startedAt: job.startedAt,
        deadlineAt: job.deadlineAt, settled: job.settled, exitCode: job.exitCode ?? null, signal: job.signal ?? null,
        cancelled: job.cancelled, stdoutTotal: job.stdout.nextOffset, stderrTotal: job.stderr.nextOffset,
        ...(job.stdoutSpillDropped ? { stdoutSpillDropped: true } : {}), ...(job.stderrSpillDropped ? { stderrSpillDropped: true } : {}),
        pid: job.pid ?? null, process: job.process ?? null, recoveries: job.recoveries.slice(-8),
        ...(job.reason ? { reason: job.reason } : {}) }
      const temporary = `${file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
      await rename(temporary, file)
    }
    job.persisting = job.persisting.then(write, write)
    await job.persisting
  }

  private async ensureJobFiles(job: DeviceJob) {
    for (const extension of ['.out', '.err']) {
      const file = this.jobFile(job.id, extension)
      if (file) await writeFile(file, Buffer.alloc(0), { mode: 0o600 })
    }
  }

  private async loadJobs() {
    if (!this.jobsPath) return
    for (const name of await readdir(this.jobsPath)) {
      if (!name.endsWith('.json')) continue
      const file = join(this.jobsPath, name)
      let value: unknown
      try { value = JSON.parse(await readFile(file, 'utf8')) } catch { continue }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const candidate = value as Record<string, unknown>
      if (candidate.version !== 1 && candidate.version !== 2) continue
      if (typeof candidate.id !== 'string' || typeof candidate.instanceId !== 'string' || typeof candidate.environmentId !== 'string'
        || typeof candidate.incarnation !== 'string' || typeof candidate.name !== 'string' || typeof candidate.fingerprint !== 'string'
        || candidate.kind !== undefined && candidate.kind !== 'command' && candidate.kind !== 'terminal'
        || !['running', 'stopping', 'exited', 'cancelled', 'unknown'].includes(candidate.state as string)
        || typeof candidate.startedAt !== 'number' || typeof candidate.deadlineAt !== 'number' || typeof candidate.settled !== 'boolean'
        || candidate.exitCode !== null && typeof candidate.exitCode !== 'number' || candidate.signal !== null && typeof candidate.signal !== 'string'
        || typeof candidate.cancelled !== 'boolean'
        || candidate.stdoutTotal !== undefined && typeof candidate.stdoutTotal !== 'number'
        || candidate.stderrTotal !== undefined && typeof candidate.stderrTotal !== 'number'
        || candidate.reason !== undefined && typeof candidate.reason !== 'string') continue
      const ownerId = candidate.version === 2 && typeof candidate.ownerId === 'string' ? candidate.ownerId : undefined
      const rootIdentity = candidate.version === 2 && typeof candidate.rootIdentity === 'string' ? candidate.rootIdentity : ''
      const pid = candidate.pid === null || candidate.pid === undefined ? undefined
        : typeof candidate.pid === 'number' && Number.isSafeInteger(candidate.pid) && candidate.pid > 0 ? candidate.pid : undefined
      const processValue = candidate.process
      const process = processValue && typeof processValue === 'object' && !Array.isArray(processValue)
        && ((processValue as DeviceProcessIdentity).kind === 'posix-proc' || (processValue as DeviceProcessIdentity).kind === 'pid')
        && Number.isSafeInteger((processValue as DeviceProcessIdentity).pid)
        ? processValue as DeviceProcessIdentity : undefined
      const recoveries = Array.isArray(candidate.recoveries) ? candidate.recoveries.filter(isRecovery) : []
      const record: DeviceJobFile = { version: candidate.version as 1 | 2, id: candidate.id as string,
        instanceId: candidate.instanceId as string, environmentId: candidate.environmentId as string,
        incarnation: candidate.incarnation as string, rootIdentity, name: candidate.name as string,
        fingerprint: candidate.fingerprint as string,
        state: candidate.state as DeviceJobState, startedAt: candidate.startedAt as number, deadlineAt: candidate.deadlineAt as number,
        settled: candidate.settled as boolean, exitCode: candidate.exitCode as number | null,
        signal: candidate.signal as string | null, cancelled: candidate.cancelled as boolean,
        recoveries, ...(ownerId === undefined ? {} : { ownerId }),
        ...(candidate.kind === 'command' || candidate.kind === 'terminal' ? { kind: candidate.kind } : {}),
        ...(typeof candidate.stdoutTotal === 'number' ? { stdoutTotal: candidate.stdoutTotal } : {}),
        ...(typeof candidate.stderrTotal === 'number' ? { stderrTotal: candidate.stderrTotal } : {}),
        ...(candidate.stdoutSpillDropped === true ? { stdoutSpillDropped: true } : {}),
        ...(candidate.stderrSpillDropped === true ? { stderrSpillDropped: true } : {}),
        ...(typeof candidate.reason === 'string' ? { reason: candidate.reason } : {}),
        ...(pid !== undefined ? { pid } : {}), ...(process ? { process } : {}) }
      const stdout = await readTail(this.jobFile(record.id, '.out'))
      const stderr = await readTail(this.jobFile(record.id, '.err'))
      const restarted = record.state === 'running' || record.state === 'stopping'
      const recovery = restarted ? await this.recoveryFor(record) : undefined
      const live = recovery?.kind === 'live-process'
      const reason = restarted ? recovery!.reason : record.reason
      const job: DeviceJob = { id: record.id, instanceId: record.instanceId, environmentId: record.environmentId,
        incarnation: record.incarnation, rootIdentity, name: record.name, fingerprint: record.fingerprint,
        kind: record.kind ?? 'command', state: live ? record.cancelled || record.state === 'stopping' ? 'stopping' : 'running'
          : restarted ? 'unknown' : record.state,
        startedAt: record.startedAt, deadlineAt: record.deadlineAt,
        settled: restarted ? !live && recovery!.rangeAlive === 'gone' : record.settled,
        exitCode: record.exitCode, signal: record.signal, cancelled: record.cancelled, ...(reason ? { reason } : {}),
        recoveries: live ? [...recoveries.slice(-7), recovery!] : recoveries,
        ...(ownerId === undefined ? {} : { ownerId }),
        ...(pid !== undefined && (live || recovery?.rangeAlive === 'alive') ? { pid } : {}),
        ...(process && (live || recovery?.rangeAlive === 'alive') ? { process } : {}),
        signalable: live,
        rootExited: restarted ? false : record.settled,
        stdout: BoundedOutput.load(stdout.buffer, Math.max(stdout.size, record.stdoutTotal ?? 0)),
        stderr: BoundedOutput.load(stderr.buffer, Math.max(stderr.size, record.stderrTotal ?? 0)),
        stdoutSpillDropped: record.stdoutSpillDropped === true,
        stderrSpillDropped: record.stderrSpillDropped === true,
        writes: Promise.resolve(), persisting: Promise.resolve() }
      this.jobs.set(job.id, job)
      if (restarted) {
        if (!live) job.recoveries = [...recoveries.slice(-7), recovery!]
        await this.persistJob(job)
        if (live) this.resumeRecoveredJob(job)
        else if (job.pid && recovery!.rangeAlive === 'alive') this.monitorUnverifiableJob(job)
      }
    }
  }

  private async pruneJobs() {
    if (this.jobs.size < maxJobs) return
    for (const [id, job] of this.jobs) {
      if (!job.settled) continue
      this.jobs.delete(id)
      for (const extension of ['.json', '.out', '.err']) {
        const file = this.jobFile(id, extension)
        if (file) await rm(file, { force: true })
      }
      if (this.jobs.size < maxJobs) return
    }
    if (this.jobs.size >= maxJobs) throw new CoreError('JOB_BUDGET', 'The device already retains its declared number of jobs.')
  }

  private async processIdentityFor(pid: number): Promise<DeviceProcessIdentity> {
    if (process.platform !== 'win32') {
      const observed = await procIdentity(pid)
      if (observed !== 'gone' && observed !== 'unknown') {
        return { kind: 'posix-proc', pid, pgrp: observed.pgrp, startTime: observed.startTime }
      }
    }
    return { kind: 'pid', pid }
  }

  /**
   * A restarted daemon can prove only what it observes now. A matching POSIX start time and
   * process group restores control of the original range; a weak PID-only signal is retained
   * as evidence but does not claim that output from the old pipe is still observable.
   */
  private async recoveryFor(record: DeviceJobFile): Promise<RemoteJobRecovery> {
    const observedAt = Date.now()
    if (record.rootIdentity && record.rootIdentity !== this.rootIdentity) {
      return { observedAt, kind: 'identity-changed', processAlive: 'unknown', rangeAlive: 'unknown',
        rangeEvidence: 'none', reason: 'The device working directory identity changed; the original range cannot be recovered here.' }
    }
    if (!record.pid || !record.process || record.process.pid !== record.pid) {
      return { observedAt, kind: 'unverifiable', processAlive: 'unknown', rangeAlive: 'unknown',
        rangeEvidence: 'none', reason: 'The job record has no process identity that this daemon can verify.' }
    }
    if (record.process.kind === 'posix-proc') {
      const current = await procIdentity(record.pid)
      if (current === 'unknown') {
        return { observedAt, kind: 'unverifiable', processAlive: 'unknown', rangeAlive: 'unknown',
          rangeEvidence: 'posix-proc', reason: 'The device could not read the original process identity.' }
      }
      if (current === 'gone') {
        if (groupAlive(record.pid)) {
          return { observedAt, kind: 'unverifiable', processAlive: 'gone', rangeAlive: 'alive',
            rangeEvidence: 'posix-proc', reason: 'The original process leader is gone but a process group with its ID is still present; the range cannot be attributed safely.' }
        }
        return { observedAt, kind: 'log-only', processAlive: 'gone', rangeAlive: 'gone',
          rangeEvidence: 'posix-proc', reason: 'The original process is gone; only its durable log and exit-unknown record remain.' }
      }
      if (current.startTime !== record.process.startTime || current.pgrp !== record.process.pgrp) {
        if (groupAlive(record.pid)) {
          return { observedAt, kind: 'unverifiable', processAlive: 'unknown', rangeAlive: 'alive',
            rangeEvidence: 'posix-proc', reason: 'The process ID now belongs to a different process; its group is not attributable to this job.' }
        }
        return { observedAt, kind: 'log-only', processAlive: 'gone', rangeAlive: 'gone',
          rangeEvidence: 'posix-proc', reason: 'The original process identity is gone; only its durable log and exit-unknown record remain.' }
      }
      const alive = groupAlive(record.pid)
      return alive
        ? { observedAt, kind: 'live-process', processAlive: 'alive', rangeAlive: 'alive',
          rangeEvidence: 'posix-proc', reason: 'The matching POSIX process identity and group are still alive; only the durable output written before the restart is observable.' }
        : { observedAt, kind: 'log-only', processAlive: 'alive', rangeAlive: 'gone',
          rangeEvidence: 'posix-proc', reason: 'The original process exists but its managed group is quiet; only the durable log remains.' }
    }
    const alive = pidAlive(record.pid)
    return alive
      ? { observedAt, kind: 'unverifiable', processAlive: 'alive', rangeAlive: 'alive',
        rangeEvidence: 'pid', reason: 'A process with the original PID is alive, but this platform cannot prove its start time; it is observed but never signalled.' }
      : { observedAt, kind: 'log-only', processAlive: 'gone', rangeAlive: 'gone',
        rangeEvidence: 'pid', reason: 'The original PID is gone; only its durable log and exit-unknown record remain.' }
  }

  private resumeRecoveredJob(job: DeviceJob) {
    const tick = async () => {
      if (job.settled) return
      if (await this.rangeEmpty(job)) {
        job.settled = true
        job.state = job.cancelled ? 'cancelled' : 'unknown'
        if (!job.cancelled) job.reason = 'recovered-process-ended'
        await this.finishJob(job)
        return
      }
      if (!job.cancelled && Date.now() >= job.deadlineAt) this.requestStop(job, 'deadline')
      job.monitorTimer = setTimeout(() => { void tick() }, 250)
      job.monitorTimer.unref()
    }
    if (job.cancelled || job.state === 'stopping') this.requestStop(job, job.reason ?? 'recovered-stop')
    else if (Date.now() >= job.deadlineAt) this.requestStop(job, 'deadline')
    else {
      job.timer = setTimeout(() => this.requestStop(job, 'deadline'), Math.max(1, job.deadlineAt - Date.now()))
      job.timer.unref()
    }
    void tick()
  }

  private monitorUnverifiableJob(job: DeviceJob) {
    const tick = async () => {
      if (job.settled) return
      if (await this.rangeEmpty(job)) {
        job.settled = true
        job.state = 'unknown'
        job.reason = 'unverifiable-range-ended'
        await this.finishJob(job)
        return
      }
      job.monitorTimer = setTimeout(() => { void tick() }, 1000)
      job.monitorTimer.unref()
    }
    void tick()
  }

  async start(): Promise<string> {
    if (this.server) throw new CoreError('INVALID_STATE', 'The device is already listening.')
    if ((this.listenHost === '0.0.0.0' || this.listenHost === '::') && !this.advertiseHost) {
      throw new CoreError('ADVERTISE_REQUIRED', 'A wildcard listener needs an explicit reachable advertiseHost.')
    }
    const server = createServer((request, response) => { void this.handle(request, response) })
    server.requestTimeout = 15_000
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.listenPort, this.listenHost, resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') { server.close(); throw new CoreError('SETUP_FAILED', 'The device did not bind a TCP port.') }
    this.server = server
    return `http://${this.advertiseHost ?? this.listenHost}:${address.port}`
  }

  async close() {
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
    const active = [...this.jobs.values()].filter(job => !job.settled)
    for (const job of active) this.requestStop(job, 'device-shutdown')
    await Promise.all(active.map(job => this.waitForSettled(job, 5000)))
    await Promise.all([...this.jobs.values()].map(job => job.writes.catch(() => {})))
    await Promise.all([...this.jobs.values()].map(job => this.persistJob(job).catch(() => {})))
    await this.skillsContext?.fiber.dispose().catch(() => {})
    this.skillsContext = undefined
  }

  listPairings(): RemotePairingView[] {
    return [...this.pairings.values()].map(pairing => ({ pairingId: pairing.pairingId, instanceId: pairing.instanceId,
      environmentId: pairing.environmentId, allowedActorIds: [...pairing.allowedActorIds],
      permissions: [...pairing.permissions], pairedAt: pairing.pairedAt, ...(pairing.revokedAt ? { revokedAt: pairing.revokedAt } : {}) }))
  }

  async revokePairing(pairingId: string) {
    identifier(pairingId, 'pairingId')
    const pairing = this.pairings.get(pairingId)
    if (!pairing) throw new CoreError('NOT_FOUND', 'The device pairing does not exist.')
    if (!pairing.revokedAt) {
      pairing.revokedAt = Date.now()
      await this.persist()
    }
    return { pairingId, revokedAt: pairing.revokedAt }
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json') {
        response.writeHead(404).end(JSON.stringify({ code: 'NOT_FOUND', message: 'Device route not found.' })); return
      }
      if (request.url === '/pair') { await this.pair(request, response); return }
      if (request.url === '/rpc') { await this.rpc(request, response); return }
      response.writeHead(404).end(JSON.stringify({ code: 'NOT_FOUND', message: 'Device route not found.' }))
    } catch (error) {
      const code = error instanceof CoreError ? error.code : 'DEVICE_FAILED'
      response.writeHead(code === 'INVALID_INPUT' ? 400 : code === 'PAIRING_LOCKED' ? 429 : 401)
        .end(JSON.stringify({ code, message: error instanceof CoreError && code !== 'DEVICE_AUTH_FAILED' ? error.message : 'The device rejected this request.' }))
    }
  }

  private async pair(request: IncomingMessage, response: ServerResponse) {
    const now = Date.now()
    while (this.pairingAttempts.length && this.pairingAttempts[0]! < now - 60_000) this.pairingAttempts.shift()
    if (this.pairingAttempts.length >= 5) throw new CoreError('PAIRING_LOCKED', 'Too many pairing attempts; try again later.')
    this.pairingAttempts.push(now)
    if (this.pairingConsumed || now > this.pairingExpiresAt) throw new CoreError('PAIRING_DENIED', 'The pairing code is no longer valid.')
    const body = await readBody(request, 16_384)
    if (!plainShape(body, ['v', 'transcript', 'proof']) || body.v !== remoteProtocolVersion || typeof body.proof !== 'string') {
      throw new CoreError('INVALID_INPUT', 'The pairing request is malformed.')
    }
    const transcript = body.transcript as PairingTranscript
    if (!plainShape(transcript, ['v', 'instanceId', 'environmentId', 'allowedActorIds', 'permissions', 'hostExchangeKey', 'hostNonce', 'expectedDeviceId'])
      || transcript.v !== remoteProtocolVersion || !Array.isArray(transcript.allowedActorIds) || !Array.isArray(transcript.permissions)
      || transcript.expectedDeviceId !== this.deviceId) {
      throw new CoreError('DEVICE_IDENTITY_MISMATCH', 'The device identity does not match the pairing request.')
    }
    if (!verifyPairingProof(this.pairingCode, transcript, body.proof)) throw new CoreError('PAIRING_DENIED', 'The pairing code is invalid.')
    const grant = this.grants.find(candidate => candidate.instanceId === transcript.instanceId && candidate.environmentId === transcript.environmentId)
    if (!grant || !sameSet(grant.allowedActorIds, transcript.allowedActorIds) || !sameSet(grant.permissions, transcript.permissions)) {
      throw new CoreError('GRANT_DENIED', 'This Instance, Environment and permission set is not granted to the host.')
    }
    const hostExchangeKey = importPublicKey(transcript.hostExchangeKey)
    const key = deriveSharedKey(this.identity.privateKey, hostExchangeKey, transcript)
    const pairingId = randomUUID()
    const pairing: PairingRecord = { pairingId, hostExchangeKey: transcript.hostExchangeKey, hostNonce: transcript.hostNonce, instanceId: transcript.instanceId,
      environmentId: transcript.environmentId, allowedActorIds: [...grant.allowedActorIds].sort(), permissions: [...grant.permissions].sort(), pairedAt: now }
    const exchangeKey = exportPublicKey(this.identity.publicKey)
    const sealed = seal(key, { deviceId: this.deviceId, incarnation: this.incarnation, root: this.root, instanceId: transcript.instanceId,
      environmentId: transcript.environmentId, allowedActorIds: pairing.allowedActorIds, permissions: pairing.permissions,
      assets: this.assetsPath ? { maxBytes: maxAssetBytes, spillBytes: maxSpillBytes } : null,
      skills: this.skillsContext ? { supported: true } : null,
      commands: this.commandSpecs(), pairedAt: now }, transcript)
    const signature = signPairingResponse(this.signing.privateKey, transcript, exchangeKey, sealed)
    this.pairings.set(pairingId, pairing)
    try { await this.persist() }
    catch (error) {
      this.pairings.delete(pairingId)
      throw error
    }
    this.pairingConsumed = true
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({
      v: remoteProtocolVersion, pairingId, deviceId: this.deviceId, signingKey: exportPublicKey(this.signing.publicKey),
      exchangeKey, signature, sealed,
    }))
  }

  private async rpc(request: IncomingMessage, response: ServerResponse) {
    const body = await readBody(request, 131_072)
    if (!plainShape(body, ['v', 'pairingId', 'requestId', 'at', 'body']) || body.v !== remoteProtocolVersion
      || typeof body.pairingId !== 'string' || typeof body.requestId !== 'string' || typeof body.at !== 'number' || typeof body.body !== 'string') {
      throw new CoreError('DEVICE_AUTH_FAILED', 'The protected request is malformed.')
    }
    const envelope = body as unknown as RpcEnvelope
    const now = Date.now()
    if (Math.abs(now - envelope.at) > 60_000) throw new CoreError('DEVICE_AUTH_FAILED', 'The protected request has expired.')
    for (const [id, seenAt] of this.seenRequests) if (seenAt < now - 120_000) this.seenRequests.delete(id)
    if (this.seenRequests.has(envelope.requestId)) throw new CoreError('DEVICE_AUTH_FAILED', 'The protected request was already used.')
    this.seenRequests.set(envelope.requestId, now)
    if (this.seenRequests.size > 2048) this.seenRequests.delete(this.seenRequests.keys().next().value!)
    const pairing = this.pairings.get(envelope.pairingId)
    if (!pairing || pairing.revokedAt) throw new CoreError('DEVICE_REVOKED', 'This host connection is not active.')
    const requestKey = this.requestKey(pairing)
    const requestBody = openSealed(requestKey, envelope.body, { v: remoteProtocolVersion, pairingId: pairing.pairingId,
      requestId: envelope.requestId, at: envelope.at })
    if (!plainShape(requestBody, ['instanceId', 'environmentId', 'actorId', 'operation', 'args'])
      || typeof requestBody.instanceId !== 'string' || typeof requestBody.environmentId !== 'string'
      || typeof requestBody.actorId !== 'string' || typeof requestBody.operation !== 'string'
      || !plainShape(requestBody.args, Object.keys(requestBody.args as Record<string, unknown>))
      || Object.values(requestBody.args as Record<string, unknown>).some(value => typeof value !== 'string')) {
      throw new CoreError('DEVICE_AUTH_FAILED', 'The protected request has an invalid shape.')
    }
    const command = requestBody as unknown as RemoteRequest
    if (command.instanceId !== pairing.instanceId || command.environmentId !== pairing.environmentId
      || !pairing.allowedActorIds.includes(command.actorId)) throw new CoreError('GRANT_DENIED', 'This actor cannot use the paired Environment.')
    const grant = this.grants.find(candidate => candidate.instanceId === pairing.instanceId && candidate.environmentId === pairing.environmentId)
    if (command.operation !== 'revoke' && (!grant || !grant.allowedActorIds.includes(command.actorId))) {
      throw new CoreError('GRANT_DENIED', 'The device no longer grants this Instance, Environment and actor.')
    }
    let result: unknown
    try {
      result = await this.execute(pairing, grant, command)
      if (command.operation === 'revoke') {
        pairing.revokedAt = Date.now()
        await this.persist()
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({
        v: remoteProtocolVersion, requestId: envelope.requestId,
        body: seal(requestKey, { ok: true, result }, { v: remoteProtocolVersion, requestId: envelope.requestId }),
      }))
    } catch (error) {
      const code = error instanceof CoreError ? error.code : 'DEVICE_FAILED'
      const message = error instanceof CoreError ? error.message : 'The device operation failed.'
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({
        v: remoteProtocolVersion, requestId: envelope.requestId,
        body: seal(requestKey, { ok: false, code, message }, { v: remoteProtocolVersion, requestId: envelope.requestId }),
      }))
    }
  }

  private requestKey(pairing: PairingRecord) {
    return deriveSharedKey(this.identity.privateKey, importPublicKey(pairing.hostExchangeKey), this.transcript(pairing))
  }

  private transcript(pairing: PairingRecord): PairingTranscript {
    return { v: remoteProtocolVersion, instanceId: pairing.instanceId, environmentId: pairing.environmentId,
      allowedActorIds: pairing.allowedActorIds, permissions: pairing.permissions, hostExchangeKey: pairing.hostExchangeKey,
      hostNonce: pairing.hostNonce, expectedDeviceId: this.deviceId }
  }

  private async execute(pairing: PairingRecord, grant: RemoteDeviceGrant | undefined, request: RemoteRequest) {
    if (request.operation === 'status') {
      if (!grant) throw new CoreError('GRANT_DENIED', 'The device no longer grants this Environment.')
      return { deviceId: this.deviceId, incarnation: this.incarnation, root: this.root, instanceId: grant.instanceId,
        environmentId: grant.environmentId, permissions: grant.permissions, allowedActorIds: grant.allowedActorIds,
        commands: this.commandSpecs(), version: remoteProtocolVersion, fingerprint: this.deviceKeyFingerprint,
        assets: this.assetsPath ? { maxBytes: maxAssetBytes, spillBytes: maxSpillBytes } : null,
        skills: this.skillsContext ? { supported: true } : null,
        capacity: { active: [...this.jobs.values()].filter(job => !job.settled).length, max: maxJobs } }
    }
    if (request.operation === 'revoke') return { revoked: true }
    const required = operationPermissions[request.operation as Exclude<RemoteOperation, 'status' | 'revoke'>]
    if (!required) {
      throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that operation.')
    }
    if (!grant || !required.every(permission => pairing.permissions.includes(permission) && grant.permissions.includes(permission))) {
      throw new CoreError('PERMISSION_DENIED', 'This device permission was not granted.')
    }
    if (request.operation.startsWith('command.') || request.operation.startsWith('terminal.')) return this.commandOperation(pairing, request)
    if (request.operation === 'file.read') {
      const target = await this.target(request.args.path!)
      const bytes = await readPrefix(target, 65536)
      if (bytes.length > 65536) throw new CoreError('FILE_TOO_LARGE', 'The file exceeds the 65536-byte read budget.')
      try { return { text: this.sanitize(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } }
      catch { throw new CoreError('INVALID_FILE', 'The file is not valid UTF-8 text.') }
    }
    if (request.operation === 'file.write') {
      if (typeof request.args.text !== 'string' || Buffer.byteLength(request.args.text) > 65536) {
        throw new CoreError('INVALID_INPUT', 'File writes are limited to 65536 UTF-8 bytes.')
      }
      const target = await this.target(request.args.path!)
      await writeFile(target, request.args.text)
      return { path: request.args.path!, bytes: Buffer.byteLength(request.args.text) }
    }
    if (request.operation === 'workcopy.inspect') return inspectWorkCopy(this.root)
    if (request.operation === 'file.artifact') {
      const target = await this.target(request.args.path!)
      const bytes = await readPrefix(target, 65536)
      if (bytes.length > 65536) throw new CoreError('FILE_TOO_LARGE', 'The artifact exceeds the 65536-byte read budget.')
      return { path: relative(this.root, target).split(sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    if (request.operation === 'file.readRange') return this.readFileRange(request.args)
    if (request.operation.startsWith('asset.')) return this.assetOperation(request)
    if (request.operation.startsWith('skill.')) return this.skillOperation(request)
    if (!request.args.pattern || request.args.pattern.length > 256) throw new CoreError('INVALID_INPUT', 'Search needs a bounded nonempty pattern.')
    return this.search(request.operation as 'file.glob' | 'file.grep', request.args.pattern)
  }

  private async commandOperation(pairing: PairingRecord, request: RemoteRequest) {
    if (request.operation === 'command.resolve') return this.resolveCommand(request.args.name)
    const jobId = this.jobIdFor(pairing, request.args.jobId)
    if (request.operation === 'command.start') return this.startJob(pairing, jobId, request.actorId, request.args)
    const job = this.jobs.get(jobId)
    if (job?.ownerId !== undefined && job.ownerId !== request.actorId) {
      throw new CoreError('JOB_OWNER_MISMATCH', 'This device job belongs to a different actor.')
    }
    if (request.operation === 'command.inspect') return this.inspectJob(jobId, request.args)
    if (request.operation === 'command.cancel') return this.cancelJob(jobId)
    if (request.operation === 'command.spillInfo') return this.spillInfo(pairing, jobId, request.args)
    if (request.operation === 'command.spill') return this.readSpill(pairing, jobId, request.args)
    if (request.operation.startsWith('terminal.')) return this.terminalOperation(jobId, request)
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that command operation.')
  }

  private async resolveCommand(name: string | undefined) {
    const command = name ? this.commands[name] : undefined
    if (!command) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured device command names can be resolved.')
    await this.verifyRoot()
    return { name, path: await this.resolveExecutable(command) }
  }

  private async storeFor(instanceId: string, environmentId: string) {
    if (!this.assetsPath) throw new UnsupportedEnvironmentCombination('This device has no deployment-owned asset store.',
      [environmentAssetGaps.deviceStore])
    const namespace = assetNamespace(instanceId, environmentId)
    let store = this.assetStores.get(namespace)
    if (!store) {
      store = await FileAssetStore.open(this.assetsPath, namespace)
      this.assetStores.set(namespace, store)
    }
    return store
  }

  private async readFileRange(args: Record<string, string>) {
    const target = await this.target(args.path!)
    const offset = parseOffset(args.offset)
    const length = parseOffset(args.length)
    if (!length || length > maxAssetPageBytes) throw new CoreError('INVALID_INPUT', `A file range is between 1 and ${maxAssetPageBytes} bytes.`)
    const expectedBytes = parseOffset(args.expectedBytes)
    if (!expectedBytes || expectedBytes > maxSpillBytes) throw new CoreError('INVALID_INPUT', 'A file reference exceeds its byte budget.')
    if (!args.expectedSha256 || !/^[a-f0-9]{64}$/u.test(args.expectedSha256)) throw new CoreError('INVALID_INPUT', 'A file range needs its expected digest.')
    const prefix = await readPrefix(target, expectedBytes)
    if (prefix.length !== expectedBytes || createHash('sha256').update(prefix).digest('hex') !== args.expectedSha256) {
      throw new CoreError('REFERENCE_STALE', 'The file no longer matches the referenced bytes.')
    }
    if (offset > expectedBytes) throw new CoreError('INVALID_INPUT', 'Asset offsets must address bytes already observed.')
    const window = prefix.subarray(offset, Math.min(expectedBytes, offset + length))
    return { path: relative(this.root, target).split(sep).join('/'), bytes: expectedBytes, sha256: args.expectedSha256,
      offset, nextOffset: offset + window.length, data: window.toString('base64') }
  }

  private async assetOperation(request: RemoteRequest) {
    const store = await this.storeFor(request.instanceId, request.environmentId)
    if (request.operation === 'asset.save') {
      const name = request.args.name
      if (!name) throw new CoreError('INVALID_INPUT', 'An attachment save needs a display name.')
      let data: Buffer
      try { data = Buffer.from(request.args.data ?? '', 'base64') }
      catch { throw new CoreError('INVALID_INPUT', 'Attachment bytes must be canonical base64.') }
      if (!request.args.data || data.toString('base64') !== request.args.data) {
        throw new CoreError('INVALID_INPUT', 'Attachment bytes must be canonical base64.')
      }
      if (data.length > maxAssetBytes) throw new CoreError('INVALID_INPUT', `Attachments are limited to ${maxAssetBytes} bytes.`)
      const mediaType = request.args.mediaType || undefined
      const saved = await store.save({ name, data, ...(mediaType ? { mediaType } : {}) })
      return { id: saved.id, name: saved.name, bytes: saved.bytes, sha256: saved.sha256,
        ...(saved.mediaType ? { mediaType: saved.mediaType } : {}) }
    }
    if (request.operation === 'asset.read') {
      const id = request.args.id
      if (!id) throw new CoreError('INVALID_INPUT', 'An asset read needs its reference identity.')
      const offset = parseOffset(request.args.offset)
      const maxBytes = parseOffset(request.args.maxBytes)
      if (!maxBytes || maxBytes > maxAssetPageBytes) throw new CoreError('INVALID_INPUT', `Asset pages are between 1 and ${maxAssetPageBytes} bytes.`)
      const read = await store.read(id, offset, maxBytes)
      const metadata = await store.stat(id)
      return { id, bytes: read.bytes, sha256: read.sha256, offset, nextOffset: offset + read.data.length,
        data: read.data.toString('base64'), ...(metadata?.name ? { name: metadata.name } : {}),
        ...(metadata?.mediaType ? { mediaType: metadata.mediaType } : {}) }
    }
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that asset operation.')
  }

  private async skillOperation(request: RemoteRequest) {
    const skills = this.skillsContext?.skills
    if (!skills) throw new UnsupportedEnvironmentCombination('This device mounted no public skill provider.',
      [environmentAssetGaps.deviceSkillStore])
    if (request.operation === 'skill.list') {
      const summaries = await skills.list({ cwd: this.root })
      return { skills: summaries.slice(0, 100).map(summary => ({ name: summary.name, description: summary.description,
        ...(summary.path ? { path: summary.path } : {}), source: summary.source, provider: summary.provider,
        modelInvocable: summary.invocation.modelInvocable })) }
    }
    if (request.operation === 'skill.get') {
      const name = request.args.name
      if (!name || !isSkillName(name)) throw new CoreError('INVALID_INPUT', 'A skill load needs its kebab-case name.')
      const skill = await skills.get(name, { cwd: this.root })
      if (!skill) throw new CoreError('NOT_FOUND', 'The skill is no longer available on this device.')
      const content = Buffer.from(skill.content, 'utf8')
      return { name: skill.name, description: skill.description, ...(skill.path ? { path: skill.path } : {}),
        source: skill.source, provider: skill.provider, content: skill.content,
        bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
    }
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that skill operation.')
  }

  private async spillInfo(pairing: PairingRecord, jobId: string, args: Record<string, string>) {
    await this.storeFor(pairing.instanceId, pairing.environmentId)
    const stream = args.stream
    if (stream !== 'stdout' && stream !== 'stderr') throw new CoreError('INVALID_INPUT', 'A spill operation names stdout or stderr.')
    const job = this.jobs.get(jobId)
    if (!job) throw new CoreError('NOT_FOUND', 'The device no longer knows this job.')
    if (stream === 'stdout' ? job.stdoutSpillDropped : job.stderrSpillDropped) {
      throw new UnsupportedEnvironmentCombination('The complete output exceeded the device spill budget.', [environmentAssetGaps.spillUnavailable])
    }
    const file = this.jobFile(jobId, stream === 'stdout' ? '.out' : '.err')
    const observed = file ? await stat(file).catch(() => undefined) : undefined
    if (!file || !observed?.isFile()) {
      throw new UnsupportedEnvironmentCombination('This job retained no complete ' + stream + ' stream.', [environmentAssetGaps.spillUnavailable])
    }
    const bytes = await readPrefix(file, Math.min(observed.size, maxSpillBytes))
    if (bytes.length !== observed.size) throw new UnsupportedEnvironmentCombination('The complete output exceeded the device spill budget.', [environmentAssetGaps.spillUnavailable])
    return { jobId, stream, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }

  private async readSpill(pairing: PairingRecord, jobId: string, args: Record<string, string>) {
    await this.storeFor(pairing.instanceId, pairing.environmentId)
    const stream = args.stream
    if (stream !== 'stdout' && stream !== 'stderr') throw new CoreError('INVALID_INPUT', 'A spill operation names stdout or stderr.')
    const offset = parseOffset(args.offset)
    const maxBytes = parseOffset(args.maxBytes)
    if (!maxBytes || maxBytes > maxAssetPageBytes) throw new CoreError('INVALID_INPUT', `Spill pages are between 1 and ${maxAssetPageBytes} bytes.`)
    const expectedBytes = parseOffset(args.expectedBytes)
    if (!expectedBytes || expectedBytes > maxSpillBytes) throw new CoreError('INVALID_INPUT', 'A spill reference exceeds its byte budget.')
    if (!args.expectedSha256 || !/^[a-f0-9]{64}$/u.test(args.expectedSha256)) throw new CoreError('INVALID_INPUT', 'A spill read needs its expected digest.')
    if (!this.jobs.has(jobId)) throw new CoreError('NOT_FOUND', 'The device no longer knows this job.')
    const file = this.jobFile(jobId, stream === 'stdout' ? '.out' : '.err')
    const observed = file ? await stat(file).catch(() => undefined) : undefined
    if (!file || !observed?.isFile() || observed.size < expectedBytes) {
      throw new CoreError('REFERENCE_STALE', 'The spill object no longer exists at the referenced length.')
    }
    const prefix = await readPrefix(file, expectedBytes)
    if (prefix.length !== expectedBytes || createHash('sha256').update(prefix).digest('hex') !== args.expectedSha256) {
      throw new CoreError('REFERENCE_STALE', 'The spill content no longer matches its reference.')
    }
    if (offset > expectedBytes) throw new CoreError('INVALID_INPUT', 'Spill offsets must address bytes already observed.')
    const window = prefix.subarray(offset, Math.min(expectedBytes, offset + maxBytes))
    return { jobId, stream, bytes: expectedBytes, sha256: args.expectedSha256, offset, nextOffset: offset + window.length,
      data: window.toString('base64') }
  }

  private jobIdFor(pairing: PairingRecord, jobId: string | undefined) {
    if (!validateRemoteJobId(jobId, this.jobPrefix(pairing))) {
      throw new CoreError('JOB_IDENTITY_MISMATCH', 'The job ID does not belong to this Instance, Environment and device incarnation.')
    }
    return jobId
  }

  private async startJob(pairing: PairingRecord, jobId: string, ownerId: string, args: Record<string, string>) {
    const name = args.name
    const mode = args.mode
    if (!name) throw new CoreError('INVALID_INPUT', 'A command start needs one configured name.')
    const command = this.commands[name]
    if (!command) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured device command names can run.')
    if (mode !== 'foreground' && mode !== 'background' && mode !== 'terminal') {
      throw new CoreError('INVALID_INPUT', 'A command start needs a foreground, background or terminal mode.')
    }
    if (mode === 'terminal' && !command.pty) throw new CoreError('UNSUPPORTED_CAPABILITY', 'This command is not configured for a terminal.')
    const rows = mode === 'terminal' ? parseDimension(args.rows, 'rows') : undefined
    const cols = mode === 'terminal' ? parseDimension(args.cols, 'cols') : undefined
    const terminalType = mode === 'terminal' ? parseTerminalType(args.terminalType) : undefined
    const existing = this.jobs.get(jobId)
    const deadlineMs = mode === 'foreground' ? command.timeoutMs : command.backgroundTimeoutMs ?? command.timeoutMs
    const fingerprint = canonicalJson([name, command.argv, command.env ?? {}, this.root, mode, deadlineMs, ownerId,
      rows ?? null, cols ?? null, terminalType ?? null])
    if (existing) {
      if (existing.ownerId !== undefined && existing.ownerId !== ownerId) {
        throw new CoreError('JOB_OWNER_MISMATCH', 'This job ID was already started by a different actor.')
      }
      if (existing.fingerprint !== fingerprint) {
        throw new CoreError('IDENTITY_CONFLICT', 'This job ID was already used with different command parameters.')
      }
      return this.snapshot(existing, 0, 0)
    }
    await this.pruneJobs()
    await this.verifyRoot()
    const executable = await this.resolveExecutable(command)
    const job: DeviceJob = { id: jobId, instanceId: pairing.instanceId, environmentId: pairing.environmentId,
      incarnation: this.incarnation, ownerId, rootIdentity: this.rootIdentity, name, fingerprint,
      kind: mode === 'terminal' ? 'terminal' : 'command', state: 'running', startedAt: Date.now(),
      deadlineAt: Date.now() + deadlineMs, settled: false, cancelled: false, stdout: new BoundedOutput(),
      stderr: new BoundedOutput(), signalable: true, recoveries: [], rootExited: false,
      stdoutSpillDropped: false, stderrSpillDropped: false,
      writes: Promise.resolve(), persisting: Promise.resolve() }
    this.jobs.set(jobId, job)
    try {
      await this.ensureJobFiles(job)
      await this.persistJob(job)
    } catch (error) {
      this.jobs.delete(jobId)
      throw error instanceof CoreError ? error : new CoreError('SETUP_FAILED', 'The device could not persist the job record.')
    }
    await this.launchJob(job, command, executable, deadlineMs, rows, cols, terminalType)
    return this.snapshot(job, 0, 0)
  }

  private async launchJob(job: DeviceJob, command: RemoteDeviceCommand, executable: string, deadlineMs: number,
    rows?: number, cols?: number, terminalType?: string) {
    let launched = false
    try {
      if (job.kind === 'terminal') await this.launchTerminal(job, command, executable, rows!, cols!, terminalType!)
      else await this.launchCommand(job, command, executable)
      launched = true
      if (job.pid) {
        job.process = await this.processIdentityFor(job.pid)
        await this.persistJob(job)
      }
    } catch {
      if (launched) void this.killRange(job)
      job.state = 'unknown'
      job.settled = true
      job.reason = 'spawn-failed'
      await this.persistJob(job)
      throw new CoreError('COMMAND_FAILED', 'The device could not start the configured command.')
    }
    job.timer = setTimeout(() => this.requestStop(job, 'deadline'), deadlineMs)
    job.timer.unref()
  }

  private async launchCommand(job: DeviceJob, command: RemoteDeviceCommand, executable: string) {
    const child = spawn(executable, command.argv.slice(1), { cwd: this.root, env: childEnvironment(command.env),
      detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    job.child = child
    job.pid = child.pid
    child.stdout?.on('data', (chunk: Buffer) => this.appendOutput(job, 'stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.appendOutput(job, 'stderr', chunk))
    child.once('error', () => this.failJob(job))
    child.once('close', (code, signal) => this.rootExit(job, code, signal))
  }

  private async launchTerminal(job: DeviceJob, command: RemoteDeviceCommand, executable: string, rows: number, cols: number, terminalType: string) {
    const terminal = spawnPty(executable, command.argv.slice(1), { cwd: this.root, env: childEnvironment(command.env),
      rows, cols, name: terminalType })
    job.pty = terminal
    job.pid = terminal.pid
    terminal.onData(data => this.appendOutput(job, 'stdout', Buffer.from(data, 'utf8')))
    terminal.onExit(({ exitCode, signal }) => this.rootExit(job, exitCode, signal === undefined ? null : `signal:${signal}`))
  }

  private failJob(job: DeviceJob) {
    if (job.settled) return
    job.state = 'unknown'
    job.settled = true
    job.reason = 'spawn-failed'
    void this.finishJob(job)
  }

  private rootExit(job: DeviceJob, code: number | null, signal: string | NodeJS.Signals | null) {
    if (job.settled || job.rootExited) return
    job.rootExited = true
    job.state = job.cancelled ? 'stopping' : 'exited'
    job.exitCode = code
    job.signal = signal
    void this.settleRange(job)
  }

  private async settleRange(job: DeviceJob) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await this.rangeEmpty(job)) {
        job.settled = true
        job.state = job.cancelled ? 'cancelled' : 'exited'
        await this.finishJob(job)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    job.settled = true
    job.state = 'unknown'
    job.reason = 'range-unconfirmed'
    await this.finishJob(job)
  }

  private async rangeEmpty(job: DeviceJob) {
    if (!job.pid) return true
    if (process.platform === 'win32') {
      const result = spawnSync('tasklist', ['/FI', `PID eq ${job.pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true })
      const ids = result.stdout.split(/\r?\n/u).map(line => line.match(/^\s*"[^"]*","([^"]*)"/u)?.[1]).filter(Boolean)
      return !ids.includes(String(job.pid))
    }
    if (job.process?.kind === 'posix-proc') {
      const current = await procIdentity(job.pid)
      if (current === 'unknown') return false
      if (current !== 'gone' && (current.startTime !== job.process.startTime || current.pgrp !== job.process.pgrp)) return false
    }
    return !groupAlive(job.pid)
  }

  private async killRange(job: DeviceJob, signal: NodeJS.Signals = 'SIGTERM') {
    if (job.settled) return
    if (!job.signalable) return
    if (!job.pid) {
      if (job.pty) {
        try { job.pty.kill(process.platform === 'win32' ? undefined : signal) } catch { /* The terminal is already gone. */ }
      }
      return
    }
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(job.pid), '/T', '/F'], { windowsHide: true })
      return
    }
    if (job.process?.kind === 'posix-proc') {
      const current = await procIdentity(job.pid)
      if (current === 'unknown') return
      if (current !== 'gone' && (current.startTime !== job.process.startTime || current.pgrp !== job.process.pgrp)) return
    }
    try {
      process.kill(-job.pid, signal)
    } catch {
      try { process.kill(job.pid, signal) } catch { /* The range is already gone. */ }
    }
  }

  private async inspectJob(jobId: string, args: Record<string, string>) {
    const job = this.jobs.get(jobId)
    if (!job) return this.unknownSnapshot(jobId)
    await job.writes.catch(() => {})
    await job.persisting.catch(() => {})
    return this.snapshot(job, parseOffset(args.stdoutOffset), parseOffset(args.stderrOffset))
  }

  private async cancelJob(jobId: string) {
    const job = this.jobs.get(jobId)
    if (!job) return this.unknownSnapshot(jobId)
    if (!job.settled) this.requestStop(job, 'requested')
    await job.writes.catch(() => {})
    await job.persisting.catch(() => {})
    return this.snapshot(job, 0, 0)
  }

  private jobPrefix(pairing: PairingRecord) {
    return remoteJobIdPrefix(pairing.instanceId, pairing.environmentId, this.incarnation)
  }

  private async verifyRoot() {
    const observed = await stat(this.root, { bigint: true })
    const identity = `${observed.dev}:${observed.ino}:${observed.birthtimeNs}`
    if (!observed.isDirectory() || identity !== this.rootIdentity) {
      throw new CoreError('ENVIRONMENT_CHANGED', 'The device working directory identity changed; configure a new Environment.')
    }
  }

  private commandSpecs(): Record<string, RemoteCommandSpec> {
    return Object.fromEntries(Object.entries(this.commands).map(([name, command]) => [name,
      { timeoutMs: command.timeoutMs, ...(command.backgroundTimeoutMs === undefined ? {} : { backgroundTimeoutMs: command.backgroundTimeoutMs }),
        ...(command.pty ? { pty: true } : {}) }]))
  }

  private unknownSnapshot(jobId: string) {
    const empty = { text: '', nextOffset: 0, lossy: false }
    return { jobId, state: 'unknown', settled: true, exited: false, pid: 0, exitCode: null, signal: null,
      cancelled: false, ownerId: null, deadlineAt: null, recovery: null,
      stdoutFrom: 0, stderrFrom: 0, stdout: empty, stderr: empty }
  }

  private snapshot(job: DeviceJob, stdoutOffset: number, stderrOffset: number) {
    return { jobId: job.id, state: job.state, settled: job.settled, exited: job.rootExited, pid: job.pid ?? 0,
      exitCode: job.exitCode ?? null, signal: job.signal ?? null, cancelled: job.cancelled,
      ownerId: job.ownerId ?? null, deadlineAt: job.deadlineAt, recovery: job.recoveries.at(-1) ?? null,
      stdoutFrom: stdoutOffset, stderrFrom: stderrOffset, stdout: job.stdout.read(stdoutOffset),
      stderr: job.stderr.read(stderrOffset) }
  }

  private terminalOperation(jobId: string, request: RemoteRequest) {
    const job = this.jobs.get(jobId)
    if (!job || job.kind !== 'terminal' || !job.pty) {
      throw new CoreError('NOT_FOUND', 'This job is not a live device terminal.')
    }
    if (request.operation === 'terminal.write') {
      const data = request.args.data
      if (typeof data !== 'string' || Buffer.byteLength(data) > 65536) throw new CoreError('INVALID_INPUT', 'Terminal writes are limited to 65536 bytes.')
      job.pty.write(data)
      return this.snapshot(job, 0, 0)
    }
    if (request.operation === 'terminal.resize') {
      job.pty.resize(parseDimension(request.args.cols, 'cols'), parseDimension(request.args.rows, 'rows'))
      return this.snapshot(job, 0, 0)
    }
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'Foreground process-group signalling is not verified on this device.')
  }

  private appendOutput(job: DeviceJob, stream: 'stdout' | 'stderr', chunk: Buffer) {
    if (job.settled) return
    const file = this.jobFile(job.id, stream === 'stdout' ? '.out' : '.err')
    if (file) {
      job.writes = job.writes.then(async () => {
        await appendFile(file, chunk)
        const observed = await stat(file)
        if (observed.size > maxSpillBytes) {
          if (stream === 'stdout') job.stdoutSpillDropped = true
          else job.stderrSpillDropped = true
          await rm(file, { force: true })
          await this.persistJob(job)
        }
      }).catch(() => {})
    }
    job[stream].append(chunk)
  }

  private requestStop(job: DeviceJob, reason: string) {
    if (job.settled) return
    if (job.state !== 'stopping') {
      job.state = 'stopping'
      job.cancelled = true
      job.reason = reason
      void this.persistJob(job).catch(() => {})
    }
    void this.killRange(job)
    if (!job.killTimer) {
      job.killTimer = setTimeout(() => { if (!job.settled) void this.killRange(job, 'SIGKILL') }, 250)
      job.killTimer.unref()
    }
  }

  private async waitForSettled(job: DeviceJob, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (!job.settled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    return job.settled
  }

  private async finishJob(job: DeviceJob) {
    if (job.timer) clearTimeout(job.timer)
    if (job.killTimer) clearTimeout(job.killTimer)
    if (job.monitorTimer) clearTimeout(job.monitorTimer)
    job.timer = undefined
    job.killTimer = undefined
    job.monitorTimer = undefined
    await job.writes.catch(() => {})
    await this.persistJob(job).catch(() => {})
  }

  private async resolveExecutable(command: RemoteDeviceCommand) {
    const requested = command.argv[0]!
    const env = childEnvironment(command.env)
    const verify = async (candidate: string) => {
      try {
        const observed = await stat(candidate)
        if (!observed.isFile()) return undefined
        if (process.platform !== 'win32' && (observed.mode & 0o111) === 0) return undefined
        return await realpath(candidate)
      } catch { return undefined }
    }
    if (isAbsolute(requested)) {
      if (process.platform === 'win32' && !['', '.exe', '.com'].includes(extname(requested).toLowerCase())) {
        throw new CoreError('UNSUPPORTED_CAPABILITY', 'Windows device commands must resolve to a native executable.')
      }
      const resolved = await verify(requested)
      if (resolved) return resolved
      throw new CoreError('COMMAND_FAILED', 'The configured device executable is not available.')
    }
    if (requested.includes('/') || requested.includes('\\')) {
      throw new CoreError('UNSUPPORTED_CAPABILITY', 'Relative executable paths are not allowed on the device.')
    }
    const extensions = process.platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.COM;.EXE').split(';').map(value => value.toLowerCase()).filter(value => value === '.com' || value === '.exe')]
      : ['']
    for (const directory of (env.PATH ?? '').split(delimiter)) {
      if (!directory) continue
      for (const extension of extensions) {
        const resolved = await verify(join(directory, requested + extension))
        if (resolved) return resolved
      }
    }
    throw new CoreError('COMMAND_FAILED', 'The configured device executable was not found on PATH.')
  }

  private async target(path: string) {
    if (typeof path !== 'string' || !path || path.length > 1024 || isAbsolute(path) || path.includes(':')
      || path.split(/[\\/]/u).includes('..') || protectedPath(path)) {
      throw new CoreError('PATH_DENIED', 'Use a relative non-sensitive path inside the device working directory.')
    }
    const target = resolve(this.root, path)
    const within = relative(this.root, target)
    if (within.startsWith('..') || isAbsolute(within)) throw new CoreError('PATH_DENIED', 'The path resolves outside the device working directory.')
    let prefix = this.root
    for (const part of path.split(/[\\/]/u).filter(part => part && part !== '.')) {
      prefix = resolve(prefix, part)
      if ((await lstat(prefix).catch(() => undefined))?.isSymbolicLink()) throw new CoreError('PATH_DENIED', 'Symbolic links are not enabled on the device.')
    }
    return target
  }

  private sanitize(text: string) {
    return sanitizeSecrets(text).split(this.root).join('<device-workdir>')
  }

  private async search(operation: 'file.glob' | 'file.grep', pattern: string) {
    const paths: string[] = []
    const matches: { path: string; line: number; text: string }[] = []
    const pending = ['']
    let visited = 0
    let bytesRead = 0
    while (pending.length) {
      const directory = pending.shift()!
      const target = await this.target(directory || '.')
      for (const entry of await readdir(target, { withFileTypes: true })) {
        if (++visited > 500) throw new CoreError('SEARCH_LIMIT', 'The bounded search exceeded 500 entries.')
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (protectedPath(path) || entry.isSymbolicLink()) continue
        const child = await this.target(path)
        if (entry.isDirectory()) { pending.push(path); continue }
        if (!entry.isFile()) continue
        if (operation === 'file.glob') {
          if (matchesGlob(path, pattern) || !pattern.includes('/') && matchesGlob(entry.name, pattern)) paths.push(path)
        } else {
          const bytes = await readPrefix(child, 65536)
          bytesRead += bytes.length
          if (bytesRead > 1_048_576) throw new CoreError('SEARCH_LIMIT', 'The bounded search exceeded one MiB.')
          const text = new TextDecoder().decode(bytes)
          if (text.includes('\0')) continue
          for (const [index, line] of text.split(/\r?\n/u).entries()) {
            if (line.includes(pattern)) matches.push({ path, line: index + 1, text: this.sanitize(line).slice(0, 1000) })
          }
        }
        if (paths.length > 100 || matches.length > 100) throw new CoreError('SEARCH_LIMIT', 'Narrow the search to at most 100 results.')
      }
    }
    return operation === 'file.glob' ? { paths: paths.sort() } : { matches }
  }
}
