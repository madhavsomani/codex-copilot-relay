import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {sdkToolName} from './claude-gateway/protocol.mjs';
import {MessageSink} from './claude-gateway/stream.mjs';
import {Ledger} from './claude-gateway/ledger.mjs';
import {estimateTokens} from './claude-gateway/server.mjs';

test('SDK tool names depend only on the client name, never on catalog position',()=>{
  const read={name:'Read'},long={name:'mcp__'+'x'.repeat(100)};
  assert.equal(sdkToolName(read,0),'client_Read');assert.equal(sdkToolName(read,57),'client_Read');
  assert.equal(sdkToolName(long,0),sdkToolName(long,9));assert.ok(sdkToolName(long,0).length<=64);
  assert.notEqual(sdkToolName({name:'mcp__relay_images__edit_image'},23),sdkToolName({name:'mcp__relay_images__generate_image'},24));
  assert.doesNotMatch(sdkToolName({name:'mcp__relay_images__generate_image'},24),/\d/);
});

function fakeResponse(){
  const response=new EventEmitter();Object.assign(response,{headersSent:false,status:null,headers:null,written:[],ended:false,
    writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},
    write(chunk){if(!this.headersSent)this.writeHead(200,{});this.written.push(String(chunk));},end(){this.ended=true;}});
  return response;
}
test('pings wait for the answer so a fast upstream error keeps its HTTP status and retry headers',async()=>{
  const response=fakeResponse(),sink=new MessageSink(response,{stream:true,model:'m'},()=>{},5,60000);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(response.headersSent,false,'no ping before the answer starts');
  sink.fail(Object.assign(new Error('rate limited'),{statusCode:429,type:'rate_limit_error',retryAfter:'7'}));
  assert.equal(response.status,429);assert.equal(response.headers['retry-after'],'7');
});
test('after the grace period pings start, so a slow first token never looks dead',async()=>{
  const response=fakeResponse(),sink=new MessageSink(response,{stream:true,model:'m'},()=>{},5,20);
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(response.status,200);assert.ok(response.written.some(chunk=>chunk.includes('event: ping')));
  sink.fail(new Error('x'));
});

test('token estimate skips deferred tool schemas and reuses per-message counts',()=>{
  const big='word '.repeat(5000);
  const input={system:'sys',prompt:'[USER]\n'+big+'\n\n[ASSISTANT]\nok'};
  const loaded={name:'A',input_schema:{type:'object',description:big}};
  const base=estimateTokens(input,{tools:[]},{});
  assert.ok(estimateTokens(input,{tools:[loaded]},{})>base+3000);
  assert.equal(estimateTokens(input,{tools:[{...loaded,defer_loading:true}]},{}),base,'deferred schemas are not counted');
  const started=performance.now();for(let i=0;i<50;i++)estimateTokens(input,{tools:[]},{});
  assert.ok(performance.now()-started<500,'cached counts make repeated estimates cheap');
});

test('a ledger near its size guard trims old rows and never throws into the request path',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-ledger-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ledger=new Ledger(path.join(dir,'ledger.json'));
  ledger.state.recent=Array.from({length:1000},(_,i)=>({id:'r'+i,status:'completed',pad:'x'.repeat(5000)}));
  assert.doesNotThrow(()=>ledger.save());
  assert.ok(fs.statSync(path.join(dir,'ledger.json')).size<=4*1024*1024);
  assert.ok(ledger.state.recent.length<1000);assert.equal(ledger.state.recent.at(-1).id,'r999','newest rows kept');
  // An unwritable path is recorded, not thrown.
  const broken=new Ledger(null);broken.file=path.join(dir,'missing','\0bad');assert.doesNotThrow(()=>broken.save());assert.ok(broken.saveError);
});

test('Claude ledger keeps a per-day per-model credit tally and backfills it once from retained receipts',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-model-daily-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'ledger.json'),now=new Date().toISOString();
  fs.writeFileSync(file,JSON.stringify({received:1,completed:1,failed:0,usage:[],taskDaily:[],taskMeteringStartedAt:now,
    recent:[{id:'r',at:now,completedAt:now,status:'completed',sdkApiCalls:1,inputTokens:100,outputTokens:5,cacheReadTokens:50,totalNanoAiu:2e9,actualModels:['claude-opus-5.5']}]}));
  const ledger=new Ledger(file);
  const row=ledger.start({model:'claude-haiku-5-5'},{},null);
  ledger.usage(row,{model:'claude-haiku-5.5',inputTokens:10,outputTokens:1,copilotUsage:{totalNanoAiu:5e7}},{id:'u1'});
  const daily=Object.entries(ledger.state.modelDaily);
  const opus=daily.find(([key])=>key.endsWith('|claude-opus-5.5'))[1],haiku=daily.find(([key])=>key.endsWith('|claude-haiku-5.5'))[1];
  assert.equal(opus.totalNanoAiu,2e9);assert.equal(opus.sdkApiCalls,1);assert.equal(haiku.totalNanoAiu,5e7);assert.equal(haiku.sdkApiCalls,1);
  assert.ok(new Ledger(file).state.modelDaily,'persisted');
});
test('Models and AI credits panel shows current models and sums both clients per model',async()=>{
  const {MODELS_SCRIPT,MODELS_HTML}=await import('./claude-gateway/../dashboard-models.mjs');
  const {DASHBOARD_HTML}=await import('./dashboard.mjs');
  assert.match(DASHBOARD_HTML,/id="model-credits"/);assert.match(DASHBOARD_HTML,/renderModelCredits\(data\)/);assert.match(MODELS_HTML,/not Copilot credits/);
  const vm=await import('node:vm');const context={Intl,Date,Math,Number,String,Map,Set,Array};vm.createContext(context);
  vm.runInContext(MODELS_SCRIPT+';this.rows=modelCreditRows;this.latest=latestModel;',context);
  const day=context.pacificDayOf(new Date());
  const data={claude:{modelDaily:[{day,model:'claude-opus-5.5',sdkApiCalls:4,aiCredits:40},{day:'1999-01-01',model:'claude-opus-5.5',sdkApiCalls:9,aiCredits:999}]},
    analytics:{modelDaily:[{day,model:'gpt-6.1-sol',sdkApiCalls:2,totalNanoAiu:12e9}]},
    records:[{client:'claude-code',receivedAt:'2026-10-15T01:00:00Z',usage:{models:[{model:'claude-haiku-5.5'}]}},
      {client:'claude-code',receivedAt:'2026-10-15T00:00:00Z',selectedModel:'claude-opus-5.5'},{receivedAt:'2026-10-15T00:30:00Z',selectedModel:'gpt-6.1-sol'}]};
  const rows=context.rows(data);
  assert.equal(JSON.stringify(rows.map(row=>[row.model,row.client,row.todayCalls,row.todayCredits])),JSON.stringify([['claude-opus-5.5','Claude Code',4,40],['gpt-6.1-sol','Codex',2,12]]));
  assert.equal(context.latest(data.records,'claude-code'),'claude-haiku-5.5');assert.equal(context.latest(data.records,'codex'),'gpt-6.1-sol');
});

test('Claude per-model daily credits reach the dashboard (key filter keeps valid day|model keys)',async()=>{
  const {gatewayVisibility}=await import('./claude-gateway/visibility.mjs');
  const state={received:0,completed:0,failed:0,usage:[],recent:[],modelDaily:{'2026-10-20|claude-opus-5.5':{sdkApiCalls:2,totalNanoAiu:3e9},'bad key':{sdkApiCalls:9}}};
  const view=gatewayVisibility({ledger:{state},runtime:{snapshot:()=>({})},models:[],turns:new Set(),server:{listening:false}});
  assert.deepEqual(view.modelDaily.map(row=>[row.day,row.model,row.sdkApiCalls,row.aiCredits]),[['2026-10-20','claude-opus-5.5',2,3]]);
});
test('session totals sum every retained day per client and session, with the per-day split',async()=>{
  const {sessionTotals}=await import('./unified-history.mjs');
  const rows=[{client:'claude-code',taskId:'a',day:'2026-10-19',sdkApiCalls:3,totalNanoAiu:10e9,creditMeteredApiCalls:3,completed:3},
    {client:'claude-code',taskId:'a',day:'2026-10-20',sdkApiCalls:2,totalNanoAiu:5e9,creditMeteredApiCalls:2,completed:2},
    {client:'codex',taskId:'a',day:'2026-10-20',sdkApiCalls:1,totalNanoAiu:1e9,creditMeteredApiCalls:1,completed:1}];
  const [claude,codex]=sessionTotals(rows);
  assert.equal(claude.client,'claude-code');assert.equal(claude.aiCredits,15);assert.equal(claude.sdkApiCalls,5);
  assert.deepEqual(claude.perDay.map(day=>[day.day,day.aiCredits]),[['2026-10-19',10],['2026-10-20',5]]);
  assert.equal(claude.firstDay,'2026-10-19');assert.equal(codex.aiCredits,1);
});
test('task cost table defaults to whole-session totals across days',async()=>{
  const {TASKS_SCRIPT,TASKS_HTML}=await import('./dashboard-tasks.mjs');
  assert.match(TASKS_HTML,/Cost per day/);assert.match(TASKS_HTML,/task-cost-search/);
  const vm=await import('node:vm');const context={Intl,Map,Set,Array,String,Number,Math,$:()=>({addEventListener(){}})};vm.createContext(context);
  vm.runInContext(TASKS_SCRIPT+';this.totals=taskTotals;this.perDay=perDayText;',context);
  const [row]=context.totals([{client:'codex',taskId:'t',day:'2026-10-19',sdkApiCalls:15,totalNanoAiu:300e9,creditMeteredApiCalls:15},
    {client:'codex',taskId:'t',day:'2026-10-20',sdkApiCalls:10,totalNanoAiu:250e9,creditMeteredApiCalls:10}]);
  assert.equal(row.sdkApiCalls,25);assert.equal(row.totalNanoAiu,550e9);assert.equal(context.perDay(row),'10-20: 250 · 10-19: 300');
});
