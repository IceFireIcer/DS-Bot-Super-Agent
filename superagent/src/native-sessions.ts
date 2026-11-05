import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { CoreError } from './model.js'

export interface NativeTool { name: string; description: string; parameters: Record<string, { type: 'string'; required: true }>; execute(args: Record<string, string>): Promise<string> }
export interface NativeSessionRequest { sessionId: string; role: 'router' | 'worker'; text: string; tools: NativeTool[] }
export interface NativeSessionsOptions { router: AgentOptions; worker: AgentOptions; timeoutMs?: number }

export class NativeSessions {
  readonly timeoutMs: number
  private readonly handles = new Set<AgentHandle>()
  private readonly completed = new Set<string>()
  private closed = false
  constructor(private readonly context: Context, private readonly options: NativeSessionsOptions) {
    const timeout = options.timeoutMs ?? 15000
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new CoreError('INVALID_CONFIG', 'Session timeout must be between 100 and 60000 ms.')
    for (const route of [options.router, options.worker]) if (!route.provider || !route.model) throw new CoreError('INVALID_CONFIG', 'Both roles require an explicit provider and model route.')
    this.options = structuredClone(options)
    this.timeoutMs = timeout
  }

  async run(request: NativeSessionRequest) {
    if (this.closed) throw new CoreError('RUNTIME_CLOSED', 'The native Session adapter is closed.')
    if (!this.context.get('sessionPersistence')) throw new CoreError('PERSISTENCE_REQUIRED', 'A native Session persistence provider is required before execution.')
    let steps = 0
    const creation = {
      sessionId: SessionId(request.sessionId), agentOptions: this.options[request.role],
      setup: ((scoped, agent) => {
        scoped.on('agent/request', async (_payload, next) => {
          if (++steps > 8) { agent.cancel({ kind: 'hook', reason: 'Super-agent step budget exhausted.' }); throw new CoreError('STEP_BUDGET', 'The Session step budget was exhausted.') }
          return next()
        })
        scoped.tools.restrict({ allow: [] })
        scoped.systemPrompt.section({ name: 'superagent-role', order: 0, text: request.role === 'router'
          ? 'You are the Router. Use only the supplied routing and delivery tools. Preserve the original request and require current ready evidence before delivering a result.'
          : 'You are the Worker. Read the original request. Use report_ready only after completing it and supplying verification evidence. Ordinary text or becoming idle does not complete work.' })
        for (const tool of request.tools) scoped.tools.register(defineTool({
          name: tool.name, description: tool.description, parameters: tool.parameters,
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          execute: args => tool.execute(args),
        }) satisfies ToolDefinition)
      }) satisfies NonNullable<Parameters<Context['agents']['create']>[0]['setup']>,
    }
    const handle = this.completed.has(request.sessionId) ? await this.context.agents.resume({ resumeSessionId: creation.sessionId, agentOptions: creation.agentOptions, setup: creation.setup }) : await this.context.agents.create(creation)
    if (this.closed) { await handle.dispose(); throw new CoreError('RUNTIME_CLOSED', 'The native Session adapter closed during creation.') }
    this.handles.add(handle)
    const timer = setTimeout(() => handle.agent.cancel({ kind: 'hook', reason: 'Super-agent turn budget exhausted.' }), this.timeoutMs)
    try {
      handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', content: [{ type: 'text', text: request.text }], source: { kind: 'user' } })
      await handle.agent.whenIdle()
      if (!await this.context.sessions.flush(handle.agent.session)) throw new CoreError('PERSISTENCE_REQUIRED', 'No persistence provider confirmed this Session flush.')
      return { sessionId: request.sessionId, status: handle.agent.status, events: structuredClone(handle.agent.session.snapshotEvents()) }
    } finally { clearTimeout(timer); await handle.dispose(); this.handles.delete(handle); this.completed.add(request.sessionId) }
  }

  async close() {
    this.closed = true
    await Promise.all([...this.handles].map(handle => handle.dispose()))
  }
}
