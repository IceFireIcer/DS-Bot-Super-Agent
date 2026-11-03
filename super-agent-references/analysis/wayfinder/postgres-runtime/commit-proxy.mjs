import net from 'node:net'

// Original test proxy: packet framing preserves TCP fragmentation/coalescing.
export async function commitProxy(upstreamPort,mode){
  const sockets=new Set();const evidence={mode,commitForwarded:false,commitCompleteSeen:false,commitCompleteForwarded:false,readySuppressed:false}
  const server=net.createServer(front=>{
    const back=net.connect({host:'127.0.0.1',port:upstreamPort});sockets.add(front);sockets.add(back)
    let input=Buffer.alloc(0),output=Buffer.alloc(0),startup=true,suppressed=false
    const destroy=()=>{front.destroy();back.destroy()}
    for(const socket of [front,back]){socket.on('error',destroy);socket.on('close',()=>{sockets.delete(socket);destroy()})}
    front.on('data',chunk=>{
      input=Buffer.concat([input,chunk])
      while(input.length>=(startup?4:5)){
        const size=startup?input.readInt32BE(0):1+input.readInt32BE(1)
        if(input.length<size)return
        const frame=input.subarray(0,size);input=input.subarray(size)
        const commit=!startup&&frame[0]===81&&frame.subarray(5).toString()==='COMMIT\0'
        startup=false
        if(commit&&mode==='before-commit'){destroy();return}
        if(commit)evidence.commitForwarded=true
        back.write(frame)
      }
    })
    back.on('data',chunk=>{
      output=Buffer.concat([output,chunk])
      while(output.length>=5){
        const size=1+output.readInt32BE(1);if(output.length<size)return
        const frame=output.subarray(0,size);output=output.subarray(size)
        const commitComplete=frame[0]===67&&frame.subarray(5).toString()==='COMMIT\0'
        if(commitComplete){
          evidence.commitCompleteSeen=true
          if(mode==='after-commit'){suppressed=true;continue}
          evidence.commitCompleteForwarded=true
        }
        if(suppressed){if(frame[0]===90){evidence.readySuppressed=true;destroy();return}continue}
        front.write(frame)
      }
    })
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  return {port:server.address().port,evidence,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r))}}
}
