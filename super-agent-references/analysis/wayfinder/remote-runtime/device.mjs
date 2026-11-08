import http from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Original loopback-only protocol fixture, no authentication and no sandbox claim.
const [root, environment, rg] = process.argv.slice(2)
const incarnation=randomUUID(),jobs=new Map();let starts=0
const locate = name => {
  if(typeof name!=='string'||isAbsolute(name)||name.includes('\\'))throw new Error('portable relative target required')
  const target=resolve(root,name),rel=relative(root,target)
  if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw new Error('outside fixture root')
  return target
}
const executable = logical => {
  if(logical==='node')return process.execPath
  if(logical==='search-rg')return rg
  throw new Error('unsupported executable identity')
}
const result=j=>({id:j.id,environment,incarnation,state:j.state,code:j.code??null,output:j.output.toString('base64'),bytes:j.output.length})
const server=http.createServer(async(req,res)=>{
  try{
    let raw='';for await(const chunk of req)raw+=chunk
    const body=raw?JSON.parse(raw):{}
    if(body.environment!==environment)throw new Error('environment mismatch')
    let value
    if(req.url==='/meta')value={environment,incarnation,platform:process.platform,root,starts}
    else if(req.url==='/resolve')value={environment,path:locate(body.path)}
    else if(req.url==='/executable')value={environment,path:executable(body.name)}
    else if(req.url==='/read')value={environment,text:await readFile(locate(body.path),'utf8')}
    else if(req.url==='/write'){await writeFile(locate(body.path),body.text);value={environment,written:true}}
    else if(req.url==='/search'){
      locate(body.path);const child=spawn(executable('search-rg'),['--json','--fixed-strings','--',body.pattern,body.path],{cwd:root,windowsHide:true})
      let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b)
      const code=await new Promise((a,b)=>{child.once('error',b);child.once('close',a)})
      if(code!==0&&code!==1)throw new Error('search failed: '+error)
      value={environment,matches:output.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.type==='match').map(row=>({path:row.data.path.text,line:row.data.line_number,text:row.data.lines.text}))}
    }else if(req.url==='/start'){
      const fingerprint=JSON.stringify([body.executable,body.path,body.delay])
      let j=jobs.get(body.id)
      if(j){if(j.fingerprint!==fingerprint)throw new Error('job ID payload conflict')}
      else{
        const file=locate(body.path),program=executable(body.executable)
        const script="const fs=require('node:fs');console.log(process.cwd());console.log(fs.readFileSync(process.argv[1],'utf8'));console.log('多字节✓');setTimeout(()=>console.log('done'),Number(process.argv[2]));"
        const child=spawn(program,['-e',script,file,String(body.delay??0)],{cwd:root,windowsHide:true})
        j={id:body.id,fingerprint,child,state:'running',output:Buffer.alloc(0)};jobs.set(j.id,j);starts++
        const append=b=>{j.output=Buffer.concat([j.output,b])};child.stdout.on('data',append);child.stderr.on('data',append)
        child.on('error',e=>{append(Buffer.from(String(e)));j.state='failed'})
        child.on('close',code=>{j.code=code;j.state=j.state==='stopping'?'cancelled':code===0?'exited':'failed'})
      }
      value=result(j)
    }else if(req.url==='/job'){
      const j=jobs.get(body.id);if(!j){value={environment,incarnation,id:body.id,state:'unknown'}}
      else{value=result(j);value.output=j.output.subarray(body.offset??0).toString('base64')}
    }else if(req.url==='/cancel'){
      const j=jobs.get(body.id)
      if(!j)value={environment,incarnation,id:body.id,state:'unknown'}
      else{
        if(j.state==='running'){j.state='stopping';setTimeout(()=>j.child.kill(),200)}
        value=result(j)
      }
    }else throw new Error('unknown operation')
    if(body.dropResponse){res.destroy();return}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value))
  }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e)}))}
})
server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port,environment,incarnation}))
process.on('message',async message=>{
  if(message!=='shutdown')return
  const running=[...jobs.values()].filter(j=>['running','stopping'].includes(j.state))
  await Promise.all(running.map(j=>new Promise(resolve=>{j.child.once('close',resolve);j.child.kill()})))
  server.close(()=>process.exit(0))
})
