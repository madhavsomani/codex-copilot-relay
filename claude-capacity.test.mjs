import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as adapter from './claude-gateway/server.mjs';
import {CopilotRuntime} from './copilot-runtime.mjs';
import {gatewayVisibility} from './claude-gateway/visibility.mjs';

const models=[{id:'claude-opus-5.5',name:'Scripted local fixture',supportedReasoningEfforts:['medium','high'],
  capabilities:{limits:{max_prompt_tokens:1000000,max_output_tokens:128000,max_context_window_tokens:1000000}}}];
const token='local-capacity-test-not-a-provider-key';
const body=()=>({model:'claude-opus-5-5',max_tokens:1024,messages:[{role:'user',content:'fixture'}],
  tools:[{name:'Read',input_schema:{type:'object',properties:{path:{type:'string'}}}}]});
async function fixture(t,overrides={}){
  const directory=mkdtempSync(path.join(os.tmpdir(),'relay-capacity-')),sessions=[];
  let runtime,options;
  const client={async start(){},async ping(){},async listModels(){return models;},async forceStop(){},
    async createSession(){
      const events=new EventEmitter(),id=String(sessions.length),session={sessionId:id,results:[],
        on:handler=>{events.on('event',handler);return()=>events.off('event',handler);},
        emit:(type,data={})=>events.emit('event',{type,data}),
        async abort(){this.aborted=true;},async disconnect(){this.disconnected=true;},
        async send(){setImmediate(()=>{
          this.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'call-'+id}]});
          this.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'call-'+id,requestId:'request-'+id,arguments:{path:'fixture'}});
        });}};
      session.rpc={tools:{handlePendingToolCall:async result=>{session.results.push(result);setImmediate(()=>{
        session.emit('assistant.message_delta',{deltaContent:'DONE'});
        session.emit('assistant.message',{content:'DONE'});session.emit('session.idle');
      });}}};sessions.push(session);return session;
    }};
  const gateway=await adapter.startSdkGateway({token,port:0,runtimeDirectory:directory,...overrides,
    runtimeFactory:config=>{options=config;runtime=new CopilotRuntime({...config,createClient:()=>client,probeIntervalMs:0});return runtime;}});
  t.after(async()=>{await gateway.close();assert.equal(existsSync(path.join(directory,'gateway.owner.json')),false);
    assert.equal(path.dirname(directory),os.tmpdir());rmSync(directory,{recursive:true,force:true});});
  const call=(value,owner='same-parent-with-parallel-workers')=>fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/messages`,{
    method:'POST',headers:{authorization:'Bearer '+token,'anthropic-version':'2023-06-01','content-type':'application/json',
      'x-claude-code-session-id':owner},body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});
  const start=async()=>{const initial=body(),res=await call(initial),value=await res.json();assert.equal(res.status,200,JSON.stringify(value));
    assert.equal(value.stop_reason,'tool_use');return {...initial,messages:[...initial.messages,{role:'assistant',content:value.content},
      {role:'user',content:[{type:'tool_result',tool_use_id:value.content[0].id,content:'RESULT'}]}]};};
  const finish=async next=>{const res=await call(next);assert.equal(res.status,200,await res.clone().text());
    assert.equal((await res.json()).stop_reason,'end_turn');};
  return {gateway,runtime,options,sessions,call,start,finish};
}

test('production Claude startup uses a bounded configurable 128-session default',async t=>{
  const f=await fixture(t);assert.equal(f.options?.maxSessions,128);
  assert.equal(gatewayVisibility(f.gateway).sessionCapacity.limit,128);
});
test('Claude capacity validates environment values before acquiring a runtime or starting the SDK',async()=>{
  for(const value of [undefined,'',2,'32',64,128,256])assert.equal(adapter.claudeSessionLimit(value),value===undefined||value===''?128:Number(value));
  for(const value of [0,1,-1,257,'Infinity','16oops','1e2',2.5,'2.5',' ',null,[],[64],{},true])assert.throws(()=>adapter.claudeSessionLimit(value),/2.*256/);
  let started=false;
  await assert.rejects(adapter.startSdkGateway({token,port:0,maxSessions:257,runtimeFactory:()=>{started=true;}}),/2.*256/);
  assert.equal(started,false);
});
test('64 parallel Claude tool sessions survive capacity rejection and all release after continuation',async t=>{
  const f=await fixture(t,{maxSessions:64}),next=await Promise.all(Array.from({length:64},()=>f.start()));
  assert.equal(f.runtime.snapshot().activeSessions,64);assert.equal(f.gateway.byTool.size,64);
  const rejected=await f.call(body());assert.equal(rejected.status,503);
  assert.equal(rejected.headers.get('x-should-retry'),'false');await rejected.text();
  assert.equal(f.sessions.length,64,'rejection must not allocate or send provider work');
  assert.ok(f.sessions.every(s=>!s.aborted),'waiting parallel workers must not be evicted');
  await f.finish(next.shift());assert.equal(f.runtime.snapshot().activeSessions,63);
  next.push(await f.start());assert.equal(f.runtime.snapshot().activeSessions,64);
  await Promise.all(next.map(f.finish));
  assert.equal(f.runtime.snapshot().activeSessions,0);assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.byTool.size,0);
  assert.ok(f.sessions.every(s=>s.results.length===1&&s.aborted&&s.disconnected));
});
test('repeated parallel Claude waves do not leak capacity, and the configured lower cap is enforced',async t=>{
  const f=await fixture(t,{maxSessions:32});assert.equal(f.runtime.maxSessions,32);
  for(let wave=0;wave<3;wave++){
    const next=await Promise.all(Array.from({length:32},()=>f.start()));
    const rejected=await f.call(body());assert.equal(rejected.status,503);await rejected.text();
    await Promise.all(next.map(f.finish));assert.equal(f.runtime.snapshot().activeSessions,0);
  }
  assert.equal(f.sessions.length,96);assert.equal(f.gateway.byTool.size,0);
});
test('at full capacity a tool turn idle past the cache lifetime is released; its results rebuild from history',async t=>{
  const f=await fixture(t,{maxSessions:2,idleEvictMs:0});
  const first=await f.start(),second=await f.start();
  assert.equal(f.runtime.snapshot().availableSessionSlots,0);
  const third=await f.call(body());assert.equal(third.status,200,'a new request is admitted by releasing the idle turn');await third.text();
  assert.ok(f.sessions[0].aborted,'the longest-idle waiting turn was released');
  // Its results are still accepted: with no holder the relay rebuilds a new SDK
  // session from the client's history (this scripted model then asks for a tool again).
  const sessionsBefore=f.sessions.length,late=await f.call(first);
  assert.equal(late.status,200,await late.clone().text());await late.text();
  assert.equal(f.sessions.length,sessionsBefore+1,'rebuilt from history in a new session');
  assert.equal(f.sessions[0].results.length,0,'the released turn never re-executes the tool');
  // With a zero idle threshold the second waiting turn was released too; it is
  // likewise accepted and rebuilt rather than rejected.
  const other=await f.call(second);assert.equal(other.status,200);await other.text();
});
