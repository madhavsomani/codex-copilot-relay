import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mergeDashboardHistory,claudeHistoryRecord} from './unified-history.mjs';
import {Ledger} from './claude-gateway/ledger.mjs';
import {digest} from './claude-gateway/protocol.mjs';
import {createSessionNames} from './session-names.mjs';
import {callRoute} from './dashboard-data.mjs';
import {recordSessionCost,sessionHash} from './claude-gateway/session-costs.mjs';

const session='11111111-2222-3333-4444-555555555555';
const selected={model:{id:'claude-opus-5.5'},effort:'medium'};
test('one history retains both clients, real Claude model/effort and partial cost metadata',()=>{
 const ledger=new Ledger();const row=ledger.start({model:'claude-opus-5-5'},{'x-claude-code-session-id':session},selected);
 ledger.usage(row,{model:'claude-opus-5.5',inputTokens:40,outputTokens:10,cacheReadTokens:30,copilotUsage:{totalNanoAiu:2000000000}});
 ledger.usage(row,{model:'claude-opus-5.5',inputTokens:2,outputTokens:1});ledger.finish(row,'completed');
 row.privatePrompt='DO_NOT_PROJECT';row.key='DO_NOT_PROJECT';
 const view=mergeDashboardHistory({records:[{id:'resp_a',receivedAt:'2020-01-01',taskId:session}],summary:{sdkApiCalls:3,inputTokens:9,outputTokens:2},analytics:{taskDaily:[{day:'2026-10-10',taskId:session,sdkApiCalls:3}]},providers:{records:[]}},ledger.state,(client,id)=>client==='claude-code'?'Claude project':'Codex project');
 assert.equal(view.records.length,2);const call=view.records[0];assert.equal(call.client,'claude-code');assert.equal(call.sessionName,'Claude project');
 assert.equal(call.selectedReasoningEffort,'medium');assert.equal(call.usage.inputTokens,42);assert.equal(call.usage.creditMeteredApiCalls,1);assert.equal(call.usage.sdkApiCalls,2);
 assert.equal(call.dollarCost,null);assert.equal(view.unifiedCopilot.sdkApiCalls,5);assert.equal(view.taskCosts.rows.length,2);
 assert.doesNotMatch(JSON.stringify(view),/DO_NOT_PROJECT/);assert.equal(callRoute(call).changed,false);assert.match(callRoute(call).note,/ID formatting/);
 assert.equal(mergeDashboardHistory({records:[],analytics:{},providers:{}},null).records.length,0);
 assert.equal(claudeHistoryRecord({...row,completedAt:undefined}).completedAt,null,'missing legacy completion time stays unknown');
});
test('Claude session daily counters survive retention and restart without double counting',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-session-cost-'));
 try{const file=path.join(root,'ledger.json');let ledger=new Ledger(file);
 const row=ledger.start({model:'claude-opus-5-5'},{'x-claude-code-session-id':session},selected);
 ledger.usage(row,{model:'claude-opus-5.5',inputTokens:5,outputTokens:2,copilotUsage:{totalNanoAiu:0}});ledger.finish(row,'completed');ledger.finish(row,'completed');
 ledger.state.recent=[];ledger.save();ledger=new Ledger(file);
 assert.equal(ledger.state.taskDaily.length,1);assert.equal(ledger.state.taskDaily[0].completed,1);assert.equal(ledger.state.taskDaily[0].sdkApiCalls,1);assert.equal(ledger.state.taskDaily[0].creditMeteredApiCalls,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('local title resolver reads titles only, honors roots and never needs transcripts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-session-name-'));
 try{const codex=path.join(root,'codex'),claude=path.join(root,'claude');fs.mkdirSync(codex);fs.mkdirSync(path.join(claude,'projects','project',session),{recursive:true});
 fs.writeFileSync(path.join(codex,'session_index.jsonl'),JSON.stringify({id:session,thread_name:'Codex title'})+'\n');
 fs.writeFileSync(path.join(claude,'projects','project',session,'custom-title.json'),JSON.stringify({customTitle:'Claude title'}));
 const names=createSessionNames({codexHome:codex,claudeHome:claude});assert.equal(names('codex',session),'Codex title');assert.equal(names('claude-code',digest(session).slice(0,16)),'Claude title');assert.equal(names('claude-code','missing'),null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('legacy daily initialization runs once, preserves unassigned history and excludes active rows until finalization',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-legacy-cost-'));
 try{const file=path.join(root,'ledger.json'),now=new Date().toISOString();
 fs.writeFileSync(file,JSON.stringify({received:2,completed:1,failed:0,usage:[],recent:[{id:'req_old',at:now,status:'completed',sdkApiCalls:1,inputTokens:8,outputTokens:2},{id:'req_active',at:now,status:'active',session:digest(session).slice(0,16),sdkApiCalls:1,inputTokens:1,outputTokens:1}]}));
 let ledger=new Ledger(file);const totals=()=>ledger.state.taskDaily.reduce((r,x)=>r+x.completed+x.failed,0);
 assert.equal(totals(),2);assert.ok(ledger.state.taskDaily.find(r=>r.taskId==='unattributed').retainedHistoryOnly);
 ledger=new Ledger(file);assert.equal(totals(),2);assert.equal(ledger.state.failed,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('daily overflow remains counted and metadata attribution stores no raw account identity',()=>{
 const state={taskDaily:Array.from({length:2048},(_,i)=>({day:'2026-10-10',taskId:i.toString(16).padStart(16,'0')}))};
 recordSessionCost(state,{at:'2026-10-10T09:00:00Z',session:'ffffffffffffffff',status:'completed',sdkApiCalls:1,totalNanoAiu:100,creditReportedCalls:1});
 const overflow=state.taskDaily.find(r=>r.taskId==='unattributed');assert.equal(overflow.completed,1);assert.equal(overflow.totalNanoAiu,100);assert.equal(overflow.attributionOverflow,true);
 assert.equal(sessionHash({},{metadata:{user_id:JSON.stringify({session_id:session,account:'PRIVATE'})}}),digest(session).slice(0,16));
 assert.equal(sessionHash({},{metadata:{user_id:'PRIVATE'}}),null);
});
