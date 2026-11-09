import { CoreError } from './model.js'
import type { Engine } from './engine.js'
import type { FeishuOpenApi } from './feishu-api.js'
import type { MembershipSnapshot, SourceMember } from './membership.js'

/**
 * Compose the Feishu member API with the engine's revisioned membership store.
 * The caller decides when to run it (startup or an authorized manual command).
 */
export class FeishuMemberSync {
  constructor(private readonly api: FeishuOpenApi, private readonly engine: Engine, private readonly chatIds: string[]) {
    if (!Array.isArray(chatIds) || chatIds.length < 1 || chatIds.length > 100 || chatIds.some(chatId => typeof chatId !== 'string' || !chatId)) {
      throw new CoreError('INVALID_CONFIG', 'Feishu member sync needs 1–100 chat IDs.')
    }
  }

  async sync(request: { commandId: string; origin?: 'startup' | 'manual'; signal: AbortSignal }): Promise<MembershipSnapshot> {
    const members: SourceMember[] = []
    for (const chatId of this.chatIds) members.push(...await this.api.listMembers({ chatId, signal: request.signal }))
    const unique = dedupe(members)
    const current = await this.engine.getSourceMembers()
    const revision = Math.max(current === undefined ? 1 : current.revision + 1, request.origin === 'startup' ? 1 : Date.now())
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
