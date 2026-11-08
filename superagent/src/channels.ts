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
    const body = event.body ?? event.title ?? `${event.kind} ${event.action}`
    const receipt = await this.engine.receiveSource({ commandId: `github:${event.deliveryId}`, threadId, objectId, type,
      version: event.cursor,
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
    let processed = 0, filtered = 0
    for (const event of [...events].sort((left, right) => compareCursor(left.cursor, right.cursor))) {
      if (prior !== undefined && event.cursor <= prior) continue
      const receipt = await this.receive(event)
      if (receipt.status === 'recorded') processed++
      else filtered++
    }
    return { processed, filtered, cursor: await this.cursor() }
  }
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
    let processed = 0, filtered = 0
    for (const event of [...events].sort((left, right) => compareCursor(left.cursor, right.cursor))) {
      if (prior !== undefined && event.cursor <= prior) continue
      const receipt = await this.receive(event)
      if (receipt.status === 'recorded') processed++
      else filtered++
    }
    return { processed, filtered, cursor: await this.cursor() }
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

interface ScheduleState { ruleId: string; lastOccurrence: number; updatedAt: number }
interface StoredScheduleRule extends ScheduleConfig { createdAt: number }
const scheduleKey = (ruleId: string) => JSON.stringify(['schedule-state', ruleId])
const scheduleRuleKey = (ruleId: string) => JSON.stringify(['schedule-rule', ruleId])

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
    await this.storage.transaction(this.instanceId, async transaction => {
      if (await transaction.get<StoredScheduleRule>('schedule-rule', scheduleRuleKey(this.config.ruleId))) return
      const rule: StoredScheduleRule = { ...this.config, createdAt: this.now() }
      await transaction.insert('schedule-rule', scheduleRuleKey(this.config.ruleId), rule)
    })
    const state = await this.storage.transaction(this.instanceId, transaction => transaction.get<ScheduleState>('schedule-state', scheduleKey(this.config.ruleId)))
    const interval = this.config.intervalMs
    const latest = Math.floor(now / interval) * interval
    let occurrences: number[]
    if (!state) occurrences = [latest]
    else if (latest <= state.lastOccurrence) occurrences = []
    else {
      if (this.config.catchUp === 'skip') occurrences = [latest]
      else if (this.config.catchUp === 'once') occurrences = [state.lastOccurrence + interval]
      else {
        const limit = this.config.maxCatchUp ?? 10
        const start = Math.max(state.lastOccurrence + interval, latest - (limit - 1) * interval)
        occurrences = Array.from({ length: Math.min(limit, Math.floor((latest - start) / interval) + 1) }, (_, index) => start + index * interval)
      }
    }
    const receipts = []
    for (const occurrence of occurrences) {
      const receipt = await this.engine.receiveSource({ commandId: `schedule:${this.config.ruleId}:${occurrence}`,
        threadId: `schedule:${this.config.ruleId}`, objectId: `occurrence:${occurrence}`, type: 'created', version: String(occurrence),
        text: this.config.text, authorId: 'schedule', authorKind: 'system', addressing: 'direct' })
      await this.storage.transaction(this.instanceId, async transaction => {
        const next: ScheduleState = { ruleId: this.config.ruleId, lastOccurrence: occurrence, updatedAt: this.now() }
        if (!await transaction.replace('schedule-state', scheduleKey(this.config.ruleId), next)) await transaction.insert('schedule-state', scheduleKey(this.config.ruleId), next)
      })
      receipts.push({ occurrence, receipt })
    }
    return { timezone: this.config.timezone, occurrences: receipts }
  }

  async rule(): Promise<StoredScheduleRule | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<StoredScheduleRule>('schedule-rule', scheduleRuleKey(this.config.ruleId)))
  }
}
