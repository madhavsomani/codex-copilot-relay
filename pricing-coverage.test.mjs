import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ProxyRecorder} from './proxy-recorder.mjs';
import {summarizeAssistantUsage} from './copilot-telemetry.mjs';
test('pricing coverage and partial lifetime totals persist without backfilling legacy calls',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-price-coverage-'));
 try {
  const options={filePath:path.join(dir,'events.jsonl')};const recorder=new ProxyRecorder(options);
  for(const model of ['gpt-6-astra','not-priced']) {
   const usage=summarizeAssistantUsage([{model,inputTokens:1000,outputTokens:100}]);
   const row=recorder.start({body:{model},inputBytes:1});recorder.finish(row,{status:'completed',selectedModel:model,usage});
  }
  for(const r of [recorder,new ProxyRecorder(options)]){
   const s=r.summary();assert.equal(s.sdkApiCalls,2);assert.equal(s.pricedApiCalls,1);assert.equal(s.unpricedApiCalls,1);assert.equal(s.apiEquivalentUsd,0.015);
  }
  const mf=path.join(dir,'proxy-metrics.json');const legacy=JSON.parse(fs.readFileSync(mf));
  delete legacy.lifetime.pricedApiCalls;delete legacy.lifetime.unpricedApiCalls;fs.writeFileSync(mf,JSON.stringify(legacy));
  const reloaded=new ProxyRecorder(options).summary();assert.equal(reloaded.pricingUnknownApiCalls,2);assert.equal(reloaded.apiEquivalentUsd,0.015);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
