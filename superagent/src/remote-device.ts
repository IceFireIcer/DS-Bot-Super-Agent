import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { lstat, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, matchesGlob, sep } from 'node:path'
import { CoreError, identifier } from './model.js'
import { deriveSharedKey, exchangeKeyPair, exportPrivateKey, exportPublicKey, importPrivateKey, importPublicKey,
  openSealed, plainShape, publicKeyFingerprint, remoteProtocolVersion, sameSet, seal, signingKeyPair, signPairingResponse,
  verifyPairingProof, type KeyPairMaterial, type PairingTranscript, type RemoteOperation, type RemotePermission, type RemoteRequest } from './remote-protocol.js'
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
  statePath?: string
  listenHost?: string
  advertiseHost?: string
  listenPort?: number
  pairingCode?: string
  pairingTtlMs?: number
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

const permissions = new Set<RemotePermission>(['read', 'write', 'search'])
const operationPermissions: Record<Exclude<RemoteOperation, 'status' | 'revoke'>, RemotePermission[]> = {
  'file.read': ['read'],
  'file.write': ['write'],
  'file.glob': ['search'],
  'file.grep': ['read', 'search'],
  'file.artifact': ['read'],
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

export class RemoteDevice {
  readonly deviceId: string
  readonly deviceKeyFingerprint: string
  readonly pairingCode: string
  readonly pairingExpiresAt: number
  private readonly root: string
  private readonly grants: RemoteDeviceGrant[]
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

  private constructor(config: Required<Pick<RemoteDeviceConfig, 'deviceId' | 'root' | 'grants'>> & RemoteDeviceConfig,
    state: DeviceState | undefined) {
    this.deviceId = config.deviceId
    this.root = config.root
    this.grants = structuredClone(config.grants)
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
    if (!cloned || Object.keys(cloned).some(key => !['deviceId', 'root', 'grants', 'statePath', 'listenHost', 'advertiseHost',
      'listenPort', 'pairingCode', 'pairingTtlMs'].includes(key))) {
      throw new CoreError('INVALID_CONFIG', 'A remote device accepts device, root, grants, state and listener options only.')
    }
    identifier(cloned.deviceId, 'deviceId')
    if (typeof cloned.root !== 'string' || !isAbsolute(cloned.root)) throw new CoreError('INVALID_CONFIG', 'The device working directory must be absolute.')
    if (!Array.isArray(cloned.grants) || !cloned.grants.length) throw new CoreError('INVALID_CONFIG', 'A remote device needs at least one grant.')
    for (const grant of cloned.grants) validateGrant(grant)
    if (cloned.statePath !== undefined) {
      if (!isAbsolute(cloned.statePath)) throw new CoreError('INVALID_CONFIG', 'The device state path must be absolute.')
      const insideRoot = relative(await realpath(cloned.root), cloned.statePath)
      if (!insideRoot.startsWith('..') && !isAbsolute(insideRoot)) throw new CoreError('INVALID_CONFIG', 'Device key state cannot live inside the exposed working directory.')
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
    const device = new RemoteDevice({ ...cloned, root }, state)
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
    if (!server) return
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
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
      environmentId: transcript.environmentId, allowedActorIds: pairing.allowedActorIds, permissions: pairing.permissions, pairedAt: now }, transcript)
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
        environmentId: grant.environmentId, permissions: grant.permissions, allowedActorIds: grant.allowedActorIds }
    }
    if (request.operation === 'revoke') return { revoked: true }
    const required = operationPermissions[request.operation as Exclude<RemoteOperation, 'status' | 'revoke'>]
    if (!required) {
      throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device does not expose that operation.')
    }
    if (!grant || !required.every(permission => pairing.permissions.includes(permission) && grant.permissions.includes(permission))) {
      throw new CoreError('PERMISSION_DENIED', 'This device permission was not granted.')
    }
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
