import { randomUUID } from 'node:crypto'
import { CoreError, identifier, type Work } from './model.js'
import type { Storage, AsyncTx } from './storage.js'
import type { Effects, EffectHandler } from './effects.js'
import type { NativeSessions, NativeTool } from './native-sessions.js'

export interface Assignment { id: string; ticketId: string; sessionId: string; state: 'pending' | 'running' | 'ended'; generation: string }
export interface ReadyReport { id: string; ticketId: string; assignmentId: string; sessionId: string; kind: 'ready'; result: string; evidence: string }
export interface Delivery { id: string; ticketId: string; purpose: 'acknowledgement' | 'result'; text: string; destination: { sourceInstanceId: string; actorId: string; eventId: string }; reportId?: string }

export class Execution {
  private readonly routerSessionId = `router-${randomUUID()}`
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly effects: Effects, private readonly sessions: NativeSessions) {}

  handlers(): Record<'notice' | 'relay' | 'outbox', EffectHandler> {
    return {
      notice: { execute: async effect => { await this.router(String(effect.payload.ticketId), effect.payload.type === 'report-ready'); return { type: 'success' } } },
      relay: { execute: async effect => { await this.worker(String(effect.payload.ticketId)); return { type: 'success' } } },
      outbox: { execute: async effect => {
        const ticketId = String(effect.payload.ticketId)
        const purpose = effect.payload.purpose
        if (purpose !== 'acknowledgement' && purpose !== 'result') throw new CoreError('INVALID_DELIVERY', 'Unsupported delivery purpose.')
        await this.storage.transaction(this.instanceId, async transaction => {
          const trigger = await this.trigger(transaction, ticketId)
          const report = purpose === 'result' ? await transaction.get<ReadyReport>('report', ticketId) : undefined
          if (purpose === 'result' && (!report || report.id !== effect.payload.reportId)) throw new CoreError('NOT_READY', 'Result delivery requires the current ready report.')
          const delivery: Delivery = { id: `${ticketId}:${purpose}`, ticketId, purpose, text: purpose === 'result' ? report!.result : 'Request accepted.', destination: { ...trigger.source, eventId: trigger.eventId }, ...(report ? { reportId: report.id } : {}) }
          if (!await transaction.get('delivery', delivery.id)) await transaction.insert('delivery', delivery.id, delivery)
        })
        return { type: 'success' }
      } },
    }
  }

  private async trigger(transaction: AsyncTx, ticketId: string) {
    const ticket = await transaction.get<Work['ticket']>('ticket', ticketId)
    const trigger = ticket && await transaction.get<Work['trigger']>('trigger', ticket.triggerId)
    if (!ticket || !trigger) throw new CoreError('NOT_FOUND', 'The work does not exist in this instance.')
    return trigger
  }

  private async router(ticketId: string, ready: boolean) {
    const trigger = await this.storage.transaction(this.instanceId, transaction => this.trigger(transaction, ticketId))
    const report = ready ? await this.storage.transaction(this.instanceId, transaction => transaction.get<ReadyReport>('report', ticketId)) : undefined
    if (ready && !report) throw new CoreError('NOT_READY', 'No ready report exists.')
    const tool: NativeTool = ready ? {
      name: 'deliver_result', description: 'Deliver the current verified ready report to the original request.', parameters: { reportId: { type: 'string', required: true } },
      execute: async args => this.storage.transaction(this.instanceId, async transaction => {
        const current = await transaction.get<ReadyReport>('report', ticketId)
        const assignment = await transaction.get<Assignment>('assignment', ticketId)
        if (!current || current.id !== args.reportId || current.assignmentId !== assignment?.id) throw new CoreError('NOT_READY', 'Only the current Assignment ready report may be delivered.')
        await this.effects.enqueue(transaction, { key: `${ticketId}:result`, stream: 'outbox', scope: ticketId, payload: { purpose: 'result', ticketId, reportId: current.id } })
        return 'Result queued for the original message.'
      }),
    } : {
      name: 'assign_worker', description: 'Assign the accepted original request to one Worker.', parameters: {},
      execute: async () => this.storage.transaction(this.instanceId, async transaction => {
        const existing = await transaction.get<Assignment>('assignment', ticketId)
        if (existing) return existing.id
        const assignment: Assignment = { id: randomUUID(), generation: randomUUID(), ticketId, sessionId: `worker-${randomUUID()}`, state: 'pending' }
        await transaction.insert('assignment', ticketId, assignment)
        await this.effects.enqueue(transaction, { key: assignment.id, stream: 'relay', scope: ticketId, payload: { ticketId, assignmentId: assignment.id } })
        return assignment.id
      }),
    }
    const result = await this.sessions.run({ sessionId: this.routerSessionId, role: 'router', text: report ? `Ready report:${JSON.stringify(report)}` : `Accepted original request:${JSON.stringify({ ticketId, text: trigger.text })}`, tools: [tool] })
    await this.storage.transaction(this.instanceId, async transaction => {
      const metadata = { id: result.sessionId, eventCount: result.events.length, role: 'router', status: result.status }
      if (!await transaction.replace('session', result.sessionId, metadata)) await transaction.insert('session', result.sessionId, metadata)
    })
  }

  private async worker(ticketId: string) {
    const { assignment, trigger } = await this.storage.transaction(this.instanceId, async transaction => {
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      if (!assignment) throw new CoreError('NOT_FOUND', 'No active Assignment exists.')
      const trigger = await this.trigger(transaction, ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      assignment.state = 'running'
      await transaction.replace('assignment', ticketId, assignment)
      await transaction.replace('intent', ticketId, { ...intent, state: 'running', reason: 'worker-running' })
      return { assignment, trigger }
    })
    const outcome = await this.sessions.run({ sessionId: assignment.sessionId, role: 'worker', text: trigger.text, tools: [{
      name: 'report_ready', description: 'Record a completed answer and concrete verification evidence for the original request.',
      parameters: { result: { type: 'string', required: true }, evidence: { type: 'string', required: true } },
      execute: async args => {
        for (const value of [args.result, args.evidence]) if (!value?.trim() || Buffer.byteLength(value) > 16384) throw new CoreError('INVALID_REPORT', 'A ready report needs bounded nonempty result and verification evidence.')
        return this.storage.transaction(this.instanceId, async transaction => {
          const current = await transaction.get<Assignment>('assignment', ticketId)
          if (current?.id !== assignment.id || current.state !== 'running') throw new CoreError('STALE_ASSIGNMENT', 'The reporting Assignment is no longer current.')
          const existing = await transaction.get<ReadyReport>('report', ticketId)
          if (existing) return existing.id
          const report: ReadyReport = { id: randomUUID(), ticketId, assignmentId: assignment.id, sessionId: assignment.sessionId, kind: 'ready', result: args.result!, evidence: args.evidence! }
          await transaction.insert('report', ticketId, report)
          return report.id
        })
      },
    }] })
    await this.storage.transaction(this.instanceId, async transaction => {
      await transaction.insert('session', outcome.sessionId, { id: outcome.sessionId, eventCount: outcome.events.length, ticketId, role: 'worker', status: outcome.status })
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      await transaction.replace('intent', ticketId, { ...intent, state: report ? 'ready' : 'running', reason: report ? 'ready-report' : 'worker-idle' })
      if (report) {
        await transaction.replace('assignment', ticketId, { ...assignment, state: 'ended' })
        await this.effects.enqueue(transaction, { key: report.id, stream: 'notice', scope: 'router', payload: { type: 'report-ready', ticketId, reportId: report.id } })
      }
    })
  }

  async conversation(ticketId: string) {
    identifier(ticketId, 'ticketId')
    return this.storage.transaction(this.instanceId, async transaction => {
      const trigger = await this.trigger(transaction, ticketId)
      const assignment = await transaction.get<Assignment>('assignment', ticketId)
      const report = await transaction.get<ReadyReport>('report', ticketId)
      const intent = (await transaction.get<Work['intent']>('intent', ticketId))!
      const messages: Delivery[] = []
      for (const purpose of ['acknowledgement', 'result']) {
        const message = await transaction.get<Delivery>('delivery', `${ticketId}:${purpose}`)
        if (message) messages.push(message)
      }
      return { ticketId, request: trigger.text, status: intent.state, reason: intent.reason, assignments: assignment ? [assignment] : [], reports: report ? [report] : [], messages }
    })
  }
}
