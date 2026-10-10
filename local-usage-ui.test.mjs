import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as ui from './setup-ui.mjs';

class Element {
  constructor(){this.children=[];this.dataset={};this.textContent='';}
  append(...values){this.children.push(...values);} replaceChildren(...values){this.children=[...values];}
  setAttribute(key,value){this[key]=value;}
}
async function render(view,{failed=false}={}){
  const nodes=new Map(),intervals=[],requests=[];
  const document={hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},
    createElement:()=>new Element()};
  const context={document,AbortSignal,setInterval:(fn,ms)=>intervals.push({fn,ms}),fetch:async(url,options)=>{requests.push({url,options});
    return {ok:!failed,json:async()=>view};}};
  assert.equal(typeof ui.LOCAL_USAGE_SCRIPT,'string');vm.runInNewContext(ui.LOCAL_USAGE_SCRIPT,context);
  await new Promise(resolve=>setImmediate(resolve));return {nodes,intervals,requests,document};
}
const view=()=>({sampledAt:'2026-10-07T13:00:00.000Z',scanStatus:'partial',scope:'This checkout only; copied histories may overlap.',truncated:false,
  sources:[{id:'claude-code:4257',client:'claude-code',port:4257,status:'available',provider:'github-copilot-sdk',liveness:'not-verified',
    received:3,completed:1,failed:1,unfinishedRecorded:1,sdkApiCalls:4,usageReportedCalls:4,inputTokens:120,outputTokens:10,
    aiCredits:1.25,creditReportedCalls:2,creditReporting:'partial',usageReporting:'receipt-subtotal',modelAttribution:'SDK usage receipts',
    models:[{model:'claude-opus-5.5',sdkApiCalls:4,inputTokens:120,outputTokens:10,aiCredits:1.25,creditReporting:'partial'}]},
    {id:'codex-desktop:provider-telemetry.json',status:'unavailable',client:'codex-desktop'}],
  providers:[{provider:'github-copilot-sdk',sourceCount:1,received:3,completed:1,failed:1,sdkApiCalls:4,inputTokens:120,outputTokens:10,
    aiCredits:1.25,creditReportedCalls:2,creditReporting:'partial',usageReporting:'receipt-subtotal'},
    {provider:'openai-codex',sourceCount:1,received:2,completed:1,failed:1,sdkApiCalls:null,inputTokens:20,outputTokens:null,
    aiCredits:null,creditReporting:'not-applicable',usageReportedCalls:1,usageReporting:'receipt-subtotal'}]});
function cells(body){return body.children.map(row=>row.children.map(cell=>cell.textContent));}
test('saved usage script is text-only, scoped and independent from live connection status',()=>{
  assert.equal(typeof ui.LOCAL_USAGE_SCRIPT,'string');new vm.Script(ui.LOCAL_USAGE_SCRIPT);
  assert.match(ui.SETUP_HTML,/Saved local usage/);assert.match(ui.SETUP_HTML,/not a live connection/i);
  assert.doesNotMatch(ui.LOCAL_USAGE_SCRIPT,/innerHTML|insertAdjacentHTML|relay-setup-status|method\s*:\s*['"]POST|https?:\/\//);
  assert.match(ui.LOCAL_USAGE_SCRIPT,/10000/);
  assert.match(ui.LOCAL_USAGE_HTML,/min-width:860px/);assert.match(ui.LOCAL_USAGE_HTML,/tabindex="0"/);
});
test('saved usage renders separate provider subtotals, partial credits and unfinished-not-live counters',async()=>{
  const r=await render(view()),providers=cells(r.nodes.get('local-usage-providers')),sources=cells(r.nodes.get('local-usage-sources'));
  assert.match(providers[0].join(' '),/GitHub Copilot.*1.25.*partial.*2.*4/);
  assert.match(providers[1][0],/OpenAI/);assert.equal(providers[1][4],'Unreported');assert.equal(providers[1][5],'Not applicable');
  assert.match(sources[0].join(' '),/Claude Code.*4257.*1.*not live.*SDK usage receipts/i);
  assert.match(sources[1].join(' '),/Unavailable/);assert.match(r.nodes.get('local-usage-scope').textContent,/copied histories/i);
  assert.equal(r.requests[0].url,'/dashboard/setup/usage');assert.equal(r.intervals[0].ms,10000);
  r.document.hidden=true;await r.intervals[0].fn();assert.equal(r.requests.length,1);
});
test('unknown, explicit zero, empty, failed and bounded views never imply a free call or connected gateway',async()=>{
  const v=view();v.providers[0].aiCredits=0;v.providers[0].creditReporting='reported';
  let r=await render(v);assert.match(cells(r.nodes.get('local-usage-providers'))[0].join(' '),/0.*reported/);
  v.providers[0].aiCredits=null;v.providers[0].creditReporting='unreported';r=await render(v);
  assert.match(cells(r.nodes.get('local-usage-providers'))[0].join(' '),/Unreported/);
  r=await render({...v,scanStatus:'empty',sources:[],providers:[]});assert.match(r.nodes.get('local-usage-state').textContent,/No saved/i);
  r=await render(v,{failed:true});assert.match(r.nodes.get('local-usage-state').textContent,/Unavailable/i);
  assert.equal(r.nodes.get('local-usage-providers').children.length,0);
  v.sources=Array.from({length:80},()=>({...view().sources[0],models:Array.from({length:40},()=>({model:'<img onerror=PRIVATE>',sdkApiCalls:1}))}));
  r=await render(v);assert.ok(r.nodes.get('local-usage-sources').children.length<=32);
  assert.ok(r.nodes.get('local-usage-models').children.length<=512);
});
