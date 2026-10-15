import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createImageServer,relayBase,tools,limits,billingNotice} from './claude-image-mcp.mjs';
import {applyImageSetup,restoreImageSetup,imageSetupStatus,imageDefinition} from './claude-image-mcp-setup.mjs';

// Synthetic images only; nothing here calls Codex or OpenAI.
const synthetic=(width,height,format='png')=>sharp({create:{width,height,channels:3,background:'#3366aa'}})[format]().toBuffer();
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-images-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

async function mockRelay(t,respond){
  const calls=[];
  const server=http.createServer((request,response)=>{let text='';request.on('data',chunk=>text+=chunk).on('end',async()=>{
    const call={path:request.url,body:JSON.parse(text||'{}'),headers:request.headers,closed:false};calls.push(call);
    response.on('close',()=>{call.closed=!response.writableEnded;});
    await respond(call,response);
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return {url:'http://127.0.0.1:'+server.address().port,calls};
}
const json=(response,status,body)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body));};

// Drive the server like a client: capture outgoing messages, answer elicitations.
function client(server,{elicitation=true,answer={action:'accept',content:{confirm:true}}}={}){
  const sent=[];let id=0;
  const harness={sent,async init(){await server.handle({jsonrpc:'2.0',id:++id,method:'initialize',params:{protocolVersion:'2025-06-18',
    capabilities:elicitation?{elicitation:{form:{}}}:{},clientInfo:{name:'test',version:'0'}}});return sent.at(-1).result;},
    async call(name,args,extra={}){const requestId=++id;const pending=server.handle({jsonrpc:'2.0',id:requestId,method:'tools/call',params:{name,arguments:args,...extra}});
      harness.lastRequestId=requestId;await pending;return sent.find(message=>message.id===requestId).result;}};
  harness.write=line=>{const message=JSON.parse(line);sent.push(message);
    if(message.method==='elicitation/create')queueMicrotask(()=>server.handle({jsonrpc:'2.0',id:message.id,result:answer}));};
  return harness;
}
function make(t,options){
  const out=temp(t);let harness;
  const server=createImageServer({outputDirectory:out,write:line=>harness.write(line),...options});
  harness=client(server,options.clientOptions);
  return {server,harness,out};
}

test('tools disclose separate OpenAI/ChatGPT billing and accept only bounded arguments',()=>{
  assert.deepEqual(tools.map(tool=>tool.name),['generate_image','edit_image']);
  for(const tool of tools){assert.match(tool.description,/not GitHub Copilot credits/);assert.equal(tool.inputSchema.additionalProperties,false);}
  assert.match(billingNotice,/OpenAI\/ChatGPT/);
});
test('relay URL must be loopback http without credentials or paths',()=>{
  assert.equal(relayBase(),'http://127.0.0.1:4144');assert.equal(relayBase('http://localhost:5000'),'http://localhost:5000');
  for(const bad of ['https://127.0.0.1:4144','http://192.168.1.5:4144','http://example.com','http://u:p@127.0.0.1:4144','http://127.0.0.1:4144/v1','not a url'])
    assert.throws(()=>relayBase(bad),/local relay|invalid/);
});
test('generate_image: one confirmed relay call, full-resolution PNG saved, bounded JPEG preview returned',async t=>{
  const png=await synthetic(2400,1600);
  const relay=await mockRelay(t,(call,response)=>json(response,200,{created:1,data:[{b64_json:png.toString('base64')}],model:'gpt-image-2'}));
  const {harness,out}=make(t,{relayUrl:relay.url,clientOptions:{}});
  const init=await harness.init();assert.equal(init.serverInfo.name,'relay_images');assert.match(init.instructions,/not GitHub Copilot credits/);
  const result=await harness.call('generate_image',{prompt:'a synthetic test pattern',background:'opaque',filename:'test_card'});
  assert.equal(result.isError,undefined,JSON.stringify(result));
  const prompt=harness.sent.find(message=>message.method==='elicitation/create');
  assert.match(prompt.params.message,/not GitHub Copilot credits/);assert.match(prompt.params.message,/synthetic test pattern/);
  assert.equal(relay.calls.length,1);assert.equal(relay.calls[0].path,'/v1/images/generations');
  assert.deepEqual(relay.calls[0].body,{model:'gpt-image-2',prompt:'a synthetic test pattern',n:1,background:'opaque'});
  const saved=result.structuredContent.path;assert.equal(path.dirname(saved),out);assert.match(path.basename(saved),/^test_card-\d{8}-\d{6}-[0-9a-f]{6}\.png$/);
  assert.ok(fs.readFileSync(saved).equals(png));assert.equal(result.structuredContent.width,2400);
  const image=result.content.find(block=>block.type==='image');assert.equal(image.mimeType,'image/jpeg');
  const shown=await sharp(Buffer.from(image.data,'base64')).metadata();
  assert.ok(Math.max(shown.width,shown.height)<=limits.previewEdge&&Buffer.from(image.data,'base64').length<=limits.previewBytes);
  assert.match(result.content[0].text,new RegExp(path.basename(saved)));
});
test('declined confirmation or a client without elicitation generates nothing',async t=>{
  const relay=await mockRelay(t,(call,response)=>json(response,500,{}));
  for(const clientOptions of [{answer:{action:'decline'}},{answer:{action:'accept',content:{confirm:false}}},{elicitation:false}]){
    const {harness}=make(t,{relayUrl:relay.url,clientOptions});await harness.init();
    const result=await harness.call('generate_image',{prompt:'x'});
    assert.equal(result.isError,true);assert.match(result.structuredContent.code,/not_approved|approval_unavailable/);
  }
  assert.equal(relay.calls.length,0);
  // Explicit opt-in to Claude Code's own per-tool permission prompt skips elicitation.
  const png=await synthetic(64,64);
  const ok=await mockRelay(t,(call,response)=>json(response,200,{data:[{b64_json:png.toString('base64')}]}));
  const {harness}=make(t,{relayUrl:ok.url,approval:'permission',clientOptions:{elicitation:false}});await harness.init();
  assert.equal((await harness.call('generate_image',{prompt:'x'})).isError,undefined);
  assert.equal(harness.sent.some(message=>message.method==='elicitation/create'),false);
  assert.throws(()=>createImageServer({approval:'none'}),/elicitation or permission/);
});
test('edit_image sends verified local references as data URLs and refuses unsafe paths',async t=>{
  const dir=temp(t),png=await synthetic(32,32),jpeg=await synthetic(32,32,'jpeg');
  const a=path.join(dir,'a.png'),b=path.join(dir,'b.jpg'),fake=path.join(dir,'fake.png');
  fs.writeFileSync(a,png);fs.writeFileSync(b,jpeg);fs.writeFileSync(fake,'not an image');
  const relay=await mockRelay(t,(call,response)=>json(response,200,{data:[{b64_json:png.toString('base64')}]}));
  const {harness}=make(t,{relayUrl:relay.url,clientOptions:{}});await harness.init();
  const result=await harness.call('edit_image',{prompt:'combine',reference_paths:[a,b]});
  assert.equal(result.isError,undefined,JSON.stringify(result));
  assert.equal(relay.calls[0].path,'/v1/images/edits');
  assert.deepEqual(relay.calls[0].body.images.map(image=>image.image_url.slice(0,23)),['data:image/png;base64,i','data:image/jpeg;base64,']);
  assert.match(harness.sent.find(message=>message.method==='elicitation/create').params.message,/a\.png, b\.jpg/);
  for(const reference_paths of [[fake],['relative.png'],['\\\\server\\share\\x.png'],[dir],[path.join(dir,'missing.png')],Array(6).fill(a)]){
    const bad=await harness.call('edit_image',{prompt:'x',reference_paths});
    assert.equal(bad.isError,true,JSON.stringify(reference_paths));
  }
  assert.equal(relay.calls.length,1);
});
test('relay errors are reported once with guidance: no retries or fallback',async t=>{
  const cases=[[501,'native_tools_disabled',/turned off/],[429,'native_tools_busy',/busy/],[502,'native_turn_incomplete',/image limit/],[503,'native_tools_unavailable',/unavailable/]];
  for(const [status,code,pattern] of cases){
    const relay=await mockRelay(t,(call,response)=>json(response,status,{error:{message:'detail',code}}));
    const {harness}=make(t,{relayUrl:relay.url,clientOptions:{}});await harness.init();
    const result=await harness.call('generate_image',{prompt:'x'});
    assert.equal(result.isError,true);assert.match(result.content[0].text,pattern);assert.match(result.content[0].text,/No retry or fallback/);
    assert.equal(relay.calls.length,1);
  }
  const notPng=await mockRelay(t,(call,response)=>json(response,200,{data:[{b64_json:Buffer.from('GIF89a').toString('base64')}]}));
  const {harness}=make(t,{relayUrl:notPng.url,clientOptions:{}});await harness.init();
  assert.equal((await harness.call('generate_image',{prompt:'x'})).structuredContent.code,'invalid_result');
  const down=make(t,{relayUrl:'http://127.0.0.1:1',clientOptions:{}});await down.harness.init();
  assert.equal((await down.harness.call('generate_image',{prompt:'x'})).structuredContent.code,'relay_unreachable');
});
test('timeout and MCP cancellation abort the single in-flight relay request',async t=>{
  const relay=await mockRelay(t,()=>{});  // never answers
  const slow=make(t,{relayUrl:relay.url,timeoutMs:150,clientOptions:{}});await slow.harness.init();
  const timedOut=await slow.harness.call('generate_image',{prompt:'x'});
  assert.equal(timedOut.structuredContent.code,'timeout');
  const {server,harness}=make(t,{relayUrl:relay.url,clientOptions:{}});await harness.init();
  const pending=harness.call('generate_image',{prompt:'x'});
  await new Promise(resolve=>setTimeout(resolve,100));
  await server.handle({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:harness.lastRequestId}});
  assert.equal((await pending).structuredContent.code,'cancelled');
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(relay.calls.length,2);assert.ok(relay.calls.every(call=>call.closed),'relay saw the client close each request');
});
test('optional bearer goes only to the relay header, never into MCP messages',async t=>{
  const png=await synthetic(16,16),secret='local-test-bearer-0123456789';
  const relay=await mockRelay(t,(call,response)=>json(response,200,{data:[{b64_json:png.toString('base64')}]}));
  const {harness}=make(t,{relayUrl:relay.url,token:secret,clientOptions:{}});await harness.init();
  await harness.call('generate_image',{prompt:'x'});
  assert.equal(relay.calls[0].headers.authorization,'Bearer '+secret);
  assert.doesNotMatch(JSON.stringify(harness.sent),new RegExp(secret));
});
test('desktop registration adds one entry, preserves other servers and restores exactly',t=>{
  const dir=temp(t),paths={config:path.join(dir,'claude_desktop_config.json'),receipt:path.join(dir,'receipt.json'),repository:dir};
  const original={mcpServers:{relay_browser:{command:'cmd',args:['x']},other:{env:{TOKEN:'PRIVATE'}}},preferences:{keep:true}};
  fs.writeFileSync(paths.config,JSON.stringify(original));
  const definition=imageDefinition({node:'C:\\node\\node.exe',repository:dir});
  assert.equal(imageSetupStatus(paths,definition).configuration,'not-configured');
  assert.equal(applyImageSetup(paths,definition).state,'applied');assert.equal(applyImageSetup(paths,definition).state,'already-applied');
  const config=JSON.parse(fs.readFileSync(paths.config));
  assert.deepEqual(config.mcpServers.relay_images,definition);assert.deepEqual(config.mcpServers.relay_browser,original.mcpServers.relay_browser);
  assert.equal(config.preferences.keep,true);assert.equal(config.mcpServers.relay_images.env,undefined);
  assert.doesNotMatch(fs.readFileSync(paths.receipt,'utf8'),/PRIVATE/);
  config.newSetting=1;fs.writeFileSync(paths.config,JSON.stringify(config));
  assert.equal(restoreImageSetup(paths).state,'restored');
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.config)),{...original,newSetting:1});
  fs.writeFileSync(paths.config,JSON.stringify({mcpServers:{relay_images:{command:'someone-else'}}}));
  assert.throws(()=>applyImageSetup(paths,definition),/no overwrite/);
});
