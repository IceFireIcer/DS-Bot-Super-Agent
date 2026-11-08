import { identifier } from './model.js'
import type { AsyncTx } from './storage.js'

export type BackgroundKind = 'job' | 'subagent'

export interface BackgroundEntry { kind: BackgroundKind; id: string; assignmentId: string }
export interface BackgroundIndexRecord { ticketId: string; entries: BackgroundEntry[] }

/**
 * Whether one background record is still live: `undefined` when it does not exist, `false` when it settled,
 * `true` while it still owns work.
 */
export type BackgroundLiveness = (tx: AsyncTx, request: { ticketId: string; id: string }) => Promise<boolean | undefined>

const indexKey = (ticketId: string) => JSON.stringify(['background', ticketId])

/**
 * The durable list of background work a Ticket still owns, kept apart from the record history so admission and
 * slot holding never depend on a bounded history scan. Each owning module supplies its own liveness check, so an
 * entry whose record settled or disappeared is dropped on the next read instead of blocking the Ticket.
 */
export class BackgroundWork {
  constructor(private readonly kind: BackgroundKind, private readonly load: BackgroundLiveness) {}

  async add(tx: AsyncTx, ticketId: string, entry: { id: string; assignmentId: string }) {
    identifier(ticketId, 'ticketId'); identifier(entry.id, 'background id')
    const current = await tx.get<BackgroundIndexRecord>('background', indexKey(ticketId)) ?? { ticketId, entries: [] }
    const entries = current.entries.filter(existing => !(existing.kind === this.kind && existing.id === entry.id))
    entries.push({ kind: this.kind, id: entry.id, assignmentId: entry.assignmentId })
    await this.write(tx, ticketId, entries)
  }

  async remove(tx: AsyncTx, ticketId: string, id: string) {
    const current = await tx.get<BackgroundIndexRecord>('background', indexKey(ticketId))
    if (!current) return
    const entries = current.entries.filter(entry => !(entry.kind === this.kind && entry.id === id))
    if (entries.length === current.entries.length) return
    await this.write(tx, ticketId, entries)
  }

  /** Live entries of this kind, after dropping anything whose record settled or vanished. */
  async active(tx: AsyncTx, ticketId: string): Promise<{ id: string; assignmentId: string }[]> {
    const current = await tx.get<BackgroundIndexRecord>('background', indexKey(ticketId))
    if (!current) return []
    const live: { id: string; assignmentId: string }[] = []
    const kept: BackgroundEntry[] = []
    for (const entry of current.entries) {
      if (entry.kind !== this.kind) { kept.push(entry); continue }
      if (await this.load(tx, { ticketId, id: entry.id }) !== true) continue
      kept.push(entry)
      live.push({ id: entry.id, assignmentId: entry.assignmentId })
    }
    if (kept.length !== current.entries.length) await this.write(tx, ticketId, kept)
    return live
  }

  async hasActive(tx: AsyncTx, ticketId: string, assignmentId?: string) {
    return (await this.active(tx, ticketId)).some(entry => assignmentId === undefined || entry.assignmentId === assignmentId)
  }

  private async write(tx: AsyncTx, ticketId: string, entries: BackgroundEntry[]) {
    const next: BackgroundIndexRecord = { ticketId, entries }
    if (!await tx.replace('background', indexKey(ticketId), next)) await tx.insert('background', indexKey(ticketId), next)
  }
}
