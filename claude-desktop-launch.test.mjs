import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as desktop from './claude-gateway/desktop-launch.mjs';
import {selectClient} from './launch.mjs';
import {createGateway} from './claude-gateway/server.mjs';
import {createSetupPortal} from './setup-server.mjs';

const models=[{id:'claude-opus-5.5',name:'Claude Opus 5.5',capabilities:{}},
  {id:'claude-sonnet-5.5',name:'Claude Sonnet 5.5',capabilities:{}},
  {id:'gpt-6.1-sol',capabilities:{}}, {id:'claude-haiku-4.5',policy:{state:'disabled'}}];
function fixture({signalAt,portalError,gatewayError,preflightError}={}){
  const signals=new EventEmitter(),lines=new EventEmitter(),logs=[],secrets=[];
  const calls={start:0,close:0,portalClose:0,console:0};
  lines.close=()=>lines.emit('close');
  const gateway={models,ledger:{state:{recent:[],usage:[],received:0,completed:0,failed:0}},
    turns:new Set(),runtime:{snapshot:()=>({state:'ready'})},
    server:{listening:true,address:()=>({port:4261})},close:async()=>{calls.close++;if(gatewayError)throw new Error('PRIVATE_CLOSE');}};
  const options={signals,log:value=>logs.push(value),reveal:value=>secrets.push(value),checkDependencies:()=>{},
    preflightSettings:async()=>{if(signalAt==='preflight')signals.emit('SIGINT');if(preflightError)throw new Error('PRIVATE_POLICY');},
    startGateway:async config=>{calls.start++;assert.match(config.token,/^[a-f0-9]{64}$/);if(signalAt==='start')signals.emit('SIGTERM');return gateway;},
    createPortal:async()=>({listen:async()=>{if(signalAt==='portal')signals.emit('SIGTERM');if(portalError==='listen')throw new Error('PRIVATE_LISTEN');return 'http://127.0.0.1:4263/dashboard/setup';},
      close:async()=>{calls.portalClose++;if(portalError==='close')throw new Error('PRIVATE_PORTAL_CLOSE');}}),
    createConsole:()=>{calls.console++;queueMicrotask(()=>{lines.emit('line','status');lines.emit('line','key');lines.emit('line','quit');});return lines;}};
  return {options,calls,signals,lines,logs,secrets};
}

test('front door includes gateway-only Claude desktop mode',()=>{
  assert.deepEqual(selectClient(['claude-desktop','--check']),{client:'claude-desktop',args:['--check']});
});
test('desktop arguments reserve existing ports and reject unknown/duplicate/conflicting options',()=>{
  assert.deepEqual(desktop.parseDesktopLaunchArguments([]),{port:4261,setupPort:0,openSetup:false,check:false});
  for(const args of [['--port','4144'],['--port','4246'],['--port','0'],['--port','4257','--port','4258'],
    ['--setup-port','4261'],['--no-setup','--open-setup'],['--check','--open-setup'],['--token','PRIVATE'],['--model','opus']])
    assert.throws(()=>desktop.parseDesktopLaunchArguments(args));
});
test('desktop form projection contains exact entitled Claude IDs, no 1M claim or external credential',()=>{
  const config=desktop.desktopConnection({models,server:{address:()=>({port:4261})}});
  assert.equal(config.inferenceProvider,'gateway');assert.equal(config.inferenceCredentialKind,'static');
  assert.equal(config.inferenceGatewayBaseUrl,'http://127.0.0.1:4261');assert.equal(config.inferenceGatewayAuthScheme,'bearer');
  assert.deepEqual(config.inferenceModels.map(value=>value.name),['claude-opus-5-5','claude-sonnet-5-5']);
  assert.equal(config.isClaudeCodeForDesktopEnabled,true);assert.equal(config.toolSearchEnabled,false);
  assert.doesNotMatch(JSON.stringify(config),/token|apikey|supports1m|gpt-/i);
});
test('desktop metadata check closes gateway and observer, with no console or key disclosure',async()=>{
  const f=fixture();assert.equal(await desktop.launch(['--check'],f.options),0);
  assert.equal(f.calls.start,1);assert.equal(f.calls.close,1);assert.equal(f.calls.portalClose,1);assert.equal(f.calls.console,0);
  assert.equal(f.secrets.length,0);assert.doesNotMatch(f.logs.join('\n'),/PRIVATE|[a-f0-9]{64}/);
  assert.equal(f.signals.listenerCount('SIGINT'),0);
});
test('desktop console reveals only the local key on explicit key input and quit cleans ownership',async()=>{
  const f=fixture();assert.equal(await desktop.launch(['--no-setup'],f.options),0);
  assert.equal(f.secrets.length,1);assert.match(f.secrets[0],/^[a-f0-9]{64}$/);
  assert.doesNotMatch(f.logs.join('\n'),new RegExp(f.secrets[0]));assert.equal(f.calls.close,1);
  assert.match(f.logs.join('\n'),/not verified|not observed/i);
});
test('desktop controlled restart can retain an explicitly supplied local key without exposing it in logs',async()=>{
  const current=fixture();current.options.token='ab'.repeat(32);
  assert.equal(await desktop.launch(['--no-setup'],current.options),0);
  assert.deepEqual(current.secrets,[current.options.token]);
  assert.ok(current.logs.every(line=>!line.includes(current.options.token)));
  for(const token of ['', 'short', 'x'.repeat(64),42]){
    const invalid=fixture();invalid.options.token=token;
    await assert.rejects(desktop.launch([],invalid.options),/Invalid local desktop gateway key/);
    assert.equal(invalid.calls.start,0);
  }
});
test('desktop startup interruption never exposes a console/key and independently closes ownership',async()=>{
  for(const signalAt of ['preflight','start','portal']){
    const f=fixture({signalAt});assert.equal(await desktop.launch([],f.options),130);
    assert.equal(f.calls.console,0);assert.equal(f.secrets.length,0);assert.equal(f.calls.close,f.calls.start);
    assert.equal(f.signals.listenerCount('SIGTERM'),0);
  }
});
test('desktop observer errors do not skip inference cleanup and raw dependency errors are hidden',async()=>{
  for(const portalError of ['listen','close']){
    const f=fixture({portalError});assert.equal(await desktop.launch(['--check'],f.options),0);
    assert.equal(f.calls.close,1);assert.doesNotMatch(f.logs.join('\n'),/PRIVATE/);
  }
  for(const spec of [{gatewayError:true},{preflightError:true}]){
    const f=fixture(spec);await assert.rejects(desktop.launch(['--check'],f.options),error=>!/PRIVATE/.test(error.publicMessage));
    assert.equal(f.calls.close,f.calls.start);
  }
});
test('desktop EOF and active Ctrl+C close only the owned gateway without modifying saved settings',async()=>{
  for(const event of ['eof','signal']){
    const f=fixture();f.options.createConsole=()=>{queueMicrotask(()=>event==='eof'?f.lines.emit('close'):f.signals.emit('SIGINT'));return f.lines;};
    assert.equal(await desktop.launch(['--no-setup'],f.options),event==='signal'?130:0);
    assert.equal(f.calls.close,1);assert.equal(f.secrets.length,0);assert.equal(f.signals.listenerCount('SIGINT'),0);
  }
});
test('desktop console cleanup failure cannot skip gateway cleanup',async()=>{
  const f=fixture();f.lines.close=()=>{throw new Error('PRIVATE_CONSOLE_CLOSE');};
  assert.equal(await desktop.launch(['--no-setup'],f.options),0);assert.equal(f.calls.close,1);
  assert.doesNotMatch(f.logs.join('\n'),/PRIVATE/);
});
test('desktop runner real loopback model/observer endpoints are credential-separated and cleanly close',async()=>{
  const signals=new EventEmitter(),lines=new EventEmitter();lines.close=()=>lines.emit('close');
  let gateway,portal,token;let inferenceCalls=0;const logs=[],secrets=[];
  const done=desktop.launch([],{signals,log:value=>logs.push(value),reveal:value=>secrets.push(value),
    checkDependencies:()=>{},preflightSettings:async()=>{},
    startGateway:async config=>{token=config.token;gateway=await createGateway({models,token,
      runtime:{snapshot:()=>({state:'ready'}),stop:async()=>{},createSession:async()=>{inferenceCalls++;throw new Error('Not inference');}}});
      await gateway.listen(0);return gateway;},
    createPortal:async config=>{portal=await createSetupPortal({...config,inspect:async()=>({installed:false}),relay:async()=>null,
      auth:async()=>({authenticated:true,models:[],claudeModels:['claude-opus-5-5']})});return portal;},
    createConsole:()=>{queueMicrotask(async()=>{
      try{
        const base=`http://127.0.0.1:${gateway.server.address().port}`;
        assert.equal((await fetch(base+'/v1/models')).status,401);
        const available=await (await fetch(base+'/v1/models',{headers:{Authorization:'Bearer '+token}})).json();
        assert.deepEqual(available.data.map(model=>model.id),['claude-opus-5-5','claude-sonnet-5-5']);
        const observer=`http://127.0.0.1:${portal.server.address().port}`;
        for(const route of ['/dashboard/setup','/dashboard/setup/status']){
          const response=await fetch(observer+route);assert.equal(response.status,200);assert.ok(!(await response.text()).includes(token));
        }
        assert.equal((await fetch(observer+'/dashboard/setup/status',{method:'POST'})).status,405);
        assert.equal((await fetch(observer+'/dashboard/setup/status',{headers:{Origin:'https://foreign.example'}})).status,403);
      }finally{lines.emit('line','quit');}
    });return lines;}});
  assert.equal(await done,0);assert.equal(inferenceCalls,0);assert.equal(secrets.length,0);
  assert.equal(gateway.server.listening,false);assert.equal(portal.server.listening,false);
  assert.doesNotMatch(logs.join('\n'),new RegExp(token));
});
