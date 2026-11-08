import { randomUUID } from 'node:crypto'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'
import { canonicalJson } from './commands.js'

export type EffectStream = 'relay' | 'notice' | 'outbox'
export type EffectPayload = Record<string, unknown>
export interface EffectRequest { key: string; stream: EffectStream; scope: string; payload: EffectPayload }
export interface Effect extends EffectRequest {
  id: string
  generation: string
  queueKey: string
  state: 'pending' | 'running' | 'unknown' | 'failed'
  attempts: number
  availableAt: number
  token?: string
  leaseUntil?: number
  reason?: string
}
export interface EffectGate {
  paused(transaction: AsyncTx): Promise<boolean>
}
export interface EffectReceipt { id: string; generation: string; state: 'pending' | 'done' | 'failed' | 'unknown' | 'superseded'; delivery?: 'pending' | 'sent' | 'dropped'; reason?: string }
export type EffectResult = { type: 'success' } | { type: 'transient' | 'permanent' | 'unknown' | 'defer' | 'not-applied'; reason: string }
export interface EffectHandler {
  execute(effect: Effect, context: { idempotencyKey: string; signal: AbortSignal }): Promise<EffectResult>
  reconcile?(effect: Effect, context: { idempotencyKey: string; signal: AbortSignal }): Promise<EffectResult>
  batch?: { maxSize: number; execute(effects: Effect[], context: { signal: AbortSignal }): Promise<EffectResult[]> }
}
export interface EffectsOptions {
  handlers?: Partial<Record<EffectStream, EffectHandler>>
  maxAttempts?: number
  retryDelayMs?: number
  operationTimeoutMs?: number
  scanIntervalMs?: number
  maxQueuedEffects?: number
  now?: () => number
}

export class Effects {
  private readonly handlers: Partial<Record<EffectStream, EffectHandler>>
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private readonly timeoutMs: number
  private readonly scanIntervalMs: number
  private readonly capacity: number
  private readonly now: () => number
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly passes = new Set<Promise<unknown>>()
  private readonly activeLanes = new Map<string, Promise<number>>()
  private stopped = false
  private paused = false
  private gate: EffectGate | undefined
  private startup: (() => Promise<void>) | undefined
  private ready: Promise<void> | undefined

  /** Register the restart scan that must settle before the first dispatch pass. */
  setStartup(hook: () => Promise<void>) {
    this.startup = hook
  }

  configure(handlers: Partial<Record<EffectStream, EffectHandler>>): void {
    if (this.passes.size || this.activeLanes.size || this.timer) throw new CoreError('RUNTIME_ACTIVE', 'Configure effect adapters before starting the dispatcher.')
    for (const handler of Object.values(handlers)) this.validateHandler(handler)
    Object.assign(this.handlers, handlers)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    if (!paused && !this.stopped) this.wake()
  }

  setGate(gate: EffectGate) {
    this.gate = gate
  }

  private validateHandler(handler: EffectHandler) {
    if (handler.batch && (!Number.isInteger(handler.batch.maxSize) || handler.batch.maxSize < 1 || handler.batch.maxSize > 20)) throw new CoreError('INVALID_CONFIG', 'An effect batch needs a size between 1 and 20.')
  }

  constructor(private readonly storage: Storage, private readonly instanceId: string, options: EffectsOptions = {}) {
    identifier(instanceId, 'instanceId')
    this.handlers = { ...options.handlers }
    for (const handler of Object.values(this.handlers)) this.validateHandler(handler)
    this.maxAttempts = options.maxAttempts ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 1000
    this.timeoutMs = options.operationTimeoutMs ?? 10000
    this.scanIntervalMs = options.scanIntervalMs ?? 1000
    this.capacity = options.maxQueuedEffects ?? 1000
    this.now = options.now ?? Date.now
    for (const [value, maximum] of [[this.maxAttempts, 10], [this.retryDelayMs, 60000], [this.timeoutMs, 60000], [this.scanIntervalMs, 60000], [this.capacity, 1000]]) {
      if (!Number.isInteger(value) || value! < 1 || value! > maximum!) throw new CoreError('INVALID_CONFIG', 'Invalid bounded effects budget.')
    }
  }

  private key(request: Pick<EffectRequest, 'key' | 'stream' | 'scope'>): string { return JSON.stringify([request.stream, request.scope, request.key]) }
  private receiptKey(id: string, generation: string): string { return JSON.stringify([id, generation]) }

  async enqueue(transaction: AsyncTx, request: EffectRequest): Promise<Effect> {
    if (transaction.instanceId !== this.instanceId) throw new CoreError('INSTANCE_MISMATCH', 'Effects must share the command instance and transaction.')
    identifier(request.key, 'effect key')
    identifier(request.scope, 'effect scope')
    if (!['relay', 'notice', 'outbox'].includes(request.stream)) throw new CoreError('INVALID_INPUT', 'Unknown effect stream.')
    const payload = canonicalJson(request.payload)
    if (!payload || Buffer.byteLength(payload) > 65536 || !request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) throw new CoreError('INVALID_INPUT', 'Effect payload must be a bounded JSON object.')
    request = { key: request.key, scope: request.scope, stream: request.stream, payload: JSON.parse(payload) }
    const key = this.key(request)
    const index = await transaction.get<{ queueKey: string; completed?: Effect }>('effect-key', key)
    if (index?.completed && JSON.stringify(index.completed.payload) === payload) return index.completed
    const previous = index ? await transaction.get<Effect>('effect', index.queueKey) : undefined
    if (previous && JSON.stringify(previous.payload) === payload) return previous
    let queueKey = previous?.queueKey
    if (!queueKey) {
      const count = await transaction.get<number>('effect-meta', 'count') ?? 0
      if (count >= this.capacity) throw new CoreError('QUEUE_FULL', 'The durable effect queue is full; no command has been accepted.')
      if (!await transaction.replace('effect-meta', 'count', count + 1)) await transaction.insert('effect-meta', 'count', count + 1)
      const sequence = (await transaction.get<number>('effect-meta', 'sequence') ?? 0) + 1
      if (!Number.isSafeInteger(sequence)) throw new CoreError('QUEUE_FULL', 'Effect sequence exhausted.')
      if (!await transaction.replace('effect-meta', 'sequence', sequence)) await transaction.insert('effect-meta', 'sequence', sequence)
      queueKey = String(sequence).padStart(16, '0')
    }
    const effect: Effect = {
      key: request.key, stream: request.stream, scope: request.scope, payload: JSON.parse(payload),
      id: previous?.id ?? randomUUID(), generation: randomUUID(), queueKey,
      state: 'pending', attempts: 0, availableAt: this.now(),
    }
    if (previous) {
      await this.writeReceipt(transaction, previous, 'superseded')
      await transaction.replace('effect', queueKey, effect)
    } else {
      await transaction.insert('effect', queueKey, effect)
      if (!await transaction.replace('effect-key', key, { queueKey })) await transaction.insert('effect-key', key, { queueKey })
    }
    await this.writeReceipt(transaction, effect, 'pending')
    return effect
  }

  async cancel(transaction: AsyncTx, request: Pick<EffectRequest, 'key' | 'stream' | 'scope'>): Promise<boolean> {
    if (transaction.instanceId !== this.instanceId) throw new CoreError('INSTANCE_MISMATCH', 'Invalid transaction instance.')
    const key = this.key(request)
    const index = await transaction.get<{ queueKey: string; completed?: Effect }>('effect-key', key)
    const effect = index && await transaction.get<Effect>('effect', index.queueKey)
    if (!effect) return transaction.remove('effect-key', key)
    await transaction.remove('effect', effect.queueKey)
    await this.releaseSlot(transaction)
    await transaction.remove('effect-key', key)
    await this.writeReceipt(transaction, effect, 'superseded')
    return true
  }

  async cancelScope(transaction: AsyncTx, request: { ticketId: string; scope?: string; streams?: EffectStream[] }) {
    const matching: Effect[] = []
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<Effect>('effect', { limit: 100, ...(cursor ? { after: cursor } : {}) })
      for (const item of page.items) {
        const effect = item.value
        if (effect.state !== 'pending') continue
        if (request.streams && !request.streams.includes(effect.stream)) continue
        if (effect.scope !== request.scope && effect.payload.ticketId !== request.ticketId) continue
        matching.push(effect)
      }
      if (!page.cursor) break
      cursor = page.cursor
      if (pageCount === 9) throw new CoreError('QUEUE_FULL', 'The stop cancellation scan exceeded its bounded effect budget.')
    }
    for (const effect of matching) await this.cancel(transaction, effect)
    return matching.length
  }

  async listByScope(ticketId: string) {
    return this.storage.transaction(this.instanceId, async transaction => {
      const effects: Effect[] = []
      let cursor: string | undefined
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await transaction.scan<Effect>('effect', { limit: 100, ...(cursor ? { after: cursor } : {}) })
        effects.push(...page.items.map(item => item.value).filter(effect => effect.scope === ticketId || effect.payload.ticketId === ticketId))
        if (!page.cursor) return effects
        cursor = page.cursor
      }
      throw new CoreError('QUEUE_FULL', 'The scoped Effect query exceeded its bounded budget.')
    })
  }

  async hasUnknownScope(ticketId: string) {
    return this.storage.transaction(this.instanceId, transaction => this.hasUnknownScopeInTransaction(transaction, ticketId))
  }

  async hasUnknownScopeInTransaction(transaction: AsyncTx, ticketId: string) {
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<Effect>('effect', { limit: 100, ...(cursor ? { after: cursor } : {}) })
      if (page.items.some(item => item.value.state === 'unknown' && (item.value.scope === ticketId || item.value.payload.ticketId === ticketId))) return true
      if (!page.cursor) return false
      cursor = page.cursor
      if (pageCount === 9) throw new CoreError('QUEUE_FULL', 'The unknown outcome scan exceeded its bounded effect budget.')
    }
    return false
  }

  /** Whether an ordered stream still has queued work for this scope, checked inside the caller's transaction. */
  async hasPendingInTransaction(transaction: AsyncTx, request: { ticketId: string; stream: EffectStream }) {
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<Effect>('effect', { limit: 100, ...(cursor === undefined ? {} : { after: cursor }) })
      if (page.items.some(item => item.value.stream === request.stream && item.value.state === 'pending'
        && (item.value.payload.ticketId === request.ticketId || item.value.scope === request.ticketId))) return true
      if (!page.cursor) return false
      cursor = page.cursor
    }
    throw new CoreError('QUEUE_FULL', 'The pending effect scan exceeded its bounded queue budget.')
  }

  list(after?: string): Promise<{ items: Effect[]; cursor?: string }> {
    return this.storage.transaction(this.instanceId, async transaction => {
      const page = await transaction.scan<Effect>('effect', { limit: 100, ...(after === undefined ? {} : { after }) })
      return { items: page.items.map(item => item.value), ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
    })
  }

  receipt(id: string, generation: string): Promise<EffectReceipt | undefined> {
    identifier(id, 'effect ID')
    identifier(generation, 'effect generation')
    return this.storage.transaction(this.instanceId, transaction => transaction.get('effect-receipt', this.receiptKey(id, generation)))
  }

  private async writeReceipt(transaction: AsyncTx, effect: Effect, state: EffectReceipt['state'], reason?: string) {
    const receipt: EffectReceipt = { id: effect.id, generation: effect.generation, state, ...(reason === undefined ? {} : { reason }) }
    if (effect.stream === 'outbox') receipt.delivery = state === 'done' ? 'sent' : state === 'failed' || state === 'superseded' ? 'dropped' : 'pending'
    const key = this.receiptKey(effect.id, effect.generation)
    if (!await transaction.replace('effect-receipt', key, receipt)) await transaction.insert('effect-receipt', key, receipt)
  }

  private async releaseSlot(transaction: AsyncTx) {
    const count = await transaction.get<number>('effect-meta', 'count') ?? 0
    await transaction.replace('effect-meta', 'count', Math.max(0, count - 1))
  }

  private async hasEarlier(transaction: AsyncTx, effect: Effect, batchKeys: Set<string>): Promise<boolean> {
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await transaction.scan<Effect>('effect', { limit: 100, ...(cursor === undefined ? {} : { after: cursor }) })
      for (const item of page.items) {
        if (item.id >= effect.queueKey) return false
        if (item.value.stream === effect.stream && item.value.scope === effect.scope && item.value.state !== 'failed' && !batchKeys.has(item.id)) return true
      }
      cursor = page.cursor
      if (cursor === undefined) return false
    }
    throw new CoreError('QUEUE_FULL', 'The ordered lane check exceeded the durable queue budget.')
  }

  private async claim(transaction: AsyncTx, queueKey: string, batchKeys = new Set<string>()): Promise<Effect | undefined> {
    if (this.paused || await this.gate?.paused(transaction)) return undefined
    const effect = await transaction.get<Effect>('effect', queueKey)
    if (!effect || effect.state === 'failed' || effect.availableAt > this.now()) return undefined
    if (!this.handlers[effect.stream]) return undefined
    if (await this.hasEarlier(transaction, effect, batchKeys)) return undefined
    if (effect.state === 'running' && effect.leaseUntil! > this.now()) return undefined
    const recovering = effect.state === 'running' || effect.state === 'unknown'
    if (recovering && !this.handlers[effect.stream]?.reconcile) {
      effect.state = 'unknown'
      effect.reason = 'External outcome requires reconciliation with the original idempotency key.'
      await transaction.replace('effect', queueKey, effect)
      await this.writeReceipt(transaction, effect, 'unknown', effect.reason)
      return undefined
    }
    if (effect.attempts >= this.maxAttempts) {
      effect.state = recovering ? 'unknown' : 'failed'
      effect.reason = 'The effect attempt budget was exhausted.'
      await transaction.replace('effect', queueKey, effect)
      await this.writeReceipt(transaction, effect, effect.state, effect.reason)
      return undefined
    }
    effect.state = recovering ? 'unknown' : 'running'
    effect.attempts++
    effect.token = randomUUID()
    effect.leaseUntil = this.now() + this.timeoutMs + 1000
    effect.availableAt = effect.leaseUntil
    await transaction.replace('effect', queueKey, effect)
    return effect
  }

  private claimBatch(queueKey: string) {
    return this.storage.transaction(this.instanceId, async transaction => {
      if (this.paused || await this.gate?.paused(transaction)) return undefined
      const first = await this.claim(transaction, queueKey)
      if (!first) return undefined
      const batch = [first]
      const limit = first.state === 'unknown' ? 1 : this.handlers[first.stream]?.batch?.maxSize ?? 1
      const batchKeys = new Set([first.queueKey])
      let cursor: string = first.queueKey
      for (let pageCount = 0; pageCount < 10 && batch.length < limit; pageCount++) {
        const page = await transaction.scan<Effect>('effect', { limit: 100, after: cursor })
        for (const entry of page.items) {
          const candidate = entry.value
          if (candidate.stream !== first.stream || candidate.scope !== first.scope || candidate.state === 'failed') continue
          if (candidate.state !== 'pending') return batch
          const claimed = await this.claim(transaction, entry.id, batchKeys)
          if (!claimed) return batch
          batch.push(claimed); batchKeys.add(claimed.queueKey)
          if (batch.length === limit) return batch
        }
        if (!page.cursor) break
        cursor = page.cursor
      }
      return batch
    })
  }

  private async settle(effect: Effect, result: EffectResult) {
    return this.storage.transaction(this.instanceId, async transaction => {
      const current = await transaction.get<Effect>('effect', effect.queueKey)
      if (!current || current.id !== effect.id || current.generation !== effect.generation || current.token !== effect.token) return false
      if (result.type === 'success') {
        await transaction.remove('effect', effect.queueKey)
        await this.releaseSlot(transaction)
        await transaction.replace('effect-key', this.key(effect), { queueKey: effect.queueKey, completed: effect })
        await this.writeReceipt(transaction, effect, 'done')
        return true
      }
      current.reason = result.reason.slice(0, 1024)
      // A defer means "not now", not "failed": keep the attempt budget intact so a bounded wait cannot exhaust it.
      if (result.type === 'defer') current.attempts = Math.max(0, current.attempts - 1)
      current.state = effect.state === 'unknown' && result.type !== 'not-applied' || result.type === 'unknown' ? 'unknown' : result.type === 'permanent' || current.attempts >= this.maxAttempts ? 'failed' : 'pending'
      current.availableAt = this.now() + (result.type === 'defer' ? 0 : Math.min(60000, this.retryDelayMs * 2 ** (current.attempts - 1)))
      delete current.token
      delete current.leaseUntil
      await transaction.replace('effect', effect.queueKey, current)
      await this.writeReceipt(transaction, current, current.state === 'pending' ? 'pending' : current.state, current.reason)
      return current.state === 'failed'
    })
  }

  private async invoke(effect: Effect): Promise<EffectResult> {
    const handler = this.handlers[effect.stream]
    const action = effect.state === 'unknown' ? handler?.reconcile?.bind(handler) : handler?.execute.bind(handler)
    if (!action) return { type: 'permanent', reason: 'No adapter is configured for this effect stream.' }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => action(structuredClone(effect), { idempotencyKey: this.receiptKey(effect.id, effect.generation), signal: controller.signal })),
        new Promise<EffectResult>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ type: 'unknown', reason: 'The adapter deadline expired; reconcile before another execution.' }) }, this.timeoutMs) }),
      ])
      if (!result || !['success', 'transient', 'permanent', 'unknown', 'defer', 'not-applied'].includes(result.type) || result.type !== 'success' && typeof result.reason !== 'string' || result.type === 'not-applied' && effect.state !== 'unknown') return { type: 'unknown', reason: 'The adapter returned an invalid outcome.' }
      return result
    } catch { return { type: 'unknown', reason: 'The adapter threw without a confirmed external outcome.' } }
    finally { if (timer) clearTimeout(timer) }
  }

  private async invokeBatch(effects: Effect[]): Promise<EffectResult[]> {
    const first = effects[0]!
    if (effects.length === 1) return [await this.invoke(first)]
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const unknown = (): EffectResult[] => effects.map(() => ({ type: 'unknown', reason: 'The batch adapter did not confirm individual outcomes; reconcile before retrying.' }))
    try {
      const results = await Promise.race([
        this.handlers[first.stream]!.batch!.execute(structuredClone(effects), { signal: controller.signal }),
        new Promise<EffectResult[]>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unknown()) }, this.timeoutMs) }),
      ])
      if (!Array.isArray(results) || results.length !== effects.length) return unknown()
      return effects.map((_effect, index) => {
        const result = results[index]
        return result && ['success', 'transient', 'permanent', 'unknown', 'defer'].includes(result.type) && (result.type === 'success' || typeof result.reason === 'string') ? result : { type: 'unknown', reason: 'The batch adapter returned no valid outcome for this item.' }
      })
    } catch { return unknown() }
    finally { if (timer) clearTimeout(timer) }
  }

  drain(): Promise<number> {
    if (this.ready) return this.ready.then(() => this.drain())
    if (this.stopped) return Promise.resolve(0)
    // Passes are not coalesced: a lane that is still running is skipped, so a pass never absorbs new work
    // behind a slow one, and a pass only waits for the lanes it started itself.
    const pass = this.run()
    this.passes.add(pass)
    return pass.finally(() => { this.passes.delete(pass) })
  }

  private async run(): Promise<number> {
    if (this.paused) return 0
    const lanes = new Map<string, Effect[]>()
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await this.list(cursor)
      for (const effect of page.items) {
        const lane = JSON.stringify([effect.stream, effect.scope])
        const items = lanes.get(lane) ?? []
        items.push(effect)
        lanes.set(lane, items)
      }
      cursor = page.cursor
      if (cursor === undefined) break
    }
    const results = await Promise.allSettled([...lanes].map(([lane, effects]) => this.runLane(lane, effects)))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    return results.reduce((count, result) => count + (result.status === 'fulfilled' ? result.value : 0), 0)
  }

  // Each lane is one independent attempt. A lane that is already running is left alone, so a slow Worker turn
  // cannot postpone effects that arrive later. Turn concurrency itself is bounded by the execution slots.
  private runLane(lane: string, effects: Effect[]): Promise<number> {
    if (this.activeLanes.has(lane)) return Promise.resolve(0)
    const task = this.attemptLane(effects).finally(() => { this.activeLanes.delete(lane) })
    this.activeLanes.set(lane, task)
    return task
  }

  private async attemptLane(effects: Effect[]): Promise<number> {
    let dispatched = 0
    for (const effect of effects) {
      if (this.stopped || this.paused) break
      const batch = await this.claimBatch(effect.queueKey)
      if (!batch?.length) break
      const results = await this.invokeBatch(batch)
      let released = true
      for (const [index, claimed] of batch.entries()) {
        if (!await this.settle(claimed, results[index]!)) released = false
        dispatched++
      }
      if (!released) break
    }
    return dispatched
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => { void this.drain().catch(() => {}) }, this.scanIntervalMs)
    this.timer.unref()
    const scan = (async () => {
      try { await this.startup?.() } catch { /* A failed startup scan is retried by the next process start; the periodic pass only dispatches durable effects. */ }
    })()
    this.ready = scan
    this.passes.add(scan)
    void scan.then(() => {
      this.passes.delete(scan)
      if (this.ready === scan) this.ready = undefined
      if (!this.stopped) this.wake()
    })
  }

  wake(): void { void this.drain().catch(() => {}) }

  async resume() {
    this.paused = false
    for (let index = 0; index < 10; index++) {
      if (await this.drain() === 0) return
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await Promise.allSettled(this.passes)
    await Promise.allSettled(this.activeLanes.values())
  }
}
