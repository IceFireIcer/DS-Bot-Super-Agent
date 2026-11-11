import { createHash } from 'node:crypto'
import { canonicalJson } from './commands.js'
import { CoreError, identifier } from './model.js'
import type { DeliveryChannel, DeliveryContext, DeliveryResult, DeliveryView } from './deliveries.js'
import type { Storage } from './storage.js'

export interface GitHubReplySource { sourceInstanceId: string; host: string; owner: string; repo: string; actorId: string }
export interface GitHubComment { id: string; url: string; body: string; authorId: string }
export interface GitHubReplyRequest { host: string; owner: string; repo: string; signal: AbortSignal }
export interface GitHubReplyTransport {
  getActor(request: GitHubReplyRequest): Promise<string>
  getTarget(request: GitHubReplyRequest & { objectId: string }): Promise<{ number: number; url: string }>
  listComments(request: GitHubReplyRequest & { number: number; page: number }): Promise<{ items: GitHubComment[]; hasMore: boolean }>
  createComment(request: GitHubReplyRequest & { number: number; body: string }): Promise<GitHubComment>
}
export interface GitHubPlatformReceipt {
  messageId: string
  url: string
  sourceInstanceId: string
  threadId: string
  marker: string
  recordedAt: number
}
export interface GitHubDeliveryChannelOptions { storage: Storage; instanceId: string; sources: GitHubReplySource[] }
interface Dispatch { fingerprint: string; state: 'posting' | 'sent'; receipt?: GitHubPlatformReceipt }

/** GitHub has no POST idempotency key. Persist the intent first and only reconcile uncertain sends; never blindly repost. */
export class GitHubDeliveryChannel implements DeliveryChannel {
  private readonly sources: GitHubReplySource[]
  constructor(private readonly transport: GitHubReplyTransport, private readonly options: GitHubDeliveryChannelOptions) {
    identifier(options.instanceId, 'instanceId')
    this.sources = structuredClone(options.sources)
    if (!this.sources.length || new Set(this.sources.map(source => source.sourceInstanceId)).size !== this.sources.length) {
      throw new CoreError('INVALID_CONFIG', 'Configure unique, explicitly permitted GitHub reply sources.')
    }
    for (const source of this.sources) {
      identifier(source.sourceInstanceId, 'sourceInstanceId'); identifier(source.actorId, 'GitHub posting actor')
      if (!/^[a-zA-Z0-9.-]+$/u.test(source.host) || !/^[a-zA-Z0-9_-]+$/u.test(source.owner) || !/^[a-zA-Z0-9_.-]+$/u.test(source.repo)) {
        throw new CoreError('INVALID_CONFIG', 'GitHub reply sources need an explicit host, owner and repository.')
      }
    }
  }

  deliver(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult> { return this.send(delivery, context, false) }
  reconcile(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult> { return this.send(delivery, context, true) }

  async getReceipt(idempotencyKey: string): Promise<GitHubPlatformReceipt | undefined> {
    identifier(idempotencyKey, 'idempotencyKey')
    return this.options.storage.transaction(this.options.instanceId, async tx =>
      (await tx.get<Dispatch>('work-command', this.key(idempotencyKey)))?.receipt)
  }

  private key(idempotencyKey: string) {
    return `github-outbound:${createHash('sha256').update(idempotencyKey).digest('hex')}`
  }

  private async send(delivery: DeliveryView, context: DeliveryContext, reconcile: boolean): Promise<DeliveryResult> {
    const source = this.sources.find(candidate => candidate.sourceInstanceId === delivery.destination.sourceInstanceId)
    if (!source || delivery.instanceId !== this.options.instanceId) return { type: 'permanent', reason: 'DESTINATION_DENIED: no grant for this Instance and GitHub source.' }
    const native = /^(?:pr|issue):([1-9]\d*)(?::(?:comment|review):[1-9]\d*)?$/u.exec(delivery.destination.eventId)
    const number = Number(native?.[1])
    if (!native || !Number.isSafeInteger(number) || delivery.destination.threadId !== `${source.sourceInstanceId}#${number}`) {
      return { type: 'permanent', reason: 'DESTINATION_MISMATCH: the native object and Thread must identify the same permitted discussion.' }
    }
    const marker = `<!-- ds-superagent:${createHash('sha256').update(JSON.stringify([this.options.instanceId, context.idempotencyKey])).digest('hex')} -->`
    const body = `${delivery.text}\n\n${marker}`
    if (Buffer.byteLength(body) > 60000) return { type: 'permanent', reason: 'MESSAGE_TOO_LARGE: the full GitHub reply exceeds the declared 60000-byte budget.' }
    const fingerprint = createHash('sha256').update(canonicalJson([delivery.id, delivery.purpose, delivery.destination, body])).digest('hex')
    const key = this.key(context.idempotencyKey)
    const previous = await this.options.storage.transaction(this.options.instanceId, tx => tx.get<Dispatch>('work-command', key))
    if (previous?.fingerprint !== undefined && previous.fingerprint !== fingerprint) return { type: 'permanent', reason: 'IDENTITY_CONFLICT: this outbound identity was used for different content or destination.' }
    if (previous?.receipt) return { type: 'success' }
    const request = { host: source.host, owner: source.owner, repo: source.repo, number, signal: context.signal }
    try {
      context.signal.throwIfAborted()
      if (await this.transport.getActor(request) !== source.actorId) return { type: 'permanent', reason: 'GITHUB_ACTOR_MISMATCH: the authenticated account is not the configured posting actor.' }
      const target = await this.transport.getTarget({ ...request, objectId: delivery.destination.eventId })
      if (target.number !== number) return { type: 'permanent', reason: 'DESTINATION_MISMATCH: native GitHub evidence points at a different discussion.' }
      const matches: GitHubComment[] = []
      for (let page = 1; page <= 10; page++) {
        const result = await this.transport.listComments({ ...request, page })
        for (const comment of result.items) if (comment.body.includes(marker)) {
          if (comment.authorId !== source.actorId || comment.body !== body) {
            return { type: 'unknown', reason: 'MARKER_CONFLICT: a marker without the exact authenticated author and body is not a receipt.' }
          }
          matches.push(comment)
        }
        if (!result.hasMore) break
        if (page === 10) return { type: 'unknown', reason: 'RECONCILIATION_BUDGET: the marker scan exceeded 1000 comments.' }
      }
      if (matches.length > 1) return { type: 'unknown', reason: 'MARKER_CONFLICT: more than one platform message has this outbound identity.' }
      if (matches[0]) return await this.record(key, fingerprint, source, number, marker, matches[0])
      if (reconcile || previous) return { type: 'unknown', reason: 'GITHUB_OUTCOME_UNKNOWN: no exact platform receipt was found; an uncertain POST is never repeated.' }
      const claimed = await this.options.storage.transaction(this.options.instanceId, async tx => {
        if (await tx.get<Dispatch>('work-command', key)) return false
        await tx.insert<Dispatch>('work-command', key, { fingerprint, state: 'posting' })
        return true
      })
      if (!claimed) return { type: 'unknown', reason: 'GITHUB_POST_IN_PROGRESS: reconcile the original outbound identity.' }
      context.signal.throwIfAborted()
      const posted = await this.transport.createComment({ ...request, body })
      if (posted.body !== body || posted.authorId !== source.actorId) return { type: 'unknown', reason: 'GITHUB_RECEIPT_INVALID: the API response did not confirm the expected body and posting actor.' }
      return await this.record(key, fingerprint, source, number, marker, posted)
    } catch (error) {
      const status = error instanceof CoreError && /^GITHUB_HTTP_\d+$/u.test(error.code) ? Number(error.code.slice('GITHUB_HTTP_'.length)) : undefined
      if (status === 401 || status === 403 || status === 404 || status === 410 || status === 422) return { type: 'permanent', reason: `GITHUB_HTTP_${status}` }
      return { type: 'unknown', reason: 'GITHUB_OUTCOME_UNKNOWN: inspect the original outbound marker before any retry.' }
    }
  }

  private async record(key: string, fingerprint: string, source: GitHubReplySource, number: number, marker: string, comment: GitHubComment): Promise<DeliveryResult> {
    const url = new URL(comment.url)
    if (!/^[1-9]\d*$/u.test(comment.id) || url.protocol !== 'https:' || url.hostname !== source.host
      || ![`/${source.owner}/${source.repo}/issues/${number}`, `/${source.owner}/${source.repo}/pull/${number}`].includes(url.pathname)
      || url.hash !== `#issuecomment-${comment.id}`) return { type: 'unknown', reason: 'GITHUB_RECEIPT_INVALID: missing or mismatched native platform identity.' }
    const receipt: GitHubPlatformReceipt = { messageId: comment.id, url: comment.url, sourceInstanceId: source.sourceInstanceId,
      threadId: `${source.sourceInstanceId}#${number}`, marker, recordedAt: Date.now() }
    await this.options.storage.transaction(this.options.instanceId, async tx => {
      const prior = await tx.get<Dispatch>('work-command', key)
      if (prior && prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'The outbound identity changed during reconciliation.')
      if (prior?.receipt) return
      const record: Dispatch = { fingerprint, state: 'sent', receipt }
      if (!await tx.replace('work-command', key, record)) await tx.insert('work-command', key, record)
    })
    return { type: 'success' }
  }
}
