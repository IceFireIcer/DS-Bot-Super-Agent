// The copied DS Bot UI still speaks /api/bot. This wrapper mounts the existing
// DS Bot Host server without its client bundle, and requires the Super-agent
// execution adapter so work does not fall back to the old core.
import * as DsBot from 'ds-bot'

export const name = 'ds-superagent-host'
export const inject = DsBot.inject
export const apply = DsBot.apply
