import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {launch} from './codex-gateway/launch.mjs';
import {createSetupPortal} from './setup-server.mjs';
const source=fileURLToPath(new URL('./',import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function fixture(t,extra={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-portable-codex-')),port=await freePort();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'fixture-1'}));
  const home=path.join(root,'client-home');fs.mkdirSync(home);const config=path.join(home,'config.toml'),auth=path.join(home,'auth.json');
  fs.writeFileSync(config,'model_provider="openai"\n');fs.writeFileSync(auth,'{"fixture":true}');
  const before=[config,auth].map(file=>digest(fs.readFileSync(file))),logs=[];
  const environment={...process.env,CODEX_HOME:home,BRIDGE_PORT:'4144',RELAY_OPENAI_ENABLED:'1',
    PORTABLE_FIXTURE_VERSION:'fixture-1',PORTABLE_FIXTURE_CLIENT_RESULT:path.join(root,'client-result.json'),...extra};
  const options={root,cwd:root,environment,dependencies:async()=>{},authProbe:async()=>({authenticated:true,models:['gpt-6.1-sol'],modelDetails:[{
    id:'gpt-6.1-sol',name:'GPT-6.1 Sol',capabilities:{supports:{vision:true,reasoningEffort:true},limits:{max_context_window_tokens:400000,max_prompt_tokens:272000}},
    supportedReasoningEfforts:['low','high','xhigh'],defaultReasoningEffort:'high'}]}),
    clientCommand:{command:process.execPath,prefix:[path.join(source,'fixtures','portable-launch-client.mjs')]},
    serverEntry:path.join(source,'fixtures','portable-launch-server.mjs'),log:value=>logs.push(value),clientStdio:'ignore',readyTimeoutMs:2000,stopTimeoutMs:2000,signals:new EventEmitter()};
  const runtime=path.join(root,'runtime','codex-cli','ports',String(port));
  return {root,port,options,runtime,logs,config,auth,assertUnchanged(){assert.deepEqual([config,auth].map(file=>digest(fs.readFileSync(file))),before);}};
}

test('portable Codex normal and nonzero client exits release only owned runtime; configs/auth stay unchanged',async t=>{
  for(const code of [0,7]){
    const f=await fixture(t,{PORTABLE_FIXTURE_CLIENT_EXIT:String(code)});
    assert.equal(await launch(['--port',String(f.port),'--effort','high','--','exec','hello'],f.options),code);
    const record=JSON.parse(fs.readFileSync(path.join(f.root,'client-result.json'),'utf8'));
    assert.equal(record.localKeyPresent,true);assert.equal(record.inheritedBridgePort,null);assert.equal(record.alternateProviderEnabled,null);
    assert.deepEqual(record.catalogModels,[{id:'gpt-6.1-sol',context:400000}]);
    assert.equal(fs.readdirSync(f.runtime).filter(name=>/^models-.*\.json$/.test(name)).length,0);
    if(code===0)assert.ok(f.logs[0].includes('effort high'));
    assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
    assert.doesNotMatch(f.logs.join('\n'),/[a-f0-9]{64}|PRIVATE_API/);
    const retained=path.join(f.runtime,'history-kept.txt');fs.writeFileSync(retained,'KEEP');
    assert.equal(await launch(['--port',String(f.port),'--','exec','again'],f.options),code);
    assert.equal(fs.readFileSync(retained,'utf8'),'KEEP');f.assertUnchanged();
  }
});
test('portable Codex port conflicts never adopt or kill another listener',async t=>{
  const f=await fixture(t),competitor=net.createServer();await new Promise(resolve=>competitor.listen(f.port,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>competitor.close(resolve)));
  await assert.rejects(launch(['--port',String(f.port),'--'],f.options),/occupied/);
  assert.equal(competitor.listening,true);assert.equal(fs.existsSync(f.runtime),false);f.assertUnchanged();
});
test('portable Codex stale ownership is never reclaimed or overwritten',async t=>{
  const f=await fixture(t);fs.mkdirSync(f.runtime,{recursive:true});const owner=path.join(f.runtime,'gateway.owner.json');fs.writeFileSync(owner,'UNCERTAIN_OWNER');
  await assert.rejects(launch(['--port',String(f.port),'--'],f.options),/ownership receipt/);
  assert.equal(fs.readFileSync(owner,'utf8'),'UNCERTAIN_OWNER');f.assertUnchanged();
});
test('portable Codex refuses unauthenticated or non-entitled models before startup',async t=>{
  for(const auth of [{authenticated:false,models:[]},{authenticated:true,models:['gpt-other']}]){
    const f=await fixture(t);f.options.authProbe=async()=>auth;
    await assert.rejects(launch(['--port',String(f.port),'--'],f.options));
    assert.equal(fs.existsSync(f.runtime),false);f.assertUnchanged();
  }
});
test('portable Codex wrong bearer and unsupported effort stop startup and clean graceful ownership',async t=>{
  for(const [env,args,pattern] of [[{PORTABLE_FIXTURE_WRONG_TOKEN:'1'},[],/deadline/],[{},['--effort','max'],/not advertised/]]){
    const f=await fixture(t,env);f.options.readyTimeoutMs=350;
    await assert.rejects(launch(['--port',String(f.port),...args,'--'],f.options),pattern);
    assert.equal(fs.existsSync(path.join(f.root,'client-result.json')),false);
    assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
  }
});
test('portable Codex abrupt owned-server failure stops stock client without fallback and retains inspection receipt',async t=>{
  const f=await fixture(t,{PORTABLE_FIXTURE_CLIENT_WAIT:'1',PORTABLE_FIXTURE_FAIL_AFTER_MS:'350'});
  await assert.rejects(launch(['--port',String(f.port),'--'],f.options),/stopped while/);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),true);f.assertUnchanged();
  assert.equal(fs.readdirSync(f.runtime).filter(name=>/^models-.*\.json$/.test(name)).length,1);
});
test('portable Codex must receive readiness from its owned child, not just an HTTP responder',async t=>{
  const f=await fixture(t,{PORTABLE_FIXTURE_NO_INITIALIZED:'1'});f.options.readyTimeoutMs=300;
  await assert.rejects(launch(['--port',String(f.port),'--'],f.options),/deadline/);
  assert.equal(fs.existsSync(path.join(f.root,'client-result.json')),false);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
});
test('portable Codex rejects oversized metadata immediately without accepting its values',async t=>{
  const f=await fixture(t,{PORTABLE_FIXTURE_OVERSIZE_HEALTH:'1'});
  await assert.rejects(launch(['--port',String(f.port),'--'],f.options),/metadata.*bound/);
  assert.equal(fs.existsSync(path.join(f.root,'client-result.json')),false);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
});
test('portable Codex wrapper signal stops its own client/server and releases receipt',async t=>{
  const f=await fixture(t,{PORTABLE_FIXTURE_CLIENT_WAIT:'1'});
  const run=launch(['--port',String(f.port),'--'],f.options);
  const deadline=Date.now()+2500;
  while(!fs.existsSync(path.join(f.root,'client-result.json'))&&Date.now()<deadline)await delay(20);
  assert.equal(fs.existsSync(path.join(f.root,'client-result.json')),true);
  f.options.signals.emit('SIGTERM');assert.equal(await run,130);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
});
test('actual unmodified Codex CLI completes an authenticated process-scoped loopback response',async t=>{
  const stock=path.join(source,'node_modules','@openai','codex','bin','codex.js');
  if(!fs.existsSync(stock)){t.skip('Pinned stock Codex dependency is not installed.');return;}
  const f=await fixture(t),output=path.join(f.root,'last-message.txt');
  const errorsFile=path.join(f.root,'stock-stderr.txt'),errorsFd=fs.openSync(errorsFile,'wx');
  t.after(()=>fs.closeSync(errorsFd));f.options.clientStdio=['ignore','ignore',errorsFd];
  f.options.environment.RUST_LOG='codex_models_manager=warn';
  f.options.clientCommand={command:process.execPath,prefix:[stock]};
  const code=await launch(['--port',String(f.port),'--effort','high','--','exec','--skip-git-repo-check','--sandbox','read-only','--output-last-message',output,'Return PORTABLE_STOCK_OK.'],f.options);
  assert.equal(code,0);assert.equal(fs.readFileSync(output,'utf8').trim(),'PORTABLE_STOCK_OK');
  assert.equal(/Unknown model|fallback model metadata/i.test(fs.readFileSync(errorsFile,'utf8')),false,'Stock Codex must use the generated model metadata.');
  const state=JSON.parse(fs.readFileSync(path.join(f.runtime,'fixture-state.json'),'utf8'));
  assert.equal(state.requests,1);assert.equal(state.model,'gpt-6.1-sol');assert.equal(state.effort,'high');assert.equal(state.authenticated,true);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
});
test('portable Codex missing model details fail before client inference and release owned startup resources',async t=>{
  const f=await fixture(t);f.options.authProbe=async()=>({authenticated:true,models:['gpt-6.1-sol']});
  await assert.rejects(launch(['--port',String(f.port),'--'],f.options),/metadata/);
  assert.equal(fs.existsSync(path.join(f.root,'client-result.json')),false);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
});
test('actual stock Codex rejects its unsupported legacy saved-profile syntax without rewriting it or inferring',async t=>{
  const stock=path.join(source,'node_modules','@openai','codex','bin','codex.js');
  if(!fs.existsSync(stock)){t.skip('Pinned stock Codex dependency is not installed.');return;}
  const f=await fixture(t),output=path.join(f.root,'last-message.txt');
  fs.writeFileSync(f.config,'profile="saved_profile"\n[profiles.saved_profile]\nmodel_provider="openai"\nmodel="gpt-5.4"\nmodel_reasoning_effort="low"\n');
  const configBefore=digest(fs.readFileSync(f.config)),authBefore=digest(fs.readFileSync(f.auth));
  f.options.clientCommand={command:process.execPath,prefix:[stock]};
  assert.equal(await launch(['--port',String(f.port),'--','exec','--skip-git-repo-check','--sandbox','read-only','--output-last-message',output,'Return PORTABLE_STOCK_OK.'],f.options),1);
  assert.equal(fs.existsSync(output),false);
  const state=JSON.parse(fs.readFileSync(path.join(f.runtime,'fixture-state.json'),'utf8'));
  assert.equal(state.requests,0);
  assert.equal(digest(fs.readFileSync(f.config)),configBefore);assert.equal(digest(fs.readFileSync(f.auth)),authBefore);
  assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);
});
test('owned Codex observer uses actual loopback metadata, closes with wrapper and never changes unrelated listeners/config',async t=>{
  const f=await fixture(t,{PORTABLE_FIXTURE_CLIENT_WAIT:'1'});let url;
  f.options.createPortal=async options=>{const portal=await createSetupPortal(options),listen=portal.listen;
    portal.listen=async()=>{url=await listen();return url;};return portal;};
  const run=launch(['--port',String(f.port),'--'],f.options),deadline=Date.now()+3000;
  try{
    while(!fs.existsSync(path.join(f.root,'client-result.json'))&&Date.now()<deadline)await delay(20);
    assert.ok(url);const view=await (await fetch(new URL('/dashboard/setup/codex',url))).json();
    assert.equal(view.state,'listening');assert.equal(view.sdkApiCalls,0);assert.equal(view.aiCredits,null);assert.equal(view.inputTokens,null);
    assert.equal(view.selectedModel,'gpt-6.1-sol');assert.doesNotMatch(JSON.stringify(view),/[a-f0-9]{64}|PRIVATE_/);
  }finally{f.options.signals.emit('SIGTERM');assert.equal(await run,130);}
  await assert.rejects(fetch(url));assert.equal(fs.existsSync(path.join(f.runtime,'gateway.owner.json')),false);f.assertUnchanged();
});
test('observer-port conflicts and --no-setup never alter inference lifecycle or terminate another observer',async t=>{
  const f=await fixture(t),competitor=net.createServer();await new Promise(resolve=>competitor.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>competitor.close(resolve)));const observerPort=competitor.address().port;
  assert.equal(await launch(['--port',String(f.port),'--setup-port',String(observerPort),'--','exec','hello'],f.options),0);
  assert.equal(competitor.listening,true);assert.match(f.logs.join('\n'),/Connection center unavailable; inference unchanged/);
  f.options.createPortal=async()=>{throw Error('Observer must not start');};
  const before=f.logs.length;assert.equal(await launch(['--port',String(f.port),'--no-setup','--','exec','hello'],f.options),0);
  assert.doesNotMatch(f.logs.slice(before).join('\n'),/Connection center unavailable/);f.assertUnchanged();
});
