import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {FEATURES,featureEnabled,loadFeatures,setFeature,parseFeatureList,resetFeatures,snapshotFeatures,
  applyExploreAgent,exploreAgentStatus,exploreAgentPath} from './relay-features.mjs';
import {ClaudeRequestHandler,encryptedPdf} from './claude-gateway/request-handler.mjs';
import {validate} from './claude-gateway/protocol.mjs';
import {Ledger,keepWarmNanoAiu} from './claude-gateway/ledger.mjs';
import {evictIdleToolTurn} from './claude-gateway/server.mjs';

const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-features-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const models=[{id:'claude-opus-5.5',name:'Claude Opus 5.5',supportedReasoningEfforts:['low','medium','high'],
  capabilities:{limits:{max_prompt_tokens:1000000,max_output_tokens:128000,max_context_window_tokens:1000000},supports:{adaptive_thinking:'required'}}}];
const body=(extra={})=>({model:'claude-opus-5-5',max_tokens:4096,messages:[{role:'user',content:'Hello'}],...extra});

test('features: defaults, saved choices, startup overrides and live changes persist',t=>{
  t.after(()=>resetFeatures());
  const dir=temp(t);
  const loaded=loadFeatures({runtimeDirectory:dir,env:{}});
  assert.equal(loaded.length,FEATURES.length);
  assert.equal(featureEnabled('cacheKeepWarm'),false,'keep-warm is opt-in');assert.equal(featureEnabled('imageHistoryTrim'),true);
  loadFeatures({runtimeDirectory:dir,env:{BRIDGE_FEATURES:'cacheKeepWarm=on, imageHistoryTrim=off'}});
  assert.equal(featureEnabled('cacheKeepWarm'),true);assert.equal(featureEnabled('imageHistoryTrim'),false);
  assert.equal(snapshotFeatures().find(item=>item.id==='cacheKeepWarm').source,'startup');
  loadFeatures({runtimeDirectory:dir,env:{}});
  assert.equal(featureEnabled('cacheKeepWarm'),true,'startup choice was saved');
  setFeature('cacheKeepWarm',false);
  loadFeatures({runtimeDirectory:dir,env:{}});assert.equal(featureEnabled('cacheKeepWarm'),false,'dashboard change was saved');
  assert.throws(()=>setFeature('nope',true),/Unknown feature/);assert.throws(()=>setFeature('cacheKeepWarm','yes'),/non-boolean/);
  assert.throws(()=>parseFeatureList('cacheKeepWarm=maybe'),/Invalid BRIDGE_FEATURES/);
  assert.throws(()=>featureEnabled('nope'),/Unknown relay feature/);
});

test('Haiku Explore agent: installs a relay-owned file, removes only its own, never touches a user file',t=>{
  const home=temp(t);
  assert.equal(exploreAgentStatus(home),'absent');
  applyExploreAgent(true,home);assert.equal(exploreAgentStatus(home),'managed');
  const text=fs.readFileSync(exploreAgentPath(home),'utf8');
  assert.match(text,/^---\nname: Explore\n/);assert.match(text,/\nmodel: haiku\n/);assert.match(text,/tools: Glob, Grep, Read, Bash/);
  applyExploreAgent(false,home);assert.equal(exploreAgentStatus(home),'absent');
  fs.mkdirSync(path.dirname(exploreAgentPath(home)),{recursive:true});fs.writeFileSync(exploreAgentPath(home),'---\nname: Explore\nmodel: sonnet\n---\nmine');
  assert.throws(()=>applyExploreAgent(true,home),/will not overwrite/);assert.throws(()=>applyExploreAgent(false,home),/will not overwrite/);
  assert.match(fs.readFileSync(exploreAgentPath(home),'utf8'),/mine/);
});

test('switching off an extra restores plain forwarding',t=>{
  t.after(()=>resetFeatures());
  const pdf={type:'document',source:{type:'base64',media_type:'application/pdf',data:Buffer.from('%PDF trailer /Encrypt 5 0 R').toString('base64')}};
  assert.equal(encryptedPdf(pdf),true);
  resetFeatures({idleToolEviction:false});
  const full={runtime:{snapshot:()=>({availableSessionSlots:0})},turns:new Set([{done:false,sink:null,pending:new Map([['a',{}]]),lastActive:0,fail(){throw new Error('evicted');}}]),idleEvictMs:1};
  assert.equal(evictIdleToolTurn(full,null,Date.now()),null,'no eviction when switched off');
});

async function provider(t,usage={input_tokens:3,cache_read_input_tokens:200000,cache_creation_input_tokens:0,output_tokens:1}){
  const bodies=[];
  const server=http.createServer(async(request,response)=>{
    let text='';for await(const chunk of request)text+=chunk;bodies.push(JSON.parse(text));
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.end([{type:'message_start',message:{usage}},{type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:1}},{type:'message_stop'}]
      .map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {bodies,url:`http://127.0.0.1:${server.address().port}/v1/messages`};
}

test('keep-warm: a quiet main chat is pinged with its identical request and max_tokens 1; subagents never',async t=>{
  const upstream=await provider(t),handler=new ClaudeRequestHandler();
  const send=(sessionId,warmKey,request)=>{
    handler.bind(sessionId,request,validate(request,models),request.messages,()=>{},warmKey);
    return handler.sendRequest(new Request(upstream.url,{method:'POST',headers:{authorization:'Bearer in-memory-only'},
      body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),{sessionId,signal:new AbortController().signal});
  };
  const big=body({messages:[{role:'user',content:'x'.repeat(500000)}],thinking:{type:'adaptive'}});
  await (await send('main-session','owner-main',big)).text();
  await (await send('agent-session',null,big)).text();
  assert.deepEqual([...handler.warmTargets.keys()],['owner-main'],'subagents are never remembered');
  const now=Date.now();
  assert.deepEqual(handler.warmDue({now}),[],'not due while recently active');
  assert.deepEqual(handler.warmDue({now:now+280000}),['owner-main']);
  const result=await handler.warm('owner-main');
  assert.equal(result.ok,true);assert.equal(result.cacheReadTokens,200000);assert.equal(result.outputTokens,1);
  const [real,,ping]=upstream.bodies;
  assert.equal(ping.max_tokens,1);assert.deepEqual(ping.messages,real.messages);assert.deepEqual(ping.system,real.system);
  assert.deepEqual(ping.tools,real.tools);assert.deepEqual(ping.thinking,real.thinking);
  assert.deepEqual(handler.warmDue({now:Date.now()+100000}),[],'interval restarts after a ping');
  assert.deepEqual(handler.warmDue({now:Date.now()+21*60*1000}),[],'stops after 20 quiet minutes');
  assert.equal(handler.warmTargets.size,0);
  // Small chats and budgeted thinking are skipped.
  await (await send('small','owner-small',body())).text();
  await (await send('budget','owner-budget',body({messages:big.messages,thinking:{type:'enabled',budget_tokens:2048}}))).text();
  assert.deepEqual(handler.warmDue({now:Date.now()+280000}),[]);
});

test('keep-warm cost is tallied separately with an estimate from measured rates',t=>{
  const dir=temp(t),ledger=new Ledger(path.join(dir,'ledger.json'));
  assert.equal(keepWarmNanoAiu({model:'claude-opus-5.5',cacheReadTokens:200000,inputTokens:3,outputTokens:1}),(200000*20+3*400+2000)*1000);
  assert.equal(keepWarmNanoAiu({model:'unknown-model',cacheReadTokens:1}),null);
  ledger.keepWarm({ok:true,model:'claude-opus-5.5',cacheReadTokens:200000,inputTokens:3,outputTokens:1});
  ledger.keepWarm({ok:false,model:'claude-opus-5.5'});
  assert.equal(ledger.state.keepWarm.pings,1);assert.equal(ledger.state.keepWarm.failed,1);
  assert.ok(Math.abs(ledger.state.keepWarm.estimatedNanoAiu/1e9-4.0032)<1e-9);
  assert.equal(ledger.state.received,0,'pings are not client requests');
});

test('dashboard has the Relay features panel with live switches',async()=>{
  const {DASHBOARD_HTML}=await import('./dashboard.mjs');
  assert.match(DASHBOARD_HTML,/id="relay-features"/);assert.match(DASHBOARD_HTML,/renderFeatures\(data\)/);
  assert.match(DASHBOARD_HTML,/\/dashboard\/features/);
});
