import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { fork, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import { dirname,join,resolve,basename,posix,win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const here=dirname(fileURLToPath(import.meta.url))
const require=createRequire(process.env.DSH_HARNESS?join(resolve(process.env.DSH_HARNESS),'package.json'):new URL('../../../../ds-bot/dev/harness/package.json',import.meta.url))
const load=name=>import(pathToFileURL(require.resolve(name)).href)
const {Context}=await load('@deepseek-ai/cordis')
const {FileSystem,FsTargetKey}=await load('@deepseek-ai/dsh-fs')
const {SubprocessRuntime}=await load('@deepseek-ai/dsh-subprocess')
assert.equal(require('@deepseek-ai/dsh-fs/package.json').version,'0.2.1-rc.4')
class RemoteFs extends FileSystem {
  constructor(ctx,client){super(ctx);this.client=client;this.targets=new Map()}
  async resolve(path){const r=await this.client.call('resolve',{path});const target={targetKey:FsTargetKey(JSON.stringify([r.environment,path])),displayPath:path};this.targets.set(target.targetKey,{path,native:r.path});return target}
  processPath(target){assert.ok(this.targets.has(target.targetKey),'foreign target');return this.targets.get(target.targetKey).native}
  async readText(target){this.processPath(target);return (await this.client.call('read',{path:this.targets.get(target.targetKey).path})).text}
}
class RemoteSubprocessLookup extends SubprocessRuntime {
  constructor(ctx,client){super(ctx);this.client=client}
  async resolveExecutable(command){return (await this.client.call('executable',{name:command})).path}
}
const rg=execFileSync(process.platform==='win32'?'where.exe':'which',['rg'],{encoding:'utf8'}).trim().split(/\r?\n/)[0]
class Client {
  constructor(endpoint){this.endpoint=Object.freeze({...endpoint});this.connected=true}
  async call(op,input={}){
    if(!this.connected)throw new Error('fixture transport disconnected before send')
    const body=JSON.stringify({...input,environment:this.endpoint.environment})
    return new Promise((a,b)=>{
      const req=http.request({host:'127.0.0.1',port:this.endpoint.port,path:'/'+op,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:3000},res=>{
        let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{const value=JSON.parse(raw);if(res.statusCode!==200)b(new Error(value.error));else if(value.environment!==this.endpoint.environment)b(new Error('environment mismatch'));else if(value.incarnation&&value.incarnation!==this.endpoint.incarnation)b(new Error('device incarnation mismatch'));else a(value)})
      });req.on('error',b);req.on('timeout',()=>req.destroy(new Error('transport timeout')));req.end(body)
    })
  }
  async status(id,offset=0){try{return await this.call('job',{id,offset})}catch{return {id,environment:this.endpoint.environment,state:'unknown'}}}
}
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(client,id,predicate){
  for(let i=0;i<100;i++){const state=await client.status(id);if(predicate(state))return state;await wait(25)}
  throw new Error('job observation timed out')
}
const dir=await mkdtemp(join(here,'.dsh-test-remote-'));const devices=[],checks=[]
async function device(name,content){
  const root=join(dir,name);await mkdir(root);await writeFile(join(root,'same name.txt'),content)
  const child=fork(fileURLToPath(new URL('./device.mjs',import.meta.url)),[root,name,rg],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});devices.push(child)
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000)
  try{const [endpoint]=await once(child,'message');return new Client(endpoint)}finally{clearTimeout(timer)}
}
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)}
try{
  const a=await device('environment-a','alpha UNIQUE_A'),b=await device('environment-b','beta UNIQUE_B')
  await check('Actual Cordis scopes bind public fs/subprocess lookup subsets to distinct device clients',async()=>{
    const ctx=new Context(),ca=ctx.isolate('fs').isolate('subprocess'),cb=ctx.isolate('fs').isolate('subprocess')
    try{
      new RemoteFs(ca,a);new RemoteSubprocessLookup(ca,a);new RemoteFs(cb,b);new RemoteSubprocessLookup(cb,b)
      const ta=await ca.fs.resolve('same name.txt'),tb=await cb.fs.resolve('same name.txt')
      assert.notEqual(ta.targetKey,tb.targetKey);assert.notEqual(ca.fs.processPath(ta),cb.fs.processPath(tb))
      assert.ok((await ca.fs.readText(ta)).includes('UNIQUE_A'));assert.ok((await cb.fs.readText(tb)).includes('UNIQUE_B'))
      assert.throws(()=>ca.fs.processPath(tb),/foreign target/);assert.equal(ca.fs.processPathFromHostPath(process.execPath),undefined)
      assert.equal(await ca.subprocess.resolveExecutable('node'),process.execPath);assert.equal(await cb.subprocess.resolveExecutable('node'),process.execPath)
      assert.equal(ctx.fs,undefined);assert.equal(ctx.subprocess,undefined)
    }finally{await ctx.fiber.dispose()}
  })
  await check('Two process-backed environments retain same-name file identity across read, write, search and shell',async()=>{
    await a.call('write',{path:'same name.txt',text:'changed UNIQUE_A'})
    assert.equal((await a.call('read',{path:'same name.txt'})).text,'changed UNIQUE_A')
    assert.equal((await b.call('read',{path:'same name.txt'})).text,'beta UNIQUE_B')
    assert.equal((await a.call('search',{path:'same name.txt',pattern:'UNIQUE_A'})).matches.length,1)
    assert.equal((await b.call('search',{path:'same name.txt',pattern:'UNIQUE_A'})).matches.length,0)
    for(const c of [a,b]){
      await c.call('start',{id:'same-job',executable:'node',path:'same name.txt',delay:0})
      const result=await until(c,'same-job',j=>j.state==='exited');const output=Buffer.from(result.output,'base64').toString()
      assert.ok(output.includes((await c.call('meta')).root));assert.ok(output.includes(c===a?'UNIQUE_A':'UNIQUE_B'))
    }
    assert.equal((await a.call('search',{path:'same name.txt',pattern:'changed'})).matches[0].path,'same name.txt')
  })
  await check('Unsupported Host executable paths and foreign environment identity are rejected',async()=>{
    await assert.rejects(a.call('start',{id:'host-bin',executable:'C:\\host\\rg.exe',path:'same name.txt'}),/unsupported executable/)
    const foreign=new Client({...a.endpoint,environment:'environment-b'})
    await assert.rejects(foreign.call('read',{path:'same name.txt'}),/environment mismatch/)
    await assert.rejects(a.call('read',{path:'../environment-b/same name.txt'}),/outside fixture/)
  })
  await check('Disconnect before send starts no job',async()=>{
    const before=(await a.call('meta')).starts;a.connected=false
    await assert.rejects(a.call('start',{id:'not-sent'}),/before send/);a.connected=true
    assert.equal((await a.call('meta')).starts,before);assert.equal((await a.status('not-sent')).state,'unknown')
  })
  await check('Accepted start with lost response reconciles by job ID rather than relaunch',async()=>{
    const input={id:'lost-start',executable:'node',path:'same name.txt',delay:250};const before=(await a.call('meta')).starts
    await assert.rejects(a.call('start',{...input,dropResponse:true}))
    const fresh=new Client(a.endpoint);assert.notEqual((await fresh.status(input.id)).state,'unknown')
    await fresh.call('start',input);assert.equal((await fresh.call('meta')).starts,before+1)
    await assert.rejects(fresh.call('start',{...input,delay:251}),/payload conflict/)
    await until(fresh,input.id,j=>j.state==='exited')
  })
  await check('Device job continues while Host transport is disconnected; fresh client resumes byte-offset output',async()=>{
    await a.call('start',{id:'background',executable:'node',path:'same name.txt',delay:500})
    const first=await until(a,'background',j=>j.bytes>0);a.connected=false
    assert.equal((await a.status('background')).state,'unknown')
    const fresh=new Client(a.endpoint),done=await until(fresh,'background',j=>j.state==='exited')
    const prefix=Buffer.from(first.output,'base64'),suffix=Buffer.from((await fresh.status('background',prefix.length)).output,'base64')
    assert.deepEqual(Buffer.concat([prefix,suffix]),Buffer.from(done.output,'base64'))
    assert.ok(Buffer.concat([prefix,suffix]).toString().includes('多字节✓'));a.connected=true
  })
  await check('Lost result response does not consume output and does not rerun the job',async()=>{
    const before=(await a.call('meta')).starts
    await assert.rejects(a.call('job',{id:'background',dropResponse:true}))
    const one=await a.status('background'),two=await a.status('background');assert.equal(one.output,two.output)
    assert.equal((await a.call('meta')).starts,before)
  })
  await check('Cancellation is stopping until actual child exit; another environment remains untouched',async()=>{
    await a.call('start',{id:'cancel',executable:'node',path:'same name.txt',delay:10000})
    await b.call('start',{id:'cancel',executable:'node',path:'same name.txt',delay:600})
    assert.equal((await a.call('cancel',{id:'cancel'})).state,'stopping')
    assert.equal((await a.status('cancel')).state,'stopping')
    assert.equal((await until(a,'cancel',j=>j.state==='cancelled')).state,'cancelled')
    assert.equal((await until(b,'cancel',j=>j.state==='exited')).state,'exited')
  })
  await check('POSIX and Windows path construction is device-side; table check is not heterogeneous runtime evidence',async()=>{
    assert.equal(posix.join('/work/a','same name.txt'),'/work/a/same name.txt')
    assert.equal(win32.join('D:\\work\\a','same name.txt'),'D:\\work\\a\\same name.txt')
    assert.notEqual(posix.join('/work/a','same name.txt'),win32.join('D:\\work\\a','same name.txt'))
  })
  await check('Wrong daemon incarnation cannot be mistaken for the original job owner',async()=>{
    const wrong=new Client({...a.endpoint,incarnation:'replaced-device'});assert.equal((await wrong.status('background')).state,'unknown')
  })
  await writeFile(join(here,'results.json'),JSON.stringify({date:'2026-11-03',node:process.version,platform:process.platform,passed:checks.length,checks,evidence:'Two local OS daemon processes, real loopback HTTP, rg search and Node child jobs. Public DSH fs/subprocess lookup/read subset scoped in real Cordis; no complete spawn handle/Agent inheritance, second physical device, different OS, durable daemon restart, process-tree cancellation, security sandbox or production network acceptance.'},null,2)+'\n')
}finally{
  await Promise.all(devices.map(async child=>{
    if(child.exitCode!==null||child.killed)return
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000)
    try{const exit=once(child,'exit');child.send('shutdown');await exit}finally{clearTimeout(timer)}
  }))
  assert.equal(dirname(resolve(dir)),resolve(here));assert.ok(basename(dir).startsWith('.dsh-test-remote-'));await rm(dir,{recursive:true,force:true})
}
