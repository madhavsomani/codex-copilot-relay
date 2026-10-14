import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {UsageReceipts,UsageOwners} from './usage-receipts.mjs';
import {SessionLease} from './relay-session-control.mjs';
import {BlankCompletionGuard,PrematureCompletionGuard,SlidingDeadline} from './exchange-lifecycle.mjs';
import {Ledger} from './claude-gateway/ledger.mjs';
import {ProxyRecorder} from './proxy-recorder.mjs';
import {normalizeAssistantUsage,summarizeAssistantUsage} from './copilot-telemetry.mjs';

const receipt=(id='provider-one')=>({apiCallId:id,model:'gpt-6.1-sol',inputTokens:100,outputTokens:10,
  cacheReadTokens:50,copilotUsage:{totalNanoAiu:1e9}});
test('production Codex Exchange routes late receipts across tool turns and suppresses duplicate events',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relay-exchange-accounting-'));
  let exchange;
  try{
    const recorder=new ProxyRecorder({filePath:path.join(directory,'events.jsonl')});
    // Execute the actual production class, without starting a listener or SDK.
    const source=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
    const start=source.indexOf('class Exchange {'),end=source.indexOf('\nsdkRuntime = new CopilotRuntime',start);
    assert.ok(start>0&&end>start);
    const context={UsageOwners,SessionLease,BlankCompletionGuard,PrematureCompletionGuard,SlidingDeadline,
      maxBlankCompletionRetries:2,maxPrematureCompletionRetries:2,exchangeTimeoutMs:900000,toolResultTimeoutMs:46800000,
      sdkUsageReceipts:new UsageReceipts(),normalizeAssistantUsage,summarizeAssistantUsage,recorder,
      contextEventFields:()=>null,log:()=>{}};
    vm.createContext(context);
    const Exchange=vm.runInContext(source.slice(start,end)+'\nExchange',context);
    exchange=new Exchange({on:()=>()=>{}},'gpt-6.1-sol',new Map(),()=>{});
    const sink=row=>({record:row,closed:false,setUsageProvider(){},setClientDisconnectHandler(){},finishText:()=>null});
    const first=recorder.start({body:{model:'gpt-6.1-sol'}}),firstSink=sink(first);
    exchange.attachSink(firstSink);
    await exchange.handleEvent({type:'assistant.message',data:{apiCallId:'provider-one',content:'fixture reply'}});
    recorder.finish(first,{status:'completed'});firstSink.closed=true;exchange.armToolDeadline();
    assert.equal(exchange.lease.state,'waiting-for-tools');
    const second=recorder.start({body:{model:'gpt-6.1-sol'}});exchange.attachSink(sink(second));
    const event={type:'assistant.usage',id:'event-one',data:receipt()};
    await exchange.handleEvent(event);await exchange.handleEvent(event);
    assert.equal(first.usage.sdkApiCalls,1);assert.equal(exchange.currentUsage().sdkApiCalls,0);
    await exchange.handleEvent({type:'assistant.usage',id:'event-two',data:receipt('provider-two')});
    assert.equal(exchange.currentUsage().sdkApiCalls,1);assert.equal(exchange.lease.state,'streaming');
    recorder.finish(second,{status:'completed',usage:exchange.currentUsage()});
    assert.equal(recorder.metrics.lifetime.sdkApiCalls,2);assert.equal(recorder.metrics.lifetime.totalNanoAiu,2e9);
  }finally{exchange?.deadline.stop();assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});}
});
test('Codex counts a repeated provider receipt once, not equal-priced distinct calls',()=>{
  const usage=summarizeAssistantUsage([receipt(),receipt(),receipt('provider-two')]);
  assert.equal(usage.sdkApiCalls,2);assert.equal(usage.totalNanoAiu,2e9);
  assert.equal(summarizeAssistantUsage([{inputTokens:5},{inputTokens:5}]).sdkApiCalls,2);
});
test('Claude late receipt corrects task usage without recounting completed requests',()=>{
  const ledger=new Ledger(),row=ledger.start({}, {'x-claude-code-session-id':'fixture'},null);
  ledger.finish(row,'completed');ledger.usage(row,receipt());ledger.usage(row,receipt());
  ledger.usage(row,receipt('provider-two'));
  const task=ledger.state.taskDaily[0];
  assert.equal(task.totalNanoAiu,2e9);assert.equal(task.sdkApiCalls,2);
  assert.equal(task.completed,1);assert.equal(task.meteredCalls,1);assert.equal(task.unmeteredCalls,0);
  assert.equal(ledger.state.completed,1);assert.equal(ledger.state.usage[0].totalNanoAiu,2e9);
});
test('Claude late receipts do not recreate expired task buckets or switch overflow attribution',()=>{
  const ledger=new Ledger(),row=ledger.start({}, {'x-claude-code-session-id':'fixture'},null);
  ledger.finish(row,'completed');ledger.state.taskDaily=[];ledger.usage(row,receipt());
  assert.equal(ledger.state.taskDaily.length,0);assert.equal(ledger.state.usage[0].totalNanoAiu,1e9);
  const second=ledger.start({}, {'x-claude-code-session-id':'other-fixture'},null);
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date());
  ledger.state.taskDaily=Array.from({length:2048},(_,i)=>({day,taskId:i.toString(16).padStart(16,'0')}));
  ledger.finish(second,'completed');const original=ledger.state.taskDaily.find(item=>item.taskId==='unattributed');
  ledger.state.taskDaily=[original];ledger.usage(second,receipt('second'));
  assert.equal(ledger.state.taskDaily.length,1);assert.equal(original.totalNanoAiu,1e9);assert.equal(original.completed,1);
});
test('Codex late cumulative receipts reconcile task, model and lifetime totals after midnight',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relay-accounting-'));
  try{
    let now=new Date('2026-10-10T06:59:00Z');
    const recorder=new ProxyRecorder({filePath:path.join(directory,'events.jsonl'),now:()=>now});
    const row=recorder.start({body:{model:'gpt-6.1-sol'}});
    recorder.finish(row,{status:'completed'});const taskKey=Object.keys(recorder.metrics.taskDaily)[0];
    now=new Date('2026-10-10T07:01:00Z');
    const usage=summarizeAssistantUsage([receipt()]);
    recorder.usageObserved(row,receipt(),usage);recorder.usageObserved(row,receipt(),usage);
    assert.equal(recorder.metrics.lifetime.sdkApiCalls,1);assert.equal(recorder.metrics.lifetime.totalNanoAiu,1e9);
    assert.equal(recorder.metrics.lifetime.completed,1);assert.equal(recorder.metrics.lifetime.unmeteredCalls,0);
    assert.equal(recorder.metrics.taskDaily[taskKey].totalNanoAiu,1e9);
    assert.equal(Object.keys(recorder.metrics.taskDaily).length,1);
    assert.equal(recorder.metrics.models['gpt-6.1-sol'].sdkApiCalls,1);
    const restored=new ProxyRecorder({filePath:path.join(directory,'events.jsonl')});
    assert.equal(restored.metrics.lifetime.totalNanoAiu,1e9);assert.equal(restored.records[0].usage.totalNanoAiu,1e9);
  }finally{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});}
});
