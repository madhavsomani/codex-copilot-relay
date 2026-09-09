import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProxyRecorder} from './proxy-recorder.mjs';
import {estimateOpenAiEquivalent} from './pricing.mjs';
import {normalizeToolOutput} from './bridge-core.mjs';

test('error summary survives repeated downgrade, index, compaction, and restart', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-regression-'));
  try {
    const options={filePath:path.join(dir,'history.jsonl'),limit:5,detailedLimit:1};
    const recorder=new ProxyRecorder(options);
    const failed=recorder.start({body:{model:'test'},inputBytes:1,streaming:false});
    recorder.finish(failed,{status:'failed',error:{message:'Network failed Bearer private-secret-value',code:'relay_task_busy'}});
    const expected=recorder.snapshot({includeDetails:false}).records[0].errorSummary;
    assert.ok(!expected.includes('private-secret-value'));
    for(let i=0;i<3;i++){const r=recorder.start({body:{model:'test'},inputBytes:1});recorder.finish(r,{status:'completed'});}
    recorder.compact();
    for(const r of [recorder,new ProxyRecorder(options)]){
      const row=r.snapshot({includeDetails:false}).records.find(x=>x.id===failed.id);
      assert.equal(row.errorSummary,expected);
      assert.equal(row.errorCode,'relay_task_busy');
      assert.equal(r.summary().failed,1);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('64 KiB tool budget preserves moderate outputs and bounds oversized UTF-8',()=>{
 const text='x'.repeat(25000)+'MIDDLE_MARKER'+'y'.repeat(25000);
 assert.equal(normalizeToolOutput({output:text}).text,text);
 const bounded=normalizeToolOutput({output:'START'+'界'.repeat(50000)+'END'}).text;
 assert.ok(Buffer.byteLength(bounded)<65536);assert.ok(bounded.startsWith('START'));assert.ok(bounded.endsWith('END'));
 assert.match(bounded,/Relay omitted/);
});

test('Astra pricing includes cache writes and long-context rates',()=>{
  const r=estimateOpenAiEquivalent([{model:'gpt-6-astra',inputTokens:300000,outputTokens:1000,cacheReadTokens:100000,cacheWriteTokens:50000}]);
  assert.equal(r.pricedApiCalls,1);
  assert.equal(r.usd,4.525);
  assert.equal(estimateOpenAiEquivalent([{model:'gpt-6-astra',inputTokens:272000,outputTokens:1000}]).usd,2.77);
});

test('unknown model variants are unpriced, not silently billed at base rates',()=>{
  const r=estimateOpenAiEquivalent([{model:'gpt-5.6-sol-fast',inputTokens:10000},{model:'gpt-6-astra-unknown',inputTokens:10000}]);
  assert.equal(r.unpricedApiCalls,2);
});
