import test from 'node:test';
import assert from 'node:assert/strict';
import {routeEffort,defaultEffort} from './reasoning-routing.mjs';
const astra={id:'gpt-6-astra',supportedReasoningEfforts:['low','medium','high','xhigh']};
const sol={id:'gpt-5.6-sol',supportedReasoningEfforts:['low','medium','high','xhigh','max']};
test('Astra defaults xhigh, explicit lower effort honored, Ultra capped transparently',()=>{
 assert.equal(defaultEffort(astra),'xhigh');assert.deepEqual(routeEffort('ultra',astra),{effort:'xhigh',capped:true});
 assert.deepEqual(routeEffort('low',astra),{effort:'low',capped:false});assert.equal(routeEffort(null,astra).effort,'xhigh');
});
test('Sol max and per-model defaults survive while unknown efforts fail early',()=>{
 assert.deepEqual(routeEffort('ultra',sol),{effort:'max',capped:false});assert.equal(defaultEffort(sol),'max');
 assert.throws(()=>routeEffort('turbo',astra),/Unknown reasoning/);
});
