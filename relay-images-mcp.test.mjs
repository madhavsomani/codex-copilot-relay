import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createImagesMcpRoute,loopbackRequest} from './relay-images-mcp.mjs';

// Synthetic images only; nothing here calls Codex or OpenAI.
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-images-mcp-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

// One listener plays both roles, like the live relay: /mcp plus a fake /v1/images/*.
async function relay(t,{respondImage}={}){
  const images=[];let route;
  const server=http.createServer(async(request,response)=>{
    const url=new URL(request.url,'http://x');
    if(await route(request,response,url.pathname))return;
    let text='';request.on('data',chunk=>text+=chunk).on('end',async()=>{
      const call={path:url.pathname,body:JSON.parse(text||'{}'),headers:request.headers};images.push(call);
      await respondImage(call,response);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,dir=temp(t);
  route=createImagesMcpRoute({port,serverOptions:{outputDirectory:dir}});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const post=(message,headers={})=>fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',
    headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify(message)});
  return {port,dir,images,post};
}
// Tool calls answer as SSE; the last event carries the JSON-RPC result.
async function rpc(res){
  if(!String(res.headers.get('content-type')).includes('text/event-stream'))return res.json();
  const events=(await res.text()).split('\n\n').filter(Boolean).map(block=>JSON.parse(block.split('\n').find(line=>line.startsWith('data: ')).slice(6)));
  return events.at(-1);
}
const png=async()=>(await sharp({create:{width:64,height:36,channels:3,background:'#3366aa'}}).png().toBuffer()).toString('base64');
const okImage=async(call,response)=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:[{b64_json:await png()}]}));};

test('initialize, list and generate over HTTP; image saved and previewed',async t=>{
  const r=await relay(t,{respondImage:okImage});
  const init=await rpc(await r.post({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}}));
  assert.equal(init.result.serverInfo.name,'relay_images');
  assert.equal((await r.post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  const list=await (await r.post({jsonrpc:'2.0',id:2,method:'tools/list'})).json();
  assert.deepEqual(list.result.tools.map(tool=>tool.name),['generate_image','edit_image']);
  const call=await rpc(await r.post({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'generate_image',arguments:{prompt:'A blue square',filename:'probe'}}}));
  assert.equal(call.id,3);assert.notEqual(call.result.isError,true);
  assert.equal(r.images.length,1);assert.equal(r.images[0].path,'/v1/images/generations');
  assert.ok(fs.existsSync(call.result.structuredContent.path));
  assert.equal(call.result.content[1].type,'image');
});

test('edit_image forwards local references to /v1/images/edits',async t=>{
  const r=await relay(t,{respondImage:okImage});
  const ref=path.join(r.dir,'ref.png');fs.writeFileSync(ref,Buffer.from(await png(),'base64'));
  const call=await rpc(await r.post({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'edit_image',arguments:{prompt:'Merge',reference_paths:[ref,ref]}}}));
  assert.notEqual(call.result.isError,true);
  assert.equal(r.images[0].path,'/v1/images/edits');assert.equal(r.images[0].body.images.length,2);
});

test('relay errors come back as tool errors, not HTTP failures',async t=>{
  const r=await relay(t,{respondImage:(call,response)=>{response.writeHead(503,{'content-type':'application/json'});
    response.end(JSON.stringify({error:{code:'native_tools_busy',message:'busy'}}));}});
  const res=await r.post({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'generate_image',arguments:{prompt:'x'}}});
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);const body=await rpc(res);
  assert.equal(body.result.isError,true);assert.equal(body.result.structuredContent.code,'native_tools_busy');
});

test('cross-site origins, DNS-rebinding hosts, GET, batches and non-JSON are refused without generating',async t=>{
  const r=await relay(t,{respondImage:okImage});
  const call={jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'generate_image',arguments:{prompt:'x'}}};
  assert.equal((await r.post(call,{origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(`http://127.0.0.1:${r.port}/mcp`)).status,405);
  assert.equal((await r.post([call])).status,400);
  assert.equal((await fetch(`http://127.0.0.1:${r.port}/mcp`,{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify(call)})).status,415);
  assert.equal(r.images.length,0);
  assert.equal(loopbackRequest({headers:{host:'evil.example:'+r.port}},r.port),false);
  assert.equal(loopbackRequest({headers:{host:'127.0.0.1:'+r.port,origin:'http://localhost:'+r.port}},r.port),true);
});

test('a client disconnect cancels the in-flight image request',async t=>{
  let seen;const closed=new Promise(resolve=>seen=resolve);
  const r=await relay(t,{respondImage:(call,response)=>{response.on('close',()=>seen(!response.writableEnded));}});
  const raw=http.request({host:'127.0.0.1',port:r.port,path:'/mcp',method:'POST',headers:{'content-type':'application/json'}});
  raw.on('error',()=>{});
  raw.end(JSON.stringify({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'generate_image',arguments:{prompt:'y'}}}));
  while(!r.images.length)await new Promise(resolve=>setTimeout(resolve,10));
  raw.destroy();
  assert.equal(await closed,true);  // upstream image request was aborted before it answered
});
