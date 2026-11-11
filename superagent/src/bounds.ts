import { CoreError } from './model.js'

/** Validate one bounded integer option without silently clamping it. */
export function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new CoreError('INVALID_CONFIG', `${name} must be between ${String(minimum)} and ${String(maximum)}.`)
  return result
}
