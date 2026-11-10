import { CoreError } from './model.js'

export const maxStoredRecordBytes = 131072
export const maxQueryLimit = 101

export function validateQueryLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxQueryLimit) {
    throw new CoreError('INVALID_INPUT', `Query limit must be between 1 and ${maxQueryLimit}.`)
  }
}

export function validateStoredRecord(value: unknown) {
  const body = JSON.stringify(value)
  if (typeof body !== 'string' || Buffer.byteLength(body) > maxStoredRecordBytes) {
    throw new CoreError('INVALID_INPUT', 'Record exceeds storage limits.')
  }
  return body
}
