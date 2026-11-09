import { isAbsolute } from 'node:path'
import { CoreError, identifier } from './model.js'
import type { Artifact } from './local-environment.js'
import type { EnvironmentConfig, ExecutionEnvironment, PreparedEnvironment } from './environment.js'
import { deriveSharedKey, exchangeKeyPair, exportPublicKey, importPrivateKey, importPublicKey, openSealed, pairingProof,
  plainShape, publicKeyFingerprint, randomToken, remoteProtocolVersion, sameSet, seal, verifyPairingResponse,
  type KeyPairMaterial, type PairingTranscript, type RemoteOperation, type RemotePermission, type RemoteRequest } from './remote-protocol.js'
import { sanitizeSecrets } from './sanitize.js'

export type RemoteEnvironmentPermission = RemotePermission

export interface RemotePairOptions {
  id: string
  instanceId: string
  allowedActorIds: string[]
  permissions: RemoteEnvironmentPermission[]
  endpoint: string
  pairingCode: string
  expectedDeviceId: string
  expectedDeviceKey: string
  timeoutMs?: number
}

export interface RemoteEnvironmentState {
  version: 1
  id: string
  instanceId: string
  allowedActorIds: string[]
  permissions: RemoteEnvironmentPermission[]
  endpoint: string
  deviceId: string
  deviceIncarnation: string
  deviceKeyFingerprint: string
  deviceExchangeKey: string
  pairingId: string
  hostExchangePrivate: string
  hostExchangePublic: string
  hostNonce: string
  root: string
}

interface PairResponse {
  v: number
  pairingId: string
  deviceId: string
  signingKey: string
  exchangeKey: string
  signature: string
  sealed: string
}

interface SealedPairing {
  deviceId: string
  incarnation: string
  root: string
  instanceId: string
  environmentId: string
  allowedActorIds: string[]
  permissions: RemoteEnvironmentPermission[]
  pairedAt: number
}

function endpointUrl(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new CoreError('INVALID_CONFIG', 'The device endpoint must be an absolute HTTP URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new CoreError('INVALID_CONFIG', 'The device endpoint cannot carry credentials, a query or a fragment.')
  }
  return url.origin + url.pathname.replace(/\/+$/u, '')
}

async function responseError(response: Response, fallback: string): Promise<CoreError> {
  const body = await response.json().catch(() => undefined) as { code?: unknown; message?: unknown } | undefined
  const code = typeof body?.code === 'string' ? body.code : fallback
  const message = typeof body?.message === 'string' ? body.message : 'The device rejected the request.'
  return new CoreError(code, message)
}

export class RemoteEnvironment implements ExecutionEnvironment {
  readonly kind = 'remote' as const
  readonly config: Readonly<EnvironmentConfig>
  readonly deviceId: string
  readonly deviceIncarnation: string
  readonly deviceKeyFingerprint: string
  readonly endpoint: string
  private readonly identity: KeyPairMaterial
  private readonly key: Buffer
  private readonly pairingId: string
  private readonly deviceExchangeKey: string
  private readonly hostNonce: string
  private readonly requestTimeoutMs: number
  private revokedState = false
  private closed = false
  private onlineState = true

  private constructor(options: RemotePairOptions & { endpoint: string }, pairing: { pairingId: string; deviceId: string;
    deviceIncarnation: string; deviceKeyFingerprint: string; deviceExchangeKey: string; hostNonce: string; root: string;
    identity: KeyPairMaterial; key: Buffer }) {
    this.deviceId = pairing.deviceId
    this.deviceIncarnation = pairing.deviceIncarnation
    this.deviceKeyFingerprint = pairing.deviceKeyFingerprint
    this.endpoint = options.endpoint
    this.identity = pairing.identity
    this.key = pairing.key
    this.pairingId = pairing.pairingId
    this.deviceExchangeKey = pairing.deviceExchangeKey
    this.hostNonce = pairing.hostNonce
    this.requestTimeoutMs = options.timeoutMs ?? 10_000
    const config: EnvironmentConfig = { id: options.id, instanceId: options.instanceId, root: pairing.root,
      allowedActorIds: [...options.allowedActorIds].sort(), permissions: [...options.permissions].sort(), commands: {} }
    Object.freeze(config.allowedActorIds); Object.freeze(config.permissions); Object.freeze(config.commands); Object.freeze(config)
    this.config = config
  }

  static async pair(options: RemotePairOptions): Promise<RemoteEnvironment> {
    if (!options || Object.keys(options).some(key => !['id', 'instanceId', 'allowedActorIds', 'permissions', 'endpoint', 'pairingCode',
      'expectedDeviceId', 'expectedDeviceKey', 'timeoutMs'].includes(key))) {
      throw new CoreError('INVALID_CONFIG', 'Pairing accepts the Environment, actors, permissions, endpoint and pairing code only.')
    }
    identifier(options.id, 'environmentId'); identifier(options.instanceId, 'instanceId'); identifier(options.expectedDeviceId, 'expectedDeviceId')
    if (!Array.isArray(options.allowedActorIds) || !options.allowedActorIds.length) throw new CoreError('INVALID_CONFIG', 'A remote Environment needs explicit actors.')
    for (const actor of options.allowedActorIds) identifier(actor, 'allowedActorId')
    if (!Array.isArray(options.permissions) || !options.permissions.length || new Set(options.permissions).size !== options.permissions.length
      || options.permissions.some(permission => !['read', 'write', 'search'].includes(permission))) {
      throw new CoreError('INVALID_CONFIG', 'A remote Environment permits distinct read, write or search capabilities only.')
    }
    if (typeof options.pairingCode !== 'string' || !options.pairingCode) throw new CoreError('INVALID_CONFIG', 'A pairing code is required.')
    if (typeof options.expectedDeviceKey !== 'string' || !/^[a-f0-9]{64}$/u.test(options.expectedDeviceKey)) {
      throw new CoreError('INVALID_CONFIG', 'Pairing must pin the device signing-key fingerprint.')
    }
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60_000)) {
      throw new CoreError('INVALID_CONFIG', 'The pairing deadline must be between 100 ms and one minute.')
    }
    const endpoint = endpointUrl(options.endpoint)
    const identity = exchangeKeyPair()
    const hostNonce = randomToken()
    const transcript: PairingTranscript = { v: remoteProtocolVersion, instanceId: options.instanceId, environmentId: options.id,
      allowedActorIds: [...options.allowedActorIds].sort(), permissions: [...options.permissions].sort(),
      hostExchangeKey: exportPublicKey(identity.publicKey), hostNonce, expectedDeviceId: options.expectedDeviceId }
    let response: Response
    try {
      response = await fetch(`${endpoint}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: remoteProtocolVersion, transcript, proof: pairingProof(options.pairingCode, transcript) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
    } catch { throw new CoreError('DEVICE_UNAVAILABLE', 'The device could not be reached for pairing.') }
    if (!response.ok) throw await responseError(response, 'PAIRING_FAILED')
    const answer = await response.json().catch(() => undefined)
    if (!plainShape(answer, ['v', 'pairingId', 'deviceId', 'signingKey', 'exchangeKey', 'signature', 'sealed'])
      || answer.v !== remoteProtocolVersion || typeof answer.pairingId !== 'string' || typeof answer.deviceId !== 'string'
      || typeof answer.signingKey !== 'string' || typeof answer.exchangeKey !== 'string' || typeof answer.signature !== 'string'
      || typeof answer.sealed !== 'string') throw new CoreError('PAIRING_FAILED', 'The device returned a malformed pairing response.')
    const paired = answer as unknown as PairResponse
    if (paired.deviceId !== options.expectedDeviceId) throw new CoreError('DEVICE_IDENTITY_MISMATCH', 'The device identity does not match this Environment.')
    const signingKey = importPublicKey(paired.signingKey)
    const fingerprint = publicKeyFingerprint(signingKey)
    if (options.expectedDeviceKey !== fingerprint) {
      throw new CoreError('DEVICE_IDENTITY_MISMATCH', 'The device key does not match the pinned key.')
    }
    if (!verifyPairingResponse(signingKey, transcript, paired.exchangeKey, paired.sealed, paired.signature)) {
      throw new CoreError('PAIRING_FAILED', 'The device did not prove its pairing response.')
    }
    const key = deriveSharedKey(identity.privateKey, importPublicKey(paired.exchangeKey), transcript)
    const sealed = openSealed(key, paired.sealed, transcript)
    if (!plainShape(sealed, ['deviceId', 'incarnation', 'root', 'instanceId', 'environmentId', 'allowedActorIds', 'permissions', 'pairedAt'])
      || typeof sealed.deviceId !== 'string' || typeof sealed.incarnation !== 'string' || typeof sealed.root !== 'string'
      || typeof sealed.instanceId !== 'string' || typeof sealed.environmentId !== 'string' || !Array.isArray(sealed.allowedActorIds)
      || !Array.isArray(sealed.permissions) || typeof sealed.pairedAt !== 'number') {
      throw new CoreError('PAIRING_FAILED', 'The device pairing payload is malformed.')
    }
    const pairing = sealed as unknown as SealedPairing
    if (pairing.deviceId !== paired.deviceId || pairing.instanceId !== options.instanceId || pairing.environmentId !== options.id
      || !isAbsolute(pairing.root) || !sameSet(pairing.allowedActorIds, options.allowedActorIds) || !sameSet(pairing.permissions, options.permissions)) {
      throw new CoreError('GRANT_DENIED', 'The device granted a different Instance, Environment or permission set.')
    }
    return new RemoteEnvironment({ ...options, endpoint }, { pairingId: paired.pairingId, deviceId: pairing.deviceId,
      deviceIncarnation: pairing.incarnation, deviceKeyFingerprint: fingerprint, deviceExchangeKey: paired.exchangeKey,
      hostNonce, root: pairing.root, identity, key })
  }

  static restore(state: RemoteEnvironmentState): RemoteEnvironment {
    if (!plainShape(state, ['version', 'id', 'instanceId', 'allowedActorIds', 'permissions', 'endpoint', 'deviceId',
      'deviceIncarnation', 'deviceKeyFingerprint', 'deviceExchangeKey', 'pairingId', 'hostExchangePrivate',
      'hostExchangePublic', 'hostNonce', 'root'])
      || state.version !== 1 || typeof state.id !== 'string' || typeof state.instanceId !== 'string'
      || !Array.isArray(state.allowedActorIds) || !Array.isArray(state.permissions) || typeof state.endpoint !== 'string'
      || typeof state.deviceId !== 'string' || typeof state.deviceIncarnation !== 'string' || typeof state.deviceKeyFingerprint !== 'string'
      || typeof state.deviceExchangeKey !== 'string' || typeof state.pairingId !== 'string' || typeof state.hostExchangePrivate !== 'string'
      || typeof state.hostExchangePublic !== 'string' || typeof state.hostNonce !== 'string' || typeof state.root !== 'string'
      || !isAbsolute(state.root) || !state.allowedActorIds.length || !state.permissions.length
      || !/^[a-f0-9]{64}$/u.test(state.deviceKeyFingerprint)
      || state.permissions.some(permission => !['read', 'write', 'search'].includes(permission))) {
      throw new CoreError('INVALID_CONFIG', 'The saved remote connection is malformed.')
    }
    identifier(state.id, 'environmentId'); identifier(state.instanceId, 'instanceId'); identifier(state.deviceId, 'deviceId')
    for (const actor of state.allowedActorIds) identifier(actor, 'allowedActorId')
    const identity = { privateKey: importPrivateKey(state.hostExchangePrivate), publicKey: importPublicKey(state.hostExchangePublic) }
    const transcript: PairingTranscript = { v: remoteProtocolVersion, instanceId: state.instanceId, environmentId: state.id,
      allowedActorIds: [...state.allowedActorIds].sort(), permissions: [...state.permissions].sort(),
      hostExchangeKey: state.hostExchangePublic, hostNonce: state.hostNonce, expectedDeviceId: state.deviceId }
    const key = deriveSharedKey(identity.privateKey, importPublicKey(state.deviceExchangeKey), transcript)
    return new RemoteEnvironment({ id: state.id, instanceId: state.instanceId, allowedActorIds: state.allowedActorIds,
      permissions: state.permissions, endpoint: endpointUrl(state.endpoint), pairingCode: '', expectedDeviceId: state.deviceId,
      expectedDeviceKey: state.deviceKeyFingerprint }, { pairingId: state.pairingId, deviceId: state.deviceId,
      deviceIncarnation: state.deviceIncarnation, deviceKeyFingerprint: state.deviceKeyFingerprint,
      deviceExchangeKey: state.deviceExchangeKey, hostNonce: state.hostNonce, root: state.root, identity, key })
  }

  snapshot(): RemoteEnvironmentState {
    if (this.closed) throw new CoreError('ENVIRONMENT_CLOSED', 'The remote Environment is closed.')
    if (this.revokedState) throw new CoreError('DEVICE_REVOKED', 'A revoked device connection cannot be exported again.')
    return { version: 1, id: this.config.id, instanceId: this.config.instanceId, allowedActorIds: [...this.config.allowedActorIds],
      permissions: [...this.config.permissions] as RemoteEnvironmentPermission[], endpoint: this.endpoint, deviceId: this.deviceId,
      deviceIncarnation: this.deviceIncarnation, deviceKeyFingerprint: this.deviceKeyFingerprint,
      deviceExchangeKey: this.deviceExchangeKey, pairingId: this.pairingId,
      hostExchangePrivate: this.identity.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      hostExchangePublic: exportPublicKey(this.identity.publicKey), hostNonce: this.hostNonce, root: this.config.root }
  }

  get revoked() { return this.revokedState }
  get online() { return this.onlineState && !this.revokedState && !this.closed }

  authorize(identity: { instanceId: string; actorId: string }) {
    if (this.closed) throw new CoreError('ENVIRONMENT_CLOSED', 'The remote Environment is closed.')
    if (this.revokedState) throw new CoreError('DEVICE_REVOKED', 'This device connection was revoked.')
    if (identity.instanceId !== this.config.instanceId || !this.config.allowedActorIds.includes(identity.actorId)) {
      throw new CoreError('ENVIRONMENT_DENIED', 'This actor or Instance cannot use the remote Environment.')
    }
  }

  async prepare(identity: { instanceId: string; actorId: string }, signal?: AbortSignal): Promise<PreparedEnvironment> {
    this.authorize(identity)
    const status = await this.call({ instanceId: identity.instanceId, environmentId: this.config.id, actorId: identity.actorId, operation: 'status', args: {} }, signal)
    if (!plainShape(status, ['deviceId', 'incarnation', 'root', 'instanceId', 'environmentId', 'permissions', 'allowedActorIds'])
      || status.deviceId !== this.deviceId || status.incarnation !== this.deviceIncarnation || status.root !== this.config.root
      || status.instanceId !== this.config.instanceId || status.environmentId !== this.config.id) {
      throw new CoreError('ENVIRONMENT_CHANGED', 'The paired device identity or working directory changed.')
    }
    this.onlineState = true
    return new RemoteBoundEnvironment(this, identity)
  }

  async revoke(signal?: AbortSignal) {
    if (this.closed) throw new CoreError('ENVIRONMENT_CLOSED', 'The remote Environment is closed.')
    if (this.revokedState) return
    try {
      await this.call({ instanceId: this.config.instanceId, environmentId: this.config.id, actorId: this.config.allowedActorIds[0]!, operation: 'revoke', args: {} }, signal, true)
    } finally {
      // The host side stops using the connection even when the device acknowledgement is lost.
      this.revokedState = true
      this.onlineState = false
    }
  }

  async close() {
    this.closed = true
    this.onlineState = false
  }

  async call(request: RemoteRequest,
    signal?: AbortSignal, permitRevoke = false): Promise<unknown> {
    if (this.closed) throw new CoreError('ENVIRONMENT_CLOSED', 'The remote Environment is closed.')
    if (this.revokedState && !permitRevoke) throw new CoreError('DEVICE_REVOKED', 'This device connection was revoked.')
    const requestId = randomToken(18)
    const at = Date.now()
    let response: Response
    try {
      const deadline = AbortSignal.timeout(this.requestTimeoutMs)
      response = await fetch(`${this.endpoint}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: remoteProtocolVersion, pairingId: this.pairingId, requestId, at,
          body: seal(this.key, request, { v: remoteProtocolVersion, pairingId: this.pairingId, requestId, at }) }),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline })
    } catch {
      this.onlineState = false
      throw new CoreError('DEVICE_UNAVAILABLE', 'The paired device is unavailable; no local substitute was used.')
    }
    if (!response.ok) {
      const error = await responseError(response, 'DEVICE_AUTH_FAILED')
      if (response.status === 401 && ['DEVICE_REVOKED', 'DEVICE_AUTH_FAILED'].includes(error.code)) {
        this.revokedState = error.code === 'DEVICE_REVOKED'
        this.onlineState = false
      }
      throw error
    }
    const answer = await response.json().catch(() => undefined)
    if (!plainShape(answer, ['v', 'requestId', 'body']) || answer.v !== remoteProtocolVersion
      || answer.requestId !== requestId || typeof answer.body !== 'string') {
      throw new CoreError('DEVICE_AUTH_FAILED', 'The device response is malformed.')
    }
    const opened = openSealed(this.key, answer.body, { v: remoteProtocolVersion, requestId })
    if (!plainShape(opened, ['ok', 'result', 'code', 'message']) || typeof opened.ok !== 'boolean') {
      throw new CoreError('DEVICE_AUTH_FAILED', 'The device response has an invalid shape.')
    }
    this.onlineState = true
    if (!opened.ok) throw new CoreError(typeof opened.code === 'string' ? opened.code : 'DEVICE_FAILED',
      typeof opened.message === 'string' ? opened.message : 'The device operation failed.')
    return opened.result
  }

  sanitize(text: string) {
    return sanitizeSecrets(text).split(this.config.root).join('<device-workdir>')
  }
}

class RemoteBoundEnvironment implements PreparedEnvironment {
  readonly cwd: string
  constructor(private readonly owner: RemoteEnvironment, private readonly identity: { instanceId: string; actorId: string }) {
    this.cwd = owner.config.root
  }

  async invoke(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    this.owner.authorize(this.identity)
    if (name === 'run_command') throw new CoreError('UNSUPPORTED_CAPABILITY', 'This device exposes no command or process capability.')
    if (name === 'read_file') {
      this.permission('read')
      return this.call('file.read', { path: this.relativePath(args.path) }, signal)
    }
    if (name === 'write_file') {
      this.permission('write')
      if (typeof args.text !== 'string' || Buffer.byteLength(args.text) > 65536) throw new CoreError('INVALID_INPUT', 'File writes are limited to 65536 UTF-8 bytes.')
      return this.call('file.write', { path: this.relativePath(args.path), text: args.text }, signal)
    }
    if (name === 'glob' || name === 'grep') {
      this.permission('search')
      if (name === 'grep') this.permission('read')
      if (!args.pattern || args.pattern.length > 256) throw new CoreError('INVALID_INPUT', 'Search needs a bounded nonempty pattern.')
      return this.call(name === 'glob' ? 'file.glob' : 'file.grep', { pattern: args.pattern }, signal)
    }
    throw new CoreError('UNSUPPORTED_CAPABILITY', 'This remote tool combination is not enabled.')
  }

  async artifact(path: string, signal?: AbortSignal): Promise<Artifact> {
    this.owner.authorize(this.identity)
    this.permission('read')
    const result = await this.call('file.artifact', { path: this.relativePath(path) }, signal)
    if (!plainShape(result, ['path', 'bytes', 'sha256']) || typeof result.path !== 'string' || typeof result.bytes !== 'number' || typeof result.sha256 !== 'string') {
      throw new CoreError('DEVICE_FAILED', 'The device returned an invalid artifact.')
    }
    return { path: result.path, bytes: result.bytes, sha256: result.sha256 }
  }

  sanitize(text: string) { return this.owner.sanitize(text) }

  private permission(name: RemoteEnvironmentPermission) {
    if (!this.owner.config.permissions.includes(name)) throw new CoreError('PERMISSION_DENIED', 'This remote capability was not enabled by the deployment.')
  }

  private relativePath(value: string | undefined) {
    if (typeof value !== 'string' || !value) throw new CoreError('INVALID_INPUT', 'A remote file operation needs one relative path.')
    return value
  }

  private async call(operation: RemoteOperation, args: Record<string, string>, signal?: AbortSignal) {
    return this.owner.call({ instanceId: this.identity.instanceId, environmentId: this.owner.config.id, actorId: this.identity.actorId, operation, args }, signal) as Promise<Record<string, unknown>>
  }
}
