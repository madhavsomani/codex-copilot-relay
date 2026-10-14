import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayVisibility} from './claude-gateway/visibility.mjs';
import {claudeConnectionState,parseClaudeVersion,connectionStates} from './setup-status.mjs';
import {createSetupPortal} from './setup-server.mjs';
import {parseLaunchArguments} from './claude-gateway/launch.mjs';
import {SETUP_HTML,CLAUDE_SETUP_SCRIPT} from './setup-ui.mjs';
import vm from 'node:vm';

const now=Date.now();
const model={id:'claude-opus-5.5',name:'Claude Opus 5.5',supportedReasoningEfforts:['high'],capabilities:{}};
const fixture=()=>({server:{listening:true,address:()=>({port:4246})},runtime:{snapshot:()=>({ok:true,state:'ready',lastError:'PRIVATE_ERROR',pid:123})},
  models:[model],turns:new Set(),token:'PRIVATE_TOKEN',ledger:{state:{received:3,completed:1,failed:1,
  transport:{attempts:4,httpResponses:3,httpErrors:1,networkErrors:1},
  usage:[{model:model.id,sdkApiCalls:2,inputTokens:120,outputTokens:10,cacheReadTokens:40,cacheWriteTokens:20,totalNanoAiu:1250000000,creditReportedCalls:1,private:'PRIVATE_BUCKET'}],
  recent:[{id:'req_fixture',at:new Date(now-1000).toISOString(),status:'completed',requestedModel:'claude-opus-5-5',selectedModel:model.id,
    actualModels:[model.id],sdkApiCalls:2,inputTokens:120,outputTokens:10,totalNanoAiu:1250000000,creditReportedCalls:1,
    prompt:'PRIVATE_PROMPT',session:'PRIVATE_SESSION',error:'PRIVATE_ERROR',token:'PRIVATE_TOKEN'}]}}});

test('Claude connection visibility is projected metadata, not credentials, prompts or account state',()=>{
  const view=gatewayVisibility(fixture());
  assert.equal(view.listening,true);assert.equal(view.provider,'github-copilot-sdk');
  assert.equal(view.received,3);assert.equal(view.activeRequests,1);assert.equal(view.sdkApiCalls,2);
  assert.equal(view.aiCredits,1.25);assert.equal(view.creditReportedCalls,1);assert.equal(view.creditReporting,'partial');
  assert.equal(view.inputTokens,120);assert.equal(view.transport.attempts,4);
  assert.equal(view.recent[0].selectedModel,model.id);assert.deepEqual(view.recent[0].actualModels,[model.id]);
  assert.equal(view.lastRequestAt,new Date(now-1000).toISOString());
  assert.doesNotMatch(JSON.stringify(view),/PRIVATE|token|pid|lastError/);
  assert.equal(view.recent[0].session,null); // Only a validated one-way session hash is public.
  const unknown=fixture();unknown.ledger.state.usage[0].totalNanoAiu=null;unknown.ledger.state.usage[0].creditReportedCalls=0;
  assert.equal(gatewayVisibility(unknown).aiCredits,null);assert.equal(gatewayVisibility(unknown).creditReporting,'unreported');
  unknown.ledger.state.usage[0].totalNanoAiu=0;unknown.ledger.state.usage[0].creditReportedCalls=2;
  assert.equal(gatewayVisibility(unknown).aiCredits,0);assert.equal(gatewayVisibility(unknown).creditReporting,'reported');
});

test('Claude connection visibility bounds and sanitizes the recent request catalog',()=>{
  const f=fixture();const row=f.ledger.state.recent[0];
  f.ledger.state.recent=Array.from({length:1200},(_,index)=>({...row,at:new Date(now-index*1000).toISOString(),requestedModel:'<PRIVATE_MODEL>',actualModels:['PRIVATE MODEL'],status:'PRIVATE_STATUS'}));
  const view=gatewayVisibility(f);assert.equal(view.recent.length,20);
  assert.equal(view.recent[0].requestedModel,null);assert.equal(view.recent[0].status,'unknown');
  assert.deepEqual(view.recent[0].actualModels,[]);assert.doesNotMatch(JSON.stringify(view),/PRIVATE/);
});

test('Claude states distinguish installation, local listener and observed traffic without a fake connection',()=>{
  const installation={installed:true},gateway=gatewayVisibility(fixture());
  assert.equal(claudeConnectionState({installation,gateway,now}),'traffic-observed');
  assert.equal(claudeConnectionState({installation,gateway,now:now+120000}),'listening');
  assert.equal(claudeConnectionState({installation,gateway:{...gateway,listening:false},now}),'not-attached');
  assert.equal(claudeConnectionState({installation:{checkFailed:true},gateway:null,now}),'unknown');
  assert.equal(claudeConnectionState({installation:{installed:false},gateway:null,now}),'not-found');
  assert.equal(claudeConnectionState({installation,gateway:null,now}),'not-attached');
  assert.equal(claudeConnectionState({installation,gateway:{...gateway,sdkState:'lost'},now}),'worker-unavailable');
});

test('Claude version parsing never returns arbitrary CLI output or a login identifier',()=>{
  assert.equal(parseClaudeVersion('2.1.292 (Claude Code)\r\n'),'2.1.292');
  for(const output of ['PRIVATE_LOGIN version 2.1.292','2.1.292 PRIVATE_ERROR','<script>PRIVATE</script>',''])assert.equal(parseClaudeVersion(output),null);
});
test('Copilot authentication with only Claude access is ready, not a fabricated GPT entitlement',()=>{
  assert.equal(connectionStates({copilot:{authenticated:true,models:[],claudeModels:['claude-opus-5-5']}}).copilot,'ready');
  assert.equal(connectionStates({copilot:{authenticated:false,models:[],claudeModels:['claude-opus-5-5']}}).copilot,'sign-in');
});

test('Claude launcher setup arguments are opt-in scoped and isolate its ports',()=>{
  assert.deepEqual(parseLaunchArguments(['--port','4246','--setup-port','4247','--open-setup','--','--model','claude-opus-5-5']),
    {port:4246,setupPort:4247,openSetup:true,clientArgs:['--model','claude-opus-5-5']});
  assert.equal(parseLaunchArguments(['-p','Hello']).setupPort,0);
  assert.equal(parseLaunchArguments(['--no-setup','--','-p','Hello']).setupPort,null);
  for(const args of [['--port','4144','--'],['--setup-port','4144','--'],['--port','4246','--setup-port','4246','--'],['--port','--'],['--bogus','x','--']])
    assert.throws(()=>parseLaunchArguments(args));
});

test('same-process connection center remains read-only and publishes only projected Claude metrics',async t=>{
  const f=fixture();const portal=await createSetupPortal({port:0,root:new URL('.',import.meta.url).pathname,relayPort:4144,
    inspect:async()=>({installed:true,configured:false}),relay:async()=>null,auth:async()=>({authenticated:false,models:[]}),
    claude:async()=>({installation:{installed:true,version:'2.1.292'},gateway:gatewayVisibility(f)})});
  await portal.listen();t.after(()=>portal.close());
  const base=`http://127.0.0.1:${portal.server.address().port}`;
  const status=await (await fetch(base+'/dashboard/setup/status')).json();
  assert.equal(status.states.claude,'traffic-observed');assert.equal(status.claude.gateway.aiCredits,1.25);
  assert.doesNotMatch(JSON.stringify(status.claude),/PRIVATE/);
  const html=await (await fetch(base+'/dashboard/setup')).text();assert.match(html,/Claude Code/);assert.match(html,/Reported AI credits/);
  assert.equal((await fetch(base+'/dashboard/setup/action',{method:'POST',body:'{}'})).status,405);
  assert.equal((await fetch(base+'/dashboard/setup/status',{headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await fetch(base+'/metrics')).status,404);assert.equal((await fetch(base+'/auth.json')).status,404);
});

test('Claude setup UI uses safe text rendering and does not invent reported credit totals',()=>{
  new vm.Script(CLAUDE_SETUP_SCRIPT);assert.match(SETUP_HTML,/--no-setup/);
  assert.doesNotMatch(CLAUDE_SETUP_SCRIPT,/innerHTML|method\s*:\s*['"]POST|ANTHROPIC_AUTH_TOKEN/);
  assert.match(CLAUDE_SETUP_SCRIPT,/Unreported/);assert.match(CLAUDE_SETUP_SCRIPT,/creditReporting/);
});
test('Claude setup renders partial and unknown credits, exact routes and request failures',()=>{
  class Element{constructor(){this.dataset={};this.children=[];}append(value){this.children.push(value);}replaceChildren(){this.children=[];}}
  const nodes=new Map();let receive;
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},
    addEventListener:(_type,handler)=>receive=handler,createElement:()=>new Element()};
  vm.runInNewContext(CLAUDE_SETUP_SCRIPT,{document});
  const view=gatewayVisibility(fixture());view.recent[0].status='rejected';view.recent[0].httpStatus=409;
  receive({detail:{states:{claude:'traffic-observed'},claude:{gateway:view},copilot:{authenticated:true,models:[],claudeModels:view.models}}});
  assert.match(nodes.get('claude-credits').textContent,/1.25.*partial/);
  const cells=nodes.get('claude-recent').children[0].children.map(value=>value.textContent);
  assert.match(cells[1],/rejected.*409/);assert.equal(cells[2],'claude-opus-5-5');assert.equal(cells[3],model.id);assert.equal(cells[4],model.id);
  view.aiCredits=null;view.creditReporting='unreported';receive({detail:{states:{claude:'listening'},claude:{gateway:view}}});
  assert.equal(nodes.get('claude-credits').textContent,'Unreported');
  receive({detail:null});assert.equal(nodes.get('claude-connection-label').textContent,'Status unavailable');
  assert.equal(nodes.get('claude-recent').children.length,0);
});
