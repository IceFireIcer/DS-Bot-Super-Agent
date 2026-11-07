import { CoreError } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export function canonicalJson(value: unknown): string {
  const visited = new Set<object>()
  const encode = (input: unknown, depth: number): unknown => {
    if (depth > 32) throw new CoreError('INVALID_INPUT', 'JSON nesting exceeds the input budget.')
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number' && Number.isFinite(input)) return input
    if (!input || typeof input !== 'object' || visited.has(input)) throw new CoreError('INVALID_INPUT', 'Payload must contain acyclic JSON values.')
    if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new CoreError('INVALID_INPUT', 'Payload must contain plain JSON objects.')
    visited.add(input)
    const output = Array.isArray(input) ? Array.from(input, item => encode(item, depth + 1))
      : Object.fromEntries(Object.keys(input).sort().map(key => [key, encode((input as Record<string, unknown>)[key], depth + 1)]))
    visited.delete(input)
    return output
  }
  return JSON.stringify(encode(value, 0))
}

export async function commandTransaction<Result>(storage: Storage, instanceId: string, operation: (transaction: AsyncTx) => Promise<Result>): Promise<Result> {
  let connection = storage
  let unknown = false
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await connection.transaction(instanceId, operation) }
      catch (error) {
        const code = error instanceof CoreError ? error.code : ''
        if (code === 'COMMIT_UNKNOWN') unknown = true
        else if (!['SERIALIZATION_FAILURE', 'DEADLOCK', '40001', '40P01'].includes(code)) {
          if (unknown && ['LOCK_TIMEOUT', 'STORAGE_UNAVAILABLE', 'STORAGE_CLOSED'].includes(code)) throw new CoreError('COMMIT_UNKNOWN', 'The original command cannot yet be reconciled under the instance write lock.')
          throw error
        }
        if (attempt === 2) throw new CoreError(unknown ? 'COMMIT_UNKNOWN' : 'RETRY_EXHAUSTED', 'The bounded command retry budget was exhausted; preserve the original command ID.')
        if (unknown) {
          if (connection !== storage) await connection.close().catch(() => {})
          try { connection = await storage.reconnect() }
          catch { throw new CoreError('COMMIT_UNKNOWN', 'A fresh connection could not verify the original command.') }
        }
      }
    }
    throw new CoreError('RETRY_EXHAUSTED', 'The command retry budget was exhausted.')
  } finally { if (connection !== storage) await connection.close().catch(() => {}) }
}
