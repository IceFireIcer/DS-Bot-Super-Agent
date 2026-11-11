const unsupported = operation => Object.assign(new Error(`The execution backend does not support ${operation} in this conversation.`), { code: 'bot/execution-unsupported' })

/**
 * Optional trusted Host boundary. Methods receive (request, {ctx, rt, signal}).
 * supports({operation, sessionId, owner}) must explicitly return true. Mutations
 * return {durable:true, sessionId}; resolveAgent returns the real DSH Agent with
 * that same Session identity. This seam neither grants tools nor owns Sessions.
 */
export function install(rt) {
  const adapter = rt.config.executionAdapter
  if (adapter !== undefined && (!adapter || adapter.version !== 1 || typeof adapter.supports !== 'function')) {
    throw new Error('executionAdapter requires version 1 and an explicit supports function.')
  }
  const ownerOf = sessionId => {
    const group = rt.groupOwners?.get(sessionId)
    const botId = group?.botId ?? rt.chatOwners?.get(sessionId)
    const room = group?.roomId ?? rt.roomOf?.(sessionId)?.id
    return { ...(botId ? { botId } : {}), ...(room ? { roomId: room } : {}),
      kind: room ? 'group' : botId ? 'bot' : 'agent' }
  }
  const executionSupports = async (operation, request, signal) => {
    if (!adapter) throw unsupported(operation)
    const owner = ownerOf(request.sessionId)
    const context = { ctx: rt.ctx, rt, signal }
    if (typeof adapter[operation] !== 'function'
      || await adapter.supports({ operation, sessionId: request.sessionId, owner }, context) !== true) throw unsupported(operation)
    signal?.throwIfAborted()
    return { owner, context }
  }
  const executionDispatch = async (operation, request, signal) => {
    const { owner, context } = await executionSupports(operation, request, signal)
    const result = await adapter[operation]({ ...request, owner }, context)
    if (operation === 'resolveAgent') {
      if (!result?.session || result.session.id !== request.sessionId) {
        throw Object.assign(new Error('The backend did not return the owning Agent for this Session.'), { code: 'bot/execution-unconfirmed' })
      }
    } else if (result?.durable !== true || result.sessionId !== request.sessionId) {
      throw Object.assign(new Error('The backend did not confirm a durable operation for this Session.'), { code: 'bot/execution-unconfirmed' })
    }
    return result
  }
  const validProjection = projection => projection && typeof projection.botId === 'string'
    && typeof projection.sessionId === 'string' && rt.chatOwners?.get(projection.sessionId) === projection.botId
  const projectExecutionSession = async sessionId => {
    const nativeBot = rt.chatOwners?.get(sessionId)
    if (nativeBot) return { botId: nativeBot, sessionId }
    if (!adapter) return undefined
    const request = { sessionId }
    const { context } = await executionSupports('projectSession', request)
    const mapped = await adapter.projectSession(request, context)
    if (!mapped) return undefined
    if (!validProjection(mapped)) throw unsupported('Session projection')
    return { botId: mapped.botId, sessionId: mapped.sessionId }
  }
  const executionChatPage = async (botId, cursor) => {
    if (!adapter) return rt.chatPage(botId, cursor)
    const sessionId = rt.chatOf(botId)
    if (!validProjection({ botId, sessionId })) throw unsupported('chat projection')
    await executionSupports('chatPage', { sessionId })
    if (cursor && Object.hasOwn(cursor, 'legacy')) {
      const page = await rt.chatPage(botId, cursor.legacy)
      return { ...page, cursor: page.cursor === null ? null : { legacy: page.cursor } }
    }
    const page = await adapter.chatPage({ botId, sessionId, cursor: cursor?.execution }, { ctx: rt.ctx, rt })
    if (!page || page.sessionId !== sessionId || !Array.isArray(page.items) || !Object.hasOwn(page, 'cursor')) throw unsupported('chat projection')
    // Existing history stays readable after the hidden Worker's latest pages.
    return { ...page, cursor: page.cursor == null ? { legacy: null } : { execution: page.cursor } }
  }
  const executionLive = async base => {
    if (!adapter) return base
    const request = { sessionId: '' }
    const { context } = await executionSupports('live', request)
    const projection = await adapter.live(request, context)
    if (!projection || typeof projection !== 'object' || Array.isArray(projection)) throw unsupported('live projection')
    const work = { ...base.work }
    for (const field of ['bots', 'rooms', 'waiting', 'turns', 'steered']) {
      if (projection.work?.[field]) work[field] = { ...work[field], ...projection.work[field] }
    }
    const questions = { ...rt.state.questions }
    for (const [sessionId, question] of Object.entries(projection.questions ?? {})) {
      if (!rt.chatOwners.has(sessionId) || !question || typeof question.id !== 'string'
        || typeof question.question !== 'string' || !Array.isArray(question.options)
        || question.options.some(option => typeof option?.label !== 'string')) throw unsupported('question projection')
      questions[sessionId] = question
    }
    return { ...base, activity: { ...base.activity, ...projection.activity }, work, questions }
  }
  Object.assign(rt, { executionAdapter: adapter, executionDispatch, projectExecutionSession, executionChatPage, executionLive })
}
