import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as launcher from './claude-gateway/launch.mjs';
import {inspectClaudeInstallation} from './setup-status.mjs';
import path from 'node:path';

// The initial red run replaced imports/process only in memory. Final tests use
// the actual module's API-only dependencies; no SDK/socket is started by mocks.
function fixture({missingClient=false,signalAt=null,portalFailure=null,gatewayFailure=false,clientCode=0,spawnFailure=false}={}){
  const signals=new EventEmitter();Object.assign(signals,{env:{},platform:'linux',argv:[]});
  const calls={start:0,spawn:0,inspect:0,settings:0,gatewayClose:0,portalClose:0,kill:0};const logs=[];
  const gateway={models:[{id:'claude-opus-5.5',name:'Claude Opus 5.5',capabilities:{}}],ledger:{},
    server:{address:()=>({port:4257})},close:async()=>{calls.gatewayClose++;if(gatewayFailure)throw new Error('PRIVATE_GATEWAY_FAILURE');}};
  const preflightSettings=async()=>{calls.settings++;if(signalAt==='settings')signals.emit('SIGINT');};
  const inspectClient=async()=>{calls.inspect++;if(signalAt==='inspect')signals.emit('SIGTERM');return missingClient?{installed:false}:{installed:true,version:'2.1.292'};};
  const startGateway=async()=>{calls.start++;if(signalAt==='gateway')signals.emit('SIGTERM');return gateway;};
  const createPortal=async()=>({listen:async()=>{if(signalAt==='portal')signals.emit('SIGINT');if(portalFailure==='listen')throw new Error('PRIVATE_LISTEN_FAILURE');return 'http://127.0.0.1:4259';},
    close:async()=>{calls.portalClose++;if(portalFailure==='close')throw new Error('PRIVATE_PORTAL_FAILURE');}});
  const spawnClient=()=>{calls.spawn++;const child=new EventEmitter();child.kill=()=>{calls.kill++;queueMicrotask(()=>child.emit('exit',null,'SIGTERM'));return true;};
    queueMicrotask(()=>{if(spawnFailure)child.emit('error',new Error('PRIVATE_SPAWN_CREDENTIAL'));else if(signalAt==='client')signals.emit('SIGTERM');else child.emit('exit',clientCode);});return child;};
  const options={signals,environment:{},checkDependencies:()=>launcher.assertDependencies('0.35.5'),preflightSettings,inspectClient,startGateway,createPortal,spawnClient,log:value=>logs.push(value)};
  return {api:launcher,options,calls,signals,logs};
}

test('Claude rejects repeated and conflicting launcher options in either order',()=>{
  for(const args of [['--no-setup','--setup-port','4253','--'],['--setup-port','4253','--no-setup','--'],
    ['--port','4251','--port','4252','--'],['--open-setup','--open-setup','--'],['--no-setup','--no-setup','--']])
    assert.throws(()=>launcher.parseLaunchArguments(args));
  assert.deepEqual(launcher.parseLaunchArguments(['--port','4257','--no-setup','--','--model','claude-haiku-4-5','--print','hello']),
    {port:4257,setupPort:null,openSetup:false,clientArgs:['--model','claude-haiku-4-5','--print','hello']});
  assert.deepEqual(launcher.parseLaunchArguments(['--print','hello']).clientArgs,['--print','hello']);
});

test('Claude missing client is rejected before any SDK factory starts',async()=>{
  const f=fixture({missingClient:true});
  await assert.rejects(f.api.launch(['--no-setup','--'],f.options));
  assert.equal(f.calls.start,0);assert.equal(f.calls.spawn,0);assert.equal(f.calls.inspect,1);
});

test('Claude catches startup signals and never starts the client afterward',async()=>{
  for(const signalAt of ['settings','inspect','gateway','portal']){
    const f=fixture({signalAt});assert.equal(await f.api.launch(signalAt==='portal'?['--']:['--no-setup','--'],f.options),130,signalAt);
    assert.equal(f.calls.spawn,0,signalAt);assert.equal(f.calls.gatewayClose,f.calls.start,signalAt);
    assert.equal(f.signals.listenerCount('SIGTERM'),0);assert.equal(f.signals.listenerCount('SIGINT'),0);
    if(['settings','inspect'].includes(signalAt))assert.equal(f.calls.start,0);
  }
});

test('Claude observer close failure cannot skip gateway cleanup',async()=>{
  const f=fixture({portalFailure:'close'});assert.equal(await f.api.launch(['--'],f.options),0);
  assert.equal(f.calls.gatewayClose,1);assert.equal(f.calls.portalClose,1);
  assert.doesNotMatch(f.logs.join('\n'),/PRIVATE/);
});

test('Claude CLI diagnostics do not trust raw error messages or publicMessage from dependencies',()=>{
  const f=fixture();assert.equal(typeof f.api.safeLaunchMessage,'function');
  for(const error of [new Error('PRIVATE_CREDENTIAL'),{message:'PRIVATE_BODY',publicMessage:'PRIVATE_TOKEN'},null])
    assert.doesNotMatch(f.api.safeLaunchMessage(error),/PRIVATE/);
});

test('Claude ordinary exit, client cancellation and spawn errors all close the owned gateway',async()=>{
  for(const spec of [{clientCode:7},{signalAt:'client'},{spawnFailure:true}]){
    const f=fixture(spec);const run=f.api.launch(['--no-setup','--'],f.options);
    if(spec.spawnFailure)await assert.rejects(run);else assert.equal(await run,spec.signalAt?130:7);
    assert.equal(f.calls.gatewayClose,1);assert.equal(f.signals.listenerCount('SIGTERM'),0);
    if(spec.signalAt)assert.equal(f.calls.kill,1);
  }
});

test('Claude observer startup conflict is optional and gateway close failure is not reported as success',async()=>{
  const optional=fixture({portalFailure:'listen'});assert.equal(await optional.api.launch(['--'],optional.options),0);
  assert.equal(optional.calls.spawn,1);assert.equal(optional.calls.gatewayClose,1);
  const failed=fixture({gatewayFailure:true});await assert.rejects(failed.api.launch(['--no-setup','--'],failed.options));
  assert.equal(failed.calls.gatewayClose,1);assert.equal(failed.signals.listenerCount('SIGINT'),0);
  assert.doesNotMatch(optional.logs.join('\n')+failed.logs.join('\n'),/PRIVATE/);
});

test('Claude version failure and second settings preflight failure preserve clean startup boundaries',async()=>{
  const bad=fixture();bad.options.inspectClient=async()=>({installed:true,version:'PRIVATE_VERSION_OUTPUT'});
  await assert.rejects(bad.api.launch(['--no-setup','--'],bad.options),error=>!/PRIVATE/.test(error.publicMessage));
  assert.equal(bad.calls.start,0);assert.equal(bad.calls.spawn,0);
  const changed=fixture();changed.options.preflightSettings=async()=>{if(++changed.calls.settings===2)throw new Error('PRIVATE_CHANGED_POLICY');};
  await assert.rejects(changed.api.launch(['--no-setup','--'],changed.options),error=>!/PRIVATE/.test(error.publicMessage));
  assert.equal(changed.calls.gatewayClose,1);assert.equal(changed.calls.spawn,0);
});

function versionProcess(){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kills=0;
  child.kill=()=>{child.kills++;return true;};return child;
}
test('Claude version preflight has a strict byte bound and deadline even when child close never arrives',async()=>{
  const hanging=versionProcess();
  assert.deepEqual(await inspectClaudeInstallation({timeoutMs:15,spawnProbe:()=>hanging}),{checkFailed:true});assert.equal(hanging.kills,1);
  const noisy=versionProcess();const run=inspectClaudeInstallation({spawnProbe:()=>noisy});
  noisy.stderr.emit('data',Buffer.alloc(4097,65));assert.deepEqual(await run,{checkFailed:true});assert.equal(noisy.kills,1);
  noisy.stdout.emit('data',Buffer.from('2.1.292 (Claude Code)'));noisy.emit('close',0);
});

test('Claude version preflight cancellation kills only its owned probe and accepts bounded clean metadata',async()=>{
  const cancelled=new AbortController();cancelled.abort();let spawned=0;
  assert.deepEqual(await inspectClaudeInstallation({signal:cancelled.signal,spawnProbe:()=>{spawned++;}}),{checkFailed:true,cancelled:true});assert.equal(spawned,0);
  const active=new AbortController(),child=versionProcess();const run=inspectClaudeInstallation({signal:active.signal,spawnProbe:()=>child});
  active.abort();assert.deepEqual(await run,{checkFailed:true,cancelled:true});assert.equal(child.kills,1);
  const valid=versionProcess(),env={FIXTURE_VERSION_ONLY:'true'};const good=inspectClaudeInstallation({executable:'fixture-claude',env,spawnProbe:(command,args,options)=>{
    assert.equal(command,'fixture-claude');assert.deepEqual(args,['--version']);assert.equal(options.env,env);return valid;}});
  valid.stdout.emit('data',Buffer.from('2.1.292 (Claude Code)\r\n'));valid.emit('close',0);
  assert.deepEqual(await good,{installed:true,version:'2.1.292'});assert.equal(valid.kills,0);
});

test('Claude missing stock executable really fails before the SDK factory',async()=>{
  const executable=path.join(process.cwd(),'runtime','NO_SUCH_CLAUDE_PRIVATE_SENTINEL.exe');let started=0;
  await assert.rejects(launcher.startClientGateway([],{},()=>{started++;},{executable,preflightSettings:async()=>{}}));
  assert.equal(started,0);
});

test('Claude normal dependency guard rejects the old package and accepts the reviewed patch',()=>{
  assert.throws(()=>launcher.assertDependencies('0.35.4'),/patched sharp/);
  assert.doesNotThrow(()=>launcher.assertDependencies('0.35.5'));
});
