import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket, {WebSocketServer} from 'ws';
import {OpenAIFallback,OpenAIResponseRoutes,authorizeFallback,fallbackConfig,
  openAIResponseBody,responseFallbackReason,upstreamPath} from './openai-fallback.mjs';

const config={enabled:true,apiKey:'test-upstream-credential',localToken:'test-local-token-'.repeat(4),model:'test-native-model'};
const headers={'x-relay-openai-token':config.localToken,'content-type':'application/json'};
const request={headers:{host:'127.0.0.1:4144',...headers}};

test('public fallback is opt-in and does not reuse general API or Codex credentials',()=>{
  assert.equal(fallbackConfig({OPENAI_API_KEY:'not-used'}).apiKey,'');
  assert.equal(fallbackConfig({}).enabled,false);
  assert.throws(()=>authorizeFallback(request,{...config,enabled:false}),{code:'openai_fallback_disabled'});
  assert.throws(()=>authorizeFallback(request,{...config,apiKey:''}),{code:'openai_fallback_unavailable'});
  assert.throws(()=>authorizeFallback({headers:{host:'127.0.0.1'}},config),{statusCode:401});
  assert.throws(()=>authorizeFallback({headers:{...request.headers,origin:'https://malicious.invalid'}},config),{statusCode:403});
  assert.throws(()=>authorizeFallback({headers:{...request.headers,host:'attacker.invalid'}},config),{statusCode:403});
  authorizeFallback(request,config);
});

test('hosted tools route whole turns; normal tools and native search remain Copilot',()=>{
  for(const type of ['file_search','code_interpreter','computer_use_preview','image_generation'])
    assert.equal(responseFallbackReason({tools:[{type}]}),'hosted_'+type);
  assert.equal(responseFallbackReason({tools:[{type:'function',name:'exec_command'}]}),null);
  assert.equal(responseFallbackReason({tools:[null]}),null);
  assert.equal(responseFallbackReason({tools:[{type:'web_search'}]},{nativeEnabled:true}),null);
  assert.equal(responseFallbackReason({tools:[{type:'web_search',filters:{allowed_domains:['example.com']}}]},{nativeEnabled:true}),'extended_web_search');
  assert.equal(responseFallbackReason({tools:[{type:'web_search',search_context_size:'high'}]},{nativeEnabled:true}),'extended_web_search');
  assert.equal(responseFallbackReason({model:'openai/test-native-model'}),'explicit_openai_model');
  assert.equal(responseFallbackReason({previous_response_id:'resp_a'},{knownResponse:true}),'openai_continuation');
});

test('model mapping is explicit and safety, tool and image parameters are unchanged',()=>{
  const body={model:'gpt-6-astra',input:[{type:'computer_call_output',acknowledged_safety_checks:[]}],
    tools:[{type:'image_generation',quality:'high',size:'1536x1024'}],reasoning:{effort:'high'},store:false};
  const output=openAIResponseBody(body,config);
  assert.equal(output.model,'test-native-model');assert.deepEqual({...output,model:body.model},body);
  assert.equal(body.model,'gpt-6-astra');
  assert.throws(()=>openAIResponseBody(body,{model:''}),{code:'openai_model_required'});
  assert.equal(openAIResponseBody({model:'openai/explicit-native'},{model:''}).model,'explicit-native');
});

test('fixed public route allowlist rejects admin/proxy targets and preserves query strings',()=>{
  for(const target of ['/v1/openai/files','/v1/vector_stores/vs_123/files','/v1/realtime/client_secrets','/v1/realtime/calls','/v1/containers/ctr_123/files'])
    assert.ok(upstreamPath(new URL(target,'http://127.0.0.1'),'POST').startsWith('/v1/'));
  assert.equal(upstreamPath(new URL('http://127.0.0.1/v1/responses/resp_123/input_items?limit=20'),'GET'),'/v1/responses/resp_123/input_items?limit=20');
  for(const target of ['/v1/openai/organization/admin_api_keys','/v1/openai/../../admin','/v1/files/%2fetc','/v1/openai/http://evil.invalid'])
    assert.throws(()=>upstreamPath(new URL(target,'http://127.0.0.1'),'POST'),{statusCode:404});
});

test('response affinity persists only hashed IDs; corrupt state fails closed',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relay-affinity-test-'));
  try {const routes=new OpenAIResponseRoutes(directory);routes.remember('resp_affinity_test');
    assert.equal(new OpenAIResponseRoutes(directory).has('resp_affinity_test'),true);
    const saved=fs.readFileSync(routes.file,'utf8');assert.ok(!saved.includes('resp_affinity_test'));
    fs.writeFileSync(routes.file,'corrupt');assert.throws(()=>new OpenAIResponseRoutes(directory),{code:'route_metadata_invalid'});
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

async function fixture(t, fetchImpl) {
  const logs=[];const gateway=new OpenAIFallback({config:()=>config,fetchImpl,log:(event,data)=>logs.push({event,...data})});
  const server=http.createServer(async(req,res)=>{try{await gateway.forward(req,res,new URL(req.url,'http://127.0.0.1'));}
    catch(error){res.writeHead(error.statusCode||500);res.end(error.code);}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{gateway.close();server.closeAllConnections();server.close();});
  return {gateway,logs,url:'http://127.0.0.1:'+server.address().port};
}

test('HTTP Responses preserves payload and isolates credentials/telemetry',async t=>{
  let sent;const fixtureValue=await fixture(t,async(url,options)=>{sent={url,options};
    return new Response(JSON.stringify({object:'response',id:'resp_http_test',output:[],usage:{input_tokens:10}}),{headers:{'content-type':'application/json'}});});
  const res=await fetch(fixtureValue.url+'/v1/responses',{method:'POST',headers:{...headers,cookie:'must-not-leave-localhost',authorization:'Bearer local-codex-secret'},
    body:JSON.stringify({model:'gpt-6-astra',tools:[{type:'file_search',vector_store_ids:['vs_test']}],input:'private fixture'})});
  assert.equal(res.status,200);assert.equal(res.headers.get('x-relay-backend'),'openai-platform');
  await res.json();assert.equal(sent.url,'https://api.openai.com/v1/responses');
  assert.equal(sent.options.headers.authorization,'Bearer '+config.apiKey);
  assert.equal(sent.options.headers.cookie,undefined);assert.equal(sent.options.headers['x-relay-openai-token'],undefined);
  assert.equal(JSON.parse(sent.options.body).tools[0].vector_store_ids[0],'vs_test');
  assert.equal(fixtureValue.gateway.routes.has('resp_http_test'),true);
  assert.ok(!JSON.stringify(fixtureValue.logs).includes('private fixture'));
});

test('split SSE forwards exact bytes and retains response affinity',async t=>{
  const text='event: response.created\ndata: {"type":"response.created","response":{"id":"resp_stream_test"}}\n\n'+
    'event: response.output_text.delta\ndata: {"delta":"hello"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n';
  const f=await fixture(t,async()=>new Response(new ReadableStream({start(controller){for(const chunk of [text.slice(0,39),text.slice(39,83),text.slice(83)])controller.enqueue(Buffer.from(chunk));controller.close();}}),{headers:{'content-type':'text/event-stream'}}));
  const res=await fetch(f.url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'openai/test',stream:true,input:'hi'})});
  assert.equal(await res.text(),text);assert.equal(f.gateway.routes.has('resp_stream_test'),true);
});

test('large native image JSON retains affinity without accumulating media in the observer',async t=>{
  const payload=JSON.stringify({id:'resp_large_image',object:'response',output:[{type:'image_generation_call',result:'x'.repeat(2_500_000)}]});
  const f=await fixture(t,async()=>new Response(payload,{headers:{'content-type':'application/json'}}));
  const res=await fetch(f.url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'openai/test',input:'hi'})});
  assert.equal((await res.text()).length,payload.length);assert.equal(f.gateway.routes.has('resp_large_image'),true);
});

test('multipart images and binary file contents pass through without schema narrowing',async t=>{
  const raw=Buffer.from('--boundary\r\nContent-Disposition: form-data; name="mask"\r\n\r\nmask-data\r\n--boundary--');let upstreamBody;
  const f=await fixture(t,async(_url,options)=>{upstreamBody=options.body;return new Response(new Uint8Array([1,2,255,0]),{headers:{'content-type':'application/octet-stream'}});});
  const res=await fetch(f.url+'/v1/images/edits',{method:'POST',headers:{...headers,'content-type':'multipart/form-data; boundary=boundary'},body:raw});
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),Buffer.from([1,2,255,0]));assert.deepEqual(upstreamBody,raw);
});

test('upstream failures are not retried or converted to successful completions',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return new Response('{"error":{"message":"quota exhausted"}}',{status:429,headers:{'content-type':'application/json','retry-after':'30'}});});
  const res=await fetch(f.url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'openai/test',input:'hi'})});
  assert.equal(res.status,429);assert.equal(res.headers.get('retry-after'),'30');assert.match(await res.text(),/quota exhausted/);assert.equal(calls,1);
});

test('redirects fail closed and unauthorized requests never contact upstream',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return new Response(null,{status:307,headers:{location:'https://untrusted.invalid'}});});
  const noAuth=await fetch(f.url+'/v1/files');assert.equal(noAuth.status,401);assert.equal(calls,0);
  const res=await fetch(f.url+'/v1/files',{headers});assert.equal(res.status,502);assert.match(await res.text(),/redirect/);assert.equal(calls,1);
});

test('downstream cancellation aborts the active OpenAI request',async t=>{
  let aborted=false;
  const f=await fixture(t,async(_url,{signal})=>{signal.addEventListener('abort',()=>{aborted=true;});
    return new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from(': ready\n\n'));signal.addEventListener('abort',()=>controller.error(new Error('cancelled')));}}),{headers:{'content-type':'text/event-stream'}});});
  const controller=new AbortController();const res=await fetch(f.url+'/v1/responses',{method:'POST',headers,signal:controller.signal,body:JSON.stringify({model:'openai/test',input:'hi'})});
  await res.body.getReader().read();controller.abort();
  for(let i=0;i<100&&!aborted;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(aborted,true);assert.equal(f.gateway.jobs.size,0);
});

test('Realtime proxies actual WebSocket text/binary frames with isolated upstream auth',async t=>{
  const upstreamServer=http.createServer();const upstreamWss=new WebSocketServer({server:upstreamServer});
  let upstreamHeaders;
  upstreamWss.on('connection',(ws,req)=>{upstreamHeaders=req.headers;ws.on('message',(data,binary)=>ws.send(data,{binary}));});
  upstreamServer.listen(0,'127.0.0.1');await once(upstreamServer,'listening');
  class LocalUpstream extends WebSocket {constructor(url,options){assert.match(url,/^wss:\/\/api.openai.com\/v1\/realtime\?model=/);
    super('ws://127.0.0.1:'+upstreamServer.address().port,options);}}
  const gateway=new OpenAIFallback({config:()=>config,WebSocketImpl:LocalUpstream});
  const server=http.createServer();gateway.attachRealtime(server);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{gateway.close();for(const client of upstreamWss.clients)client.terminate();upstreamWss.close();upstreamServer.close();server.close();});
  const client=new WebSocket('ws://127.0.0.1:'+server.address().port+'/v1/realtime?model=test-realtime',{headers});
  await once(client,'open');client.send(JSON.stringify({type:'session.update',session:{instructions:'fixture'}}));
  const [text,binary]=await once(client,'message');assert.equal(binary,false);assert.equal(JSON.parse(text).type,'session.update');
  client.send(Buffer.from([0,1,255]));const [bytes,isBinary]=await once(client,'message');assert.equal(isBinary,true);assert.deepEqual(bytes,Buffer.from([0,1,255]));
  assert.equal(upstreamHeaders.authorization,'Bearer '+config.apiKey);assert.equal(upstreamHeaders['x-relay-openai-token'],undefined);client.close();
});
