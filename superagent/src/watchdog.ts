import { randomUUID } from 'node:crypto'
import { CoreError } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

/**
 * What the Watchdog sees from outside the Host. The Host adapter owns how these facts are read; the
 * Watchdog only classifies them and decides whether a restart is allowed.
 */
export interface WatchdogProbe {
  service: 'healthy' | 'failed'
  hostId?: string
  epoch?: number
  sources: WatchdogSourceHealth[]
  setups: WatchdogSetupHealth[]
  /** Non-source component errors: policy, delivery, outbox or another named part. */
  components?: WatchdogComponentHealth[]
  /** Tickets that wait for a person, a device or an external condition. They are not a failure. */
  normalWaits: number
  takeoverPending?: boolean
  paused?: boolean
  unknownEffects?: number
  detail?: string
}

export interface WatchdogSourceHealth {
  id: string
  state: 'idle' | 'setup' | 'polling' | 'failed' | 'stopped'
  error?: string
}

export interface WatchdogSetupHealth {
  id: string
  state: 'ready' | 'missing' | 'failed'
  error?: string
}

export interface WatchdogComponentHealth {
  id: string
  kind: 'policy' | 'delivery' | 'outbox' | 'other'
  state: 'healthy' | 'failed'
  error?: string
}

/**
 * The independent Host side of the Watchdog. `start()` must acquire the Host lease and finish the
 * replacement takeover (including device and unknown-work reconciliation) before it resolves.
 */
export interface WatchdogHost {
  probe(options: { signal: AbortSignal }): Promise<WatchdogProbe>
  /** Ask the Host to stop and wait. A timeout must leave the Host running: no force kill. */
  stop(options: { graceMs: number; signal: AbortSignal }): Promise<'stopped' | 'timeout'>
  start(options: { signal: AbortSignal }): Promise<void>
}

export type WatchdogKind = 'healthy' | 'normal-wait' | 'component-failure' | 'setup-missing' | 'setup-failed'
  | 'service-failure' | 'recovered' | 'restart-timeout' | 'restart-failed' | 'budget-exhausted'

export interface WatchdogNotification {
  kind: WatchdogKind
  message: string
  fingerprint: string
  at: number
  /** The Watchdog cannot recover this itself; a person has to look. */
  escalate: boolean
}

export interface WatchdogBudget {
  used: number
  max: number
  windowMs: number
}

export interface WatchdogInspection {
  id: string
  instanceId: string
  at: number
  version: string
  kind: WatchdogKind
  service: 'healthy' | 'failed'
  hostId?: string
  epoch?: number
  action: 'none' | 'restart'
  result: 'silent' | 'notified' | 'suppressed' | 'stopped' | 'recovered' | 'timeout' | 'failed'
  /** The observation the decision was based on. */
  observation: WatchdogProbe
  /** The observation after a restart, when one was attempted. */
  after?: WatchdogProbe
  fingerprint?: string
  detail?: string
  budget: WatchdogBudget
}

export interface WatchdogState {
  instanceId: string
  version: string
  last?: WatchdogInspection
  restarts: number[]
  notifiedFingerprint?: string
  history: WatchdogInspection[]
}

export interface WatchdogOptions {
  instanceId: string
  storage: Storage
  host: WatchdogHost
  intervalMs?: number
  graceMs?: number
  probeTimeoutMs?: number
  startTimeoutMs?: number
  maxRestarts?: number
  restartWindowMs?: number
  historyLimit?: number
  version?: string
  now?: () => number
  notify?: (notification: WatchdogNotification) => void | Promise<void>
  onInspection?: (inspection: WatchdogInspection) => void | Promise<void>
  log?: Pick<Console, 'warn' | 'error'>
}

const stateKey = (instanceId: string) => JSON.stringify(['watchdog-state', instanceId])

const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) => {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new CoreError('INVALID_CONFIG', `${name} must be between ${String(minimum)} and ${String(maximum)}.`)
  return result
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  const abort = () => { clearTimeout(timer); reject(new CoreError('WATCHDOG_STOPPED', 'The Watchdog was stopped.')) }
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
})

const fingerprintOf = (kind: WatchdogKind, probe: WatchdogProbe, extra = '') => {
  const sources = probe.sources.filter(source => source.state === 'failed').map(source => [source.id, source.error ?? '']).sort()
  const setups = probe.setups.filter(setup => setup.state !== 'ready').map(setup => [setup.id, setup.state, setup.error ?? '']).sort()
  const components = (probe.components ?? []).filter(component => component.state === 'failed').map(component => [component.id, component.kind, component.error ?? '']).sort()
  return JSON.stringify([kind, probe.hostId ?? '', sources, setups, components, probe.unknownEffects ?? 0, extra])
}

const messageOf = (kind: WatchdogKind, probe: WatchdogProbe, detail?: string) => {
  if (kind === 'component-failure') {
    const failed = probe.sources.filter(source => source.state === 'failed').map(source => `${source.id} (${source.error ?? 'SOURCE_FAILED'})`)
    const components = (probe.components ?? []).filter(component => component.state === 'failed').map(component => `${component.id} (${component.kind}${component.error ? `: ${component.error}` : ''})`)
    const unknown = probe.unknownEffects ?? 0
    return `The Host stays up; component work needs attention: ${[...failed, ...components, ...(unknown > 0 ? [`${String(unknown)} unknown external effect(s)`] : [])].join(', ')}. The Watchdog did not restart the Host.`
  }
  if (kind === 'setup-missing' || kind === 'setup-failed') {
    const setups = probe.setups.filter(setup => setup.state !== 'ready').map(setup => `${setup.id} (${setup.state}${setup.error ? `: ${setup.error}` : ''})`)
    return `The Host stays up; setup needs attention: ${setups.join(', ')}. Configure it and recheck; the Watchdog did not restart the Host.`
  }
  if (kind === 'restart-timeout') return 'The Host did not stop within the grace period. It was not force-killed; a person has to inspect it.'
  if (kind === 'restart-failed') return `The Host was started again but did not become healthy${detail ? `: ${detail}` : ''}. A person has to inspect it.`
  if (kind === 'budget-exhausted') return `The Host failed again after the allowed restarts in this window. The Watchdog stopped restarting it; a person has to inspect it.`
  return `The Watchdog saw ${kind}${detail ? `: ${detail}` : ''}.`
}

const normalizeProbe = (probe: WatchdogProbe): WatchdogProbe => ({
  service: probe.service === 'healthy' ? 'healthy' : 'failed',
  sources: probe.sources,
  setups: probe.setups,
  ...(probe.components === undefined ? {} : { components: probe.components }),
  normalWaits: probe.normalWaits,
  ...(probe.hostId === undefined ? {} : { hostId: probe.hostId }),
  ...(probe.epoch === undefined ? {} : { epoch: probe.epoch }),
  ...(probe.takeoverPending === undefined ? {} : { takeoverPending: probe.takeoverPending }),
  ...(probe.paused === undefined ? {} : { paused: probe.paused }),
  ...(probe.unknownEffects === undefined ? {} : { unknownEffects: probe.unknownEffects }),
  ...(probe.detail === undefined ? {} : { detail: probe.detail }),
})

/**
 * An independent operational loop. It never resumes stopped work, never relaxes a pause or a
 * revocation, and never replays an unknown effect: a service restart delegates to the Host's own
 * takeover, which fences the old epoch and reconciles before work resumes.
 */
export class Watchdog {
  private readonly instanceId: string
  private readonly storage: Storage
  private readonly host: WatchdogHost
  private readonly intervalMs: number
  private readonly graceMs: number
  private readonly probeTimeoutMs: number
  private readonly startTimeoutMs: number
  private readonly maxRestarts: number
  private readonly restartWindowMs: number
  private readonly historyLimit: number
  private readonly version: string
  private readonly now: () => number
  private readonly notify: (notification: WatchdogNotification) => void | Promise<void>
  private readonly onInspection: (inspection: WatchdogInspection) => void | Promise<void>
  private readonly log: Pick<Console, 'warn' | 'error'>
  private controller: AbortController | undefined
  private loop: Promise<void> | undefined
  private inspecting: Promise<WatchdogInspection> | undefined

  constructor(options: WatchdogOptions) {
    this.instanceId = options.instanceId
    this.storage = options.storage
    this.host = options.host
    this.intervalMs = bounded(options.intervalMs, 3_600_000, 10, 86_400_000, 'intervalMs')
    this.graceMs = bounded(options.graceMs, 300_000, 10, 300_000, 'graceMs')
    this.probeTimeoutMs = bounded(options.probeTimeoutMs, 30_000, 10, 300_000, 'probeTimeoutMs')
    this.startTimeoutMs = bounded(options.startTimeoutMs, 120_000, 10, 300_000, 'startTimeoutMs')
    this.maxRestarts = bounded(options.maxRestarts, 3, 1, 100, 'maxRestarts')
    this.restartWindowMs = bounded(options.restartWindowMs, 21_600_000, 1_000, 604_800_000, 'restartWindowMs')
    this.historyLimit = bounded(options.historyLimit, 100, 1, 1_000, 'historyLimit')
    this.version = options.version ?? 'watchdog-1'
    this.now = options.now ?? Date.now
    this.notify = options.notify ?? (() => undefined)
    this.onInspection = options.onInspection ?? (() => undefined)
    this.log = options.log ?? console
  }

  /** Start the hourly loop. The first inspection runs at once. */
  start(): void {
    if (this.loop) throw new CoreError('RUNTIME_ACTIVE', 'The Watchdog is already running.')
    const controller = new AbortController()
    this.controller = controller
    this.loop = this.run(controller.signal)
  }

  async stop(): Promise<void> {
    this.controller?.abort()
    try { await this.loop } catch { /* stop observes the aborted wait */ }
    this.loop = undefined
    this.controller = undefined
  }

  /** One inspection, for a scheduled runner or an operator. At most one restart attempt. */
  inspectOnce(): Promise<WatchdogInspection> {
    this.inspecting ??= this.inspect().finally(() => { this.inspecting = undefined })
    return this.inspecting
  }

  getState(): Promise<WatchdogState | undefined> {
    return this.storage.transaction(this.instanceId, transaction => transaction.get<WatchdogState>('watchdog-state', stateKey(this.instanceId)))
  }

  private async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try { await this.inspectOnce() } catch (error) { this.log.error(error) }
      if (signal.aborted) return
      try { await wait(this.intervalMs, signal) } catch { return }
    }
  }

  private async inspect(): Promise<WatchdogInspection> {
    const at = this.now()
    const state = await this.storage.transaction(this.instanceId, transaction => this.readState(transaction))
    const probe = await this.probe()
    const restarts = state.restarts.filter(time => time > at - this.restartWindowMs)
    const budget: WatchdogBudget = { used: restarts.length, max: this.maxRestarts, windowMs: this.restartWindowMs }
    const finding = this.classify(probe, budget)
    const inspection: WatchdogInspection = {
      id: randomUUID(), instanceId: this.instanceId, at, version: this.version, kind: finding.kind,
      service: probe.service, action: finding.action, result: finding.result,
      observation: probe,
      ...(probe.hostId === undefined ? {} : { hostId: probe.hostId }),
      ...(probe.epoch === undefined ? {} : { epoch: probe.epoch }),
      ...(finding.fingerprint === undefined ? {} : { fingerprint: finding.fingerprint }),
      ...(finding.detail === undefined ? {} : { detail: finding.detail }),
      budget,
    }
    if (finding.kind === 'service-failure' && budget.used >= budget.max) {
      inspection.kind = 'budget-exhausted'
      inspection.action = 'none'
      inspection.detail = messageOf('budget-exhausted', probe)
      inspection.fingerprint = fingerprintOf('budget-exhausted', probe, String(budget.max))
      inspection.result = await this.deliver(inspection, state)
    } else if (finding.kind === 'service-failure') {
      const restart = await this.restart(probe, budget, restarts, at)
      Object.assign(inspection, restart.inspection)
      state.restarts = restarts
      if (inspection.result === 'notified') inspection.result = await this.deliver(inspection, state)
    }
    if (finding.kind !== 'service-failure' && finding.notify) {
      const delivered = await this.deliver(inspection, state)
      inspection.result = delivered
    }
    // Health, normal waiting and a successful recovery clear the dedupe key: a later recurrence is news.
    const clearsNotificationDedupe = inspection.kind === 'healthy' || inspection.kind === 'normal-wait' || inspection.kind === 'recovered'
    await this.storage.transaction(this.instanceId, transaction => this.writeState(transaction, state, inspection, clearsNotificationDedupe))
    try { await this.onInspection(inspection) } catch (error) { this.log.warn(`The Watchdog inspection listener failed: ${error instanceof Error ? error.message : String(error)}`) }
    return inspection
  }

  private classify(probe: WatchdogProbe, budget: WatchdogBudget): { kind: WatchdogKind; action: 'none' | 'restart'; result: WatchdogInspection['result']; notify: boolean; fingerprint?: string; detail?: string } {
    const failedSources = probe.sources.filter(source => source.state === 'failed')
    const failedComponents = (probe.components ?? []).filter(component => component.state === 'failed')
    if (failedSources.length > 0 || failedComponents.length > 0 || (probe.unknownEffects ?? 0) > 0) {
      return { kind: 'component-failure', action: 'none', result: 'silent', notify: true,
        fingerprint: fingerprintOf('component-failure', probe), detail: messageOf('component-failure', probe) }
    }
    const missing = probe.setups.filter(setup => setup.state === 'missing')
    if (missing.length > 0) {
      return { kind: 'setup-missing', action: 'none', result: 'silent', notify: true,
        fingerprint: fingerprintOf('setup-missing', probe), detail: messageOf('setup-missing', probe) }
    }
    const failed = probe.setups.filter(setup => setup.state === 'failed')
    if (failed.length > 0) {
      return { kind: 'setup-failed', action: 'none', result: 'silent', notify: true,
        fingerprint: fingerprintOf('setup-failed', probe), detail: messageOf('setup-failed', probe) }
    }
    // A component or setup problem keeps the Host up even when the service probe also failed:
    // restarting it would not fix the account, directory or policy that needs a person.
    if (probe.service === 'failed') {
      return { kind: 'service-failure', action: 'restart', result: 'silent', notify: false,
        fingerprint: fingerprintOf('service-failure', probe, budget.used >= budget.max ? 'budget' : '') }
    }
    if (probe.takeoverPending === true || probe.paused === true || probe.normalWaits > 0) {
      return { kind: 'normal-wait', action: 'none', result: 'silent', notify: false,
        detail: probe.takeoverPending === true ? 'The Host is reconciling a replacement.' : probe.paused === true ? 'Processing is paused.' : `${String(probe.normalWaits)} Ticket(s) wait for a person, a device or an external condition.` }
    }
    return { kind: 'healthy', action: 'none', result: 'silent', notify: false }
  }

  private async restart(probe: WatchdogProbe, budget: WatchdogBudget, restarts: number[], at: number): Promise<{ inspection: Partial<WatchdogInspection> }> {
    // An attempt spends budget even when the graceful stop does not finish: it is an action.
    restarts.push(at)
    budget.used = restarts.length
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.graceMs + 1_000)
    let stopped: 'stopped' | 'timeout' = 'timeout'
    try { stopped = await this.withTimeout(this.host.stop({ graceMs: this.graceMs, signal: controller.signal }), this.graceMs + 1_000) }
    catch (error) {
      const detail = `The Host did not stop: ${error instanceof Error ? error.message : String(error)}`
      return { inspection: { kind: 'restart-timeout', result: 'notified', detail, fingerprint: fingerprintOf('restart-timeout', probe, detail) } }
    }
    finally { clearTimeout(timer) }
    if (stopped !== 'stopped') {
      const detail = messageOf('restart-timeout', probe)
      return { inspection: { kind: 'restart-timeout', result: 'notified', detail, fingerprint: fingerprintOf('restart-timeout', probe, detail) } }
    }
    try {
      await this.withTimeout(this.host.start({ signal: AbortSignal.timeout(this.startTimeoutMs) }), this.startTimeoutMs + 1_000)
    } catch (error) {
      const detail = `The Host did not start: ${error instanceof Error ? error.message : String(error)}`
      return { inspection: { kind: 'restart-failed', result: 'notified', detail, fingerprint: fingerprintOf('restart-failed', { ...probe, service: 'failed' }, detail) } }
    }
    const after = await this.probe()
    if (after.service === 'healthy') {
      return { inspection: { kind: 'recovered', service: 'healthy', result: 'recovered', action: 'restart',
        after,
        ...(after.hostId === undefined ? {} : { hostId: after.hostId }), ...(after.epoch === undefined ? {} : { epoch: after.epoch }),
        detail: `The Host replaced the failed one${after.epoch === undefined ? '' : ` at epoch ${String(after.epoch)}`}.` } }
    }
    const detail = messageOf('restart-failed', after, after.detail)
    return { inspection: { kind: 'restart-failed', service: after.service, result: 'notified', detail, after, fingerprint: fingerprintOf('restart-failed', after, detail),
      ...(after.hostId === undefined ? {} : { hostId: after.hostId }), ...(after.epoch === undefined ? {} : { epoch: after.epoch }) } }
  }

  private async deliver(inspection: WatchdogInspection, state: WatchdogState): Promise<'notified' | 'suppressed' | 'failed'> {
    const fingerprint = inspection.fingerprint ?? fingerprintOf(inspection.kind, { service: inspection.service, sources: [], setups: [], normalWaits: 0 })
    if (state.notifiedFingerprint === fingerprint) {
      inspection.fingerprint = fingerprint
      return 'suppressed'
    }
    const notification: WatchdogNotification = {
      kind: inspection.kind, message: inspection.detail ?? messageOf(inspection.kind, { service: inspection.service, sources: [], setups: [], normalWaits: 0 }),
      fingerprint, at: inspection.at, escalate: inspection.kind === 'restart-timeout' || inspection.kind === 'restart-failed' || inspection.kind === 'budget-exhausted',
    }
    try {
      await this.notify(notification)
      state.notifiedFingerprint = fingerprint
      inspection.fingerprint = fingerprint
      return 'notified'
    } catch (error) {
      this.log.warn(`The Watchdog notification failed: ${error instanceof Error ? error.message : String(error)}`)
      return 'failed'
    }
  }

  private async probe(): Promise<WatchdogProbe> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs)
    try { return normalizeProbe(await this.withTimeout(this.host.probe({ signal: controller.signal }), this.probeTimeoutMs)) }
    catch (error) { return { service: 'failed', sources: [], setups: [], normalWaits: 0, detail: `The Host did not answer: ${error instanceof Error ? error.message : String(error)}` } }
    finally { clearTimeout(timer) }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CoreError('WATCHDOG_TIMEOUT', `The operation exceeded ${String(ms)} ms.`)), ms)
      void promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
    })
  }

  private async readState(transaction: AsyncTx): Promise<WatchdogState> {
    const existing = await transaction.get<WatchdogState>('watchdog-state', stateKey(this.instanceId))
    return existing ?? { instanceId: this.instanceId, version: this.version, restarts: [], history: [] }
  }

  private async writeState(transaction: AsyncTx, state: WatchdogState, inspection: WatchdogInspection, clearsNotificationDedupe: boolean): Promise<void> {
    const next: WatchdogState = {
      instanceId: this.instanceId, version: this.version, last: inspection,
      restarts: state.restarts.filter(time => time > inspection.at - this.restartWindowMs),
      ...(clearsNotificationDedupe || state.notifiedFingerprint === undefined ? {} : { notifiedFingerprint: state.notifiedFingerprint }),
      history: [inspection, ...state.history.filter(item => item.id !== inspection.id)].slice(0, this.historyLimit),
    }
    if (!await transaction.replace('watchdog-state', stateKey(this.instanceId), next)) await transaction.insert('watchdog-state', stateKey(this.instanceId), next)
  }
}
