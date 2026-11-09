import { CoreError } from './model.js'
import type { Storage } from './storage.js'
import type { Engine } from './engine.js'
import type { SourceReceipt } from './source-events.js'

interface Cursor { cursor: string; updatedAt: number }
const cursorKey = (sourceInstanceId: string) => JSON.stringify(['channel-cursor', sourceInstanceId])

class CursorStore {
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly now: () => number = Date.now) {}
  async read(sourceInstanceId: string) {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<Cursor>('channel-cursor', cursorKey(sourceInstanceId)))
  }
  async write(sourceInstanceId: string, cursor: string) {
    const record: Cursor = { cursor, updatedAt: this.now() }
    await this.storage.transaction(this.instanceId, async transaction => {
      if (!await transaction.replace('channel-cursor', cursorKey(sourceInstanceId), record)) await transaction.insert('channel-cursor', cursorKey(sourceInstanceId), record)
    })
  }
}

export interface GitHubEvent {
  deliveryId: string
  cursor: string
  repo: string
  kind: 'issue' | 'pull_request' | 'review' | 'ci' | 'comment'
  action: 'created' | 'edited' | 'deleted' | 'closed' | 'reopened' | 'synchronize' | 'reviewed' | 'completed'
  number: number
  id: string
  authorId: string
  authorKind?: 'human' | 'bot' | 'ci' | 'system'
  title?: string
  body?: string
  updatedAt: string
  deletionEvidence?: string
  draft?: boolean
  state?: 'open' | 'closed' | 'merged'
}

export interface GitHubSourceConfig {
  owner: string
  repo: string
  selfActorIds?: string[]
}

function githubObjectId(event: GitHubEvent) {
  if (event.kind === 'issue') return `issue:${event.number}`
  if (event.kind === 'pull_request') return `pr:${event.number}`
  return `pr:${event.number}:${event.kind}:${event.id}`
}

export class GitHubSource {
  readonly sourceInstanceId: string
  private readonly cursors: CursorStore
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly engine: Engine, private readonly config: GitHubSourceConfig, now: () => number = Date.now) {
    if (!config?.owner || !config?.repo) throw new CoreError('INVALID_CONFIG', 'A GitHub source needs owner and repo.')
    this.sourceInstanceId = `github:${config.owner}/${config.repo}`
    this.cursors = new CursorStore(storage, instanceId, now)
  }

  async cursor() { return (await this.cursors.read(this.sourceInstanceId))?.cursor }

  async receive(event: GitHubEvent): Promise<SourceReceipt> {
    if (!event || event.repo !== `${this.config.owner}/${this.config.repo}`) throw new CoreError('SOURCE_SCOPE_DENIED', 'The GitHub event belongs to another repository.')
    if (!Number.isInteger(event.number) || event.number < 1) throw new CoreError('INVALID_INPUT', 'A GitHub event needs a positive issue or pull request number.')
    if (this.config.selfActorIds?.includes(event.authorId)) {
      await this.cursors.write(this.sourceInstanceId, event.cursor)
      return { status: 'filtered', reason: 'SOURCE_SELF' }
    }
    const threadId = `github:${this.config.owner}/${this.config.repo}#${event.number}`
    const objectId = githubObjectId(event)
    const type = event.action === 'deleted' ? 'deleted' : event.action === 'edited' || event.action === 'synchronize' ? 'edited' : 'created'
    const body = githubBody(event)
    const receipt = await this.engine.receiveSource({ commandId: `github:${event.deliveryId}`, threadId, objectId, type,
      version: sequenceVersion(event),
      ...(type === 'deleted' ? { deletionEvidence: event.deletionEvidence ?? `GitHub deleted ${event.kind} ${event.id}.` } : { text: body }),
      authorId: event.authorId, authorKind: event.authorKind ?? (event.authorId.endsWith('[bot]') ? 'bot' : 'human'),
      addressing: event.kind === 'review' || event.kind === 'comment' ? 'mention' : 'direct' })
    await this.cursors.write(this.sourceInstanceId, event.cursor)
    return receipt
  }

  /** Process an ordered delivery page, advancing the durable cursor only after each event is recorded. */
  async poll(events: GitHubEvent[]) {
    if (!Array.isArray(events) || events.length > 1000) throw new CoreError('INVALID_INPUT', 'A GitHub poll accepts at most 1000 ordered events.')
    const prior = await this.cursor()
    let processed = 0, filtered = 0, malformed = 0, failed = 0
    for (const event of [...events].sort((left, right) => compareCursor(left.cursor, right.cursor))) {
      if (prior !== undefined && event.cursor <= prior) continue
      try {
        const receipt = await this.receive(event)
        if (receipt.status === 'recorded') processed++
        else filtered++
      } catch (error) {
        if (error instanceof CoreError && ['SOURCE_SCOPE_DENIED', 'INVALID_INPUT', 'NOT_FOUND'].includes(error.code)) {
          malformed++
          await this.cursors.write(this.sourceInstanceId, event.cursor)
          continue
        }
        failed++
        break
      }
    }
    return { processed, filtered, malformed, failed, cursor: await this.cursor() }
  }
}

/** Keep an adapter-provided canonical sequence; derive one only for composite API cursors. */
function sequenceVersion(event: GitHubEvent) {
  return /^(?:0|[1-9][0-9]{0,39})$/u.test(event.cursor) ? event.cursor : nativeVersion(event.updatedAt, event.id)
}

function githubBody(event: GitHubEvent) {
  const detail = event.body ?? event.title ?? ''
  switch (event.kind) {
    case 'pull_request': return `Pull request #${event.number} ${event.action}${event.draft ? ' (draft)' : event.state ? ` (${event.state})` : ''}.\n\n${detail}`
    case 'review': return `Pull request #${event.number} review.\n\n${detail}`
    case 'ci': return `Pull request #${event.number} CI ${event.action}.\n\n${detail}`
    default: return `Issue #${event.number} ${event.action}.\n\n${detail}`
  }
}

const versionMillisWidth = 1000000000000n
const versionIdDigits = 12

/** A sequence-compatible native version ordered by GitHub's timestamp, with the resource ID as a tie-break. */
function nativeVersion(updatedAt: string, id: string) {
  const millis = Date.parse(updatedAt)
  const tail = BigInt(String(id).replace(/\D/gu, '').slice(-versionIdDigits) || '0')
  return ((BigInt(Number.isFinite(millis) ? millis : Date.now()) * versionMillisWidth) + tail).toString()
}

export interface FeishuEvent {
  eventId: string
  cursor: string
  tenantKey: string
  chatId: string
  messageId: string
  senderId: string
  senderKind?: 'human' | 'bot' | 'system'
  text?: string
  createTime: string
  deleted?: boolean
  deletionEvidence?: string
}

export interface FeishuSourceConfig {
  tenantKey: string
  chatIds: string[]
  selfActorIds?: string[]
}

export class FeishuSource {
  readonly sourceInstanceId: string
  private readonly cursors: CursorStore
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly engine: Engine, private readonly config: FeishuSourceConfig, now: () => number = Date.now) {
    if (!config?.tenantKey || !Array.isArray(config?.chatIds) || !config.chatIds.length || config.chatIds.length > 100) throw new CoreError('INVALID_CONFIG', 'A Feishu source needs a tenant and one to one hundred chat scopes.')
    this.sourceInstanceId = `feishu:${config.tenantKey}:${[...config.chatIds].sort().join(',')}`
    this.cursors = new CursorStore(storage, instanceId, now)
  }

  async cursor() { return (await this.cursors.read(this.sourceInstanceId))?.cursor }

  async receive(event: FeishuEvent): Promise<SourceReceipt> {
    if (!event || event.tenantKey !== this.config.tenantKey || !this.config.chatIds.includes(event.chatId)) {
      throw new CoreError('SOURCE_SCOPE_DENIED', 'The Feishu event is outside the configured tenant or chat scope.')
    }
    if (this.config.selfActorIds?.includes(event.senderId)) {
      await this.cursors.write(this.sourceInstanceId, event.cursor)
      return { status: 'filtered', reason: 'SOURCE_SELF' }
    }
    const threadId = `feishu:${this.config.tenantKey}:${event.chatId}`
    const objectId = `message:${event.messageId}`
    const receipt = await this.engine.receiveSource({ commandId: `feishu:${event.eventId}`, threadId, objectId,
      type: event.deleted ? 'deleted' : 'created', version: `${event.createTime}:${event.eventId}`,
      ...(event.deleted ? { deletionEvidence: event.deletionEvidence ?? `Feishu deleted message ${event.messageId}.` } : { text: event.text ?? '' }),
      authorId: event.senderId, authorKind: event.senderKind ?? 'human', addressing: 'direct' })
    await this.cursors.write(this.sourceInstanceId, event.cursor)
    return receipt
  }

  async poll(events: FeishuEvent[]) {
    if (!Array.isArray(events) || events.length > 1000) throw new CoreError('INVALID_INPUT', 'A Feishu poll accepts at most 1000 ordered events.')
    const prior = await this.cursor()
    let processed = 0, filtered = 0, malformed = 0, failed = 0
    for (const event of [...events].sort((left, right) => compareCursor(left.cursor, right.cursor))) {
      if (prior !== undefined && event.cursor <= prior) continue
      try {
        const receipt = await this.receive(event)
        if (receipt.status === 'recorded') processed++
        else filtered++
      } catch (error) {
        if (error instanceof CoreError && ['SOURCE_SCOPE_DENIED', 'INVALID_INPUT', 'NOT_FOUND'].includes(error.code)) {
          malformed++
          await this.cursors.write(this.sourceInstanceId, event.cursor)
          continue
        }
        failed++
        break
      }
    }
    return { processed, filtered, malformed, failed, cursor: await this.cursor() }
  }
}

function compareCursor(left: string, right: string) {
  if (/^(?:0|[1-9][0-9]{0,39})$/u.test(left) && /^(?:0|[1-9][0-9]{0,39})$/u.test(right)) {
    const a = BigInt(left), b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  return left.localeCompare(right)
}

export interface ScheduleConfig {
  ruleId: string
  timezone: string
  intervalMs: number
  text: string
  catchUp?: 'skip' | 'once' | 'all'
  maxCatchUp?: number
}

export interface ScheduleRule extends ScheduleConfig { revision: number; createdAt: number; updatedAt: number }
export interface ScheduleOccurrence {
  ruleId: string
  revision: number
  occurrence: number
  eventId: string
  recordedAt: number
}
interface ScheduleState { ruleId: string; lastOccurrence: number; lastLocal?: number; revision: number; updatedAt: number }
const scheduleKey = (ruleId: string) => JSON.stringify(['schedule-state', ruleId])
const scheduleRuleKey = (ruleId: string) => JSON.stringify(['schedule-rule', ruleId])
const scheduleRuleHistoryAfter = (ruleId: string) => scheduleRuleKey(ruleId)
const scheduleRuleHistoryKey = (ruleId: string, revision: number) => `${scheduleRuleKey(ruleId)}:${String(revision).padStart(6, '0')}`
const scheduleOccurrencePrefix = (ruleId: string) => JSON.stringify(['schedule-occurrence', ruleId])
const scheduleOccurrenceOrderMax = 9_007_199_254_740_991
const scheduleOccurrenceKey = (ruleId: string, occurrence: number) => `${scheduleOccurrencePrefix(ruleId)}:${String(scheduleOccurrenceOrderMax - occurrence).padStart(16, '0')}`

/** Occurrences are identified by the rule's local wall clock, so a repeated hour cannot fire twice. */
function localBoundary(instant: number, timeZone: string, interval: number) {
  return Math.floor((instant + zoneOffsetMs(timeZone, instant)) / interval) * interval
}

function zoneOffsetMs(timeZone: string, instant: number) {
  const second = instant - (((instant % 1000) + 1000) % 1000)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(second))
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value)
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - second
}

/** Return the real instant for a local wall time, or undefined when the local time never existed. */
function localToInstant(local: number, timeZone: string) {
  const first = local - zoneOffsetMs(timeZone, local)
  if (first + zoneOffsetMs(timeZone, first) === local) return first
  const second = local - zoneOffsetMs(timeZone, first)
  if (second + zoneOffsetMs(timeZone, second) === local) return second
  return undefined
}

function existingInstant(local: number, timeZone: string) {
  const instant = localToInstant(local, timeZone)
  if (instant === undefined) throw new CoreError('INCOMPLETE_STATE', 'A derived schedule boundary has no real instant.')
  return instant
}

function sameRuleConfig(left: ScheduleConfig, right: ScheduleConfig) {
  return left.ruleId === right.ruleId && left.timezone === right.timezone && left.intervalMs === right.intervalMs
    && left.text === right.text && (left.catchUp ?? null) === (right.catchUp ?? null) && (left.maxCatchUp ?? null) === (right.maxCatchUp ?? null)
}

export class ScheduleSource {
  readonly sourceInstanceId: string
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly engine: Engine, private readonly config: ScheduleConfig, private readonly now: () => number = Date.now) {
    if (!config?.ruleId || !config?.timezone || !Number.isInteger(config?.intervalMs) || config.intervalMs < 1000) throw new CoreError('INVALID_CONFIG', 'A schedule needs a rule ID, timezone and interval of at least one second.')
    if (typeof config.text !== 'string' || !config.text.trim() || Buffer.byteLength(config.text) > 65536) throw new CoreError('INVALID_CONFIG', 'A schedule needs bounded non-empty text.')
    try { new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }) } catch { throw new CoreError('INVALID_CONFIG', 'The schedule timezone is not recognized.') }
    if (config.catchUp !== undefined && !['skip', 'once', 'all'].includes(config.catchUp)) throw new CoreError('INVALID_CONFIG', 'Schedule catch-up is skip, once or all.')
    if (config.maxCatchUp !== undefined && (!Number.isInteger(config.maxCatchUp) || config.maxCatchUp < 1 || config.maxCatchUp > 100)) throw new CoreError('INVALID_CONFIG', 'Schedule catch-up is bounded at 100 occurrences.')
    this.sourceInstanceId = `schedule:${config.ruleId}`
  }

  async tick(now = this.now()) {
    const rule = await this.ensureRule()
    const state = await this.storage.transaction(this.instanceId, transaction => transaction.get<ScheduleState>('schedule-state', scheduleKey(rule.ruleId)))
    const receipts = []
    for (const occurrence of this.selectOccurrences(rule, state, now)) {
      const receipt = await this.engine.receiveSource({ commandId: `schedule:${rule.ruleId}:${occurrence}`,
        threadId: `schedule:${rule.ruleId}`, objectId: `occurrence:${occurrence}`, type: 'created', version: String(occurrence),
        text: rule.text, authorId: 'schedule', authorKind: 'system', addressing: 'direct' })
      await this.recordOccurrence(rule, occurrence, receipt)
      receipts.push({ occurrence, receipt })
    }
    return { ruleId: rule.ruleId, timezone: rule.timezone, revision: rule.revision, occurrences: receipts }
  }

  private selectOccurrences(rule: ScheduleRule, state: ScheduleState | undefined, now: number) {
    const interval = rule.intervalMs
    const latestLocal = localBoundary(now, rule.timezone, interval)
    const lastLocal = state === undefined ? undefined
      : state.revision === rule.revision && state.lastLocal !== undefined ? state.lastLocal
        : localBoundary(state.lastOccurrence, rule.timezone, interval)
    if (lastLocal === undefined) return [existingInstant(latestLocal, rule.timezone)]
    if (latestLocal <= lastLocal) return []
    if (rule.catchUp === 'skip') return [existingInstant(latestLocal, rule.timezone)]
    if (rule.catchUp === 'once') {
      const limit = rule.maxCatchUp ?? 10
      for (let index = 1; index <= limit; index++) {
        const slot = lastLocal + index * interval
        if (slot > latestLocal) return []
        const instant = localToInstant(slot, rule.timezone)
        if (instant !== undefined) return [instant]
      }
      return []
    }
    const limit = rule.maxCatchUp ?? 10
    const start = Math.max(lastLocal + interval, latestLocal - (limit - 1) * interval)
    const slots = Array.from({ length: Math.min(limit, Math.floor((latestLocal - start) / interval) + 1) }, (_, index) => start + index * interval)
    return slots.flatMap(slot => {
      const instant = localToInstant(slot, rule.timezone)
      return instant === undefined ? [] : [instant]
    })
  }

  private async recordOccurrence(rule: ScheduleRule, occurrence: number, receipt: { eventId?: string }) {
    await this.storage.transaction(this.instanceId, async transaction => {
      const next: ScheduleState = { ruleId: rule.ruleId, lastOccurrence: occurrence,
        lastLocal: localBoundary(occurrence, rule.timezone, rule.intervalMs), revision: rule.revision, updatedAt: this.now() }
      if (!await transaction.replace('schedule-state', scheduleKey(rule.ruleId), next)) await transaction.insert('schedule-state', scheduleKey(rule.ruleId), next)
      const evidence: ScheduleOccurrence = { ruleId: rule.ruleId, revision: rule.revision, occurrence,
        eventId: receipt.eventId ?? `schedule:${rule.ruleId}:${occurrence}`, recordedAt: this.now() }
      const key = scheduleOccurrenceKey(rule.ruleId, occurrence)
      if (!await transaction.replace('schedule-occurrence', key, evidence)) await transaction.insert('schedule-occurrence', key, evidence)
    })
  }

  private ensureRule(): Promise<ScheduleRule> {
    return this.storage.transaction(this.instanceId, async transaction => {
      const desired: ScheduleConfig = { ...this.config }
      const current = await transaction.get<ScheduleRule>('schedule-rule', scheduleRuleKey(desired.ruleId))
      if (!current) {
        const rule: ScheduleRule = { ...desired, revision: 1, createdAt: this.now(), updatedAt: this.now() }
        await transaction.insert('schedule-rule', scheduleRuleKey(rule.ruleId), rule)
        await transaction.insert('schedule-rule-history', scheduleRuleHistoryKey(rule.ruleId, rule.revision), rule)
        return rule
      }
      if (current.timezone !== desired.timezone) throw new CoreError('SCHEDULE_RULE_CONFLICT', 'A schedule rule cannot change its timezone; start a new rule ID instead.')
      const revision = Number.isInteger(current.revision) && current.revision > 0 ? current.revision : 1
      const createdAt = Number.isFinite(current.createdAt) ? current.createdAt : this.now()
      if (sameRuleConfig(current, desired)) {
        if (current.revision === revision) return current
        const normalized: ScheduleRule = { ...current, revision, createdAt, updatedAt: this.now() }
        await transaction.replace('schedule-rule', scheduleRuleKey(normalized.ruleId), normalized)
        const key = scheduleRuleHistoryKey(normalized.ruleId, revision)
        if (!await transaction.replace('schedule-rule-history', key, normalized)) await transaction.insert('schedule-rule-history', key, normalized)
        return normalized
      }
      const rule: ScheduleRule = { ...desired, revision: revision + 1, createdAt, updatedAt: this.now() }
      await transaction.replace('schedule-rule', scheduleRuleKey(rule.ruleId), rule)
      await transaction.insert('schedule-rule-history', scheduleRuleHistoryKey(rule.ruleId, rule.revision), rule)
      return rule
    })
  }

  async rule(): Promise<ScheduleRule | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<ScheduleRule>('schedule-rule', scheduleRuleKey(this.config.ruleId)))
  }

  async ruleHistory(options: { limit?: number; after?: string } = {}): Promise<{ items: ScheduleRule[]; cursor?: string }> {
    const limit = options.limit ?? 100
    const anchor = scheduleRuleHistoryAfter(this.config.ruleId)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CoreError('INVALID_INPUT', 'Schedule rule history accepts 1–100 records.')
    if (options.after !== undefined && (!options.after.startsWith(`${anchor}:`) || options.after.length > 4096)) {
      throw new CoreError('INVALID_INPUT', 'Use a history cursor from this schedule rule.')
    }
    return this.storage.transaction(this.instanceId, async transaction => {
      const page = await transaction.scan<ScheduleRule>('schedule-rule-history', { limit, after: options.after ?? anchor })
      return { items: page.items.map(item => item.value).filter(rule => rule.ruleId === this.config.ruleId),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
    })
  }

  async occurrences(options: { limit?: number; after?: string } = {}): Promise<{ items: ScheduleOccurrence[]; cursor?: string }> {
    const limit = options.limit ?? 50
    const prefix = scheduleOccurrencePrefix(this.config.ruleId)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CoreError('INVALID_INPUT', 'Schedule occurrence history accepts 1–100 records.')
    if (options.after !== undefined && (!options.after.startsWith(`${prefix}:`) || options.after.length > 4096)) {
      throw new CoreError('INVALID_INPUT', 'Use an occurrence cursor from this schedule rule.')
    }
    return this.storage.transaction(this.instanceId, async transaction => {
      const page = await transaction.scan<ScheduleOccurrence>('schedule-occurrence', { limit, after: options.after ?? prefix })
      return { items: page.items.map(item => item.value).filter(occurrence => occurrence.ruleId === this.config.ruleId),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
    })
  }
}
