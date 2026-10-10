import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {providerError,readProviderError,errorResponseHeaders} from './claude-gateway/errors.mjs';
import {createGateway} from './claude-gateway/server.mjs';
import {ClaudeRequestHandler} from './claude-gateway/request-handler.mjs';
import {MessageSink} from './claude-gateway/stream.mjs';
import {retryProbeArguments,createLocalRetryFixture} from './claude-gateway/probe-retry-signals.mjs';

const now=Date.parse('2026-10-07T13:00:00Z');
const body={model:'claude-opus-5-5',max_tokens:1024,messages:[{role:'user',content:'Local retry fixture'}]};
const models=[{id:'claude-opus-5.5',name:'Local fixture only',supportedReasoningEfforts:['low'],capabilities:{}}];
const localToken='local-only-fixture-not-a-real-credential';
test('retry decisions and whole-second delays survive bounded provider error projection',async()=>{
  for(const decision of ['true','false']){
    const response=new Response(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'fixture rejection'}}),{
      status:529,headers:{'x-should-retry':decision,'retry-after':'61','request-id':'retry-fixture'}});
    const projected=await readProviderError(response);assert.equal(projected.shouldRetry,decision);
    assert.equal(projected.retryAfter,'61');assert.equal(projected.requestId,'retry-fixture');
    const restored=providerError(529,projected);assert.equal(restored.shouldRetry,decision);
    assert.equal(restored.retryAfter,'61');assert.equal((await response.json()).error.message,'fixture rejection');
  }
});
test('retry-after dates become ceiling seconds; absent and malformed hints are never invented',()=>{
  const parse=(retry,decision)=>providerError(429,{error:{type:'rate_limit_error'}},new Headers({
    ...(retry===undefined?{}:{'retry-after':retry}),...(decision===undefined?{}:{'x-should-retry':decision})}),()=>now+200);
  assert.equal(parse('Wed, 07 Oct 2026 13:01:02 GMT').retryAfter,'62');
  assert.equal(parse('Wed, 07 Oct 2026 12:59:59 GMT').retryAfter,'0');
  assert.equal(parse('0','false').retryAfter,'0');assert.equal(parse('3600','true').retryAfter,'3600');
  for(const value of [undefined,'-1','1.5','Infinity','soon','9999999999999999','2026-10-07T13:01:02Z'])
    assert.equal(parse(value).retryAfter,undefined);
  for(const value of [undefined,'1','False','always'])assert.equal(parse(undefined,value).shouldRetry,undefined);
});
test('real request-hook to gateway HTTP errors retain retry/correlation without provider inference',async t=>{
  const handler=new ClaudeRequestHandler(),sessions=new Set();let requests=0,released=0;
  const upstream=http.createServer(async(req,res)=>{for await(const chunk of req){};requests++;
    res.writeHead(500,{'content-type':'application/json','x-should-retry':'false','retry-after':'0',
      'request-id':'fixture-upstream-correlation','x-secret-fixture':'never-forward','set-cookie':'private=value'});
    res.end(JSON.stringify({type:'error',error:{type:'api_error',message:'FIXTURE_NO_RETRY'}}));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  class Session{
    constructor(){this.events=new EventEmitter();this.sessionId='fixture-'+sessions.size;sessions.add(this);}
    on(fn){this.events.on('event',fn);return()=>this.events.off('event',fn);}
    async send(){setImmediate(async()=>{
      const response=await handler.sendRequest(new Request(`http://127.0.0.1:${upstream.address().port}/v1/messages`,{
        method:'POST',body:JSON.stringify({model:models[0].id,messages:[],stream:true})}),
        {sessionId:this.sessionId,signal:new AbortController().signal});
      await response.text();this.events.emit('event',{type:'session.error',data:{message:'SDK wrapper failure'}});
    });}
    async abort(){}async disconnect(){}
  }
  const runtime={snapshot:()=>({state:'fixture-only'}),createSession:async()=>({session:new Session(),generation:1}),
    release:()=>released++,stop:async()=>{}};
  const gateway=await createGateway({runtime,models,token:localToken,requestHandler:handler});
  await gateway.listen(0);t.after(()=>gateway.close());
  for(const stream of [false,true]){
    const response=await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/messages?beta=true`,{method:'POST',
      headers:{authorization:'Bearer '+localToken,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({...body,stream})});
    assert.equal(response.status,500);assert.equal(response.headers.get('x-should-retry'),'false');
    assert.equal(response.headers.get('retry-after'),'0');assert.equal(response.headers.get('request-id'),'fixture-upstream-correlation');
    assert.equal(response.headers.get('x-secret-fixture'),null);assert.equal(response.headers.get('set-cookie'),null);
    const result=await response.json();assert.equal(result.error.message,'FIXTURE_NO_RETRY');assert.equal(result.request_id,'fixture-upstream-correlation');
  }
  assert.equal(requests,2);assert.equal(released,2);assert.equal(handler.plans.size,0);
  assert.equal(gateway.ledger.state.failed,2);assert.equal(gateway.ledger.state.completed,0);
  assert.ok(gateway.ledger.state.recent.every(row=>row.sdkApiCalls===0&&row.totalNanoAiu===null));
  assert.equal(gateway.turns.size,0);assert.equal(gateway.byTool.size,0);
});
test('an error after partial SSE cannot rewrite response headers or finish as success',()=>{
  const response=new EventEmitter();let headers,writes='',headCalls=0;
  response.writeHead=(_status,value)=>{headCalls++;headers=value;};response.write=value=>writes+=value;response.end=()=>{};
  const sink=new MessageSink(response,{...body,stream:true},()=>{});sink.text('partial output');
  sink.fail(providerError(500,{error:{type:'api_error',message:'FIXTURE_PARTIAL'}},
    new Headers({'x-should-retry':'false','retry-after':'3','request-id':'partial-fixture'})));
  assert.equal(headCalls,1);assert.equal(headers['x-should-retry'],undefined);assert.equal(headers['retry-after'],undefined);
  assert.match(writes,/event: error/);assert.match(writes,/partial-fixture/);assert.doesNotMatch(writes,/event: message_stop/);
});
test('failure headers reject injection and never leak unrelated metadata or override native header decisions',()=>{
  assert.deepEqual(errorResponseHeaders({requestId:'bad\r\nkey',retryAfter:'1\r\nkey',shouldRetry:'yes',authorization:'PRIVATE'}),{});
  const error=providerError(500,{error:{type:'api_error',retryAfter:'99',shouldRetry:'true'}},new Headers({'retry-after':'2','x-should-retry':'false'}));
  assert.deepEqual(errorResponseHeaders(error),{'retry-after':'2','x-should-retry':'false'});
  assert.equal(providerError(429,{error:{type:'rate_limit_error'}},new Headers({'retry-after':'Tue, 07 Oct 2026 13:00:00 GMT'}),()=>now).retryAfter,undefined);
});
test('local retry probe cannot start paid or outage work; optional token endpoint remains unmetered and does not disable subsequent requests',async t=>{
  assert.doesNotThrow(()=>retryProbeArguments(['--local']));
  for(const args of [[],['--live'],['--local','--outage'],['--local','--fallback']])assert.throws(()=>retryProbeArguments(args));
  const f=await createLocalRetryFixture();t.after(()=>f.close());
  const post=(pathname,value)=>fetch(`http://127.0.0.1:${f.gateway.server.address().port}${pathname}`,{method:'POST',
    headers:{authorization:'Bearer '+f.token,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify(value)});
  const count=await post('/v1/messages/count_tokens',body);assert.equal(count.status,501);
  assert.match((await count.json()).error.message,/Exact Anthropic token counting unavailable/);
  assert.equal(f.gateway.ledger.state.received,0);assert.equal(f.stats().upstreamRequests,0);
  const inference=await post('/v1/messages',body);assert.equal(inference.status,500);await inference.text();
  assert.equal(inference.headers.get('x-should-retry'),'false');assert.equal(f.stats().upstreamRequests,1);
  assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
});
