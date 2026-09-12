import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readResponsesBody} from './responses-body.mjs';

async function serve(t,options={}) {
  const state={started:0,finished:0};
  const server=http.createServer(async(req,res)=>{
    state.started++;
    try{const result=await readResponsesBody(req,{maxBytes:2048,maxWireBytes:10000,maxReadMs:1000,...options});res.end(JSON.stringify({body:result.body,ingress:result.ingress}));}
    catch(e){if(!res.destroyed){res.writeHead(e.statusCode||400,{'Connection':'close'});res.end(JSON.stringify({code:e.code||'request_aborted'}));}}
    finally{state.finished++;}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {port:server.address().port,state};
}
function send(port,text,headers={},end=true){
  let req;
  const done=new Promise((resolve,reject)=>{
    req=http.request({host:'127.0.0.1',port,method:'POST',agent:false,headers},res=>{
      let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,...JSON.parse(data)}));
    });req.on('error',reject);if(text)req.write(text);if(end)req.end();
  });return {req,done};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(fn){const end=Date.now()+1000;while(!fn()){assert.ok(Date.now()<end,'condition timed out');await tick();}}

test('HTTP reader returns 400 and 413 JSON, not socket resets',async t=>{
  const {port}=await serve(t);
  for(const [text,headers,status,code]of[
    ['{"input":',{},400,'invalid_json'],
    [JSON.stringify({input:'x'.repeat(3000)}),{},413,'request_too_large'],
    ['{}',{'Content-Length':'20000'},413,'request_too_large'],
    ['{"input":"'+'x'.repeat(11000)+'"}',{},413,'request_too_large']
  ]) {const result=await send(port,text,headers).done;assert.equal(result.status,status);assert.equal(result.code,code);}
  assert.equal((await send(port,'{"input":"still ready"}').done).status,200);
});
test('HTTP declared and chunked image histories compact identically',async t=>{
  const {port}=await serve(t,{maxBytes:3000,maxImages:2,maxImageChars:1200});
  const text=JSON.stringify({input:Array.from({length:9},(_,i)=>({role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+String(i).repeat(500)}]}))});
  const a=await send(port,text,{'Content-Length':String(Buffer.byteLength(text))}).done;
  const b=await send(port,text).done;
  assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.equal(a.ingress.omittedHistoricalImages,7);
});
test('slow uploads receive 408 and readers are reusable afterward',async t=>{
  const {port,state}=await serve(t,{maxReadMs:50});
  const slow=send(port,'{"input":',{},false);t.after(()=>slow.req.destroy());
  assert.deepEqual(await slow.done,{status:408,code:'request_upload_timeout'});
  await until(()=>state.finished===1);
  assert.equal((await send(port,'{}').done).status,200);
});
test('fifth concurrent reader gets 429; aborted uploads release all four slots',async t=>{
  const {port,state}=await serve(t);
  const slow=Array.from({length:4},()=>send(port,'{"input":',{},false));
  for(const item of slow){item.done.catch(()=>{});t.after(()=>item.req.destroy());}
  await until(()=>state.started===4);
  assert.deepEqual(await send(port,'{}').done,{status:429,code:'request_reader_busy'});
  for(const item of slow)item.req.destroy();
  await until(()=>state.finished===5);
  assert.equal((await send(port,'{}').done).status,200);
});
