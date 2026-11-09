import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto'
import { canonicalJson } from './commands.js'
import { CoreError } from './model.js'

export const remoteProtocolVersion = 3
export const remoteProtocolInfo = 'superagent-remote-v3'
export type RemotePermission = 'read' | 'write' | 'search' | 'command'
export type RemoteOperation = 'status' | 'revoke' | 'file.read' | 'file.write' | 'file.glob' | 'file.grep' | 'file.artifact'
  | 'command.resolve' | 'command.start' | 'command.inspect' | 'command.cancel'
  | 'terminal.write' | 'terminal.resize'

/** The evidence a device retains when it reopens a job record after a daemon restart. */
export interface RemoteJobRecovery {
  observedAt: number
  kind: 'live-process' | 'log-only' | 'identity-changed' | 'unverifiable'
  processAlive: 'alive' | 'gone' | 'unknown'
  rangeAlive: 'alive' | 'gone' | 'unknown'
  rangeEvidence: 'posix-proc' | 'pid' | 'none'
  reason: string
}

/** Bounded command facts a paired Host may list; argv and environment stay on the device. */
export interface RemoteCommandSpec {
  timeoutMs: number
  backgroundTimeoutMs?: number
  pty?: boolean
}

export const remoteForegroundTimeoutMin = 50
export const remoteForegroundTimeoutMax = 10000
export const remoteBackgroundTimeoutMax = 3600000
export const remoteJobIdMaxBytes = 512

export function validRemoteCommandSpec(spec: RemoteCommandSpec) {
  return Number.isInteger(spec.timeoutMs) && spec.timeoutMs >= remoteForegroundTimeoutMin && spec.timeoutMs <= remoteForegroundTimeoutMax
    && (spec.backgroundTimeoutMs === undefined || Number.isInteger(spec.backgroundTimeoutMs)
      && spec.backgroundTimeoutMs >= spec.timeoutMs && spec.backgroundTimeoutMs <= remoteBackgroundTimeoutMax)
    && (spec.pty === undefined || typeof spec.pty === 'boolean')
}

export function remoteJobIdPrefix(instanceId: string, environmentId: string, incarnation: string) {
  return `job:${instanceId}:${environmentId}:${incarnation}:`
}

export function validateRemoteJobId(jobId: unknown, prefix: string): jobId is string {
  return typeof jobId === 'string' && jobId.startsWith(prefix) && Buffer.byteLength(jobId) <= remoteJobIdMaxBytes
}

export interface RemoteRequest {
  instanceId: string
  environmentId: string
  actorId: string
  operation: RemoteOperation
  args: Record<string, string>
}

export interface KeyPairMaterial {
  privateKey: KeyObject
  publicKey: KeyObject
}

export interface PairingTranscript {
  v: number
  instanceId: string
  environmentId: string
  allowedActorIds: string[]
  permissions: RemotePermission[]
  hostExchangeKey: string
  hostNonce: string
  expectedDeviceId: string
}

export function plainShape(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).every(key => keys.includes(key))
}

export function sameSet(left: string[], right: string[]) {
  const a = [...left].sort()
  const b = [...right].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function exchangeKeyPair(): KeyPairMaterial {
  return generateKeyPairSync('x25519')
}

export function signingKeyPair(): KeyPairMaterial {
  return generateKeyPairSync('ed25519')
}

export function exportPublicKey(key: KeyObject): string {
  return key.export({ format: 'der', type: 'spki' }).toString('base64')
}

export function exportPrivateKey(key: KeyObject): string {
  return key.export({ format: 'der', type: 'pkcs8' }).toString('base64')
}

export function importPublicKey(value: string): KeyObject {
  try { return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' }) }
  catch { throw new CoreError('DEVICE_AUTH_FAILED', 'The device public key is invalid.') }
}

export function importPrivateKey(value: string): KeyObject {
  try { return createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' }) }
  catch { throw new CoreError('DEVICE_AUTH_FAILED', 'The device private key is invalid.') }
}

export function publicKeyFingerprint(key: KeyObject) {
  return createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex')
}

export function pairingProof(pairingCode: string, transcript: PairingTranscript) {
  return createHmac('sha256', pairingCode).update(canonicalJson(transcript)).digest('hex')
}

export function verifyPairingProof(pairingCode: string, transcript: PairingTranscript, proof: string) {
  const expected = Buffer.from(pairingProof(pairingCode, transcript))
  const supplied = Buffer.from(proof)
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

export function signPairingResponse(privateKey: KeyObject, transcript: PairingTranscript, exchangeKey: string, sealed: string) {
  return sign(null, Buffer.from(canonicalJson({ transcript, exchangeKey, sealed })), privateKey).toString('base64url')
}

export function verifyPairingResponse(publicKey: KeyObject, transcript: PairingTranscript, exchangeKey: string, sealed: string, signature: string) {
  try { return verify(null, Buffer.from(canonicalJson({ transcript, exchangeKey, sealed })), publicKey, Buffer.from(signature, 'base64url')) }
  catch { return false }
}

export function deriveSharedKey(privateKey: KeyObject, publicKey: KeyObject, transcript: PairingTranscript) {
  const shared = diffieHellman({ privateKey, publicKey })
  const salt = createHash('sha256').update(canonicalJson(transcript)).digest()
  return Buffer.from(hkdfSync('sha256', shared, salt, remoteProtocolInfo, 32))
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

function aadValue(value: unknown) {
  return Buffer.from(canonicalJson(value))
}

export function seal(key: Buffer, value: unknown, aad: unknown) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aadValue(aad))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJson(value))), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export function openSealed(key: Buffer, sealed: string, aad: unknown): unknown {
  let payload: Buffer
  try { payload = Buffer.from(sealed, 'base64url') }
  catch { throw new CoreError('DEVICE_AUTH_FAILED', 'The protected message is invalid.') }
  if (payload.length < 29) throw new CoreError('DEVICE_AUTH_FAILED', 'The protected message is incomplete.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
    decipher.setAAD(aadValue(aad))
    decipher.setAuthTag(payload.subarray(12, 28))
    const plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()])
    return JSON.parse(plaintext.toString('utf8'))
  } catch {
    // Authentication failures are deliberately indistinguishable from malformed envelopes.
    throw new CoreError('DEVICE_AUTH_FAILED', 'The protected message could not be authenticated.')
  }
}
