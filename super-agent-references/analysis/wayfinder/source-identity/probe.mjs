import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

// Original protocol model using fictional identifiers, not a connector or a port of the reference Engine.
const key = (...parts) => JSON.stringify(parts)
const configs = [
  { id: 'repo-a', instance: 'private', kind: 'github', scope: 'https://git.example/alpha/one', allowed: ['42'] },
  { id: 'repo-b', instance: 'private', kind: 'github', scope: 'https://git.example/beta/two', allowed: [] },
  { id: 'chat-a', instance: 'private', kind: 'chat', scope: 'tenant-a/room', allowed: ['42'] },
  { id: 'chat-b', instance: 'private', kind: 'chat', scope: 'tenant-b/room', allowed: [] },
  { id: 'team-a', instance: 'team', kind: 'github', scope: 'https://git.example/alpha/one', allowed: ['42'] },
]
class Replay {
  constructor(snapshot) {
    this.sources = new Map(configs.map(c => [c.id, c]))
    this.events = new Map(snapshot?.events ?? [])
    this.latest = new Map(snapshot?.latest ?? [])
    this.tickets = new Map(snapshot?.tickets ?? [])
    this.subscriptions = new Map(snapshot?.subscriptions ?? [])
    this.returned = new Map(snapshot?.returned ?? [])
    this.fanout = new Map(snapshot?.fanout ?? [])
  }
  snapshot() { return structuredClone(Object.fromEntries(['events','latest','tickets','subscriptions','returned','fanout'].map(k => [k, [...this[k]]]))) }
  receive(sourceId, raw) {
    const s = this.sources.get(sourceId); assert.ok(s, 'registered transport source required')
    assert.equal(raw.scope, s.scope, 'source scope mismatch')
    const event = {
      source: s.id, instance: s.instance, kind: s.kind,
      object: key(s.instance, s.id, raw.type, raw.object),
      thread: key(s.instance, s.id, raw.threadType ?? 'discussion', raw.thread),
      actor: key(s.instance, s.id, raw.actor),
      channel: key(s.instance, s.id, raw.thread, raw.object),
      id: key(s.instance, s.id, raw.type, raw.object, raw.version, raw.operation),
      version: raw.version, operation: raw.operation, text: raw.text,
      human: raw.human !== false, authorized: raw.human !== false && s.allowed.includes(raw.actor),
    }
    assert.ok(Number.isSafeInteger(event.version) && event.version >= 0, 'fixture requires comparable source versions')
    const existing = this.events.get(event.id)
    if (existing) return { status: JSON.stringify(existing) === JSON.stringify(event) ? 'duplicate' : 'conflict', event: existing }
    const current = this.latest.get(event.object)
    if (current && current.version === event.version) return { status: 'conflict', event }
    this.events.set(event.id, event)
    if (current && current.version > event.version) return { status: 'archived-stale', event }
    this.latest.set(event.object, event)
    this.fanout.set(event.id, structuredClone(this.subscriptions.get(event.thread) ?? []))
    return { status: 'current', event }
  }
  accept(event, id) {
    assert.ok(event.authorized && event.operation !== 'delete', 'new work requires authorization')
    assert.equal(this.latest.get(event.object)?.id, event.id, 'stale event cannot authorize new work')
    assert.equal(this.owners(event).length, 0, 'worker owns follow-up')
    const prior = [...this.tickets.values()].find(t => t.origin === event.object)
    if (prior) return prior.id
    assert.ok(!this.tickets.has(id), 'ticket identity already used')
    this.tickets.set(id, { id, instance: event.instance, origin: event.object, mandateActor: event.actor })
    this.bind(id, event.thread, 'own'); return id
  }
  bind(id, thread, mode) {
    const ticket = this.tickets.get(id); assert.ok(ticket)
    assert.equal(JSON.parse(thread)[0], ticket.instance, 'cross-instance subscription denied')
    const subscriptions = this.subscriptions.get(thread) ?? []
    this.subscriptions.set(thread, [...subscriptions.filter(x => x.id !== id), { id, mode }])
  }
  owners(event) {
    if (!event.human || event.operation === 'delete' || this.latest.get(event.object)?.id !== event.id) return []
    const returned = this.returned.get(event.id) ?? []
    return (this.fanout.get(event.id) ?? []).filter(s => s.mode === 'own' && !returned.includes(s.id)).map(s => s.id)
  }
  handback(event, id) {
    assert.ok(this.owners(event).includes(id), 'only current owner may hand back')
    this.returned.set(event.id, [...this.returned.get(event.id) ?? [], id])
    return this.owners(event).length === 0
  }
  associate(event, candidates, evidence) {
    assert.equal(this.owners(event).length, 0, 'worker owns follow-up')
    assert.ok(event.authorized, 'reference does not grant authorization')
    assert.notEqual(event.operation, 'delete', 'deleted content cannot associate')
    assert.equal(this.latest.get(event.object)?.id, event.id, 'stale event cannot associate')
    assert.ok(evidence && ['explicit-reference','verified-context'].includes(evidence.kind), 'similarity is only a candidate')
    assert.equal(candidates.length, 1, 'ambiguous association')
    const ticket = this.tickets.get(candidates[0]); assert.ok(ticket, 'unknown reference')
    assert.equal(ticket.instance, event.instance, 'cross-instance association denied')
    assert.equal(evidence.target, ticket.id, 'evidence does not match target')
    assert.ok(evidence.verified && evidence.sourceEvent === event.id, 'unverified reference')
    assert.ok(evidence.readable, 'target access denied')
    assert.ok(!(this.returned.get(event.id) ?? []).includes(ticket.id), 'cannot attach back to handback owner')
    this.bind(ticket.id, event.thread, 'own')
    this.fanout.set(event.id, [...this.fanout.get(event.id) ?? [], { id: ticket.id, mode: 'own' }])
    return { ticket: ticket.id, sourceEvent: event.id, evidence: structuredClone(evidence) }
  }
}
const raw = (source, patch = {}) => ({ scope: configs.find(c => c.id === source).scope, type: 'message', object: '7', thread: '7', actor: '42', version: 1, operation: 'create', text: 'Please inspect', ...patch })
const event = (r, source = 'repo-a', patch) => r.receive(source, raw(source, patch)).event
const proof = (e, target) => ({ kind: 'explicit-reference', sourceEvent: e.id, target, verified: true, readable: true })
const checks = []
function check(name, work, negative = false) { work(); checks.push({ name, negative, passed: true }); console.log('PASS ' + name) }

check('N1 kind plus native ID collides for two repositories', () => {
  const rows = new Map(); rows.set('github:7', 'repo-a'); rows.set('github:7', 'repo-b'); assert.equal(rows.size, 1)
}, true)
check('N2 actor-only allowlist leaks permission between source instances', () => {
  const sharedAllowlist = new Set(['42']); assert.equal(sharedAllowlist.has(raw('repo-b').actor), true)
}, true)
check('P1 four source instances retain same-number messages, threads and actors independently', () => {
  const r = new Replay(); const items = ['repo-a','repo-b','chat-a','chat-b'].map(s => event(r, s))
  for (const field of ['id','object','thread','actor','channel']) assert.equal(new Set(items.map(e => e[field])).size, 4)
  assert.equal(r.events.size, 4)
})
check('P2 source-scoped Policy never borrows another instance actor permission', () => {
  const r = new Replay(); assert.ok(event(r).authorized); assert.equal(event(r,'repo-b').authorized, false)
  assert.throws(() => r.accept(event(r,'repo-b'), 'wrong'), /authorization/)
})
check('P3 payload source spoof and scope substitution cannot overwrite transport identity', () => {
  const r = new Replay(); const e = event(r,'repo-b',{ source: 'repo-a', instance: 'private' }); assert.equal(e.source,'repo-b'); assert.equal(e.authorized,false)
  assert.throws(() => r.receive('repo-a',raw('repo-b')), /scope mismatch/)
})
check('P4 tuple encoding distinguishes delimiter-shaped native IDs', () => {
  assert.notEqual(key('a:b','c'),key('a','b:c')); assert.notEqual(key('1',1),key('1','1'))
})
check('P5 retries ignore transport delivery IDs; edits retain immutable event history', () => {
  const r = new Replay(); const a = event(r)
  assert.equal(r.receive('repo-a',raw('repo-a',{ deliveryId: 'retry' })).status,'duplicate')
  const b = event(r,'repo-a',{version:2,operation:'edit',text:'Change direction'})
  assert.equal(a.object,b.object); assert.notEqual(a.id,b.id); assert.equal(r.events.get(a.id).text,'Please inspect')
})
check('P6 stale create/edit after deletion does not resurrect or authorize work', () => {
  const r = new Replay(); const initial = event(r); r.accept(initial,'work')
  const tombstone = event(r,'repo-a',{version:3,operation:'delete',text:''})
  assert.equal(r.receive('repo-a',raw('repo-a',{version:2,operation:'edit'})).status,'archived-stale')
  assert.equal(r.latest.get(initial.object).id,tombstone.id); assert.equal(r.tickets.size,1)
  assert.throws(() => r.accept(initial,'new'), /stale/)
  assert.throws(() => r.accept(tombstone,'new'), /authorization/)
  assert.throws(() => r.associate(tombstone,['work'],proof(tombstone,'work')), /deleted content/)
  assert.equal(r.tickets.get('work').mandateActor,initial.actor)
})
check('P7 same-version divergent content reports conflict without overwriting current', () => {
  const r = new Replay(); const first = event(r)
  assert.equal(r.receive('repo-a',raw('repo-a',{text:'conflicting'})).status,'conflict')
  assert.equal(r.latest.get(first.object).text,'Please inspect')
})
check('P8 editing an accepted message follows the same Ticket without new acceptance', () => {
  const r = new Replay(); r.accept(event(r),'work'); const follow = event(r,'repo-a',{version:2,operation:'edit'})
  assert.deepEqual(r.owners(follow),['work']); assert.throws(() => r.accept(follow,'other'), /worker owns/); assert.equal(r.tickets.size,1)
})
check('P9 verified cross-channel reference records provenance without changing mandate', () => {
  const r = new Replay(); r.accept(event(r),'work'); const before = structuredClone(r.tickets.get('work'))
  const chat = event(r,'chat-a'); const record = r.associate(chat,['work'],proof(chat,'work'))
  assert.equal(record.sourceEvent,chat.id); assert.deepEqual(r.owners(chat),['work']); assert.deepEqual(r.tickets.get('work'),before)
})
check('P10 similarity, ambiguous and invalid references never subscribe a Thread', () => {
  const r = new Replay(); r.accept(event(r),'work'); const chat = event(r,'chat-a')
  assert.throws(() => r.associate(chat,['work'],{kind:'similarity'}), /similarity/)
  assert.throws(() => r.associate(chat,['work','other'],proof(chat,'work')), /ambiguous/)
  assert.throws(() => r.associate(chat,['missing'],proof(chat,'missing')), /unknown reference/)
  assert.throws(() => r.associate(chat,['work'],{...proof(chat,'work'),verified:false}), /unverified/)
  assert.throws(() => r.associate(chat,['work'],{...proof(chat,'work'),readable:false}), /access denied/)
  assert.deepEqual(r.owners(chat),[])
})
check('P11 explicit reference is not permission and does not cross context Instances', () => {
  const r = new Replay(); r.accept(event(r),'work'); const denied = event(r,'chat-b')
  assert.throws(() => r.associate(denied,['work'],proof(denied,'work')), /authorization/)
  const team = event(r,'team-a'); assert.throws(() => r.associate(team,['work'],proof(team,'work')), /cross-instance/)
})
check('P12 multi-owner handback blocks rerouting until every owner returns', () => {
  const r = new Replay(); const first = event(r); r.accept(first,'one')
  r.accept(event(r,'repo-a',{object:'8',thread:'8'}),'two'); r.bind('two',first.thread,'own')
  const follow = event(r,'repo-a',{object:'9'}); assert.deepEqual(r.owners(follow),['one','two'])
  assert.equal(r.handback(follow,'one'),false); assert.throws(() => r.associate(follow,['one'],proof(follow,'one')), /worker owns/)
  assert.equal(r.handback(follow,'two'),true); assert.throws(() => r.associate(follow,['one'],proof(follow,'one')), /handback/)
})
check('P13 context-only and bot events cannot acquire human follow-up ownership', () => {
  const r = new Replay(); const first = event(r); r.accept(first,'work'); const chat = event(r,'chat-a')
  r.bind('work',chat.thread,'context'); assert.deepEqual(r.owners(chat),[])
  const bot = event(r,'repo-a',{object:'bot',human:false}); assert.deepEqual(r.owners(bot),[]); assert.equal(bot.authorized,false)
})
check('P14 replay after snapshot restore preserves dedup, namespace and handback', () => {
  const r = new Replay(); r.accept(event(r),'work'); const follow = event(r,'repo-a',{object:'next'}); r.handback(follow,'work')
  const restored = new Replay(r.snapshot()); assert.equal(restored.receive('repo-a',raw('repo-a',{object:'next'})).status,'duplicate'); assert.deepEqual(restored.owners(follow),[])
})
check('P15 legacy identifiers require an explicit unambiguous source mapping', () => {
  const mapLegacy = (legacy, candidates) => { assert.equal(candidates.length,1,'ambiguous legacy source'); return key('private',candidates[0],legacy) }
  assert.throws(() => mapLegacy('github:7',['repo-a','repo-b']), /ambiguous/)
  assert.equal(mapLegacy('github:7',['repo-a']),key('private','repo-a','github:7'))
})
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify({scope:'Original in-memory protocol model with fictional source versions and verified-reference flags; no real connector, database, DSH, authentication or semantic resolver validation.',checks,passed:checks.length,negativeControls:checks.filter(c=>c.negative).length},null,2)+'\n')
