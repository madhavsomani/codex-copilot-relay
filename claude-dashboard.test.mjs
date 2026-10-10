import test from 'node:test';
import assert from 'node:assert/strict';
import {mountClaudeGateway} from './unified-gateway.mjs';
import {Ledger} from './claude-gateway/ledger.mjs';
import {gatewayVisibility} from './claude-gateway/visibility.mjs';
import {DASHBOARD_HTML} from './dashboard.mjs';

const selected={model:{id:'claude-opus-5.5'},effort:'high'};
function fixture(){return {ledger:new Ledger(),runtime:{snapshot:()=>({state:'ready'})},models:[],turns:new Set(),
  mountPort:4144,mountedListening:true,close:async()=>{}};}

test('Claude live events have stable request IDs, real transport phases and receipt coverage, without private fields',async()=>{
  const gateway=fixture(),events=[];
  const mount=await mountClaudeGateway({start:async()=>gateway});
  const unsubscribe=mount.subscribe(event=>events.push(event));
  const row=gateway.ledger.start({model:'claude-opus-5-5'},{'x-claude-code-session-id':'PRIVATE_SESSION'},null);
  row.prompt='PRIVATE_PROMPT';row.token='PRIVATE_TOKEN';
  gateway.ledger.select(row,{model:'claude-opus-5-5'},selected);
  gateway.ledger.transport(row,{type:'relay_transport_attempt'});
  gateway.ledger.usage(row,{model:selected.model.id,inputTokens:30,outputTokens:4});
  gateway.ledger.usage(row,{model:selected.model.id,inputTokens:10,outputTokens:2,copilotUsage:{totalNanoAiu:0}});
  gateway.ledger.finish(row,'completed');
  assert.deepEqual(events.map(e=>e.type),['relay.received','relay.selected','relay.forwarded','relay.usage','relay.usage','relay.completed']);
  assert.ok(events.every(e=>e.record.id===row.id&&e.record.client==='claude-code'));
  assert.equal(events[3].record.usage.totalNanoAiu,null);
  const last=events.at(-1).record;
  assert.equal(last.usage.inputTokens,40);assert.equal(last.usage.outputTokens,6);
  assert.equal(last.usage.creditMeteredApiCalls,1);assert.equal(last.usage.sdkApiCalls,2);
  assert.equal(last.usage.totalNanoAiu,0);assert.equal(last.requestPath,'/claude/v1/messages');
  assert.ok(last.latencyMs>=0);assert.doesNotMatch(JSON.stringify(events),/PRIVATE/);
  unsubscribe();gateway.ledger.start({}, {},null);assert.equal(events.length,6);
});

test('dashboard observer failure never aborts Claude work and retained rows are safe to identify',async()=>{
  const gateway=fixture(),mount=await mountClaudeGateway({start:async()=>gateway,log:()=>{throw new Error('closed console');}});
  mount.subscribe(()=>{throw new Error('closed browser');});
  let row;
  assert.doesNotThrow(()=>{row=gateway.ledger.start({model:'claude-opus-5-5'},{},selected);gateway.ledger.finish(row,'failed');});
  const view=gatewayVisibility(gateway);
  assert.equal(view.recent[0].id,row.id);assert.ok(view.recent[0].durationMs>=0);
});

test('Control Room preserves Codex history and adds a bounded Claude branch, client identity and honest usage scope',()=>{
  for(const id of ['route-claude-journey','inspector-client','claude-gateway-activity','claude-live-status','claude-request-rows'])
    assert.ok(DASHBOARD_HTML.includes('id="'+id+'"'),id);
  assert.match(DASHBOARD_HTML,/renderClaudeGateway\(data\.claude\)/);
  assert.match(DASHBOARD_HTML,/call\.client === "claude-code"/);
  assert.match(DASHBOARD_HTML,/GUI identity is not attested/);
  assert.match(DASHBOARD_HTML,/Codex metrics below/);
  assert.match(DASHBOARD_HTML,/slice\(0, 20\)/);
  assert.doesNotMatch(DASHBOARD_HTML,/<script\s+src=/i);
  assert.match(DASHBOARD_HTML,/Claude Code App/);
  assert.match(DASHBOARD_HTML,/id="route-claude-tool-journey"/);
  assert.match(DASHBOARD_HTML,/>Tools<\/text>/);
  assert.doesNotMatch(DASHBOARD_HTML,/>Codex tools<\/text>/);
  assert.match(DASHBOARD_HTML,/launchTransitGlyph\(toolPath/);
  assert.match(DASHBOARD_HTML,/title = "Tool call returned to " \+ client/);
});

test('Claude tool handoffs are client-scoped metadata and do not invent historical counts',async()=>{
  const gateway=fixture(),events=[];
  const mount=await mountClaudeGateway({start:async()=>gateway});mount.subscribe(e=>events.push(e));
  const row=gateway.ledger.start({model:'claude-opus-5-5'},{},selected);
  row.privateToolArguments='PRIVATE_TOOL_DATA';
  gateway.ledger.toolSignal(row,'tool_requested');gateway.ledger.toolSignal(row,'tool_resolved');
  gateway.ledger.finish(row,'completed');gateway.ledger.toolSignal(row,'tool_requested');
  assert.deepEqual(events.map(e=>e.type),['relay.received','relay.tool_requested','relay.tool_resolved','relay.completed']);
  assert.equal(events.at(-1).record.toolRequests,1);assert.equal(events.at(-1).record.toolResults,1);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_TOOL_DATA/);
  delete row.toolRequests;delete row.toolResults;
  assert.equal(gatewayVisibility(gateway).recent[0].toolRequests,null);
  const pending=gateway.ledger.start({}, {},null);
  gateway.ledger.onChange=()=>{throw new Error('observer down');};
  assert.doesNotThrow(()=>gateway.ledger.toolSignal(pending,'tool_requested'));
});
