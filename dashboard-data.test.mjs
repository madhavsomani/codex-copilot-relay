import assert from 'node:assert/strict';
import test from 'node:test';
import {callRoute, sdkCredits, nativeImageStatus} from './dashboard-data.mjs';

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
