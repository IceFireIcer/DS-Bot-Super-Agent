import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export type ProactiveMode = 'observe' | 'auto'
export interface ProactiveMatch {
  actorKinds: ('human' | 'bot' | 'ci' | 'system')[]
  addressing: ('direct' | 'mention' | 'ambient')[]
  textPattern?: string
}
export interface ProactiveBudget { maxRuns: number; windowMs: number }
export interface ProactiveRule {
  id: string
  name: string
  mode: ProactiveMode
  match: ProactiveMatch
  communication: 'silent' | 'notify'
  budget: ProactiveBudget
  enabled: boolean
}
export interface ProactiveCandidate {
  sourceInstanceId: string
  eventId: string
  threadId: string
  objectId: string
  text: string
  authorKind: 'human' | 'bot' | 'ci' | 'system'
  addressing: 'direct' | 'mention' | 'ambient'
}
export interface ProactivePreparation {
  summary: string
  artifacts?: { path: string; bytes: number; sha256: string }[]
}
export interface ProactiveRun {
  id: string
  instanceId: string
  ruleId: string
  ruleRevision: number
  eventId: string
  sourceInstanceId: string
  mode: ProactiveMode
  state: 'running' | 'observed' | 'prepared' | 'silent' | 'suppressed' | 'budget-exhausted' | 'failed'
  isolatedDirectory?: string
  summary?: string
  artifacts?: ProactivePreparation['artifacts']
  reason?: string
  createdAt: number
}
interface StoredRules { revision: number; rules: ProactiveRule[]; updatedAt: number }
export interface ProactiveOptions {
  rootDirectory: string
  prepare?: (request: { rule: ProactiveRule; candidate: ProactiveCandidate; isolatedDirectory: string; remainingRuns: number }, signal: AbortSignal) => Promise<ProactivePreparation | undefined>
  prepareTimeoutMs?: number
  now?: () => number
}
const ruleKey = 'proactive-rules'
const runPrefix = (ruleId: string) => `${JSON.stringify(['proactive-run', ruleId])}:`
const historyKey = (revision: number) => `${JSON.stringify(['proactive-rule-history'])}:${String(revision).padStart(10, '0')}`

function validateRule(rule: ProactiveRule) {
  if (!rule || Object.keys(rule).some(key => !['id', 'name', 'mode', 'match', 'communication', 'budget', 'enabled'].includes(key))) {
    throw new CoreError('INVALID_CONFIG', 'A proactive rule accepts id, name, mode, match, communication, budget and enabled only.')
  }
  identifier(rule.id, 'proactive rule id')
  if (typeof rule.name !== 'string' || !rule.name.trim() || Buffer.byteLength(rule.name) > 128) throw new CoreError('INVALID_CONFIG', 'A proactive rule needs a bounded name.')
  if (rule.mode !== 'observe' && rule.mode !== 'auto') throw new CoreError('INVALID_CONFIG', 'A proactive rule mode is observe or auto.')
  if (!rule.match || Object.keys(rule.match).some(key => !['actorKinds', 'addressing', 'textPattern'].includes(key))) throw new CoreError('INVALID_CONFIG', 'A proactive match accepts actorKinds, addressing and textPattern only.')
  if (!Array.isArray(rule.match.actorKinds) || !rule.match.actorKinds.length || rule.match.actorKinds.some(kind => !['human', 'bot', 'ci', 'system'].includes(kind))) throw new CoreError('INVALID_CONFIG', 'A proactive match needs supported actor kinds.')
  if (!Array.isArray(rule.match.addressing) || !rule.match.addressing.length || rule.match.addressing.some(kind => !['direct', 'mention', 'ambient'].includes(kind))) throw new CoreError('INVALID_CONFIG', 'A proactive match needs supported addressing kinds.')
  if (rule.match.textPattern !== undefined) {
    if (typeof rule.match.textPattern !== 'string' || !rule.match.textPattern || Buffer.byteLength(rule.match.textPattern) > 512) throw new CoreError('INVALID_CONFIG', 'A proactive text pattern must be bounded.')
    try { new RegExp(rule.match.textPattern, 'iu') } catch { throw new CoreError('INVALID_CONFIG', 'The proactive text pattern is not a valid regular expression.') }
  }
  if (rule.communication !== 'silent' && rule.communication !== 'notify') throw new CoreError('INVALID_CONFIG', 'A proactive rule communicates silently or with a notify.')
  if (!rule.budget || Object.keys(rule.budget).some(key => !['maxRuns', 'windowMs'].includes(key))
    || !Number.isInteger(rule.budget.maxRuns) || rule.budget.maxRuns < 1 || rule.budget.maxRuns > 100
    || !Number.isInteger(rule.budget.windowMs) || rule.budget.windowMs < 1000 || rule.budget.windowMs > 30 * 86400000) {
    throw new CoreError('INVALID_CONFIG', 'A proactive budget needs 1–100 runs within a 1 s–30 day window.')
  }
  if (typeof rule.enabled !== 'boolean') throw new CoreError('INVALID_CONFIG', 'A proactive rule enabled flag must be boolean.')
}

export class Proactive {
  private readonly prepare: ProactiveOptions['prepare']
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly rootDirectory: string
  constructor(private readonly storage: Storage, private readonly instanceId: string, options: ProactiveOptions) {
    if (!options?.rootDirectory || !isAbsolute(options.rootDirectory)) throw new CoreError('INVALID_CONFIG', 'A proactive root directory must be explicit and absolute.')
    this.rootDirectory = options.rootDirectory
    this.prepare = options.prepare
    this.timeoutMs = options.prepareTimeoutMs ?? 10000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60000) throw new CoreError('INVALID_CONFIG', 'The proactive preparation timeout must be 100–60000 ms.')
    this.now = options.now ?? Date.now
  }

  async rules(): Promise<{ revision: number; rules: ProactiveRule[] }> {
    const stored = await this.storage.transaction(this.instanceId, tx => tx.get<StoredRules>('proactive-rule', ruleKey))
    return stored ? { revision: stored.revision, rules: stored.rules } : { revision: 1, rules: [] }
  }

  async setRules(transaction: AsyncTx, expectedRevision: number, rules: ProactiveRule[]): Promise<{ revision: number; rules: ProactiveRule[] }> {
    if (!Array.isArray(rules) || rules.length > 50) throw new CoreError('INVALID_CONFIG', 'At most fifty proactive rules are supported.')
    if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new CoreError('INVALID_CONFIG', 'Proactive rule IDs must be unique.')
    for (const rule of rules) validateRule(rule)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new CoreError('INVALID_CONFIG', 'A positive proactive rule revision is required.')
    const current = await transaction.get<StoredRules>('proactive-rule', ruleKey)
    if ((current?.revision ?? 1) !== expectedRevision) throw new CoreError('CONFIG_REVISION_CONFLICT', 'The proactive rules changed after this update was prepared.')
    const next: StoredRules = { revision: (current?.revision ?? 1) + 1, rules: structuredClone(rules), updatedAt: this.now() }
    if (!await transaction.replace('proactive-rule', ruleKey, next)) await transaction.insert('proactive-rule', ruleKey, next)
    await transaction.insert('proactive-rule-history', historyKey(next.revision), next)
    return { revision: next.revision, rules: next.rules }
  }

  async evaluate(candidate: ProactiveCandidate, revisionOverride?: number): Promise<ProactiveRun[]> {
    const configured = await this.rules()
    const revision = revisionOverride ?? configured.revision
    const runs: ProactiveRun[] = []
    for (const rule of configured.rules) {
      if (!rule.enabled) continue
      if (!rule.match.actorKinds.includes(candidate.authorKind)) continue
      if (!rule.match.addressing.includes(candidate.addressing)) continue
      if (rule.match.textPattern && !new RegExp(rule.match.textPattern, 'iu').test(candidate.text)) continue
      const id = `${runPrefix(rule.id)}${createHash('sha256').update(candidate.eventId).digest('hex')}`
      const existing = await this.storage.transaction(this.instanceId, tx => tx.get<ProactiveRun>('proactive-run', id))
      if (existing) continue
      const reserved = await this.storage.transaction(this.instanceId, async tx => {
        const replay = await tx.get<ProactiveRun>('proactive-run', id)
        if (replay) return { replay }
        if (rule.mode === 'observe') {
          return { run: await this.insert(tx, { id, instanceId: this.instanceId, ruleId: rule.id, ruleRevision: revision, eventId: candidate.eventId,
            sourceInstanceId: candidate.sourceInstanceId, mode: rule.mode, state: 'observed', createdAt: this.now() }) }
        }
        if (candidate.authorKind !== 'human' || candidate.addressing === 'ambient') {
          return { run: await this.insert(tx, { id, instanceId: this.instanceId, ruleId: rule.id, ruleRevision: revision, eventId: candidate.eventId,
            sourceInstanceId: candidate.sourceInstanceId, mode: rule.mode, state: 'suppressed', reason: 'NON_HUMAN_OR_AMBIENT', createdAt: this.now() }) }
        }
        const used = await this.countRuns(tx, rule.id, rule.budget.windowMs)
        if (used >= rule.budget.maxRuns) {
          return { run: await this.insert(tx, { id, instanceId: this.instanceId, ruleId: rule.id, ruleRevision: revision, eventId: candidate.eventId,
            sourceInstanceId: candidate.sourceInstanceId, mode: rule.mode, state: 'budget-exhausted',
            reason: `${used}/${rule.budget.maxRuns} runs used in the declared window.`, createdAt: this.now() }) }
        }
        const isolatedDirectory = join(this.rootDirectory, rule.id, createHash('sha256').update(candidate.eventId).digest('hex'))
        return { run: await this.insert(tx, { id, instanceId: this.instanceId, ruleId: rule.id, ruleRevision: revision, eventId: candidate.eventId,
          sourceInstanceId: candidate.sourceInstanceId, mode: rule.mode, state: 'running', isolatedDirectory, createdAt: this.now() }), remaining: rule.budget.maxRuns - used }
      })
      if ('replay' in reserved) { runs.push(reserved.replay!); continue }
      if (reserved.run!.state !== 'running') { runs.push(reserved.run!); continue }
      const base = reserved.run!
      let final: ProactiveRun
      if (!this.prepare) final = { ...base, state: 'silent', reason: 'NO_PREPARATION_ADAPTER' }
      else {
        await mkdir(base.isolatedDirectory!, { recursive: true })
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const prepared = await Promise.race([
            this.prepare({ rule, candidate, isolatedDirectory: base.isolatedDirectory!, remainingRuns: reserved.remaining! }, controller.signal),
            new Promise<undefined>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(undefined) }, this.timeoutMs) }),
          ])
          final = !prepared?.summary?.trim()
            ? { ...base, state: 'silent', reason: 'NO_USEFUL_RESULT' }
            : { ...base, state: 'prepared', summary: prepared.summary.slice(0, 4096), ...(prepared.artifacts ? { artifacts: prepared.artifacts } : {}) }
        } catch (error) {
          final = { ...base, state: 'failed', reason: error instanceof CoreError ? error.code : 'PREPARATION_FAILED' }
        } finally { if (timer) clearTimeout(timer) }
      }
      const settled = await this.storage.transaction(this.instanceId, tx => this.insertOrReplace(tx, final))
      runs.push(settled)
    }
    return runs
  }

  async listRuns(ruleId?: string): Promise<ProactiveRun[]> {
    const prefix = ruleId ? runPrefix(ruleId) : `${JSON.stringify(['proactive-run']).slice(0, -1)},`
    return this.storage.transaction(this.instanceId, async tx => {
      const items: ProactiveRun[] = []
      let cursor = prefix
      for (let pageCount = 0; pageCount < 10; pageCount++) {
        const page = await tx.scan<ProactiveRun>('proactive-run', { limit: 100, after: cursor })
        items.push(...page.items.map(item => item.value))
        if (!page.cursor || !page.cursor.startsWith(prefix)) return items
        cursor = page.cursor
      }
      throw new CoreError('PROACTIVE_BUDGET', 'The proactive run history exceeds its 1000-record budget.')
    })
  }

  private async countRuns(tx: AsyncTx, ruleId: string, windowMs: number) {
    const since = this.now() - windowMs
    return (await this.listRunsIn(tx, ruleId)).filter(run => run.createdAt >= since && ['running', 'prepared', 'silent', 'failed'].includes(run.state)).length
  }

  private async listRunsIn(tx: AsyncTx, ruleId: string) {
    const items: ProactiveRun[] = []
    let cursor = runPrefix(ruleId)
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = await tx.scan<ProactiveRun>('proactive-run', { limit: 100, after: cursor })
      items.push(...page.items.map(item => item.value))
      if (!page.cursor || !page.cursor.startsWith(runPrefix(ruleId))) return items
      cursor = page.cursor
    }
    return items
  }

  private async insert(tx: AsyncTx, run: ProactiveRun) {
    await tx.insert('proactive-run', run.id, run)
    return run
  }

  /** Reserve transitions and final settlement share this identity-preserving write. */
  private async insertOrReplace(tx: AsyncTx, run: ProactiveRun) {
    if (!await tx.replace('proactive-run', run.id, run)) await tx.insert('proactive-run', run.id, run)
    return run
  }
}
