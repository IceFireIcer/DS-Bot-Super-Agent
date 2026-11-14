import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson, commandTransaction } from './commands.js'
import { CoreError, identifier, type DesktopSource } from './model.js'
import type { NativeSessions, NativeTool } from './native-sessions.js'
import type { AsyncTx, Storage } from './storage.js'
import type { RoleProfile } from './config.js'

export interface MainBinding { instanceId: string; mainId: string; mainSessionId: string; routerSessionId: string }
interface MainState extends MainBinding { sequence: number; activeCommand?: string }
export interface MainMessage { id: string; sequence: number; role: 'user' | 'main'; text: string; createdAt: number; status: 'queued' | 'running' | 'completed' | 'failed'; error?: string }
interface MainCommand { fingerprint: string; messageId: string; userSequence: number; status: MainMessage['status']; replySequence?: number }
export interface MainAddress { instanceId: string }
export interface MainSend extends MainAddress { commandId: string; text: string }
export interface MainPage extends MainBinding { messages: MainMessage[]; cursor?: number }
interface MainEvent { type: string; data: { id?: string; message?: { content?: { type: string; text?: string }[] }; reason?: { kind?: string } } }
const messageKey = (sequence: number) => String(sequence).padStart(16, '0')

/** Business facts stay separate from the native Session; no transaction spans a model turn. */
export class MainConversation {
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly source: DesktopSource, private readonly sessions?: NativeSessions, private readonly prepare?: (sessionId: string) => Promise<RoleProfile>) {}

  private authorize(request: MainAddress) {
    if (!request || request.instanceId !== this.instanceId || !this.source.allowedActorIds.includes(this.source.actorId)) {
      throw new CoreError('SOURCE_NOT_AUTHORIZED', 'This Main conversation is outside the authorized Instance.')
    }
    if (this.closed) throw new CoreError('RUNTIME_CLOSED', 'The Main conversation is closed.')
  }

  private async state(tx: AsyncTx): Promise<MainState> {
    const prior = await tx.get<MainState>('main-state', 'main')
    if (prior) return prior
    const initial: MainState = { instanceId: this.instanceId, mainId: `main-${randomUUID()}`, mainSessionId: `main-session-${randomUUID()}`, routerSessionId: `router-${randomUUID()}`, sequence: 0 }
    await tx.insert('main-state', 'main', initial)
    return initial
  }

  async open(request: MainAddress): Promise<MainBinding> {
    this.authorize(request)
    if (!this.sessions?.mainRoute) throw new CoreError('ROLE_NOT_CONFIGURED', 'Main needs its own explicit model route.')
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const { sequence: _sequence, activeCommand: _active, ...binding } = await this.state(tx)
      return binding
    })
  }

  async page(request: MainAddress & { after?: number; limit?: number }): Promise<MainPage> {
    this.authorize(request)
    const limit = request.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || request.after !== undefined && (!Number.isSafeInteger(request.after) || request.after < 0)) {
      throw new CoreError('INVALID_INPUT', 'Main history needs a bounded page and non-negative cursor.')
    }
    const state = await commandTransaction(this.storage, this.instanceId, tx => this.state(tx))
    if (state.activeCommand) await this.reconcile(state, state.activeCommand)
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const { sequence: _sequence, activeCommand: _active, ...binding } = await this.state(tx)
      const page = await tx.scan<MainMessage>('main-message', { limit, ...(request.after === undefined ? {} : { after: messageKey(request.after) }) })
      return { ...binding, messages: page.items.map(item => item.value), ...(page.cursor ? { cursor: Number(page.cursor) } : {}) }
    })
  }

  async send(request: MainSend) {
    this.authorize(request)
    identifier(request.commandId, 'commandId')
    if (typeof request.text !== 'string' || !request.text.trim() || Buffer.byteLength(request.text) > 32768) throw new CoreError('INVALID_INPUT', 'Send a nonempty Main message of at most 32768 bytes.')
    const binding = await this.open(request)
    const key = createHash('sha256').update(canonicalJson([this.source.sourceInstanceId, this.source.actorId, request.commandId])).digest('hex')
    const fingerprint = createHash('sha256').update(canonicalJson([request.instanceId, request.text])).digest('hex')
    await commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<MainCommand>('main-command', key)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CoreError('IDENTITY_CONFLICT', 'This Main message identity was already used for different text.')
        return
      }
      const state = await this.state(tx)
      const sequence = state.sequence + 1
      const messageId = `main-input-${randomUUID()}`
      await tx.insert<MainMessage>('main-message', messageKey(sequence), { id: messageId, sequence, role: 'user', text: request.text, createdAt: Date.now(), status: 'queued' })
      await tx.insert<MainCommand>('main-command', key, { fingerprint, messageId, userSequence: sequence, status: 'queued' })
      await tx.replace('main-state', 'main', { ...state, sequence })
    })
    const turn = this.tail.then(() => this.run(binding, key, request.text))
    this.tail = turn.catch(() => {})
    return turn
  }

  private tools(): NativeTool[] {
    return [
      { name: 'delegate_work', description: 'Request a product work delegation. Currently unavailable; no Ticket or Worker will be created.', parameters: { brief: { type: 'string', required: true } }, execute: async () => JSON.stringify({ available: false, code: 'DELEGATION_UNAVAILABLE', message: 'Work delegation is not connected yet. No work was started.' }) },
      { name: 'query_work', description: 'Query the product work service availability. Work delegation is not connected yet.', parameters: {}, execute: async () => JSON.stringify({ available: false, code: 'DELEGATION_UNAVAILABLE', message: 'Work delegation is not connected yet.' }) },
    ]
  }

  private async run(binding: MainBinding, key: string, text: string) {
    if (this.closed) throw new CoreError('RUNTIME_CLOSED', 'The Main conversation is closed.')
    const command = await commandTransaction(this.storage, this.instanceId, tx => tx.get<MainCommand>('main-command', key))
    if (!command) throw new CoreError('INCOMPLETE_STATE', 'The Main input receipt is missing.')
    if (command.status === 'completed') return { ...binding, messageId: command.messageId, status: command.status }
    try {
      const state = await commandTransaction(this.storage, this.instanceId, tx => this.state(tx))
      if (state.activeCommand && state.activeCommand !== key) {
        if (!await this.reconcile(binding, state.activeCommand)) throw new CoreError('MAIN_TURN_UNKNOWN', 'The previous Main turn needs reconciliation before another turn.')
      }
      if ((await this.sessions!.hasMessage(binding.mainSessionId, command.messageId)).found) {
        if (await this.reconcile(binding, key)) return { ...binding, messageId: command.messageId, status: 'completed' as const }
        if (command.status === 'failed') return { ...binding, messageId: command.messageId, status: command.status }
        throw new CoreError('MAIN_TURN_UNKNOWN', 'The previous Main turn needs reconciliation.')
      }
      if (command.status === 'failed') return { ...binding, messageId: command.messageId, status: command.status }
      await this.updateCommand(key, 'running')
      const profile = await this.prepare?.(binding.mainSessionId)
      const result = await this.sessions!.run({ role: 'main', sessionId: binding.mainSessionId, text, tools: this.tools(), messageId: command.messageId, ...(profile ? { profile } : {}) })
      const answer = this.reply(result.events as MainEvent[], command.messageId)
      if (!answer) throw new CoreError('MAIN_TURN_FAILED', 'Main did not produce a completed visible reply.')
      await this.publish(key, answer)
      return { ...binding, messageId: command.messageId, status: 'completed' as const }
    } catch (error) {
      const code = error instanceof CoreError ? error.code : 'MAIN_TURN_FAILED'
      await this.updateCommand(key, 'failed', code)
      throw new CoreError(code, 'Main could not finish this reply. Your message remains in the conversation.')
    }
  }

  private reply(events: readonly MainEvent[], messageId: string) {
    const start = events.findIndex(event => event.type === 'user/message' && event.data.id === messageId)
    if (start < 0) return undefined
    const following = events.slice(start + 1)
    const end = following.findIndex(event => event.type === 'turn/end')
    if (end < 0 || following[end]?.data.reason?.kind !== 'completed') return undefined
    const answer = following.slice(0, end).filter(event => event.type === 'assistant/message').flatMap(event => event.data.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
    return answer.trim() ? answer : undefined
  }

  private async reconcile(binding: MainBinding, key: string) {
    const command = await commandTransaction(this.storage, this.instanceId, tx => tx.get<MainCommand>('main-command', key))
    if (!command || command.status === 'completed') return command?.status === 'completed'
    if (!this.sessions || !(await this.sessions.hasMessage(binding.mainSessionId, command.messageId)).found) return false
    const events: MainEvent[] = []
    let after: number | undefined
    for (let count = 0; count < 100; count++) {
      const page = await this.sessions.readSession(binding.mainSessionId, { limit: 100, ...(after === undefined ? {} : { after }) })
      events.push(...page.events as unknown as MainEvent[])
      const answer = this.reply(events, command.messageId)
      if (answer) { await this.publish(key, answer); return true }
      if (page.cursor === undefined) return false
      after = page.cursor
    }
    throw new CoreError('MAIN_HISTORY_BUDGET', 'Main history reconciliation exceeded its bounded read budget.')
  }

  private publish(key: string, answer: string) {
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const prior = await tx.get<MainCommand>('main-command', key)
      if (!prior || prior.status === 'completed') return
      const state = await this.state(tx)
      const sequence = state.sequence + 1
      await tx.insert<MainMessage>('main-message', messageKey(sequence), { id: `reply:${prior.messageId}`, sequence, role: 'main', text: answer, createdAt: Date.now(), status: 'completed' })
      await tx.replace('main-state', 'main', { ...state, sequence })
      await this.updateCommandIn(tx, key, { ...prior, status: 'completed', replySequence: sequence })
    })
  }

  private async updateCommandIn(tx: AsyncTx, key: string, command: MainCommand, error?: string) {
    await tx.replace('main-command', key, command)
    const message = await tx.get<MainMessage>('main-message', messageKey(command.userSequence))
    if (message) await tx.replace('main-message', messageKey(command.userSequence), { ...message, status: command.status, ...(error ? { error } : {}) })
    const state = await this.state(tx)
    if (command.status === 'running') await tx.replace('main-state', 'main', { ...state, activeCommand: key })
    else if (state.activeCommand === key && command.status === 'completed') {
      const { activeCommand: _active, ...settled } = state
      await tx.replace('main-state', 'main', settled)
    }
  }

  private updateCommand(key: string, status: MainCommand['status'], error?: string) {
    return commandTransaction(this.storage, this.instanceId, async tx => {
      const command = await tx.get<MainCommand>('main-command', key)
      if (command && command.status !== 'completed') await this.updateCommandIn(tx, key, { ...command, status }, error)
    })
  }

  async close() { this.closed = true; await this.tail }
}
