import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRelayStopControl} from './relay-stop-control.mjs';

test('owned stop waits for requests and tool continuations; stale commands cannot stop a new instance',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'relay-stop-'));
  const file=path.join(root,'relay-stop.json');let active=1,stops=0;
  const control=createRelayStopControl({directory:root,active:()=>active,stop:()=>stops++});
  writeFileSync(file,JSON.stringify({instanceId:'old-instance'}));
  control.check();assert.equal(stops,0);
  writeFileSync(file,JSON.stringify({instanceId:control.instanceId}));
  control.check();assert.equal(stops,0);assert.equal(control.stopping,false);
  active=0;control.check();assert.equal(stops,1);assert.equal(control.stopping,true);
  assert.equal(existsSync(file),false);control.check();assert.equal(stops,1);
});
test('malformed and oversized controls fail closed and do not touch history',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'relay-stop-'));
  writeFileSync(path.join(root,'proxy-metrics.json'),'keep');
  const control=createRelayStopControl({directory:root,active:()=>0,stop:()=>assert.fail('unexpected stop')});
  for(const value of ['{', 'x'.repeat(8192), JSON.stringify({instanceId:123})]){
    writeFileSync(path.join(root,'relay-stop.json'),value);assert.doesNotThrow(()=>control.check());
  }
  assert.equal(readFileSync(path.join(root,'proxy-metrics.json'),'utf8'),'keep');
});
