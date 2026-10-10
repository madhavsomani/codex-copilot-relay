import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {startSdkGateway} from './claude-gateway/server.mjs';
import {acquireRuntimeLease,defaultRuntimeDirectory} from './claude-gateway/runtime-lease.mjs';

const models=[{id:'claude-opus-5.5',name:'Claude Opus 5.5',capabilities:{}}];
const token='fixture-local-token-not-service-auth';
function runtime(){return {started:0,stopped:0,snapshot:()=>({ok:true,state:'ready'}),start:async function(){this.started++;},
  ready:async()=>({listModels:async()=>models}),stop:async function(){this.stopped++;}};}
function folder(t){const root=mkdtempSync(path.join(os.tmpdir(),'claude-ownership-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}

test('Claude default runtime preserves prior 4246 history and separates other ports',()=>{
  const main=defaultRuntimeDirectory(4246),other=defaultRuntimeDirectory(4248);
  assert.match(main,/runtime[\\/]claude-preview$/);assert.notEqual(main,other);
  assert.equal(defaultRuntimeDirectory(4248),other);assert.throws(()=>defaultRuntimeDirectory(0));
});
test('Claude competing runtime writer is refused before ledger recovery or SDK startup',async t=>{
  const root=folder(t),firstRuntime=runtime();
  const first=await startSdkGateway({token,port:0,runtimeDirectory:root,runtimeFactory:()=>firstRuntime});t.after(()=>first.close());
  const row=first.ledger.start({model:'claude-opus-5-5'},{},null);
  const file=path.join(root,'ledger.json'),before=readFileSync(file,'utf8');let factoryCalls=0;
  await assert.rejects(startSdkGateway({token,port:0,runtimeDirectory:root,runtimeFactory:()=>{factoryCalls++;return runtime();}}),/already owned/i);
  assert.equal(readFileSync(file,'utf8'),before);assert.equal(first.ledger.state.recent[0].status,'active');assert.equal(factoryCalls,0);
  first.ledger.finish(row,'completed');await first.close();await first.close();assert.equal(firstRuntime.stopped,1);
  const next=await startSdkGateway({token,port:0,runtimeDirectory:root,runtimeFactory:()=>runtime()});
  assert.equal(next.ledger.state.received,1);assert.equal(next.ledger.state.completed,1);assert.equal(next.ledger.state.failed,0);await next.close();
});
test('Claude independent runtime directories can own simultaneous gateways without losing counters',async t=>{
  const root=folder(t),left=await startSdkGateway({token,port:0,runtimeDirectory:path.join(root,'left'),runtimeFactory:()=>runtime()});
  const right=await startSdkGateway({token,port:0,runtimeDirectory:path.join(root,'right'),runtimeFactory:()=>runtime()});
  t.after(()=>Promise.all([left.close(),right.close()]));assert.notEqual(left.server.address().port,right.server.address().port);
  for(let i=0;i<3;i++)left.ledger.finish(left.ledger.start({}, {}, null),'completed');
  right.ledger.finish(right.ledger.start({}, {}, null),'rejected');
  assert.equal(JSON.parse(readFileSync(path.join(root,'left','ledger.json'))).received,3);
  assert.equal(JSON.parse(readFileSync(path.join(root,'right','ledger.json'))).received,1);
  assert.equal(left.ledger.state.failed,0);assert.equal(right.ledger.state.completed,0);
});
test('Claude ownership releases on SDK start and listener failure without rewriting user config',async t=>{
  const root=folder(t),failedRuntime=runtime();failedRuntime.start=async()=>{throw new Error('fixture-startup');};
  await assert.rejects(startSdkGateway({token,port:0,runtimeDirectory:root,runtimeFactory:()=>failedRuntime}),/fixture-startup/);
  assert.equal(failedRuntime.stopped,1);const lease=acquireRuntimeLease(root);lease.release();
  const occupied=http.createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const failedBind=runtime();await assert.rejects(startSdkGateway({token,port:occupied.address().port,runtimeDirectory:root,runtimeFactory:()=>failedBind}),error=>error.code==='EADDRINUSE');
  assert.equal(failedBind.stopped,1);const next=acquireRuntimeLease(root);next.release();
});
test('Claude lease never removes a replaced ownership file and stale ownership fails closed',t=>{
  const root=folder(t),lease=acquireRuntimeLease(root),file=path.join(root,'gateway.owner.json');
  writeFileSync(file,JSON.stringify({version:1,pid:process.pid,owner:'different-fixture-owner'}));lease.release();
  assert.equal(existsSync(file),true);assert.throws(()=>acquireRuntimeLease(root),/already owned/i);
});
test('Claude malformed persisted ledger releases startup ownership and never deletes the ledger',async t=>{
  const root=folder(t),file=path.join(root,'ledger.json');writeFileSync(file,'{fixture-malformed');let started=false;
  await assert.rejects(startSdkGateway({token,port:0,runtimeDirectory:root,runtimeFactory:()=>{started=true;return runtime();}}),SyntaxError);
  assert.equal(started,false);assert.equal(readFileSync(file,'utf8'),'{fixture-malformed');
  const lease=acquireRuntimeLease(root);lease.release();
});
test('Claude exclusive runtime ownership holds across separate operating-system processes',async t=>{
  const root=folder(t),module=pathToFileURL(path.resolve('claude-gateway/runtime-lease.mjs')).href;
  const script=`import {acquireRuntimeLease} from ${JSON.stringify(module)};const lease=acquireRuntimeLease(process.argv[1]);console.log('OWNED');process.on('SIGTERM',()=>{lease.release();process.exit(0)});setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');t.after(async()=>{if(child.exitCode===null){child.kill();await exited;}});
  let output='';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture ownership startup timed out')),5000);
    child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);if(!output.includes('OWNED'))reject(new Error('Fixture exited before acquiring ownership'));});
    child.stdout.on('data',value=>{output+=value;if(output.includes('OWNED')){clearTimeout(timer);resolve();}});});
  assert.throws(()=>acquireRuntimeLease(root),/already owned/i);child.kill();await exited;
});
