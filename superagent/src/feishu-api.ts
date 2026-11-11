import { createHash } from 'node:crypto'
import { CoreError } from './model.js'
import type { FeishuEvent } from './channels.js'
import type { FeishuTransport } from './pollers.js'
import type { SourceMember } from './membership.js'

const defaultBaseUrl = 'https://open.feishu.cn'
const tokenPath = '/open-apis/auth/v3/tenant_access_token/internal'

export interface FeishuApiOptions {
  appId: string
  appSecret: string
  baseUrl?: string
  fetch?: typeof fetch
  now?: () => number
  pageSize?: number
  memberPageSize?: number
  maxMemberPages?: number
  lookbackSeconds?: number
  /** The runtime acknowledges a page only after every event has a durable receipt. */
  acknowledgePages?: boolean
  requestTimeoutMs?: number
}

export interface FeishuNativeEvent extends FeishuEvent { rootId?: string; threadId?: string }

export interface FeishuChatInfo {
  chatId: string
  chatType: 'p2p' | 'group'
  name?: string
}

/** A Feishu API response error carrying the native code and HTTP status when they exist. */
export class FeishuApiError extends CoreError {
  constructor(public readonly feishuCode: number | undefined, public readonly httpStatus: number | undefined, message: string, code = 'SOURCE_FAILED') {
    super(code, message)
  }
}

interface FeishuPage<T> { items: T[]; pageToken?: string; hasMore: boolean }

/** Feishu OpenAPI transport: tenant token, chat message history, chat info and member listing. */
export class FeishuOpenApi implements FeishuTransport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly pageSize: number
  private readonly memberPageSize: number
  private readonly maxMemberPages: number
  private readonly lookbackSeconds: number
  private token: { value: string; expiresAt: number } | undefined
  private readonly chats = new Map<string, FeishuChatInfo>()
  private readonly pageTokens = new Map<string, string>()
  private readonly pageStarts = new Map<string, number | undefined>()
  private readonly threadPages = new Map<string, { chatId: string; rootId: string; pageToken?: string }>()
  private pendingPage: { events: FeishuNativeEvent[]; malformed: number; commit: () => void } | undefined
  private readonly requestTimeoutMs: number

  constructor(private readonly options: FeishuApiOptions) {
    if (!options.appId || !options.appSecret) throw new CoreError('INVALID_CONFIG', 'A Feishu app needs an app ID and secret.')
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/u, '')
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.pageSize = options.pageSize ?? 50
    this.memberPageSize = options.memberPageSize ?? 100
    this.maxMemberPages = options.maxMemberPages ?? 10
    this.lookbackSeconds = options.lookbackSeconds ?? 600
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000
    let base: URL
    try { base = new URL(this.baseUrl) }
    catch { throw new CoreError('INVALID_CONFIG', 'The Feishu API base must be a valid HTTPS origin.') }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      throw new CoreError('INVALID_CONFIG', 'The Feishu API base must be an HTTPS origin without credentials.')
    }
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1000 || this.requestTimeoutMs > 300000) throw new CoreError('INVALID_CONFIG', 'A Feishu request deadline is 1–300 seconds.')
    if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 50) throw new CoreError('INVALID_CONFIG', 'A Feishu message page is 1–50 items.')
    if (!Number.isInteger(this.memberPageSize) || this.memberPageSize < 1 || this.memberPageSize > 100) throw new CoreError('INVALID_CONFIG', 'A Feishu member page is 1–100 items.')
    if (!Number.isInteger(this.maxMemberPages) || this.maxMemberPages < 1 || this.maxMemberPages > 100) throw new CoreError('INVALID_CONFIG', 'Feishu member pagination is bounded at 100 pages.')
    if (!Number.isInteger(this.lookbackSeconds) || this.lookbackSeconds < 0 || this.lookbackSeconds > 86400) throw new CoreError('INVALID_CONFIG', 'A Feishu lookback is 0–24 hours.')
  }

  async setup(request: { tenantKey?: string; chatIds: string[]; signal: AbortSignal }): Promise<void> {
    if (request.tenantKey) {
      const data = await this.call<{ tenant?: { tenant_key?: string } }>('/open-apis/tenant/v2/tenant/query', { signal: request.signal })
      if (data?.tenant?.tenant_key !== request.tenantKey) throw new CoreError('SOURCE_SCOPE_DENIED', 'The Feishu credentials do not identify the configured tenant.')
    }
    await this.check(request.chatIds, request.signal)
  }

  /** Setup check: the token works and every configured chat is reachable by this app. */
  async check(chatIds: string[], signal: AbortSignal): Promise<FeishuChatInfo[]> {
    await this.ensureToken(signal)
    return Promise.all(chatIds.map(chatId => this.chatInfo(chatId, signal)))
  }

  async listEvents(request: { tenantKey: string; chatIds: string[]; cursor?: string; signal: AbortSignal }) {
    request.signal.throwIfAborted()
    if (this.pendingPage) return { events: this.pendingPage.events, malformed: this.pendingPage.malformed }
    const startSeconds = request.cursor === undefined ? undefined
      : Math.max(0, (cursorSeconds(request.cursor) ?? 0) - this.lookbackSeconds)
    const events: FeishuNativeEvent[] = []
    let malformed = 0
    const commits: (() => void)[] = []
    for (const chatId of request.chatIds) {
      const info = await this.chatInfo(chatId, request.signal)
      const queued = [...this.threadPages.entries()].find(([, value]) => value.chatId === chatId)
      if (queued) {
        const [threadId, thread] = queued
        const page = await this.messagePage(threadId, thread.pageToken, undefined, request.signal, 'thread')
        for (const item of page.items) {
          const event = this.mapMessage({ ...item, root_id: item.message_id === thread.rootId ? undefined : item.root_id ?? thread.rootId, thread_id: threadId }, info, request.tenantKey)
          if (event) events.push(event)
          else malformed++
        }
        commits.push(() => {
          if (page.hasMore && page.pageToken) this.threadPages.set(threadId, { ...thread, pageToken: page.pageToken })
          else this.threadPages.delete(threadId)
        })
        continue
      }
      const pageToken = this.pageTokens.get(chatId)
      const start = pageToken ? this.pageStarts.get(chatId) : startSeconds
      const page = await this.messagePage(chatId, pageToken, start, request.signal)
      commits.push(() => {
        if (page.hasMore && page.pageToken) { this.pageTokens.set(chatId, page.pageToken); this.pageStarts.set(chatId, start) }
        else { this.pageTokens.delete(chatId); this.pageStarts.delete(chatId) }
      })
      for (const item of page.items) {
        const event = this.mapMessage(item, info, request.tenantKey)
        if (event) {
          events.push(event)
          if (event.threadId && !event.rootId) commits.push(() => {
            this.threadPages.set(event.threadId!, { chatId, rootId: event.messageId })
          })
        }
        else malformed++
      }
    }
    const page = { events: events.sort((left, right) => left.cursor.localeCompare(right.cursor)), malformed,
      commit: () => { for (const commit of commits) commit() } }
    if (this.options.acknowledgePages) this.pendingPage = page
    else page.commit()
    return { events: page.events, malformed }
  }

  acknowledgePage(): void { this.pendingPage?.commit(); this.pendingPage = undefined }

  /** Verify the native message scope before an authorized outbound reply. */
  async messageChat(messageId: string, signal: AbortSignal): Promise<string> {
    const data = await this.call<{ items?: Record<string, unknown>[] }>(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, { signal })
    const message = data?.items?.find(item => item.message_id === messageId)
    const chatId = asString(message?.chat_id)
    if (!chatId) throw new CoreError('SOURCE_FAILED', 'Feishu did not return a verifiable message scope.')
    return chatId
  }

  clear(): void {
    this.token = undefined; this.chats.clear(); this.pageTokens.clear(); this.pageStarts.clear(); this.threadPages.clear(); this.pendingPage = undefined
  }

  /** List every human member of one chat; bot members are not part of this endpoint. */
  async listMembers(request: { chatId: string; signal: AbortSignal }): Promise<SourceMember[]> {
    const members: SourceMember[] = []
    let pageToken: string | undefined
    for (let page = 0; page < this.maxMemberPages; page++) {
      const query = new URLSearchParams({ member_id_type: 'open_id', page_size: String(this.memberPageSize) })
      if (pageToken) query.set('page_token', pageToken)
      const body = await this.call<{ items?: Record<string, unknown>[]; page_token?: string; has_more?: boolean }>(
        `/open-apis/im/v1/chats/${encodeURIComponent(request.chatId)}/members?${query.toString()}`, { signal: request.signal })
      if (!Array.isArray(body?.items)) throw new CoreError('SOURCE_FAILED', 'Feishu returned an invalid member page.')
      for (const item of body.items) {
        const id = asString(item?.member_id)
        if (!id || (item.member_id_type !== undefined && item.member_id_type !== 'open_id')) throw new CoreError('SOURCE_FAILED', 'Feishu returned an invalid member identity.')
        const name = asString(item?.name)
        members.push({ nativeActorId: id, kind: 'human', ...(name ? { displayName: name } : {}), active: true })
      }
      if (body?.has_more !== true) return uniqueMembers(members)
      if (typeof body.page_token !== 'string' || !body.page_token || body.page_token === pageToken) throw new CoreError('SOURCE_FAILED', 'Feishu member pagination did not advance.')
      pageToken = body.page_token
    }
    throw new CoreError('SOURCE_BUDGET', 'Feishu member pagination exceeded its declared page budget.')
  }

  /** Reply in place to a native message; the same uuid is deduplicated by Feishu for one hour. */
  async replyMessage(request: { messageId: string; text: string; uuid: string; signal: AbortSignal }): Promise<{ messageId: string }> {
    if (typeof request.messageId !== 'string' || !request.messageId) throw new CoreError('INVALID_INPUT', 'A Feishu reply needs a message ID.')
    if (typeof request.text !== 'string' || !request.text.trim()) throw new CoreError('INVALID_INPUT', 'A Feishu reply needs nonempty text.')
    if (typeof request.uuid !== 'string' || !request.uuid || request.uuid.length > 50) throw new CoreError('INVALID_INPUT', 'A Feishu reply uuid must be at most 50 characters.')
    const body = await this.call<{ message_id?: string }>(`/open-apis/im/v1/messages/${encodeURIComponent(request.messageId)}/reply`,
      { method: 'POST', body: { content: JSON.stringify({ text: request.text }), msg_type: 'text', uuid: request.uuid }, signal: request.signal })
    if (typeof body?.message_id !== 'string' || !body.message_id) throw new CoreError('SOURCE_FAILED', 'Feishu accepted the reply without returning a message ID.')
    return { messageId: body.message_id }
  }

  private async chatInfo(chatId: string, signal: AbortSignal): Promise<FeishuChatInfo> {
    const cached = this.chats.get(chatId)
    if (cached) return cached
    const body = await this.call<Record<string, unknown>>(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`, { signal })
    const chatType = body?.chat_mode === 'p2p' || body?.chat_type === 'p2p' ? 'p2p' : 'group'
    const name = asString(body?.name)
    const info: FeishuChatInfo = { chatId, chatType, ...(name ? { name } : {}) }
    this.chats.set(chatId, info)
    return info
  }

  private async messagePage(chatId: string, pageToken: string | undefined, startSeconds: number | undefined, signal: AbortSignal, containerType = 'chat'): Promise<FeishuPage<Record<string, unknown>>> {
    const query = new URLSearchParams({ container_id_type: containerType, container_id: chatId, sort_type: 'ByCreateTimeAsc', page_size: String(this.pageSize) })
    if (pageToken) query.set('page_token', pageToken)
    else if (startSeconds !== undefined) query.set('start_time', String(startSeconds))
    const body = await this.call<{ items?: Record<string, unknown>[]; page_token?: string; has_more?: boolean }>(
      `/open-apis/im/v1/messages?${query.toString()}`, { signal })
    if (!Array.isArray(body?.items) || (body.has_more === true && (!body.page_token || body.page_token === pageToken))) throw new CoreError('SOURCE_FAILED', 'Feishu returned an invalid message page.')
    return { items: body.items,
      ...(typeof body?.page_token === 'string' && body.page_token ? { pageToken: body.page_token } : {}),
      hasMore: body?.has_more === true }
  }

  private mapMessage(item: Record<string, unknown>, info: FeishuChatInfo, tenantKey: string): FeishuNativeEvent | undefined {
    const messageId = asString(item?.message_id)
    const chatId = asString(item?.chat_id)
    const sender = item?.sender as Record<string, unknown> | undefined
    const senderId = asString(sender?.id)
    const createTime = asMillis(item?.create_time)
    const updateTime = asMillis(item?.update_time)
    if (!messageId || chatId !== info.chatId || !senderId || createTime === undefined || sender?.id_type !== 'open_id' && sender?.sender_type !== 'app') return undefined
    if (sender?.sender_type !== 'user' && sender?.sender_type !== 'app') return undefined
    const deleted = item?.deleted === true
    const edited = !deleted && (item?.updated === true || updateTime !== undefined && updateTime > createTime)
    const mentionIds = Array.isArray(item?.mentions)
      ? (item.mentions as Record<string, unknown>[]).map(mention => asString(mention?.id)).filter((id): id is string => Boolean(id))
      : []
    const text = deleted ? undefined : messageText(item)
    const kind = deleted ? 'deleted' : edited ? 'edited' : 'created'
    const fingerprint = createHash('sha256').update(`${kind}\n${text ?? ''}`).digest('hex').slice(0, 16)
    return {
      eventId: `${messageId}:${updateTime ?? 'unknown'}:${kind}:${fingerprint}`,
      cursor: eventCursor(createTime, messageId),
      tenantKey, chatId, chatType: info.chatType, messageId, senderId,
      senderKind: sender?.sender_type === 'app' ? 'bot' : 'human',
      ...(text === undefined ? {} : { text }),
      createTime: String(createTime), ...(updateTime === undefined ? {} : { updateTime: String(updateTime) }),
      ...(asString(item.root_id) ? { rootId: asString(item.root_id)! } : {}),
      ...(asString(item.thread_id) ? { threadId: asString(item.thread_id)! } : {}),
      ...(mentionIds.length ? { mentionIds } : {}),
      ...(edited ? { edited: true } : {}),
      ...(deleted ? { deleted: true, deletionEvidence: `Feishu recalled message ${messageId}.` } : {}),
    }
  }

  private async ensureToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value
    const body = await this.fetchJson(`${this.baseUrl}${tokenPath}`, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret }) })
    if (body?.code !== 0 || typeof body?.tenant_access_token !== 'string' || !body.tenant_access_token) {
      throw new CoreError('SOURCE_FAILED', 'Feishu token request failed.')
    }
    const expire = Number(body.expire)
    const lifetime = Number.isFinite(expire) && expire > 0 ? Math.max(1, expire - 60) : 60
    this.token = { value: body.tenant_access_token, expiresAt: this.now() + lifetime * 1000 }
    return this.token.value
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; signal: AbortSignal }, allowRefresh = true): Promise<T> {
    const token = await this.ensureToken(init.signal)
    const body = await this.fetchJson(`${this.baseUrl}${path}`, { method: init.method ?? 'GET', signal: init.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) })
    if (body?.code === 99991663 && allowRefresh) {
      this.token = undefined
      return this.call<T>(path, init, false)
    }
    if (body?.code !== 0) {
      const code = typeof body?.code === 'number' ? body.code : Number(body?.code)
      throw new FeishuApiError(Number.isFinite(code) ? code : undefined, undefined,
        `Feishu API error ${Number.isFinite(code) ? code : 'UNKNOWN'}.`)
    }
    return body?.data as T
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(this.requestTimeoutMs)])
    try { response = await this.fetchImpl(url, { ...init, signal, redirect: 'error' }) }
    catch {
      if (init.signal?.aborted) throw new CoreError('SOURCE_STOPPED', 'The Feishu request was stopped.')
      throw new CoreError(signal.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_FAILED', 'The Feishu request failed.')
    }
    if (!response.ok) throw new FeishuApiError(undefined, response.status, `Feishu API returned HTTP ${response.status}.`)
    try {
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid response')
      return body as Record<string, unknown>
    }
    catch { throw new CoreError('SOURCE_FAILED', 'Feishu returned invalid JSON.') }
  }
}

function cursorSeconds(cursor: string | undefined) {
  const match = cursor?.match(/^(\d{1,16}):/u)
  if (!match) return undefined
  const millis = Number(match[1])
  return Number.isSafeInteger(millis) && millis > 0 ? Math.floor(millis / 1000) : undefined
}

function eventCursor(millis: number, messageId: string) {
  return `${String(millis).padStart(16, '0')}:${messageId}`
}

function asString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function asMillis(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

function messageText(item: Record<string, unknown>) {
  const type = asString(item?.msg_type) ?? 'message'
  const body = item?.body as Record<string, unknown> | undefined
  const raw = asString(body?.content)
  if (type === 'text' && raw) {
    try {
      const content = JSON.parse(raw) as Record<string, unknown>
      if (typeof content?.text === 'string' && content.text.trim()) return content.text
    } catch { /* the raw fallback below keeps the message readable */ }
  }
  if (type === 'post' && raw) {
    try {
      const text = postText(JSON.parse(raw) as Record<string, unknown>)
      if (text) return text
    } catch { /* fall through to the placeholder */ }
  }
  const placeholders: Record<string, string> = { image: '[image]', file: '[file]', audio: '[audio]', media: '[media]',
    sticker: '[sticker]', interactive: '[card]' }
  return placeholders[type] ?? `[${type}]`
}

function postText(content: Record<string, unknown>) {
  const localized = (content?.zh_cn ?? content?.en_us ?? content) as Record<string, unknown>
  const parts: string[] = []
  if (typeof localized?.title === 'string' && localized.title.trim()) parts.push(localized.title)
  if (Array.isArray(localized?.content)) {
    for (const line of localized.content as unknown[]) {
      if (!Array.isArray(line)) continue
      for (const element of line as Record<string, unknown>[]) if (typeof element?.text === 'string') parts.push(element.text)
    }
  }
  return parts.filter(part => part.trim()).join('\n').slice(0, 65536)
}

function uniqueMembers(members: SourceMember[]) {
  const seen = new Set<string>()
  return members.filter(member => {
    if (seen.has(member.nativeActorId)) return false
    seen.add(member.nativeActorId)
    return true
  })
}
