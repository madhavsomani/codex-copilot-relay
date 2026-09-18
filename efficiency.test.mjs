import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sessionSignature, discoveryDecision, prepareDiscoveryContinuation, checkpointPolicy, checkpointState, toolOutputPolicy} from './efficiency-policy.mjs';
import {pacificDay, pacificDailySeries} from './usage-calendar.mjs';
import {requestTaskId, requestOwner} from './exchange-ownership.mjs';
import {normalizeToolOutput, extractToolOutputs} from './bridge-core.mjs';
import {ProxyRecorder} from './proxy-recorder.mjs';
import {summarizeAssistantUsage} from './copilot-telemetry.mjs';

const taskId = '01a0a6f3-3c1c-7c50-95f4-9f58608d52ed';
const compatibility = {model:'gpt-test', reasoningEffort:'high', sessionTools:[{name:'echo', parameters:{type:'object'}}], systemInstructions:[]};
const body = {input:[{role:'developer', content:'Preserve approval gates'}]};

test('discovery reuses only the same identified session contract', () => {
  const prior = {owner:'owner', signature:sessionSignature(body, compatibility)};
  assert.equal(discoveryDecision(prior, 'owner', body, compatibility), 'discovery_reused');
  assert.equal(discoveryDecision(prior, null, body, compatibility), 'discovery_unidentified');
  assert.equal(discoveryDecision(prior, 'other', body, compatibility), 'discovery_unidentified');
  for (const changed of [{...compatibility, sessionTools:[]}, {...compatibility, reasoningEffort:'low'}, {...compatibility, model:'other'}, {...compatibility, sessionTools:[{name:'echo', parameters:{type:'string'}}]}]) {
    assert.equal(discoveryDecision(prior, 'owner', body, changed), 'discovery_contract_changed');
  }
  assert.equal(discoveryDecision(prior, 'owner', {input:[{role:'developer',content:'New constraint'}]}, compatibility), 'discovery_contract_changed');
  assert.equal(discoveryDecision(prior, 'owner', {input:[...body.input,{role:'user',content:'Stop and change approach'}]}, compatibility), 'discovery_contract_changed');
  assert.equal(sessionSignature(body, compatibility), sessionSignature(body, {...compatibility, sessionTools:[{parameters:{type:'object'},name:'echo'}]}));
});

test('search outputs join pending calls without duplicating model-visible schemas', () => {
  assert.equal(extractToolOutputs({input:[{type:'tool_search_output',call_id:'search',tools:[]}]}).length, 1);
});

test('discovery admission preserves active streams and isolates changed catalogs', async () => {
  let disconnects = 0;
  const prior = {owner:'owner',signature:sessionSignature(body,compatibility),disconnect:async()=>{disconnects+=1;}};
  const outputs = [{type:'tool_search_output',call_id:'search'}];
  const reused = await prepareDiscoveryContinuation(outputs,[prior],'owner',body,compatibility);
  assert.equal(reused.outputs,outputs); assert.equal(disconnects,0);
  prior.sink={closed:false};
  await assert.rejects(prepareDiscoveryContinuation(outputs,[prior],'owner',body,{...compatibility,sessionTools:[]}), {statusCode:409});
  assert.equal(disconnects,0); assert.equal(prior.done,undefined);
  prior.sink=null;
  await assert.rejects(prepareDiscoveryContinuation(outputs,[prior,{}],'owner',body,compatibility),{statusCode:409});
  const changed=await prepareDiscoveryContinuation(outputs,[prior],'owner',body,{...compatibility,sessionTools:[]});
  assert.deepEqual(changed.outputs,[]); assert.equal(disconnects,1); assert.equal(prior.done,true);
});

test('task identity rejects conflicts and never uses shared cache keys', () => {
  assert.equal(requestTaskId({client_metadata:{thread_id:taskId}}), taskId);
  assert.equal(requestTaskId({prompt_cache_key:taskId}), null);
  assert.notEqual(requestOwner({client_metadata:{thread_id:taskId}}), taskId);
  assert.throws(() => requestTaskId({client_metadata:{thread_id:taskId}}, {'thread-id':'00000000-0000-0000-0000-000000000000'}));
  assert.throws(() => requestTaskId({client_metadata:{thread_id:taskId,'x-codex-turn-metadata':{thread_id:'00000000-0000-0000-0000-000000000000'}}}));
});

test('routine output is bounded while instruction reads, error status and images survive', () => {
  const routine = toolOutputPolicy({name:'exec_command',arguments:JSON.stringify({cmd:'npm test'})});
  const result = normalizeToolOutput({output:'build output '.repeat(10000),status:'error'}, routine);
  assert.ok(Buffer.byteLength(result.text) <= 16384);
  assert.match(result.text, /omitted/); assert.equal(result.failed, true);
  const instructions = toolOutputPolicy({name:'exec_command',arguments:JSON.stringify({cmd:'Get-Content SKILL.md'})});
  const text = 'Required instruction '.repeat(5000);
  assert.equal(normalizeToolOutput({output:text}, instructions).text, text);
  const image = normalizeToolOutput({output:[{type:'input_text',text:'log '.repeat(20000)},{type:'input_image',image_url:'data:image/png;base64,aGVsbG8='}]}, routine);
  assert.equal(image.binaryResultsForLlm.length, 1);
});

test('Pacific calendar handles midnight and both DST transitions without relabelling UTC totals', () => {
  assert.equal(pacificDay('2026-09-17T06:59:00Z'), '2026-09-16');
  assert.equal(pacificDay('2026-09-17T07:00:00Z'), '2026-09-17');
  for (const [day, hours, end] of [['2026-03-08',23,'2026-03-09T08:00:00Z'],['2026-11-01',25,'2026-11-02T09:00:00Z']]) {
    const rows = [];
    for(let offset=0;offset<50;offset+=1) {
      const date=new Date(Date.parse(end)-offset*3600000);
      rows.push({bucket:date.toISOString(),telemetryAvailable:true,inputTokens:1,sdkApiCalls:1});
    }
    const row=pacificDailySeries(rows, new Date(end), 2).find(row=>row.bucket===day);
    assert.equal(row.inputTokens,hours); assert.equal(row.telemetryPartial,false);
  }
  const partial=pacificDailySeries([{bucket:'2026-09-17T06:00:00Z',telemetryAvailable:true,inputTokens:9}],new Date('2026-09-17T06:30:00Z'),1)[0];
  assert.equal(partial.bucket,'2026-09-16'); assert.equal(partial.inputTokens,9); assert.equal(partial.telemetryPartial,true);
});

test('task checkpoints persist once at completion and distinguish unknown credits', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relay-efficiency-'));
  const options={filePath:path.join(directory,'records.jsonl'),now:()=>new Date('2026-09-17T06:30:00Z')};
  try {
    const recorder=new ProxyRecorder(options);
    const record=recorder.start({body:{},taskId});
    const usage=summarizeAssistantUsage([{inputTokens:100,outputTokens:10,totalNanoAiu:600e9}]);
    recorder.usageObserved(record,usage,usage);
    assert.equal(recorder.taskUsage(taskId).completed,0);
    recorder.finish(record,{status:'completed',usage}); recorder.finish(record,{status:'completed',usage});
    assert.match(recorder.costCheckpoint(taskId,checkpointPolicy()),/600.000 SDK AI credits/);
    assert.equal(recorder.costCheckpoint(taskId,checkpointPolicy()),null);
    assert.equal(recorder.costCheckpoint('another-task',checkpointPolicy()),null);
    recorder.clear();
    for(const current of [recorder,new ProxyRecorder(options)]) {
      const row=current.taskUsage(taskId);
      assert.equal(row.completed,1); assert.equal(row.sdkApiCalls,1); assert.equal(row.totalNanoAiu,600e9);
      assert.equal(current.analytics().taskDaily[0].day,'2026-09-16');
      assert.equal(checkpointState(row).creditCheckpoint,1);
      assert.equal(current.costCheckpoint(taskId,checkpointPolicy()),null);
    }
    assert.equal(checkpointState({sdkApiCalls:25,creditMeteredApiCalls:0}).aiCredits,null);
    assert.equal(checkpointState({sdkApiCalls:25,creditMeteredApiCalls:0}).stepCheckpoint,1);
    assert.equal(checkpointPolicy({BRIDGE_CHECKPOINT_STEPS:'0'}).steps,20);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
