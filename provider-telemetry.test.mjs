import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderTelemetry,normalizeProviderUsage,nativeFeatureError} from './provider-telemetry.mjs';
import {ProviderUsageObserver} from './provider-usage-observer.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

test('missing counters remain unknown; cached and audio tokens are subsets',()=>{
  const u=normalizeProviderUsage({input_tokens:100,output_tokens:30,input_token_details:{cached_tokens:40,audio_tokens:80},output_token_details:{audio_tokens:20}});
  assert.equal(u.inputTokens,100);assert.equal(u.cachedInputTokens,40);assert.equal(u.inputAudioTokens,80);assert.equal(u.outputAudioTokens,20);
  assert.equal(u.reasoningTokens,null);assert.equal(normalizeProviderUsage({input_tokens:null}).inputTokens,null);
});
test('durable provider mileage is isolated, deduplicated and body-free',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'provider-ledger-test-'));
  try{const ledger=new ProviderTelemetry({directory,limit:2});
    const r=ledger.start({provider:'openai-codex',kind:'image',model:'gpt-6-astra',prompt:'DO_NOT_STORE'});ledger.submitted(r);
    ledger.usage(r,{input_tokens:12,output_tokens:3},{key:'one',source:'native_helper_turn',complete:false});
    ledger.usage(r,{input_tokens:12,output_tokens:3},{key:'one'});ledger.finish(r);
    const p=ledger.start({provider:'openai-platform',kind:'voice'});ledger.submitted(p);ledger.finish(p,{error:{code:'insufficient_quota'},statusCode:429,status:'failed'});
    const l=ledger.start({provider:'openai-codex',kind:'search'});ledger.finish(l);
    const next=new ProviderTelemetry({directory,limit:2});assert.equal(next.records.length,2);
    assert.equal(next.total('openai-codex').inputTokens,12);assert.equal(next.total('openai-platform').inputTokens,null);
    assert.equal(next.total('openai-platform').limited,1);assert.equal(next.total('openai-codex').limited,0);
    assert.equal(next.observedLimits['openai-platform'].state,'quota_exhausted');
    assert.doesNotMatch(fs.readFileSync(next.file,'utf8'),/DO_NOT_STORE|prompt|apiKey/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('native feature failures instruct the caller to continue independent Copilot work',()=>{
  const failure=nativeFeatureError({message:'usage limit reached'});assert.equal(failure.code,'quota_exhausted');
  assert.equal(failure.retryable,false);assert.match(failure.message,/Continue independent work with Copilot/);
});
test('JSON observer ignores image/audio/prompt bodies but reads trailing usage',async()=>{
  const events=[];const observer=new ProviderUsageObserver('application/json',event=>events.push(event));
  const text=JSON.stringify({id:'resp_image',object:'response',output:[{result:'x'.repeat(2_500_000),text:'SECRET'}],usage:{input_tokens:10,output_tokens:7}});
  for(let i=0;i<text.length;i+=9999)await observer.chunk(Buffer.from(text.slice(i,i+9999)));await observer.end();
  assert.equal(events.length,1);assert.equal(events[0].usage.output_tokens,7);assert.equal(events[0].output,undefined);
  assert.ok(JSON.stringify(events).length<200);
});
test('SSE observation survives every single-byte split, repeated frames and CRLF',async()=>{
  const events=[];const observer=new ProviderUsageObserver('text/event-stream',e=>events.push(e));
  const text='event: response.completed\r\ndata: '+JSON.stringify({type:'response.completed',response:{id:'resp_x',usage:{input_tokens:42,output_tokens:0}}})+'\r\n\r\ndata: [DONE]\r\n\r\n';
  for(const byte of Buffer.from(text))await observer.chunk(Buffer.from([byte]));await observer.end();
  assert.equal(events.length,1);assert.equal(events[0].response.usage.input_tokens,42);
});
test('legacy native calls import once without inventing image token counts',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'provider-legacy-test-'));
  try{const file=path.join(directory,'events.log');fs.writeFileSync(file,[
    {timestamp:'2026-09-10T12:00:00Z',type:'native_tool.started',kind:'image'},
    {timestamp:'2026-09-10T12:00:30Z',type:'native_tool.completed',kind:'image',model:'gpt-image-2'},
    {timestamp:'2026-09-10T12:01:00Z',type:'native_tool.completed',kind:'search',usage:{input_tokens:40,output_tokens:2}},
  ].map(e=>JSON.stringify(e)).join('\n'));
    const ledger=new ProviderTelemetry({directory});await ledger.importLegacy(file);await ledger.importLegacy(file);
    assert.equal(ledger.records.length,2);assert.equal(ledger.records[0].usage.inputTokens,null);
    assert.equal(ledger.records[0].source,'legacy-log');assert.equal(ledger.total('openai-codex').inputTokens,40);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
