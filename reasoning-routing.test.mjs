import test from 'node:test';
import assert from 'node:assert/strict';
import {routeEffort,defaultEffort} from './reasoning-routing.mjs';
const astra={id:'gpt-6-astra',supportedReasoningEfforts:['low','medium','high','xhigh']};
const sol={id:'gpt-5.6-sol',supportedReasoningEfforts:['low','medium','high','xhigh','max']};
test('Astra defaults low, explicit effort honored, Ultra capped transparently',()=>{
 assert.equal(defaultEffort(astra),'low');assert.deepEqual(routeEffort('ultra',astra),{effort:'xhigh',capped:true});
 assert.deepEqual(routeEffort('low',astra),{effort:'low',capped:false});assert.equal(routeEffort(null,astra).effort,'low');
 assert.deepEqual(routeEffort('xhigh',astra),{effort:'xhigh',capped:false});
});
test('Sol defaults low without weakening an explicit max request',()=>{
 assert.deepEqual(routeEffort('ultra',sol),{effort:'max',capped:false});assert.equal(defaultEffort(sol),'low');
 assert.throws(()=>routeEffort('turbo',astra),/Unknown reasoning/);
});
test('default effort uses a supported inexpensive level without assuming low is supported',()=>{
 assert.equal(defaultEffort({supportedReasoningEfforts:['none','high']}),'none');
 assert.equal(defaultEffort({supportedReasoningEfforts:['high','xhigh']}),'high');
 assert.equal(defaultEffort({}),'low');
});
