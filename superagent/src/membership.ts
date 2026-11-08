import { CoreError, identifier } from './model.js'
import type { AsyncTx, Storage } from './storage.js'

export interface SourceMember {
  nativeActorId: string
  kind: 'human' | 'bot'
  displayName?: string
  active: boolean
}
export interface MembershipSnapshot {
  sourceInstanceId: string
  revision: number
  members: SourceMember[]
  origin: 'startup' | 'manual'
  updatedAt: number
}
const key = (sourceInstanceId: string) => JSON.stringify(['source-members', sourceInstanceId])
const historyKey = (sourceInstanceId: string, revision: number) => `${JSON.stringify(['source-members-history', sourceInstanceId])}:${String(revision).padStart(10, '0')}`

export class SourceMembership {
  constructor(private readonly storage: Storage, private readonly instanceId: string, private readonly sourceInstanceId: string, private readonly now: () => number = Date.now) {
    identifier(sourceInstanceId, 'sourceInstanceId')
  }

  async get(): Promise<MembershipSnapshot | undefined> {
    return this.storage.transaction(this.instanceId, tx => tx.get<MembershipSnapshot>('source-members', key(this.sourceInstanceId)))
  }

  /** A strictly newer native revision replaces the snapshot; an older or equal one never overwrites it. */
  async sync(transaction: AsyncTx, request: { revision: number; members: SourceMember[]; origin: 'startup' | 'manual' }): Promise<MembershipSnapshot> {
    if (!Number.isSafeInteger(request.revision) || request.revision < 1) throw new CoreError('INVALID_CONFIG', 'A member-sync revision must be a positive safe integer.')
    if (!Array.isArray(request.members) || request.members.length > 1000) throw new CoreError('INVALID_CONFIG', 'A member sync accepts at most 1000 members.')
    const ids = new Set<string>()
    for (const member of request.members) {
      identifier(member?.nativeActorId, 'nativeActorId')
      if (!['human', 'bot'].includes(member.kind)) throw new CoreError('INVALID_CONFIG', 'A member kind is human or bot.')
      if (member.displayName !== undefined && (typeof member.displayName !== 'string' || Buffer.byteLength(member.displayName) > 256)) throw new CoreError('INVALID_CONFIG', 'A member display name must be bounded.')
      if (typeof member.active !== 'boolean') throw new CoreError('INVALID_CONFIG', 'A member active flag must be boolean.')
      if (ids.has(member.nativeActorId)) throw new CoreError('INVALID_CONFIG', 'Native member identities must be unique in one sync.')
      ids.add(member.nativeActorId)
    }
    const current = await transaction.get<MembershipSnapshot>('source-members', key(this.sourceInstanceId))
    if (current && request.revision <= current.revision) throw new CoreError('STALE_MEMBERSHIP_SYNC', 'This member-sync revision is not newer than the stored snapshot.')
    const snapshot: MembershipSnapshot = { sourceInstanceId: this.sourceInstanceId, revision: request.revision,
      members: structuredClone(request.members), origin: request.origin, updatedAt: this.now() }
    if (!await transaction.replace('source-members', key(this.sourceInstanceId), snapshot)) await transaction.insert('source-members', key(this.sourceInstanceId), snapshot)
    await transaction.insert('source-members-history', historyKey(this.sourceInstanceId, request.revision), snapshot)
    return snapshot
  }

  async history(): Promise<MembershipSnapshot[]> {
    const prefix = `${JSON.stringify(['source-members-history', this.sourceInstanceId])}:`
    return this.storage.transaction(this.instanceId, async tx => {
      const page = await tx.scan<MembershipSnapshot>('source-members-history', { limit: 100, after: prefix })
      return page.items.map(item => item.value).filter(snapshot => snapshot.sourceInstanceId === this.sourceInstanceId)
    })
  }
}
