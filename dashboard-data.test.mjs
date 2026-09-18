import assert from 'node:assert/strict';
import test from 'node:test';
import {callRoute, sdkCredits, nativeImageStatus, callTokenUsage} from './dashboard-data.mjs';

test('native image status is independent of the disabled legacy search flag',()=>{
  assert.equal(nativeImageStatus({enabled:false,imageEnabled:true}),'Images enabled · native search removed');
  assert.equal(nativeImageStatus({enabled:true,imageEnabled:false}),'Images disabled · native search removed');
  assert.equal(nativeImageStatus({enabled:true}),'Image status unavailable');
});

test('historical Terra to Astra routing remains distinct from current policy', () => {
  const r = callRoute({requestedModel:'gpt-5.6-terra',selectedModel:'gpt-6-astra',receivedAt:'2026-09-08T12:00:00Z'},
    {startedAt:'2026-09-09T12:00:00Z',routing:{mode:'per-request'}});
  assert.equal(r.requested,'gpt-5.6-terra'); assert.equal(r.selected,'gpt-6-astra');
  assert.equal(r.changed,true); assert.match(r.note,/earlier relay run/);
});
test('pending selection is never presented as actual inference', () => {
  const r=callRoute({requestedModel:'gpt-5.6-terra'});
  assert.equal(r.selected,null); assert.match(r.note,/Awaiting/);
});
test('SDK-reported model stays separate from the requested and selected model', () => {
  const r=callRoute({requestedModel:'gpt-5.6-sol',selectedModel:'gpt-6-astra',continuedFrom:'resp_1',
    usage:{models:[{model:'sdk-reported-model'}]}});
  assert.match(r.note,/Continued/); assert.deepEqual(r.reported,['sdk-reported-model']);
});
test('credits use nano-AIU only, distinguishing missing data from reported zero', () => {
  assert.equal(sdkCredits({totalNanoAiu:74800000}),0.0748);
  assert.equal(sdkCredits({totalNanoAiu:272827570899000}),272827.570899);
  assert.equal(sdkCredits({totalNanoAiu:0,creditMeteredApiCalls:1}),0);
  assert.equal(sdkCredits({totalNanoAiu:0}),null);
  assert.equal(sdkCredits({copilotCostUnits:100,apiEquivalentUsd:42}),null);
  assert.equal(sdkCredits({totalNanoAiu:-1}),null);
});

test('per-call tokens include cached input once and do not add reasoning or cache writes again', () => {
  assert.deepEqual(callTokenUsage({metered:true,inputTokens:166078,outputTokens:346,
    cacheReadTokens:162517,cacheWriteTokens:3558,reasoningTokens:140,sdkApiCalls:1}), {
    totalTokens:166424,inputTokens:166078,outputTokens:346,cachedInputTokens:162517,
    nonCachedInputTokens:3561,sdkApiCalls:1,
  });
});

test('per-call token reporting distinguishes unavailable counts from measured zero', () => {
  const missing = {totalTokens:null,inputTokens:null,outputTokens:null,cachedInputTokens:null,nonCachedInputTokens:null,sdkApiCalls:null};
  assert.deepEqual(callTokenUsage(),missing);
  assert.deepEqual(callTokenUsage(null),missing);
  assert.deepEqual(callTokenUsage({metered:false,inputTokens:0,outputTokens:0,cacheReadTokens:0,sdkApiCalls:0}),missing);
  assert.deepEqual(callTokenUsage({metered:true,inputTokens:0,outputTokens:0,cacheReadTokens:0,sdkApiCalls:1}),
    {...missing,totalTokens:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,nonCachedInputTokens:0,sdkApiCalls:1});
  assert.deepEqual(callTokenUsage({metered:true,inputTokens:100}),{...missing,inputTokens:100});
});

test('per-call tokens preserve aggregates over multiple SDK calls and reject invalid counts', () => {
  const aggregate = callTokenUsage({metered:true,inputTokens:3100,outputTokens:310,cacheReadTokens:2400,sdkApiCalls:3});
  assert.equal(aggregate.totalTokens,3410);
  assert.equal(aggregate.nonCachedInputTokens,700);
  assert.equal(aggregate.sdkApiCalls,3);
  const invalid = callTokenUsage({metered:true,inputTokens:-1,outputTokens:Infinity,cacheReadTokens:NaN,sdkApiCalls:-1});
  assert.ok(Object.values(invalid).every(value=>value===null));
  assert.equal(callTokenUsage({metered:true,inputTokens:10,cacheReadTokens:11}).nonCachedInputTokens,null);
});
