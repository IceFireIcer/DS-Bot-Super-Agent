import { randomUUID } from 'node:crypto'
import { CoreError, identifier } from './model.js'
import type { DesktopSource, IntakePolicy } from './model.js'
import type { Storage } from './storage.js'
import type { Engine } from './engine.js'
import { FeishuSource } from './channels.js'
import type { FeishuSourceConfig } from './channels.js'
import { FeishuPoller } from './pollers.js'
import type { ChannelHealth } from './pollers.js'
import { FeishuOpenApi } from './feishu-api.js'
import type { FeishuApiOptions, FeishuNativeEvent } from './feishu-api.js'
import { FeishuDeliveryChannel } from './feishu-delivery.js'
import type { DeliveryResult, DeliveryView } from './deliveries.js'
import { FeishuMemberSync } from './feishu-sync.js'
import type { MembershipSnapshot } from './membership.js'
import type { SourceReceipt } from './source-events.js'

export interface FeishuRuntimeOptions {
  storage: Storage
  instanceId: string
  tenantKey: string
  chatIds: string[]
  actorId: string
  selfActorIds: string[]
  allowedActorIds: string[]
  intake?: IntakePolicy
  api: FeishuApiOptions
  intervalMs?: number
  pollTimeoutMs?: number
  maxBackoffMs?: number
  setupTimeoutMs?: number
  maxTextChars?: number
}

/** Source-scoped composition; the Host retains ownership of Engine and Storage. */
export class FeishuRuntime {
  readonly sourceBinding: DesktopSource
  readonly channel: FeishuDeliveryChannel
  private readonly binding: DesktopSource
  private readonly api: FeishuOpenApi
  private readonly options: FeishuRuntimeOptions
  private readonly config: FeishuSourceConfig
  private readonly setupTimeoutMs: number
  private engine: Engine | undefined
  private poller: FeishuPoller | undefined
  private members: FeishuMemberSync | undefined
  private controller: AbortController | undefined
  private starting: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private readonly operations = new Set<Promise<unknown>>()
  private readonly deliveries = new Set<Promise<unknown>>()
  private state: 'idle' | 'setup' | 'running' | 'failed' | 'stopped' = 'idle'
  private lastError: string | undefined

  constructor(options: FeishuRuntimeOptions) {
    identifier(options.instanceId, 'instanceId'); identifier(options.actorId, 'actorId')
    if (!/^[\w-]{1,256}$/u.test(options.tenantKey) || !Array.isArray(options.chatIds) || options.chatIds.length < 1 || options.chatIds.length > 20
      || options.chatIds.some(id => !/^[\w-]{1,256}$/u.test(id)) || new Set(options.chatIds).size !== options.chatIds.length) {
      throw new CoreError('INVALID_CONFIG', 'A Feishu runtime needs a tenant and 1–20 distinct native chat IDs.')
    }
    if (!/^[\w-]{1,256}$/u.test(options.api.appId)) throw new CoreError('INVALID_CONFIG', 'A Feishu app needs a native app ID.')
    if (!Array.isArray(options.allowedActorIds) || !options.allowedActorIds.includes(options.actorId)
      || !Array.isArray(options.selfActorIds) || !options.selfActorIds.length) throw new CoreError('INVALID_CONFIG', 'Configure the Feishu receiving actor and native bot identities explicitly.')
    for (const id of [...options.allowedActorIds, ...options.selfActorIds]) identifier(id, 'nativeActorId')
    const { api, intake, storage, ...configuration } = options
    this.options = { ...structuredClone(configuration), storage, api: { ...api }, ...(intake ? { intake: { ...intake } } : {}) }
    this.setupTimeoutMs = options.setupTimeoutMs ?? 60000
    if (!Number.isInteger(this.setupTimeoutMs) || this.setupTimeoutMs < 1000 || this.setupTimeoutMs > 300000) throw new CoreError('INVALID_CONFIG', 'Feishu setup is bounded at 1–300 seconds.')
    this.config = { tenantKey: options.tenantKey, chatIds: [...options.chatIds], selfActorIds: [...new Set([...options.selfActorIds, api.appId])] }
    const threads = options.chatIds.map(id => `feishu:${options.tenantKey}:${id}`)
    const clonedIntake = cloneIntake(intake)
    this.sourceBinding = { kind: 'feishu', sourceInstanceId: `feishu:${options.tenantKey}:${[...options.chatIds].sort().join(',')}:app:${api.appId}`,
      actorId: options.actorId, allowedActorIds: [...options.allowedActorIds], versionOrder: 'sequence',
      allowedThreadIds: threads, allowedThreadPrefixes: threads.map(id => `${id}:message:`),
      ...(clonedIntake ? { intake: clonedIntake } : {}) }
    const { intake: _intake, ...sourceConfiguration } = this.sourceBinding
    this.binding = { ...structuredClone(sourceConfiguration), ...(clonedIntake ? { intake: cloneIntake(clonedIntake)! } : {}) }
    this.api = new FeishuOpenApi({ ...api, acknowledgePages: true })
    this.channel = new FeishuDeliveryChannel({ replyMessage: request => {
      if (this.state !== 'running' || !this.controller) throw new CoreError('SOURCE_STOPPED', 'The Feishu source is stopped.')
      return this.trackDelivery(this.api.replyMessage({ ...request, signal: AbortSignal.any([request.signal, this.controller.signal]) }))
    } }, {
      sourceInstanceId: this.sourceBinding.sourceInstanceId, ...(options.maxTextChars === undefined ? {} : { maxTextChars: options.maxTextChars }),
      authorize: (delivery, signal) => this.authorizeDelivery(delivery, signal),
      findReceipt: (deliveryId, idempotencyKey) => this.trackDelivery(this.options.storage.transaction(this.options.instanceId,
        tx => tx.get<{ messageId: string; fingerprint: string }>('channel-cursor', this.receiptKey(deliveryId, idempotencyKey)))),
      recordReceipt: receipt => this.trackDelivery(this.options.storage.transaction(this.options.instanceId, async tx => {
        const key = this.receiptKey(receipt.deliveryId, receipt.idempotencyKey)
        const prior = await tx.get<{ messageId: string; fingerprint: string }>('channel-cursor', key)
        if (prior && (prior.messageId !== receipt.messageId || prior.fingerprint !== receipt.fingerprint)) throw new CoreError('IDENTITY_CONFLICT', 'The Feishu platform receipt changed for the same delivery attempt.')
        // A separate native delivery checkpoint never replaces the inbound source cursor.
        if (!prior) await tx.insert('channel-cursor', key, { ...receipt, cursor: receipt.messageId, updatedAt: receipt.recordedAt })
      })),
    })
  }

  /** Pass sourceBinding and channel to this Engine's constructor before binding it here. */
  bind(engine: Engine): void {
    if (this.engine || this.state !== 'idle') throw new CoreError('RUNTIME_ACTIVE', 'The Feishu runtime has already been bound.')
    this.engine = engine
    const source = new FeishuRuntimeSource(this.options.storage, this.options.instanceId, engine, this.config, this.binding.sourceInstanceId)
    this.members = new FeishuMemberSync(this.api, engine, this.config.chatIds)
    this.poller = new FeishuPoller(source, {
      setup: async () => {},
      // A shared high-water mark cannot safely skip a slower chat or newly discovered thread.
      // Bounded pages cycle through native history; durable event receipts deduplicate each cycle.
      listEvents: request => this.api.listEvents({ tenantKey: request.tenantKey, chatIds: request.chatIds, signal: request.signal }),
    }, this.config.tenantKey, this.config.chatIds, {
      ...(this.options.intervalMs === undefined ? {} : { intervalMs: this.options.intervalMs }),
      ...(this.options.pollTimeoutMs === undefined ? {} : { pollTimeoutMs: this.options.pollTimeoutMs }),
      ...(this.options.maxBackoffMs === undefined ? {} : { maxBackoffMs: this.options.maxBackoffMs }),
    })
    source.afterPage = failed => {
      if (failed) throw new CoreError('SOURCE_FAILED', 'A Feishu page has an uncommitted item; retry the same page.')
      this.api.acknowledgePage()
    }
  }

  start(): Promise<void> {
    if (!this.poller || !this.members) throw new CoreError('INVALID_CONFIG', 'Bind the Feishu runtime to its configured Engine before starting.')
    if (this.starting || this.stopping || this.controller) throw new CoreError('RUNTIME_ACTIVE', 'The Feishu runtime is already active.')
    const controller = new AbortController()
    this.controller = controller
    this.state = 'setup'; this.lastError = undefined
    const operation = this.setup(controller)
    this.starting = operation
    return operation.finally(() => { this.starting = undefined })
  }

  private async setup(controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.setupTimeoutMs)])
    try {
      await this.api.setup({ tenantKey: this.config.tenantKey, chatIds: this.config.chatIds, signal })
      await this.members!.sync({ commandId: `feishu-members:${randomUUID()}`, origin: 'startup', signal })
      signal.throwIfAborted()
      this.state = 'running'
      await this.poller!.start()
      signal.throwIfAborted()
    } catch (error) {
      controller.abort()
      await this.poller!.stop()
      this.api.clear()
      this.controller = undefined
      this.state = this.stopping ? 'stopped' : 'failed'
      this.lastError = error instanceof CoreError ? error.code : 'FEISHU_SETUP_FAILED'
      throw new CoreError(this.lastError, 'Feishu setup did not complete; reception remains disabled.')
    }
  }

  /** Trusted Host/admin entry; source text and membership data cannot invoke it. */
  syncMembers(commandId: string): Promise<MembershipSnapshot> {
    identifier(commandId, 'commandId')
    if (this.state !== 'running' || !this.controller || !this.members) throw new CoreError('SOURCE_STOPPED', 'Start the Feishu runtime before syncing members.')
    return this.track(this.members.sync({ commandId, origin: 'manual', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.setupTimeoutMs)]) }))
  }

  /** Explicit answer path for ambiguous conversations; Engine checks current event, actor and Thread. */
  answerAttention(command: { commandId: string; attentionId: string; sourceEventId: string; text: string }) {
    if (this.state !== 'running' || !this.engine) throw new CoreError('SOURCE_STOPPED', 'The Feishu runtime is not accepting answers.')
    return this.track(this.engine.answerAttention(command))
  }

  health(): ChannelHealth {
    const health = this.poller?.health() ?? { state: 'idle' as const, passes: 0 }
    return { ...health, ...(this.state === 'running' ? {} : { state: this.state === 'setup' ? 'setup' : this.state }),
      ...(this.lastError ? { lastError: this.lastError } : {}) }
  }

  getDeliveryReceipt(deliveryId: string, idempotencyKey: string) {
    identifier(deliveryId, 'deliveryId'); identifier(idempotencyKey, 'idempotencyKey')
    return this.options.storage.transaction(this.options.instanceId, tx => tx.get<{ deliveryId: string; idempotencyKey: string; messageId: string; sourceInstanceId: string; recordedAt: number }>(
      'channel-cursor', this.receiptKey(deliveryId, idempotencyKey)))
  }

  getUnverifiedMessage(chatId: string, messageId: string) {
    if (!this.config.chatIds.includes(chatId)) throw new CoreError('SOURCE_SCOPE_DENIED', 'This chat is outside the Feishu runtime scope.')
    identifier(messageId, 'messageId')
    return this.options.storage.transaction(this.options.instanceId, tx => tx.get<{ state: 'unknown'; event: FeishuNativeEvent; sourceReceipt?: SourceReceipt; cursor: string; updatedAt: number }>(
      'channel-cursor', JSON.stringify(['feishu-unverified-version', this.binding.sourceInstanceId, chatId, messageId])))
  }

  private receiptKey(deliveryId: string, idempotencyKey: string) {
    return JSON.stringify(['feishu-delivery-receipt', this.binding.sourceInstanceId, deliveryId, idempotencyKey])
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.state = 'stopped'
    this.controller?.abort()
    const operation = (async () => {
      await this.starting?.catch(() => {})
      await this.poller?.stop()
      while (this.operations.size || this.deliveries.size) await Promise.allSettled([...this.operations, ...this.deliveries])
      this.api.clear()
      this.controller = undefined
      this.state = 'stopped'
    })()
    this.stopping = operation
    return operation.finally(() => { this.stopping = undefined })
  }

  private async authorizeDelivery(delivery: DeliveryView, signal: AbortSignal): Promise<DeliveryResult | undefined> {
    if (this.state !== 'running' || !this.controller) return { type: 'transient', reason: 'FEISHU_SOURCE_DISABLED' }
    if (!this.options.allowedActorIds.includes(delivery.destination.actorId)
      && !this.binding.intake?.allowedRequesterIds.includes(delivery.destination.actorId)) return { type: 'permanent', reason: 'DESTINATION_ACTOR_DENIED' }
    const threadId = delivery.destination.threadId
    const prefix = this.config.chatIds.find(id => threadId === `feishu:${this.config.tenantKey}:${id}` || threadId?.startsWith(`feishu:${this.config.tenantKey}:${id}:message:`))
    if (!prefix) return { type: 'permanent', reason: 'DESTINATION_THREAD_DENIED' }
    const scope = await this.trackDelivery(this.api.messageChat(delivery.destination.eventId.slice('message:'.length), AbortSignal.any([signal, this.controller.signal])))
    if (scope !== prefix) return { type: 'permanent', reason: 'DESTINATION_CHAT_DENIED' }
    if (this.state !== 'running') return { type: 'transient', reason: 'FEISHU_SOURCE_DISABLED' }
    return undefined
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    return operation.finally(() => { this.operations.delete(operation) })
  }

  private trackDelivery<T>(operation: Promise<T>): Promise<T> {
    this.deliveries.add(operation)
    return operation.finally(() => { this.deliveries.delete(operation) })
  }
}

function cloneIntake(intake: IntakePolicy | undefined): IntakePolicy | undefined {
  if (!intake) return undefined
  const { assess, ...configuration } = intake
  return { ...structuredClone(configuration), ...(assess ? { assess } : {}) }
}

class FeishuRuntimeSource extends FeishuSource {
  override readonly sourceInstanceId: string
  afterPage: (failed: number) => void = () => {}
  constructor(private readonly runtimeStorage: Storage, private readonly runtimeInstanceId: string, private readonly runtimeEngine: Engine, private readonly scope: FeishuSourceConfig, sourceInstanceId: string) {
    super(runtimeStorage, runtimeInstanceId, runtimeEngine, scope)
    this.sourceInstanceId = sourceInstanceId
  }

  override async receive(event: FeishuNativeEvent): Promise<SourceReceipt> {
    if (event.tenantKey !== this.scope.tenantKey || !this.scope.chatIds.includes(event.chatId)) throw new CoreError('SOURCE_SCOPE_DENIED', 'The Feishu event is outside the runtime scope.')
    const root = event.rootId ?? event.messageId
    const threadId = `feishu:${event.tenantKey}:${event.chatId}${event.chatType === 'p2p' ? '' : `:message:${root}`}`
    const addressing = event.chatType === 'p2p' ? 'direct' : event.rootId || event.mentionIds?.some(id => this.scope.selfActorIds?.includes(id)) ? 'mention' : 'ambient'
    let receipt: SourceReceipt
    if (this.scope.selfActorIds?.includes(event.senderId)) receipt = { status: 'filtered', reason: 'SOURCE_SELF' }
    else if (event.updateTime === undefined && !event.deleted) {
      // The guarded source transaction must revoke the old projection before any cursor advances.
      // Recording only a quarantine checkpoint would leave its old text usable as authorization.
      const recorded = await this.runtimeEngine.receiveUnverifiedSource({ commandId: `feishu:unverified:${event.eventId}`,
        threadId, objectId: `message:${event.messageId}`, type: event.edited ? 'edited' : 'created',
        version: `unverified:${event.eventId}`, text: event.text ?? '', authorId: event.senderId,
        authorKind: event.senderKind ?? 'human', addressing })
      const projection = await this.runtimeEngine.getSourceObject({ threadId, objectId: `message:${event.messageId}` })
      if (projection?.state !== 'unknown' && projection?.state !== 'deleted') {
        throw new CoreError('SOURCE_UNVERIFIED_NOT_APPLIED', 'The unverified Feishu observation did not invalidate its source projection.')
      }
      const key = JSON.stringify(['feishu-unverified-version', this.sourceInstanceId, event.chatId, event.messageId])
      await this.runtimeStorage.transaction(this.runtimeInstanceId, async tx => {
        const record = { state: 'unknown', event, sourceReceipt: recorded, cursor: event.cursor, updatedAt: Date.now() }
        if (!await tx.replace('channel-cursor', key, record)) await tx.insert('channel-cursor', key, record)
      })
      receipt = { status: 'filtered', reason: 'SOURCE_VERSION_UNVERIFIED' }
    }
    else {
      const commandId = `feishu:${event.eventId}`
      const prior = await this.runtimeEngine.getSourceReceipt(commandId)
      if (prior) receipt = { status: 'filtered', reason: 'SOURCE_REPLAY' }
      else {
        receipt = await this.runtimeEngine.receiveSource({ commandId, threadId, objectId: `message:${event.messageId}`,
          type: event.deleted ? 'deleted' : event.edited ? 'edited' : 'created', version: event.updateTime ?? '0',
          ...(event.deleted ? { deletionEvidence: event.deletionEvidence ?? `Feishu recalled message ${event.messageId}.` } : { text: event.text ?? '' }),
          authorId: event.senderId, authorKind: event.senderKind ?? 'human',
          addressing })
      }
    }
    const key = JSON.stringify(['channel-cursor', this.sourceInstanceId])
    await this.runtimeStorage.transaction(this.runtimeInstanceId, async tx => {
      const current = await tx.get<{ cursor: string }>('channel-cursor', key)
      if (current && current.cursor.localeCompare(event.cursor) >= 0) return
      const next = { cursor: event.cursor, updatedAt: Date.now() }
      if (!await tx.replace('channel-cursor', key, next)) await tx.insert('channel-cursor', key, next)
    })
    return receipt
  }

  override async poll(events: FeishuNativeEvent[]) {
    const result = await super.poll(events)
    this.afterPage(result.failed)
    return result
  }
}
