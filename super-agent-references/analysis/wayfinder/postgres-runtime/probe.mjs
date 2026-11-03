import assert from 'node:assert/strict'
import net from 'node:net'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {dirname,join,resolve,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomBytes,createHash} from 'node:crypto'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import {commitProxy} from './commit-proxy.mjs'

const here=dirname(fileURLToPath(import.meta.url)),dir=await mkdtemp(join(here,'.dsh-test-postgres-'))
const temporary=net.createServer();await new Promise(r=>temporary.listen(0,'127.0.0.1',r));const port=temporary.address().port;await new Promise(r=>temporary.close(r))
const password=randomBytes(24).toString('hex')
const server=new EmbeddedPostgres({databaseDir:join(dir,'cluster'),port,user:'postgres',password,persistent:true,createPostgresUser:false,onLog:()=>{},onError:()=>{},postgresFlags:['-h','127.0.0.1','-c','fsync=on','-c','synchronous_commit=on']})
const clients=[],proxies=[],checks=[];let started=false
const connection={host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false,connectionTimeoutMillis:3000,query_timeout:5000}
async function connect(override={}){const c=new pg.Client({...connection,...override});c.on('error',()=>{});clients.push(c);await c.connect();return c}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const hash=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex')
async function begin(c,isolation='READ COMMITTED'){
  await c.query('BEGIN ISOLATION LEVEL '+isolation)
  await c.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='4000ms'")
}
async function lock(c,instance){const r=await c.query('SELECT id FROM instances WHERE id=$1 FOR UPDATE',[instance]);assert.equal(r.rowCount,1,'Instance coordinator must exist')}
async function prepare(c,instance,id,input={increment:1}){
  await lock(c,instance)
  const old=(await c.query('SELECT * FROM receipts WHERE instance=$1 AND command=$2',[instance,id])).rows[0]
  if(old){assert.equal(old.fingerprint,hash(input),'command ID payload mismatch');return old.result}
  const result=(await c.query('UPDATE domain_state SET value=value+$2 WHERE instance=$1 RETURNING value',[instance,input.increment])).rows[0]
  await c.query('INSERT INTO effects VALUES($1,$2,$3)',[instance,id,JSON.stringify(result)])
  await c.query('INSERT INTO receipts VALUES($1,$2,$3,$4)',[instance,id,hash(input),JSON.stringify(result)])
  return result
}
async function command(c,instance,id,input={increment:1},hook){
  await begin(c)
  try{const value=await prepare(c,instance,id,input);await hook?.();await c.query('COMMIT');return value}
  catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
}
// Receipt absence is authoritative only after re-acquiring the same coordinator lock.
async function reconcile(c,instance,id){await begin(c);try{await lock(c,instance);const r=await c.query('SELECT result FROM receipts WHERE instance=$1 AND command=$2',[instance,id]);await c.query('COMMIT');return r.rows[0]?.result??null}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}}
async function retryWhole(c,work){
  const codes=[]
  for(let attempt=1;attempt<=3;attempt++){
    await begin(c,'SERIALIZABLE')
    try{const value=await work(attempt);await c.query('COMMIT');return {value,attempts:attempt,codes}}
    catch(e){await c.query('ROLLBACK').catch(()=>{});if(!['40001','40P01'].includes(e.code)||attempt===3)throw e;codes.push(e.code)}
  }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function blocked(admin,pid){for(let i=0;i<100;i++){if((await admin.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[pid])).rows[0].n>0)return;await sleep(10)}throw new Error('writer did not wait on expected lock')}
const check=async(name,fn)=>{const detail=await fn();checks.push({name,detail});console.log('PASS '+name)}
try{
  await server.initialise();await server.start();started=true
  const admin=await connect(),a=await connect(),b=await connect()
  const settings=(await admin.query("SELECT version() AS version,current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS synchronous_commit,current_setting('listen_addresses') AS listen")).rows[0]
  assert.equal(settings.fsync,'on');assert.equal(settings.synchronous_commit,'on');assert.equal(settings.listen,'127.0.0.1')
  await admin.query(`CREATE TABLE instances(id text PRIMARY KEY); INSERT INTO instances VALUES('A'),('B');
    CREATE TABLE domain_state(instance text PRIMARY KEY REFERENCES instances,value integer NOT NULL); INSERT INTO domain_state VALUES('A',0),('B',0);
    CREATE TABLE effects(instance text,command text,payload jsonb,PRIMARY KEY(instance,command));
    CREATE TABLE receipts(instance text,command text,fingerprint text,result jsonb,PRIMARY KEY(instance,command));
    CREATE TABLE conflict_fixture(id integer PRIMARY KEY,value integer);INSERT INTO conflict_fixture VALUES(1,0),(2,0)`)
  await check('Same Instance writer demonstrably waits; fresh state read after lock prevents lost updates',async()=>{
    const entered=gate(),release=gate();const first=command(a,'A','held',{increment:1},async()=>{entered.resolve();await release.promise})
    await entered.promise;const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const second=command(b,'A','waiter');await blocked(admin,pid);release.resolve();await Promise.all([first,second])
    assert.equal((await admin.query("SELECT value FROM domain_state WHERE instance='A'")).rows[0].value,2)
    return {observedBlocking:true,committedIncrements:2}
  })
  await check('Different Instance progresses while A coordinator remains locked',async()=>{
    await begin(a);await lock(a,'A')
    try{assert.equal((await command(b,'B','independent')).value,1)}finally{await a.query('ROLLBACK')}
  })
  await check('Concurrent duplicate IDs produce one result and effect; changed payload fails',async()=>{
    const before=(await admin.query("SELECT value FROM domain_state WHERE instance='A'")).rows[0].value
    const [x,y]=await Promise.all([command(a,'A','duplicate'),command(b,'A','duplicate')]);assert.deepEqual(x,y)
    assert.equal(x.value,before+1)
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM effects WHERE command='duplicate'")).rows[0].n,1)
    await assert.rejects(command(a,'A','duplicate',{increment:2}),/payload mismatch/)
  })
  await check('Failure before commit atomically rolls back state, effect and receipt',async()=>{
    const before=(await admin.query("SELECT value FROM domain_state WHERE instance='A'")).rows[0].value
    await assert.rejects(command(a,'A','rollback',{increment:1},()=>{throw new Error('injected')}),/injected/)
    assert.equal(await reconcile(b,'A','rollback'),null)
    assert.equal((await admin.query("SELECT value FROM domain_state WHERE instance='A'")).rows[0].value,before)
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM effects WHERE command='rollback'")).rows[0].n,0)
  })
  await check('Terminating real backend mid-transaction releases lock and rolls back pending receipt',async()=>{
    const c=await connect();await begin(c);await prepare(c,'A','terminated')
    const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS stopped',[pid])).rows[0].stopped,true)
    assert.equal(await reconcile(b,'A','terminated'),null)
  })
  await check('lock_timeout bounds wait with actual 55P03 without claiming acceptance',async()=>{
    await begin(a);await lock(a,'A');await begin(b);await b.query("SET LOCAL lock_timeout='100ms'")
    try{await assert.rejects(lock(b,'A'),e=>e.code==='55P03')}finally{await b.query('ROLLBACK');await a.query('ROLLBACK')}
    return {sqlstate:'55P03',lockTimeoutMs:100}
  })
  await check('Actual opposite-order row locking yields 40P01; consistent order can subsequently proceed',async()=>{
    await begin(a);await begin(b)
    await a.query('SELECT * FROM conflict_fixture WHERE id=1 FOR UPDATE');await b.query('SELECT * FROM conflict_fixture WHERE id=2 FOR UPDATE')
    const results=await Promise.allSettled([a.query('SELECT * FROM conflict_fixture WHERE id=2 FOR UPDATE'),b.query('SELECT * FROM conflict_fixture WHERE id=1 FOR UPDATE')])
    assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='40P01').length,1)
    await a.query('ROLLBACK');await b.query('ROLLBACK')
    await begin(a);await a.query('SELECT * FROM conflict_fixture ORDER BY id FOR UPDATE');await a.query('COMMIT')
    return {sqlstate:'40P01',victim:'not-assumed'}
  })
  await check('Actual 40001 retries whole transaction and leaves one effect/receipt',async()=>{
    const result=await retryWhole(a,async attempt=>{
      const value=(await a.query('SELECT value FROM conflict_fixture WHERE id=1')).rows[0].value
      if(attempt===1)await b.query('UPDATE conflict_fixture SET value=value+1 WHERE id=1')
      await a.query('UPDATE conflict_fixture SET value=$1 WHERE id=1',[value+1])
      await a.query("INSERT INTO effects VALUES('A','serial-retry','{}')")
      await a.query("INSERT INTO receipts VALUES('A','serial-retry','fixture','{}')")
      return value+1
    })
    assert.equal(result.attempts,2);assert.deepEqual(result.codes,['40001']);assert.equal(result.value,2)
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM receipts WHERE command='serial-retry'")).rows[0].n,1)
    return result
  })
  await check('Repeated actual serialization conflicts exhaust bounded whole-transaction retries',async()=>{
    let attempts=0
    await assert.rejects(retryWhole(a,async()=>{
      attempts++
      const value=(await a.query('SELECT value FROM conflict_fixture WHERE id=2')).rows[0].value
      await b.query('UPDATE conflict_fixture SET value=value+1 WHERE id=2')
      await a.query('UPDATE conflict_fixture SET value=$1 WHERE id=2',[value+1])
      await a.query("INSERT INTO receipts VALUES('A','exhausted','fixture','{}')")
    }),e=>e.code==='40001')
    assert.equal(attempts,3);assert.equal(await reconcile(b,'A','exhausted'),null)
    return {attempts,exhausted:true,sqlstate:'40001'}
  })
  for(const mode of ['after-commit','before-commit']){
    await check('Protocol fault '+mode+' reconciles unknown outcome using same command ID',async()=>{
      const proxy=await commitProxy(port,mode);proxies.push(proxy);const c=await connect({port:proxy.port});const id='wire-'+mode
      await begin(c);const expected=await prepare(c,'A',id)
      let callerConfirmed=false;await assert.rejects(c.query('COMMIT').then(r=>{callerConfirmed=true;return r}));assert.equal(callerConfirmed,false)
      const recovered=await reconcile(b,'A',id)
      if(mode==='after-commit'){
        assert.equal(proxy.evidence.commitCompleteSeen,true);assert.equal(proxy.evidence.commitCompleteForwarded,false);assert.equal(proxy.evidence.readySuppressed,true)
        assert.deepEqual(recovered,expected);assert.deepEqual(await command(b,'A',id),expected)
      }else{assert.equal(proxy.evidence.commitForwarded,false);assert.equal(recovered,null);await command(b,'A',id)}
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM effects WHERE command=$1',[id])).rows[0].n,1)
      return {...proxy.evidence,callerConfirmed,reconciled:recovered?'committed':'absent-after-lock'}
    })
  }
  await writeFile(join(here,'results.json'),JSON.stringify({date:'2026-11-03',node:process.version,platform:process.platform,settings,passed:checks.length,checks,evidence:'Real isolated PostgreSQL cluster, multiple TCP clients, actual SQLSTATE faults and protocol-framed COMMIT response suppression. Not a production storage adapter, Host lease, failover replica, power-loss or remote exactly-once test.'},null,2)+'\n')
}finally{
  await Promise.allSettled(clients.map(c=>c.end()))
  await Promise.allSettled(proxies.map(p=>p.close()))
  if(started)await server.stop()
  assert.equal(dirname(resolve(dir)),resolve(here));assert.ok(basename(dir).startsWith('.dsh-test-postgres-'))
  await rm(dir,{recursive:true,force:true})
}
