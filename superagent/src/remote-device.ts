import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join, relative, resolve, matchesGlob, sep } from 'node:path'
import { canonicalJson } from './commands.js'
import { CoreError, identifier } from './model.js'
import { BoundedOutput, maxRemoteOutputBytes } from './remote-output.js'
import { deriveSharedKey, exchangeKeyPair, exportPrivateKey, exportPublicKey, importPrivateKey, importPublicKey,
  openSealed, plainShape, publicKeyFingerprint, remoteProtocolVersion, sameSet, seal, signingKeyPair, signPairingResponse,
  validRemoteCommandSpec, validateRemoteJobId, remoteJobIdPrefix, verifyPairingProof, type KeyPairMaterial,
  type PairingTranscript, type RemoteCommandSpec,
  type RemoteOperation, type RemotePermission, type RemoteRequest } from './remote-protocol.js'
import { protectedPath } from './path-safety.js'
import { sanitizeSecrets } from './sanitize.js'

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
  'file.glob': ['search'],
  'file.grep': ['read', 'search'],
  'file.artifact': ['read'],
  'command.resolve': ['command'],
  'command.start': ['command'],
  'command.inspect': ['command'],
  'command.cancel': ['command'],
}

type DeviceJobState = 'running' | 'stopping' | 'exited' | 'cancelled' | 'unknown'
const maxJobs = 64

interface DeviceJob {
  id: string
  instanceId: string
  environmentId: string
  incarnation: string
  name: string
  fingerprint: string
  state: DeviceJobState
  startedAt: number
  deadlineAt: number
  settled: boolean
  exitCode?: number | null
  signal?: string | null
  cancelled: boolean
  reason?: string
  stdout: BoundedOutput
  stderr: BoundedOutput
  child?: ChildProcess
  timer?: ReturnType<typeof setTimeout> | undefined
  killTimer?: ReturnType<typeof setTimeout> | undefined
  writes: Promise<void>
  persisting: Promise<void>
}

interface DeviceJobFile {
  version: 1
  id: string
  instanceId: string
  environmentId: string
  incarnation: string
  name: string
  fingerprint: string
  state: DeviceJobState
  startedAt: number
  deadlineAt: number
  settled: boolean
  exitCode: number | null
  signal: string | null
  cancelled: boolean
  stdoutTotal: number
  stderrTotal: number
  reason?: string
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
    || Object.keys(candidate).some(key => !['argv', 'timeoutMs', 'backgroundTimeoutMs', 'env'].includes(key))) {
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
    if (!cloned || Object.keys(cloned).some(key => !['deviceId', 'root', 'grants', 'commands', 'jobsPath', 'statePath', 'listenHost', 'advertiseHost',
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
    return device
  }

  private async persist() {
    if (!this.statePath) return
    const state: DeviceState = { version: 1, incarnation: this.incarnation, exchangePrivate: exportPrivateKey(this.identity.privateKey),
      exchangePublic: exportPublicKey(this.identity.publicKey), signingPrivate: exportPrivateKey(this.signing.privateKey),
      signingPublic: exportPublicKey(this.signing.publicKey), pairings: [...this.pairings.values()] }
    await writeFile(this.statePath, JSON.stringify(state), { mode: 0o600 })
  }

  private jobFile(jobId: string, extension: string) {
    if (!this.jobsPath) return undefined
    return join(this.jobsPath, `${createHash('sha256').update(jobId).digest('hex')}${extension}`)
  }

  private async persistJob(job: DeviceJob) {
    const file = this.jobFile(job.id, '.json')
    if (!file) return
    const write = async () => {
      const state: DeviceJobFile = { version: 1, id: job.id, instanceId: job.instanceId, environmentId: job.environmentId,
        incarnation: job.incarnation, name: job.name, fingerprint: job.fingerprint, state: job.state, startedAt: job.startedAt,
        deadlineAt: job.deadlineAt, settled: job.settled, exitCode: job.exitCode ?? null, signal: job.signal ?? null,
        cancelled: job.cancelled, stdoutTotal: job.stdout.nextOffset, stderrTotal: job.stderr.nextOffset,
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
      if (!plainShape(value, ['version', 'id', 'instanceId', 'environmentId', 'incarnation', 'name', 'fingerprint', 'state',
        'startedAt', 'deadlineAt', 'settled', 'exitCode', 'signal', 'cancelled', 'stdoutTotal', 'stderrTotal', 'reason'])
        || value.version !== 1 || typeof value.id !== 'string' || typeof value.instanceId !== 'string'
        || typeof value.environmentId !== 'string' || typeof value.incarnation !== 'string' || typeof value.name !== 'string'
        || typeof value.fingerprint !== 'string' || !['running', 'stopping', 'exited', 'cancelled', 'unknown'].includes(value.state as string)
        || typeof value.startedAt !== 'number' || typeof value.deadlineAt !== 'number' || typeof value.settled !== 'boolean'
        || value.exitCode !== null && typeof value.exitCode !== 'number' || value.signal !== null && typeof value.signal !== 'string'
        || typeof value.cancelled !== 'boolean'
        || value.stdoutTotal !== undefined && typeof value.stdoutTotal !== 'number'
        || value.stderrTotal !== undefined && typeof value.stderrTotal !== 'number'
        || value.reason !== undefined && typeof value.reason !== 'string') continue
      const record = value as unknown as DeviceJobFile
      const stdout = await readTail(this.jobFile(record.id, '.out'))
      const stderr = await readTail(this.jobFile(record.id, '.err'))
      const restarted = record.state === 'running' || record.state === 'stopping'
      const reason = restarted ? 'device-restarted' : record.reason
      const job: DeviceJob = { id: record.id, instanceId: record.instanceId, environmentId: record.environmentId,
        incarnation: record.incarnation, name: record.name, fingerprint: record.fingerprint,
        state: restarted ? 'unknown' : record.state, startedAt: record.startedAt, deadlineAt: record.deadlineAt,
        settled: restarted ? true : record.settled, exitCode: record.exitCode, signal: record.signal,
        cancelled: record.cancelled, ...(reason ? { reason } : {}),
        stdout: BoundedOutput.load(stdout.buffer, Math.max(stdout.size, record.stdoutTotal ?? 0)),
        stderr: BoundedOutput.load(stderr.buffer, Math.max(stderr.size, record.stderrTotal ?? 0)),
        writes: Promise.resolve(), persisting: Promise.resolve() }
      this.jobs.set(job.id, job)
      if (restarted) await this.persistJob(job)
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
    const active = [...this.jobs.values()].filter(job => job.child && !job.settled)
    for (const job of active) this.requestStop(job, 'device-shutdown')
    await Promise.all(active.map(job => new Promise<void>(resolve => {
      if (!job.child || job.settled) { resolve(); return }
      const timer = setTimeout(() => { job.child?.kill('SIGKILL'); resolve() }, 2000)
      timer.unref()
      job.child.once('close', () => { clearTimeout(timer); resolve() })
    })))
    await Promise.all([...this.jobs.values()].map(job => job.writes.catch(() => {})))
    await Promise.all([...this.jobs.values()].map(job => this.persistJob(job).catch(() => {})))
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
        commands: this.commandSpecs() }
    }
    if (request.operation === 'revoke') return { revoked: true }
    const required = operationPermissions[request.operation as Exclude<RemoteOperation, 'status' | 'revoke'>]
    if (!required) {
      throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that operation.')
    }
    if (!grant || !required.every(permission => pairing.permissions.includes(permission) && grant.permissions.includes(permission))) {
      throw new CoreError('PERMISSION_DENIED', 'This device permission was not granted.')
    }
    if (request.operation.startsWith('command.')) return this.commandOperation(pairing, request)
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
    if (request.operation === 'file.artifact') {
      const target = await this.target(request.args.path!)
      const bytes = await readPrefix(target, 65536)
      if (bytes.length > 65536) throw new CoreError('FILE_TOO_LARGE', 'The artifact exceeds the 65536-byte read budget.')
      return { path: relative(this.root, target).split(sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    if (!request.args.pattern || request.args.pattern.length > 256) throw new CoreError('INVALID_INPUT', 'Search needs a bounded nonempty pattern.')
    return this.search(request.operation as 'file.glob' | 'file.grep', request.args.pattern)
  }

  private async commandOperation(pairing: PairingRecord, request: RemoteRequest) {
    if (request.operation === 'command.resolve') return this.resolveCommand(request.args.name)
    const jobId = this.jobIdFor(pairing, request.args.jobId)
    if (request.operation === 'command.start') return this.startJob(pairing, jobId, request.args)
    if (request.operation === 'command.inspect') return this.inspectJob(jobId, request.args)
    if (request.operation === 'command.cancel') return this.cancelJob(jobId)
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that command operation.')
  }

  private async resolveCommand(name: string | undefined) {
    const command = name ? this.commands[name] : undefined
    if (!command) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured device command names can be resolved.')
    await this.verifyRoot()
    return { name, path: await this.resolveExecutable(command) }
  }

  private jobIdFor(pairing: PairingRecord, jobId: string | undefined) {
    if (!validateRemoteJobId(jobId, this.jobPrefix(pairing))) {
      throw new CoreError('JOB_IDENTITY_MISMATCH', 'The job ID does not belong to this Instance, Environment and device incarnation.')
    }
    return jobId
  }

  private async startJob(pairing: PairingRecord, jobId: string, args: Record<string, string>) {
    const name = args.name
    const mode = args.mode
    if (!name) throw new CoreError('INVALID_INPUT', 'A command start needs one configured name.')
    const command = this.commands[name]
    if (!command) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured device command names can run.')
    if (mode !== 'foreground' && mode !== 'background') throw new CoreError('INVALID_INPUT', 'A command start needs a foreground or background mode.')
    const existing = this.jobs.get(jobId)
    const deadlineMs = mode === 'background' ? command.backgroundTimeoutMs ?? command.timeoutMs : command.timeoutMs
    const fingerprint = canonicalJson([name, command.argv, command.env ?? {}, this.root, mode, deadlineMs])
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new CoreError('IDENTITY_CONFLICT', 'This job ID was already used with different command parameters.')
      }
      return this.snapshot(existing, 0, 0)
    }
    await this.pruneJobs()
    await this.verifyRoot()
    const executable = await this.resolveExecutable(command)
    const job: DeviceJob = { id: jobId, instanceId: pairing.instanceId, environmentId: pairing.environmentId,
      incarnation: this.incarnation, name, fingerprint, state: 'running', startedAt: Date.now(),
      deadlineAt: Date.now() + deadlineMs, settled: false, cancelled: false, stdout: new BoundedOutput(),
      stderr: new BoundedOutput(), writes: Promise.resolve(), persisting: Promise.resolve() }
    this.jobs.set(jobId, job)
    try {
      await this.ensureJobFiles(job)
      await this.persistJob(job)
    } catch (error) {
      this.jobs.delete(jobId)
      throw error instanceof CoreError ? error : new CoreError('SETUP_FAILED', 'The device could not persist the job record.')
    }
    await this.launchJob(job, command, executable, deadlineMs)
    return this.snapshot(job, 0, 0)
  }

  private async launchJob(job: DeviceJob, command: RemoteDeviceCommand, executable: string, deadlineMs: number) {
    let child: ChildProcess
    try {
      child = spawn(executable, command.argv.slice(1), { cwd: this.root, env: childEnvironment(command.env),
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch {
      job.state = 'unknown'
      job.settled = true
      job.reason = 'spawn-failed'
      await this.persistJob(job)
      throw new CoreError('COMMAND_FAILED', 'The device could not start the configured command.')
    }
    job.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.appendOutput(job, 'stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.appendOutput(job, 'stderr', chunk))
    child.once('error', () => this.failJob(job))
    child.once('close', (code, signal) => this.exitJob(job, code, signal))
    job.timer = setTimeout(() => this.requestStop(job, 'deadline'), deadlineMs)
    job.timer.unref()
  }

  private failJob(job: DeviceJob) {
    if (job.settled) return
    job.state = 'unknown'
    job.settled = true
    job.reason = 'spawn-failed'
    void this.finishJob(job)
  }

  private exitJob(job: DeviceJob, code: number | null, signal: NodeJS.Signals | null) {
    if (job.settled) return
    job.state = job.state === 'stopping' ? 'cancelled' : 'exited'
    job.cancelled = job.state === 'cancelled'
    job.settled = true
    job.exitCode = code
    job.signal = signal
    void this.finishJob(job)
  }

  private inspectJob(jobId: string, args: Record<string, string>) {
    const job = this.jobs.get(jobId)
    if (!job) return this.unknownSnapshot(jobId)
    return this.snapshot(job, parseOffset(args.stdoutOffset), parseOffset(args.stderrOffset))
  }

  private cancelJob(jobId: string) {
    const job = this.jobs.get(jobId)
    if (!job) return this.unknownSnapshot(jobId)
    if (!job.settled) this.requestStop(job, 'requested')
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
      { timeoutMs: command.timeoutMs, ...(command.backgroundTimeoutMs === undefined ? {} : { backgroundTimeoutMs: command.backgroundTimeoutMs }) }]))
  }

  private unknownSnapshot(jobId: string) {
    const empty = { text: '', nextOffset: 0, lossy: false }
    return { jobId, state: 'unknown', settled: true, exitCode: null, signal: null, cancelled: false, stdout: empty, stderr: empty }
  }

  private snapshot(job: DeviceJob, stdoutOffset: number, stderrOffset: number) {
    return { jobId: job.id, state: job.state, settled: job.settled, exitCode: job.exitCode ?? null,
      signal: job.signal ?? null, cancelled: job.cancelled, stdout: job.stdout.read(stdoutOffset),
      stderr: job.stderr.read(stderrOffset) }
  }

  private appendOutput(job: DeviceJob, stream: 'stdout' | 'stderr', chunk: Buffer) {
    if (job.settled) return
    job[stream].append(chunk)
    const file = this.jobFile(job.id, stream === 'stdout' ? '.out' : '.err')
    if (!file) return
    job.writes = job.writes.then(async () => {
      await appendFile(file, chunk)
      const observed = await stat(file)
      if (observed.size > maxRemoteOutputBytes * 4) {
        await this.persistJob(job)
        await writeFile(file, job[stream].tail, { mode: 0o600 })
      }
    }).catch(() => {})
  }

  private requestStop(job: DeviceJob, reason: string) {
    if (job.settled) return
    if (job.state === 'running') {
      job.state = 'stopping'
      job.cancelled = true
      job.reason = reason
      void this.persistJob(job).catch(() => {})
    }
    const child = job.child
    if (!child || child.exitCode !== null) return
    if (process.platform === 'win32') {
      child.kill()
      return
    }
    child.kill('SIGTERM')
    if (!job.killTimer) {
      job.killTimer = setTimeout(() => { if (!job.settled) child.kill('SIGKILL') }, 250)
      job.killTimer.unref()
    }
  }

  private async finishJob(job: DeviceJob) {
    if (job.timer) clearTimeout(job.timer)
    if (job.killTimer) clearTimeout(job.killTimer)
    job.timer = undefined
    job.killTimer = undefined
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
