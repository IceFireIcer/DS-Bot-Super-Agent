import { CoreError } from './model.js'
import type { Engine } from './engine.js'
import type { FeishuOpenApi } from './feishu-api.js'
import type { MembershipSnapshot, SourceMember } from './membership.js'

/**
 * Compose the Feishu member API with the engine's revisioned membership store.
 * The caller decides when to run it (startup or an authorized manual command).
 */
export class FeishuMemberSync {
  private pending: Promise<MembershipSnapshot> | undefined
  constructor(private readonly api: FeishuOpenApi, private readonly engine: Engine, private readonly chatIds: string[]) {
    if (!Array.isArray(chatIds) || chatIds.length < 1 || chatIds.length > 100 || chatIds.some(chatId => typeof chatId !== 'string' || !chatId)) {
      throw new CoreError('INVALID_CONFIG', 'Feishu member sync needs 1–100 chat IDs.')
    }
  }

  sync(request: { commandId: string; origin?: 'startup' | 'manual'; signal: AbortSignal }): Promise<MembershipSnapshot> {
    if (this.pending) throw new CoreError('MEMBERSHIP_SYNC_ACTIVE', 'A Feishu member sync is already running.')
    const operation = this.collect(request)
    this.pending = operation
    return operation.finally(() => { this.pending = undefined })
  }

  private async collect(request: { commandId: string; origin?: 'startup' | 'manual'; signal: AbortSignal }): Promise<MembershipSnapshot> {
    request.signal.throwIfAborted()
    // Reserve the revision before the network read: a newer manual snapshot must win.
    const current = await this.engine.getSourceMembers()
    const revision = (current?.revision ?? 0) + 1
    const members: SourceMember[] = []
    for (const chatId of this.chatIds) members.push(...await this.api.listMembers({ chatId, signal: request.signal }))
    request.signal.throwIfAborted()
    const unique = dedupe(members)
    return this.engine.syncSourceMembers({ commandId: request.commandId, revision, members: unique, origin: request.origin ?? 'manual' })
  }
}

function dedupe(members: SourceMember[]) {
  const byId = new Map<string, SourceMember>()
  for (const member of members) {
    const existing = byId.get(member.nativeActorId)
    byId.set(member.nativeActorId, existing && existing.displayName ? existing : member)
  }
  return [...byId.values()]
}
