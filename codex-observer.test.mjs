import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {createSetupPortal} from './setup-server.mjs';
import * as observer from './codex-gateway/observer.mjs';
import {parseCodexLaunchArguments} from './codex-gateway/launch.mjs';

const sample=()=>({ok:true,provider:'github-copilot-sdk',version:'fixture-1',model:'gpt-6.1-sol',sdk:{ok:true},
  lastCodexRequestAt:'2026-10-07T13:00:00.000Z',activeExchanges:2,private:'PRIVATE_CREDENTIAL',
  telemetry:{summary:{received:7,completed:4,failed:2,sdkApiCalls:8,inputTokens:120,outputTokens:30,
    creditMeteredApiCalls:2,totalNanoAiu:1250000000,apiEquivalentUsd:99,prompts:'PRIVATE_PROMPT'}}});
test('owned Codex observer projects truthful receipt coverage without secrets, price estimates or raw health',async()=>{
  let reads=0,time=Date.parse('2026-10-07T13:00:01Z'),alive=true;
  const read=observer.createCodexObserver({port:4151,version:'fixture-1',model:'gpt-6.1-sol',effort:'xhigh',clientVersion:'codex-cli 0.147.0',
    isAlive:()=>alive,now:()=>time,readHealth:async()=>{reads++;return sample();}});
  const values=await Promise.all([read(),read(),read()]);const view=values[0];assert.equal(reads,1);
  assert.equal(view.received,7);assert.equal(view.sdkApiCalls,8);assert.equal(view.aiCredits,1.25);assert.equal(view.creditReporting,'partial');
  assert.equal(view.activeExchanges,2);assert.equal(view.state,'traffic-observed');assert.equal(view.automaticFallback,false);
  assert.equal(view.selectedModel,'gpt-6.1-sol');assert.equal(view.modelAttribution,'Launcher selection; not per-request actual SDK model');
  assert.doesNotMatch(JSON.stringify(view),/PRIVATE_|apiEquivalent|Bearer|prompts|authToken/);
  time+=11000;await read();assert.equal(reads,2);alive=false;
  const stopped=await read();assert.equal(stopped.listening,false);assert.equal(stopped.state,'not-live');assert.equal(stopped.received,undefined);
});
test('observer distinguishes unreported, explicit zero and malformed counters; changed identity and unreachable health fail closed',async()=>{
  for(const [change,expected] of [
    [s=>{s.telemetry.summary.creditMeteredApiCalls=0;},'unreported'],
    [s=>{s.telemetry.summary.totalNanoAiu=0;s.telemetry.summary.creditMeteredApiCalls=8;},'reported'],
    [s=>{s.telemetry.summary.sdkApiCalls=0;s.telemetry.summary.creditMeteredApiCalls=0;},'unreported'],
    [s=>{s.telemetry.summary.creditMeteredApiCalls=9;},'unavailable'],
    [s=>{s.telemetry.summary.received=1;},'unavailable'],
    [s=>{s.telemetry.summary.inputTokens=1.5;},'unavailable'],
    [s=>{s.version='imposter';},'unavailable']]){
    const s=sample();change(s);const read=observer.createCodexObserver({port:4151,version:'fixture-1',model:'gpt-6.1-sol',isAlive:()=>true,readHealth:async()=>s});
    const view=await read();if(expected==='unavailable'){assert.equal(view.state,expected);assert.equal(view.received,undefined);}
    else {assert.equal(view.creditReporting,expected);assert.equal(view.aiCredits,expected==='reported'?0:null);
      if(s.telemetry.summary.sdkApiCalls===0)assert.equal(view.inputTokens,null);}
  }
  const read=observer.createCodexObserver({port:4151,version:'fixture-1',model:'gpt-6.1-sol',isAlive:()=>true,readHealth:async()=>{throw Error('PRIVATE_ERROR');}});
  assert.doesNotMatch(JSON.stringify(await read()),/PRIVATE_ERROR/);
});
test('Codex observer endpoint is read-only, same-origin, selector-free, and does not expose an inference credential',async t=>{
  const portal=await createSetupPortal({port:0,inspect:async()=>({installed:true,configured:true}),relay:async()=>null,auth:async()=>({authenticated:false,models:[]}),
    codexObserver:async()=>({state:'listening',selectedModel:'gpt-6.1-sol',listening:true})});
  const url=await portal.listen(),base=new URL(url).origin;t.after(()=>portal.close());
  const response=await fetch(base+'/dashboard/setup/codex');assert.equal(response.status,200);
  assert.equal((await response.json()).selectedModel,'gpt-6.1-sol');
  assert.equal((await fetch(base+'/dashboard/setup/codex?port=4144')).status,400);
  assert.equal((await fetch(base+'/dashboard/setup/codex',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/dashboard/setup/codex',{headers:{origin:'https://evil.invalid'}})).status,403);
  const html=await (await fetch(url)).text();assert.match(html,/Live portable Codex/);assert.doesNotMatch(html,/href="http:\/\/127\.0\.0\.1:4144\/dashboard"/);
  assert.equal((await fetch(base+'/v1/responses',{method:'GET'})).status,404);
});
test('portable Codex observer flags cannot target production or silently mix contradictory options',()=>{
  const config=parseCodexLaunchArguments(['--port','4151','--setup-port','4153','--open-setup','--','exec','hello']);
  assert.equal(config.setupPort,4153);assert.equal(config.openSetup,true);
  assert.equal(parseCodexLaunchArguments(['--no-setup','--']).setupPort,null);
  for(const args of [['--setup-port','4144','--'],['--port','4151','--setup-port','4151','--'],['--no-setup','--open-setup','--'],
    ['--no-setup','--setup-port','4153','--'],['--setup-port','4153','--no-setup','--'],['--setup-port','1','--']])assert.throws(()=>parseCodexLaunchArguments(args));
});
test('Codex observer UI is text-only, bounded, no third-party scripts, hides inactive data and pauses hidden tabs',async()=>{
  new vm.Script(observer.CODEX_OBSERVER_SCRIPT);assert.doesNotMatch(observer.CODEX_OBSERVER_SCRIPT,/innerHTML|insertAdjacentHTML|https?:\/\/|method\s*:\s*['"]POST/);
  const nodes=new Map(),intervals=[];
  const document={hidden:false,addEventListener:()=>{},getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false});return nodes.get(id);}};
  let requests=0,data={listening:true,state:'traffic-observed',version:'1.3.59',selectedModel:'gpt-6.1-sol',effort:'xhigh',
    sdkApiCalls:8,inputTokens:120,outputTokens:30,received:7,completed:4,failed:2,activeExchanges:2,aiCredits:1.25,creditReporting:'partial',creditReportedCalls:2};
  vm.runInNewContext(observer.CODEX_OBSERVER_SCRIPT,{document,AbortSignal,fetch:async()=>{requests++;return {ok:true,json:async()=>data};},setInterval:(fn,ms)=>intervals.push({fn,ms})});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes.get('codex-live-receipts').textContent,'8');
  assert.match(nodes.get('codex-live-credits').textContent,/1.25.*partial/);
  document.hidden=true;await intervals[0].fn();assert.equal(requests,1);document.hidden=false;data={state:'not-live',listening:false};
  await intervals[0].fn();assert.equal(nodes.get('codex-live-receipts').textContent,'Unreported');
});
test('owned observer health read rejects oversized bodies, redirects and private invalid JSON without disclosing them',async t=>{
  let mode='oversize';const server=http.createServer((_request,response)=>{
    if(mode==='redirect'){response.writeHead(302,{location:'http://example.invalid/PRIVATE'});response.end();return;}
    response.writeHead(200,{'content-type':'application/json'});response.end(mode==='oversize'?JSON.stringify({...sample(),padding:'x'.repeat(70000)}):'PRIVATE_INVALID_JSON');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  for(mode of ['oversize','redirect','invalid']){
    const read=observer.createCodexObserver({port:server.address().port,version:'fixture-1',model:'gpt-6.1-sol',isAlive:()=>true});
    const result=await read();assert.equal(result.state,'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
});
