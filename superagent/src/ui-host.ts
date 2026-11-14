import type { Context } from '@deepseek-ai/cordis'
import { Engine } from './engine.js'
import { NativeSessions } from './native-sessions.js'
import { SqliteStorage } from './storage.js'
import { CoreError, identifier } from './model.js'
import type { ContextRef } from './context.js'
import type { RoleModel } from './config.js'
import type { DsBotHostConfig } from './ds-bot-host.js'
import { ClientAccess } from './client-access.js'

interface FeedItem {
  id: string
  ticketId: string
  kind: 'user' | 'bot'
  purpose: string
  text: string
  time: number
  evidence?: ContextRef
}

function route(context: Context, configured?: RoleModel) {
  const selected = configured ?? context.get('agentDefaultModel')?.currentSelection?.()
  if (!selected?.provider || !selected.model) throw new CoreError('INVALID_CONFIG', 'Super-agent needs a model route.')
  return { provider: selected.provider, model: selected.model }
}

function stringField(payload: Record<string, unknown>, name: string) {
  const value = payload[name]
  if (typeof value !== 'string' || !value.trim()) throw new CoreError('INVALID_INPUT', `${name} needs text.`)
  return value
}

export async function createSuperagentUi(context: Context, databasePath: string, config: Partial<DsBotHostConfig>) {
  let sessions: NativeSessions | undefined
  let storage: SqliteStorage | undefined
  let engine: Engine | undefined
  try {
    sessions = new NativeSessions(context, { router: route(context, config.router), worker: route(context, config.worker),
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }) })
    storage = await SqliteStorage.open(databasePath)
    engine = new Engine(storage, 'ds-superagent:conversation', {
      kind: 'desktop', sourceInstanceId: 'ds-superagent-ui', actorId: 'local-user', allowedActorIds: ['local-user'],
      allowedThreadIds: ['conversation'], versionOrder: 'sequence',
    }, config.effects ?? {}, sessions, [], {}, {}, {}, config.delivery ?? {}, {
      hostId: 'ds-superagent-ui', ...(config.leaseMs === undefined ? {} : { leaseMs: config.leaseMs }),
    })
    await engine.acquireHost()
    engine.effects.start()
  } catch (error) {
    await engine?.effects.stop().catch(() => {})
    await engine?.shutdown().catch(() => {})
    await Promise.allSettled([sessions?.close(), storage?.close()])
    throw error
  }
  const runtime = engine
  const runtimeSessions = sessions
  const runtimeStorage = storage
  const journal = new ClientAccess(runtimeStorage, 'ds-superagent-ui-feed')

  const state = async (payload: Record<string, unknown>) => {
    if (payload.cursor !== undefined) {
      if (typeof payload.cursor !== 'string' || !/^\d{1,10}$/u.test(payload.cursor)) throw new CoreError('INVALID_INPUT', 'Invalid feed cursor.')
    }
    const items: FeedItem[] = []
    const tickets = []
    let cursor: string | undefined
    do {
      const page = await runtime.listTickets(cursor)
      for (const work of page.items) {
        const ticketId = work.ticket.id
        const conversation = await runtime.conversation(ticketId)
        const firstMessage = Math.min(...conversation.messageHistory.map(message => message.createdAt))
        items.push({ id: `${ticketId}:request`, ticketId, kind: 'user', purpose: 'request', text: conversation.request,
          time: Number.isFinite(firstMessage) ? firstMessage - 1 : 0 })
        for (const message of conversation.messageHistory) {
          if (message.purpose === 'attention') continue
          items.push({ id: `${message.id}:${message.sequence}`, ticketId, kind: 'bot', purpose: message.purpose,
            text: message.text, time: message.createdAt,
            ...(message.purpose === 'result' && message.basis.kind === 'ready-report'
              ? { evidence: { kind: 'report' as const, ticketId, id: message.basis.reportId } } : {}) })
        }
        for (const attention of conversation.attentionHistory) {
          if (attention.status === 'answered' && attention.answerText) items.push({ id: `${attention.id}:answer`, ticketId,
            kind: 'user', purpose: 'answer', text: attention.answerText, time: attention.answeredAt ?? attention.createdAt })
        }
        tickets.push({ ticketId, status: conversation.status, reason: conversation.reason,
          attention: conversation.attention?.status === 'waiting' ? conversation.attention : null,
          canStop: !conversation.stop && conversation.lifecycle !== 'ended' && conversation.status !== 'ready',
          canResume: conversation.stop?.state === 'stopped' && !conversation.stop.pendingDeviceConfirmation })
      }
      cursor = page.nextCursor
    } while (cursor)
    items.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
    for (let index = 0; index < items.length; index += 1000) {
      await journal.record(items.slice(index, index + 1000).map(item => ({
        key: item.id, kind: 'state' as const, ticketId: item.ticketId, data: item,
      })))
    }
    const page = await journal.readEvents(payload.cursor as string | undefined, 100)
    return { version: 1, items: page.items.map(event => {
      const item = event.data as FeedItem
      return { ...item, time: item.time || event.at }
    }), tickets, cursor: page.cursor, hasMore: page.hasMore }
  }

  const handle = async (endpoint: string, payload: Record<string, unknown> = {}) => {
    if (endpoint === 'state') return state(payload)
    if (endpoint === 'send') {
      if (Object.keys(payload).some(key => !['requestId', 'text'].includes(key))) throw new CoreError('UNSUPPORTED_CAPABILITY', 'v1 accepts text messages only.')
      const requestId = stringField(payload, 'requestId')
      identifier(requestId, 'requestId')
      const text = stringField(payload, 'text')
      const received = await runtime.receiveSource({ commandId: `ui:${requestId}`, threadId: 'conversation', objectId: requestId,
        type: 'created', version: '1', text, authorId: 'local-user', authorKind: 'human', addressing: 'direct' })
      if (!received.eventId) throw new CoreError('INVALID_INPUT', 'The message was not recorded.')
      const receipt = await runtime.acceptSource({ commandId: `accept:${requestId}`, threadId: 'conversation', objectId: requestId, expectedEventId: received.eventId })
      runtime.effects.wake()
      return { durable: true, ticketId: receipt.ticketId }
    }
    if (endpoint === 'evidence') {
      const ticketId = stringField(payload, 'ticketId')
      return runtime.readContext({ ticketId, ref: payload.ref as ContextRef, ...(payload.after === undefined ? {} : { after: stringField(payload, 'after') }) })
    }
    const commandId = ['answer', 'stop', 'resume'].includes(endpoint) ? stringField(payload, 'requestId') : ''
    if (endpoint === 'answer') {
      const ticketId = stringField(payload, 'ticketId')
      const conversation = await runtime.conversation(ticketId)
      const attentionId = stringField(payload, 'attentionId')
      if (conversation.attention?.id !== attentionId) throw new CoreError('INVALID_INPUT', 'The question does not belong to this Ticket.')
      await runtime.answerAttention({ commandId, attentionId, text: stringField(payload, 'text') })
    } else if (endpoint === 'stop') {
      await runtime.stopTicket({ commandId, ticketId: stringField(payload, 'ticketId'), reason: 'Stopped by the user.' })
    } else if (endpoint === 'resume') {
      await runtime.resumeTicket({ commandId, ticketId: stringField(payload, 'ticketId') })
    } else throw new CoreError('UNSUPPORTED_CAPABILITY', 'This action is unavailable in Super-agent v1.')
    runtime.effects.wake()
    return { durable: true }
  }
  return { handle, close: async () => {
    const errors = []
    try { await runtime.effects.stop() } catch (error) { errors.push(error) }
    try { await runtime.shutdown() } catch (error) { errors.push(error) }
    try { await runtimeSessions.close() } catch (error) { errors.push(error) }
    try { await runtimeStorage.close() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'The Super-agent UI did not close cleanly.')
  } }
}
