import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

const require = createRequire(process.env.DSH_HARNESS ? join(resolve(process.env.DSH_HARNESS), 'package.json') : new URL('../../../../ds-bot/dev/harness/package.json', import.meta.url))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { Session, SessionStore } = await load('@deepseek-ai/dsh-session')
const { SessionPersistence, SessionAlreadyOwnedError, SessionOwnershipLostError, SessionHandleClosedError, SessionReadOnlyError } = await load('@deepseek-ai/dsh-session-persistence')
const { SessionProjectionRegistry } = await load('@deepseek-ai/dsh-session-projection')
const { SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
class Query extends SessionQueryEngine {async searchSessions(){throw new Error('unused in probe')} async searchEvents(){throw new Error('unused in probe')}}
const version = require('@deepseek-ai/dsh-session/package.json').version
assert.equal(version, '0.2.1-rc.4')

// Original minimal public-interface provider: SQLite protocol evidence, not a production backend.
class Provider extends SessionPersistence {
  constructor(ctx, path) {
    super(ctx)
    this.db = new DatabaseSync(path); this.owner = randomUUID(); this.handles = new Map(); this.disposals = []; this.failFlush = false
    this.db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, header TEXT NOT NULL, owner TEXT NOT NULL, epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT, seq INTEGER, value TEXT NOT NULL, PRIMARY KEY(id,seq));
      CREATE TABLE IF NOT EXISTS business(message TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0);`)
    ctx.on('session/event', (session, event) => {
      const h = this.handles.get(session.id); assert.ok(h, 'published Session must have write handle')
      h.tail = h.tail.then(() => h.append([event]))
      h.tail.catch(() => {})
    })
    ctx.on('session/flush', session => this.flushFor(session.id))
    ctx.on('session/disposed', session => {
      const h = this.handles.get(session.id)
      if (h) { const closing = h.tail.then(() => h.close()); closing.catch(() => {}); this.disposals.push(closing) }
    })
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  async create(header) {
    assert.equal(header.version,4)
    this.atomic(() => this.db.prepare('INSERT INTO sessions VALUES(?,?,?,1)').run(header.id,JSON.stringify(header),this.owner))
    return this.handle(header.id,'write')
  }
  async open(id,access) {
    if (access==='write') this.atomic(() => {
      const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id); assert.ok(row,'missing Session')
      if (row.owner) throw new SessionAlreadyOwnedError(id)
      this.db.prepare('UPDATE sessions SET owner=?,epoch=epoch+1 WHERE id=?').run(this.owner,id)
    })
    return this.handle(id,access)
  }
  handle(id,access) {
    const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id); assert.ok(row)
    const h=new Handle(this,id,JSON.parse(row.header),row.epoch,access)
    if (access==='write')this.handles.set(id,h)
    return h
  }
  async flushFor(id) { const h=this.handles.get(id); assert.ok(h); await h.tail; await h.flush() }
  async flush() {
    const results=await Promise.allSettled([...this.handles.values()].filter(h=>!h.closed).map(async h=>{await h.tail;await h.flush()}))
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason)
    if(errors.length)throw new AggregateError(errors,'Session flush failed')
  }
  async stat(id) {
    const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id)
    if(!row)return undefined
    const count=this.db.prepare('SELECT count(*) AS n FROM events WHERE id=?').get(id).n+(this.handles.get(id)?.pending.length??0)
    return {header:JSON.parse(row.header),revision:String(count),eventCount:count}
  }
  async list(){return Promise.all(this.db.prepare('SELECT id FROM sessions').all().map(r=>this.stat(r.id)))}
  // Deliberate test-only control plane fencing, NOT an implemented lease or failure detector.
  fence(id){this.atomic(()=>this.db.prepare("UPDATE sessions SET owner='',epoch=epoch+1 WHERE id=?").run(id))}
  shutdown(){this.db.close()}
}
class Handle {
  constructor(p,id,header,epoch,access){Object.assign(this,{p,id,header,epoch,access,inheritedEventCount:0,pending:[],closed:false,tail:Promise.resolve()})}
  check(op){
    if(this.closed)throw new SessionHandleClosedError(this.id,op)
    if(this.access!=='write')throw new SessionReadOnlyError(this.id,op)
    const row=this.p.db.prepare('SELECT owner,epoch FROM sessions WHERE id=?').get(this.id)
    if(row.owner!==this.p.owner||row.epoch!==this.epoch)throw new SessionOwnershipLostError(this.id)
  }
  durable(){return this.p.db.prepare('SELECT value FROM events WHERE id=? ORDER BY seq').all(this.id).map(r=>JSON.parse(r.value))}
  async read(offset=0,length=Infinity){
    if(this.closed)throw new SessionHandleClosedError(this.id,'read')
    return {events:structuredClone([...this.durable(),...(this.p.handles.get(this.id)?.pending??this.pending)].slice(offset,offset+length)),eventState:'detached'}
  }
  async append(events){
    this.check('append'); const log=[...(await this.read()).events]
    assert.equal(events[0]?.seq??log.length,log.length,'non-contiguous append')
    // Public Session replay validates event vocabulary and exact sequence without private DSH imports.
    Session.create(this.id,[...log,...events],this.header)
    this.check('append'); this.pending.push(...structuredClone(events))
  }
  async flush(){
    this.check('flush')
    if(this.p.failFlush)throw new Error('injected flush failure')
    this.p.atomic(()=>{
      this.check('flush')
      const insert=this.p.db.prepare('INSERT INTO events VALUES(?,?,?)')
      for(const e of this.pending)insert.run(this.id,e.seq,JSON.stringify(e))
    })
    this.pending=[]
  }
  async close(){
    if(this.closed)return
    if(this.access==='write'){
      await this.flush()
      this.p.atomic(()=>{this.check('close');this.p.db.prepare("UPDATE sessions SET owner='' WHERE id=?").run(this.id)})
      this.p.handles.delete(this.id)
    }
    this.closed=true
  }
  [Symbol.asyncDispose](){return this.close()}
}
function header(id){return Session.create(id).header}
function appendInput(s,id){return s.append('user/message',{id,role:'user',content:[{type:'text',text:'Fictional input'}],source:{kind:'user'}},{surfaceOp:'append'})}
function message(seq,id){return {...appendInput(Session.create('fixture'),id),seq}}
function fixture(path){const ctx=new Context();new SessionStore(ctx);new SessionProjectionRegistry(ctx);new Query(ctx);const p=new Provider(ctx,path);return {ctx,p}}

if(process.argv[2]==='--child'){
  const {p}=fixture(process.argv[3]);const h=await p.open('race','write')
  process.send('owned')
  process.on('message',async(command)=>{
    try{await h.append([message(0,'stale')]);if(command==='flush'){await h.flush();process.send('flushed')}else process.send('appended')}
    catch(e){process.send(e.constructor.name)}
  })
}else{
  const here=dirname(fileURLToPath(import.meta.url));const dir=mkdtempSync(join(here,'.dsh-test-session-'))
  const providers=[];const children=[];const checks=[]
  const make=name=>{const f=fixture(join(dir,name+'.sqlite'));providers.push(f.p);return f}
  const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)}
  try{
    await check('Public Session live event, awaited flush, dispose and replay',async()=>{
      const {ctx,p}=make('live');const session=ctx.sessions.prepare('live');const h=await p.create(session.header)
      const detach=ctx.sessions.enter(session);ctx.sessions.announce(session)
      appendInput(session,'m1')
      assert.equal(await ctx.sessions.flush(session),true)
      assert.equal((await h.read()).events.length,1)
      detach();await Promise.all(p.disposals)
      const restored=await p.open('live','write');const log=(await restored.read()).events
      const resumed=ctx.sessions.prepare('live',{seed:log,meta:restored.header,inheritedEventCount:0,eventState:'detached'});const stop=ctx.sessions.enter(resumed);const prepared=await ctx.sessionQuery.readSession(resumed.id);await restored.append(prepared.events.slice(log.length));await restored.flush();ctx.sessions.announce(resumed)
      appendInput(resumed,'m2');await ctx.sessions.flush(resumed)
      assert.deepEqual((await restored.read()).events.map(e=>e.seq),[0,1,2]);stop();await Promise.all(p.disposals)
    })
    await check('Append visibility is not cross-process durability; failed flush does not acknowledge',async()=>{
      const {p}=make('barrier');const h=await p.create(header('barrier'));await h.append([message(0,'m')])
      assert.equal((await h.read()).events.length,1);assert.equal((await(await p.open('barrier','read')).read()).events.length,1);assert.equal((await p.stat('barrier')).eventCount,1)
      const {p:other}=make('barrier');const read=await other.open('barrier','read');assert.equal((await read.read()).events.length,0)
      p.failFlush=true;await assert.rejects(h.flush(),/flush failure/);assert.equal((await read.read()).events.length,0)
      p.failFlush=false;await h.flush();assert.equal((await read.read()).events.length,1)
      await assert.rejects(read.append([message(1,'bad')]),SessionReadOnlyError)
      await assert.rejects(h.append([message(8,'gap')]),/non-contiguous/)
      await h.close();await h.close();await assert.rejects(h.append([]),SessionHandleClosedError)
    })
    await check('Two real processes compete; explicit epoch fencing rejects delayed old append',async()=>{
      const {p}=make('race');await(await p.create(header('race'))).close()
      const child=fork(fileURLToPath(import.meta.url),['--child',join(dir,'race.sqlite')],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});children.push(child)
      const timer=setTimeout(()=>child.kill('SIGKILL'),10000)
      try{
        assert.equal((await once(child,'message'))[0],'owned')
        await assert.rejects(p.open('race','write'),SessionAlreadyOwnedError)
        p.fence('race');const newHandle=await p.open('race','write')
        const reply=once(child,'message');child.send('late-append');assert.equal((await reply)[0],'SessionOwnershipLostError')
        await newHandle.append([message(0,'new-owner')]);await newHandle.close()
      }finally{clearTimeout(timer);const ended=once(child,'exit');child.kill('SIGKILL');await ended}
    })
    for(const durable of [false,true])await check('Actual process death '+(durable?'retains flushed log':'drops unflushed buffer')+' and needs explicit takeover',async()=>{
      const name=durable?'crash-flushed':'crash';const {p}=make(name);const h=await p.create(header('race'));await h.close()
      // Child can own without an expiring lease; the test coordinator fences only after confirmed exit.
      const child=fork(fileURLToPath(import.meta.url),['--child',join(dir,name+'.sqlite')],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});children.push(child)
      const timer=setTimeout(()=>child.kill('SIGKILL'),10000)
      try{assert.equal((await once(child,'message'))[0],'owned');const reply=once(child,'message');child.send(durable?'flush':'append');assert.equal((await reply)[0],durable?'flushed':'appended')}
      finally{clearTimeout(timer);const ended=once(child,'exit');child.kill('SIGKILL');await ended}
      await assert.rejects(p.open('race','write'),SessionAlreadyOwnedError);p.fence('race')
      const reopened=await p.open('race','write');assert.equal((await reopened.read()).events.length,durable?1:0);await reopened.close()
    })
    await check('Public awaited Session flush propagates durability failure',async()=>{
      const {ctx,p}=make('public-failure');const s=ctx.sessions.prepare('fail');await p.create(s.header);const detach=ctx.sessions.enter(s);ctx.sessions.announce(s)
      appendInput(s,'failure');p.failFlush=true
      await assert.rejects(ctx.sessions.flush(s),/injected flush failure/)
      assert.equal(p.db.prepare('SELECT count(*) AS n FROM events').get().n,0);p.failFlush=false;await ctx.sessions.flush(s)
      assert.equal((await p.stat('fail')).eventCount,1);detach();await Promise.all(p.disposals)
    })
    await check('Close failure retains ownership until durability succeeds',async()=>{
      const {p}=make('close');const h=await p.create(header('close'));await h.append([message(0,'m')]);p.failFlush=true
      await assert.rejects(h.close(),/flush failure/);await assert.rejects(p.open('close','write'),SessionAlreadyOwnedError)
      p.failFlush=false;await h.close();const reopened=await p.open('close','write');assert.equal((await reopened.read()).events.length,1);await reopened.close()
    })
    await check('Business saved before Session write and Session flush before business receipt reconcile by stable ID',async()=>{
      const {ctx,p}=make('reconcile');const s=ctx.sessions.prepare('delivery');const h=await p.create(s.header);const detach=ctx.sessions.enter(s);ctx.sessions.announce(s)
      p.db.prepare("INSERT INTO business VALUES('input-1',0)").run()
      const deliver=async()=>{
        const prior=(await h.read()).events.some(e=>e.data?.id==='input-1')
        if(!prior)appendInput(s,'input-1')
        await ctx.sessions.flush(s)
      }
      await deliver();assert.equal(p.db.prepare('SELECT acknowledged FROM business').get().acknowledged,0)
      await deliver();p.db.prepare('UPDATE business SET acknowledged=1').run()
      assert.equal((await h.read()).events.length,1);assert.equal(p.db.prepare('SELECT acknowledged FROM business').get().acknowledged,1)
      detach();await Promise.all(p.disposals)
    })
    writeFileSync(join(here,'results.json'),JSON.stringify({date:'2026-11-03',dshSessionVersion:version,node:process.version,platform:process.platform,passed:checks.length,checks,evidence:'Real public Cordis/SessionStore event-flush-disposed lifecycle plus original SQLite provider and two OS processes. No agent loop, PostgreSQL, lease expiry, device, power loss or full provider conformance acceptance.'},null,2)+'\n')
  }finally{
    for(const c of children)if(c.exitCode===null&&!c.killed)c.kill('SIGKILL')
    for(const p of providers)p.shutdown()
    assert.equal(dirname(resolve(dir)),resolve(here));assert.ok(basename(dir).startsWith('.dsh-test-session-'));rmSync(dir,{recursive:true,force:true})
  }
}
