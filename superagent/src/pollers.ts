import { CoreError } from './model.js'
import type { FeishuEvent, FeishuSource, GitHubEvent, GitHubSource, ScheduleSource } from './channels.js'

export interface ChannelHealth {
  state: 'idle' | 'setup' | 'polling' | 'failed' | 'stopped'
  lastError?: string
  lastSuccessAt?: number
  cursor?: string
  passes: number
  malformed?: number
  failedItems?: number
}
export interface GitHubTransport {
  listEvents(request: { owner: string; repo: string; cursor?: string; signal: AbortSignal }): Promise<{ events: GitHubEvent[]; cursor?: string }>
}
export interface FeishuTransport {
  listEvents(request: { tenantKey: string; chatIds: string[]; cursor?: string; signal: AbortSignal }): Promise<{ events: FeishuEvent[]; cursor?: string }>
}
interface PollerOptions {
  intervalMs?: number
  maxBackoffMs?: number
  now?: () => number
  setup?: (signal: AbortSignal) => Promise<void>
}

function validateOptions(options: PollerOptions) {
  const interval = options.intervalMs ?? 1000
  const backoff = options.maxBackoffMs ?? 60000
  if (!Number.isInteger(interval) || interval < 10 || interval > 60000) throw new CoreError('INVALID_CONFIG', 'A source poll interval must be 10–60000 ms.')
  if (!Number.isInteger(backoff) || backoff < interval || backoff > 3600000) throw new CoreError('INVALID_CONFIG', 'A source poll backoff must be between the interval and one hour.')
  return { interval, backoff }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(new CoreError('SOURCE_STOPPED', 'The source poller was stopped.')) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export class GitHubPoller {
  private readonly interval: number
  private readonly backoff: number
  private readonly now: () => number
  private readonly setup: PollerOptions['setup']
  private controller: AbortController | undefined
  private loop: Promise<void> | undefined
  private healthState: ChannelHealth = { state: 'idle', passes: 0 }
  constructor(private readonly source: GitHubSource, private readonly transport: GitHubTransport, private readonly owner: string, private readonly repo: string, options: PollerOptions = {}) {
    const validated = validateOptions(options)
    this.interval = validated.interval; this.backoff = validated.backoff; this.now = options.now ?? Date.now; this.setup = options.setup
  }

  health(): ChannelHealth { return { ...this.healthState } }

  /** Run setup before the first reception; a failed setup receives nothing and is visible separately. */
  async start(): Promise<void> {
    if (this.controller) throw new CoreError('RUNTIME_ACTIVE', 'The GitHub poller is already running.')
    const controller = new AbortController()
    this.controller = controller
    this.healthState = { state: 'setup', passes: 0 }
    try { await this.setup?.(controller.signal) }
    catch (error) { this.healthState = { state: 'failed', lastError: error instanceof CoreError ? error.code : 'SETUP_FAILED', passes: 0, ...(await this.cursorSafe()) }; controller.abort(); this.controller = undefined; throw error }
    if (controller.signal.aborted) { this.controller = undefined; return }
    this.loop = this.run(controller.signal)
  }

  async stop(): Promise<void> {
    this.controller?.abort()
    try { await this.loop } catch { /* stop observes the aborted pass */ }
    this.loop = undefined; this.controller = undefined
    if (this.healthState.state !== 'failed') this.healthState = { ...this.healthState, state: 'stopped' }
  }

  async pollOnce(signal = new AbortController().signal) {
    this.healthState = { ...this.healthState, state: 'polling' }
    try {
      const cursor = await this.source.cursor()
      const page = await this.transport.listEvents({ owner: this.owner, repo: this.repo, ...(cursor === undefined ? {} : { cursor }), signal })
      const result = await this.source.poll(page.events)
      this.healthState = { state: 'polling', passes: this.healthState.passes + 1, lastSuccessAt: this.now(), malformed: result.malformed,
        failedItems: result.failed, ...(result.cursor === undefined ? {} : { cursor: result.cursor }) }
      return result
    } catch (error) {
      this.healthState = { ...this.healthState, state: 'failed', lastError: error instanceof CoreError ? error.code : 'SOURCE_FAILED', ...(await this.cursorSafe()) }
      throw error
    }
  }

  private async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try { await this.pollOnce(signal) }
      catch (error) {
        if (signal.aborted) return
        this.healthState = { ...this.healthState, state: 'failed', lastError: error instanceof CoreError ? error.code : 'SOURCE_FAILED', ...(await this.cursorSafe()) }
        await wait(this.backoff, signal).catch(() => {})
      }
      if (signal.aborted) return
      await wait(this.interval, signal).catch(() => {})
    }
  }

  private async cursorSafe(): Promise<{ cursor?: string }> {
    try { const cursor = await this.source.cursor(); return cursor === undefined ? {} : { cursor } } catch { return {} }
  }
}

export class FeishuPoller {
  private readonly interval: number
  private readonly backoff: number
  private readonly now: () => number
  private readonly setup: PollerOptions['setup']
  private controller: AbortController | undefined
  private loop: Promise<void> | undefined
  private healthState: ChannelHealth = { state: 'idle', passes: 0 }
  constructor(private readonly source: FeishuSource, private readonly transport: FeishuTransport, private readonly tenantKey: string, private readonly chatIds: string[], options: PollerOptions = {}) {
    const validated = validateOptions(options)
    this.interval = validated.interval; this.backoff = validated.backoff; this.now = options.now ?? Date.now; this.setup = options.setup
  }

  health(): ChannelHealth { return { ...this.healthState } }

  async start(): Promise<void> {
    if (this.controller) throw new CoreError('RUNTIME_ACTIVE', 'The Feishu poller is already running.')
    const controller = new AbortController()
    this.controller = controller
    this.healthState = { state: 'setup', passes: 0 }
    try { await this.setup?.(controller.signal) }
    catch (error) { this.healthState = { state: 'failed', lastError: error instanceof CoreError ? error.code : 'SETUP_FAILED', passes: 0, ...(await this.cursorSafe()) }; controller.abort(); this.controller = undefined; throw error }
    if (controller.signal.aborted) { this.controller = undefined; return }
    this.loop = this.run(controller.signal)
  }

  async stop(): Promise<void> {
    this.controller?.abort()
    try { await this.loop } catch { /* stop observes the aborted pass */ }
    this.loop = undefined; this.controller = undefined
    if (this.healthState.state !== 'failed') this.healthState = { ...this.healthState, state: 'stopped' }
  }

  async pollOnce(signal = new AbortController().signal) {
    this.healthState = { ...this.healthState, state: 'polling' }
    try {
      const cursor = await this.source.cursor()
      const page = await this.transport.listEvents({ tenantKey: this.tenantKey, chatIds: [...this.chatIds], ...(cursor === undefined ? {} : { cursor }), signal })
      const result = await this.source.poll(page.events)
      this.healthState = { state: 'polling', passes: this.healthState.passes + 1, lastSuccessAt: this.now(), malformed: result.malformed,
        failedItems: result.failed, ...(result.cursor === undefined ? {} : { cursor: result.cursor }) }
      return result
    } catch (error) {
      this.healthState = { ...this.healthState, state: 'failed', lastError: error instanceof CoreError ? error.code : 'SOURCE_FAILED', ...(await this.cursorSafe()) }
      throw error
    }
  }

  private async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try { await this.pollOnce(signal) }
      catch (error) {
        if (signal.aborted) return
        this.healthState = { ...this.healthState, state: 'failed', lastError: error instanceof CoreError ? error.code : 'SOURCE_FAILED', ...(await this.cursorSafe()) }
        await wait(this.backoff, signal).catch(() => {})
      }
      if (signal.aborted) return
      await wait(this.interval, signal).catch(() => {})
    }
  }

  private async cursorSafe(): Promise<{ cursor?: string }> {
    try { const cursor = await this.source.cursor(); return cursor === undefined ? {} : { cursor } } catch { return {} }
  }
}

export class ScheduleRunner {
  private timer: ReturnType<typeof setInterval> | undefined
  constructor(private readonly source: ScheduleSource, private readonly intervalMs: number = 1000) {
    if (!Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 3600000) throw new CoreError('INVALID_CONFIG', 'A schedule runner interval must be 10 ms–1 h.')
  }
  async start() {
    if (this.timer) throw new CoreError('RUNTIME_ACTIVE', 'The schedule runner is already running.')
    await this.source.tick()
    this.timer = setInterval(() => { void this.source.tick().catch(() => {}) }, this.intervalMs)
    this.timer.unref()
  }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined }
}
