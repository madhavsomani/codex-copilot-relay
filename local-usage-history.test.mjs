import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readLocalUsageHistory,createLocalUsageReader} from './local-usage-history.mjs';
import {createSetupPortal} from './setup-server.mjs';

const at='2026-10-07T13:00:00.000Z';
const copilot=()=>({version:2,updatedAt:at,baseline:{unmeteredBefore:1},lifetime:{received:4,completed:3,failed:1,
  meteredCalls:3,unmeteredCalls:1,sdkApiCalls:3,inputTokens:300,outputTokens:30,cacheReadTokens:20,cacheWriteTokens:10,
  totalNanoAiu:1250000000,creditMeteredApiCalls:2},models:{'gpt-6.1-sol':{sdkApiCalls:3,inputTokens:300,outputTokens:30,totalNanoAiu:1250000000,creditMeteredApiCalls:2}},
  PRIVATE_CREDENTIAL:'never-output',taskDaily:{PRIVATE_SESSION:{PRIVATE_PROMPT:'never-output'}}});
const claude=()=>({received:2,completed:1,failed:0,usage:[{model:'claude-opus-5.5',sdkApiCalls:1,inputTokens:40,outputTokens:5,
  cacheReadTokens:0,cacheWriteTokens:0,totalNanoAiu:null,creditReportedCalls:0}],recent:[{at,status:'active',PRIVATE_TOOL:'never-output'}]});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-relay-usage-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:4}));
  return {root,async write(file,value){const target=path.join(root,'runtime',file);await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,typeof value==='string'?value:JSON.stringify(value));return target;}};}

test('local usage discovers only canonical ledgers and separates provider counters without leaking private fields',async t=>{
  const f=await fixture(t);await f.write('proxy-metrics.json',copilot());
  await f.write('codex-cli/ports/4151/proxy-metrics.json',copilot());await f.write('claude-preview/ledger.json',claude());
  await f.write('claude-preview/ports/4257/ledger.json',claude());await f.write('candidate/runtime/proxy-metrics.json',copilot());
  const view=await readLocalUsageHistory({root:f.root});
  assert.deepEqual(view.sources.map(row=>row.id).sort(),['claude-code:4246','claude-code:4257','codex-cli:4151','codex-desktop']);
  assert.equal(view.providers.length,1);assert.equal(view.providers[0].provider,'github-copilot-sdk');
  assert.equal(view.providers[0].received,12);assert.equal(view.providers[0].inputTokens,680);
  assert.equal(view.providers[0].aiCredits,2.5);assert.equal(view.providers[0].creditReporting,'partial');
  assert.equal(view.sources[0].liveness,'not-verified');
  assert.doesNotMatch(JSON.stringify(view),/PRIVATE|never-output|gateway.owner|taskDaily|token|session|pid|root/);
});
test('combined usage reads only the selected owned ledgers and refuses an outside root',async t=>{
  const f=await fixture(t);await f.write('proxy-metrics.json',copilot());
  await f.write('unified/4265/proxy-metrics.json',copilot());await f.write('unified/4265/claude/ledger.json',claude());
  const view=await readLocalUsageHistory({root:f.root,runtimeDirectory:path.join(f.root,'runtime','unified','4265')});
  assert.deepEqual(view.sources.map(row=>row.id),['unified-codex','unified-claude']);
  assert.equal(view.providers[0].received,6);assert.equal(view.providers[0].aiCredits,1.25);
  assert.match(view.scope,/Older desktop/);assert.doesNotMatch(JSON.stringify(view),/PRIVATE|never-output/);
  const refused=await readLocalUsageHistory({root:f.root,runtimeDirectory:path.dirname(f.root)});
  assert.equal(refused.scanStatus,'unavailable');assert.deepEqual(refused.sources,[]);
});
test('usage preserves missing reports versus reported zero and models disclose attribution boundaries',async t=>{
  const f=await fixture(t),data=copilot();data.lifetime.sdkApiCalls=0;data.lifetime.creditMeteredApiCalls=0;
  await f.write('proxy-metrics.json',data);await f.write('claude-preview/ledger.json',claude());
  let view=await readLocalUsageHistory({root:f.root}),codex=view.sources.find(row=>row.client==='codex-desktop');
  assert.equal(codex.inputTokens,null);assert.equal(codex.aiCredits,null);assert.equal(codex.creditReporting,'unreported');
  assert.equal(codex.modelAttribution,'SDK usage or selected-model fallback');
  assert.equal(view.sources.find(row=>row.client==='claude-code').modelAttribution,'SDK usage receipts');
  const zero=claude();zero.usage[0].totalNanoAiu=0;zero.usage[0].creditReportedCalls=1;
  await f.write('claude-preview/ledger.json',zero);view=await readLocalUsageHistory({root:f.root});
  assert.equal(view.sources.find(row=>row.client==='claude-code').aiCredits,0);
  assert.equal(view.sources.find(row=>row.client==='claude-code').creditReporting,'reported');
});
test('OpenAI telemetry is a separate provider subtotal, not Copilot credits or automatic fallback',async t=>{
  const f=await fixture(t);await f.write('provider-telemetry.json',{version:1,since:at,totals:{'openai-codex':{calls:2,submitted:2,completed:1,failed:1,
    usageReports:1,inputTokens:20,outputTokens:30,inputImageTokens:null,outputImageTokens:null},'PRIVATE_PROVIDER':{calls:999}},records:[],seen:[]});
  const view=await readLocalUsageHistory({root:f.root});assert.equal(view.providers.length,1);
  assert.equal(view.providers[0].provider,'openai-codex');assert.equal(view.providers[0].aiCredits,null);
  assert.equal(view.providers[0].inputTokens,20);assert.equal(view.providers[0].usageReporting,'receipt-subtotal');
  assert.equal(view.providers[0].sdkApiCalls,null);
  assert.equal(view.automaticFallback,false);assert.doesNotMatch(JSON.stringify(view),/PRIVATE/);
});
test('multiple receipts never prove all requests metered, and model bounds do not truncate totals',async t=>{
  const f=await fixture(t),data=copilot();data.lifetime.sdkApiCalls=12;data.lifetime.creditMeteredApiCalls=12;
  data.models=Object.fromEntries(Array.from({length:18},(_,i)=>['gpt-test-'+i,{sdkApiCalls:1,inputTokens:1,outputTokens:1,totalNanoAiu:0,creditMeteredApiCalls:1}]));
  await f.write('proxy-metrics.json',data);
  const c=claude();c.usage[0].sdkApiCalls=4;c.usage[0].creditReportedCalls=4;c.usage[0].totalNanoAiu=0;
  await f.write('claude-preview/ledger.json',c);
  const view=await readLocalUsageHistory({root:f.root}),codex=view.sources.find(row=>row.client==='codex-desktop');
  assert.equal(codex.usageReporting,'receipt-subtotal');assert.equal(codex.meteredRequestOutcomes,3);
  assert.equal(codex.unmeteredRequestOutcomes,1);assert.equal(codex.models.length,16);assert.equal(codex.modelsTruncated,true);
  assert.equal(view.sources.find(row=>row.client==='claude-code').usageReporting,'receipt-subtotal');
  assert.equal(view.providers[0].creditReporting,'reported');assert.equal(view.providers[0].sdkApiCalls,16);
  assert.equal(view.providers[0].inputTokens,340);
});
test('unreported aggregate remains unknown, malformed counts and mutated files do not become zero',async t=>{
  const f=await fixture(t),data=copilot();data.lifetime.sdkApiCalls=0;data.lifetime.creditMeteredApiCalls=0;
  await f.write('proxy-metrics.json',data);
  let view=await readLocalUsageHistory({root:f.root});assert.equal(view.providers[0].usageReporting,'unreported');
  for(const field of ['received','sdkApiCalls','creditMeteredApiCalls']){
    const broken=copilot();broken.lifetime[field]=1.5;await f.write('proxy-metrics.json',broken);
    view=await readLocalUsageHistory({root:f.root});assert.equal(view.sources[0].status,'unavailable');
  }
});
test('Windows junctions and nested port ancestors cannot redirect ledger reads',async t=>{
  const f=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'relay-usage-outside-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'proxy-metrics.json'),JSON.stringify(copilot()));
  await fs.mkdir(path.join(f.root,'runtime/codex-cli'),{recursive:true});
  await fs.mkdir(path.join(outside,'4151'));await fs.writeFile(path.join(outside,'4151/proxy-metrics.json'),JSON.stringify(copilot()));
  const linked=path.join(f.root,'runtime/codex-cli/ports');await fs.symlink(outside,linked,process.platform==='win32'?'junction':'dir');
  const view=await readLocalUsageHistory({root:f.root});
  assert.equal(view.providers.length,0);assert.equal(view.scanStatus,'partial');
});
test('empty, corrupt, unsupported, oversized and inconsistent ledgers are unavailable, never recovered or zeroed',async t=>{
  const f=await fixture(t);assert.equal((await readLocalUsageHistory({root:f.root})).sources.length,0);
  for(const value of ['{bad',JSON.stringify({...copilot(),version:99}),JSON.stringify({...copilot(),lifetime:{...copilot().lifetime,received:-1}}),
    ' '.repeat(17*1024*1024)]){
    const file=await f.write('proxy-metrics.json',value),before=await fs.stat(file);
    const view=await readLocalUsageHistory({root:f.root});assert.equal(view.providers.length,0);assert.equal(view.sources[0].status,'unavailable');
    assert.equal((await fs.stat(file)).mtimeMs,before.mtimeMs);
  }
});
test('discovery and response stay bounded and candidate/custom directories never enter totals',async t=>{
  const f=await fixture(t);
  for(let index=0;index<36;index++)await f.write(`codex-cli/ports/${4200+index}/proxy-metrics.json`,copilot());
  await f.write('codex-cli/ports/PRIVATE_PATH/proxy-metrics.json',copilot());
  const view=await readLocalUsageHistory({root:f.root});assert.ok(view.sources.length<=32);assert.equal(view.truncated,true);
  assert.ok(Buffer.byteLength(JSON.stringify(view))<=256*1024);assert.doesNotMatch(JSON.stringify(view),/PRIVATE/);
});
test('symbolic-link ledger and ancestor paths are not read or followed',{skip:process.platform==='win32'},async t=>{
  const f=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'relay-private-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'proxy-metrics.json'),JSON.stringify(copilot()));await fs.mkdir(path.join(f.root,'runtime'));
  await fs.symlink(path.join(outside,'proxy-metrics.json'),path.join(f.root,'runtime/proxy-metrics.json'));
  let view=await readLocalUsageHistory({root:f.root});assert.equal(view.providers.length,0);assert.equal(view.sources[0].status,'unavailable');
  await fs.unlink(path.join(f.root,'runtime/proxy-metrics.json'));await fs.rmdir(path.join(f.root,'runtime'));await fs.symlink(outside,path.join(f.root,'runtime'));
  view=await readLocalUsageHistory({root:f.root});assert.equal(view.providers.length,0);assert.equal(view.scanStatus,'unavailable');
});
test('concurrent reads use a bounded cache and never perform provider inference or modify files',async t=>{
  const f=await fixture(t);let time=0;await f.write('proxy-metrics.json',copilot());
  const read=createLocalUsageReader({root:f.root,now:()=>time});const values=await Promise.all([read(),read(),read()]);
  assert.equal(values[0],values[1]);await f.write('proxy-metrics.json','{bad');assert.equal((await read()).sources[0].status,'available');
  time=11000;assert.equal((await read()).sources[0].status,'unavailable');
});
test('hard-linked ledgers are unavailable, and total read reservations stay bounded even for corrupt files',async t=>{
  const f=await fixture(t),first=await f.write('proxy-metrics.json',copilot());
  await fs.link(first,path.join(f.root,'duplicate.json'));
  let view=await readLocalUsageHistory({root:f.root});assert.equal(view.sources[0].status,'unavailable');
  await fs.unlink(first);
  for(let i=0;i<9;i++)await f.write(`claude-preview/ports/${4300+i}/ledger.json`,' '.repeat(4*1024*1024));
  view=await readLocalUsageHistory({root:f.root});assert.equal(view.providers.length,0);
  assert.equal(view.scanStatus,'partial');assert.equal(view.truncated,true);
});
test('connection center history endpoint is dependency-free, same-origin, GET-only and does not expose paths',async t=>{
  const f=await fixture(t);await f.write('proxy-metrics.json',copilot());
  const portal=await createSetupPortal({root:f.root,port:0,inspect:async()=>({installed:false}),auth:async()=>({authenticated:false}),relay:async()=>null});
  await portal.listen();t.after(()=>portal.close());const url=`http://127.0.0.1:${portal.server.address().port}/dashboard/setup/usage`;
  const response=await fetch(url);assert.equal(response.status,200);const view=await response.json();assert.equal(view.sources[0].received,4);
  assert.equal((await fetch(url,{method:'POST'})).status,405);assert.equal((await fetch(url,{headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await fetch(url+'?path=auth.json')).status,400);assert.doesNotMatch(JSON.stringify(view),/PRIVATE|never-output/);
});
