import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ProxyRecorder} from './proxy-recorder.mjs';
import {normalizeAssistantUsage,summarizeAssistantUsage} from './copilot-telemetry.mjs';
import {DASHBOARD_HTML} from './dashboard.mjs';

test('credit reporting survives normalization; absent credits do not become a reported zero',()=>{
  const zero=normalizeAssistantUsage({model:'gpt-5.6-terra',copilotUsage:{totalNanoAiu:0}});
  const missing=normalizeAssistantUsage({model:'gpt-5.6-terra',inputTokens:100});
  assert.equal(normalizeAssistantUsage(zero).creditMeteredApiCalls,1);
  assert.equal(normalizeAssistantUsage(missing).creditMeteredApiCalls,0);
  const sum=summarizeAssistantUsage([zero,missing]);
  assert.equal(sum.creditMeteredApiCalls,1); assert.equal(sum.sdkApiCalls,2);
});

test('live cumulative credits finalize exactly once; route and credits survive history downgrade/restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-dashboard-'));
  try {
    const options={filePath:path.join(dir,'history.jsonl'),limit:4,detailedLimit:1};
    const r=new ProxyRecorder(options);
    const record=r.start({body:{model:'gpt-5.6-terra'},relayVersion:'1.3.17',routingMode:'per-request'});
    const e1=normalizeAssistantUsage({model:'gpt-5.6-terra',totalNanoAiu:74800000});
    const e2=normalizeAssistantUsage({model:'gpt-5.6-terra',totalNanoAiu:25200000});
    r.usageObserved(record,e1,summarizeAssistantUsage([e1]));
    r.usageObserved(record,e2,summarizeAssistantUsage([e1,e2]));
    assert.equal(r.summary().aiCredits,0,'live usage must not increment finalized totals');
    assert.equal(r.snapshot({includeDetails:false}).records[0].usage.totalNanoAiu,100000000);
    r.finish(record,{status:'completed',selectedModel:'gpt-5.6-terra',usage:summarizeAssistantUsage([e1,e2])});
    r.finish(record,{status:'completed',usage:summarizeAssistantUsage([e1,e2])});
    const next=r.start({body:{model:'test'}}); r.finish(next,{status:'completed'}); r.compact();
    for(const recorder of [r,new ProxyRecorder(options)]) {
      const s=recorder.summary(); assert.equal(s.aiCredits,0.1); assert.equal(s.creditMeteredApiCalls,2);
      const row=recorder.snapshot({includeDetails:false}).records.find(x=>x.id===record.id);
      assert.equal(row.relayVersion,'1.3.17'); assert.equal(row.routingMode,'per-request');
      assert.equal(row.usage.totalNanoAiu,100000000); assert.equal(row.usage.creditMeteredApiCalls,2);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('inline dashboard script is valid and exposes route comparison and credits without dependencies',()=>{
  const script=DASHBOARD_HTML.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(()=>new vm.Script(script));
  for(const id of ['routing-policy','ai-credits','inspector-requested','inspector-model','inspector-reported','inspector-credits'])
    assert.ok(DASHBOARD_HTML.includes('id="'+id+'"'));
  assert.ok(DASHBOARD_HTML.includes('Lifetime reported through this relay'));
});
