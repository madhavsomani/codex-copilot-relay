import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mountClaudeGateway} from './unified-gateway.mjs';
import {createGateway} from './claude-gateway/server.mjs';
import {parseUnifiedArguments,publicGatewayEvent,launch} from './unified-launch.mjs';
import {selectClient} from './launch.mjs';
import {createGatewayReporter} from './unified-events.mjs';
import {renderUnifiedSetupPage} from './unified-setup.mjs';

test('combined service has one entry point and never takes an existing preview port',()=>{
  assert.equal(selectClient(['gateway']).client,'gateway');
  assert.deepEqual(parseUnifiedArguments([]),{port:4265,open:false,check:false});
  for(const port of ['4144','4246','4261','4263','0','65536','1e4'])assert.throws(()=>parseUnifiedArguments(['--port',port]));
  assert.throws(()=>parseUnifiedArguments(['--check','--open']));
  assert.throws(()=>parseUnifiedArguments(['--port','4265','--port','4266']));
});
test('one listener dispatches Messages and Responses without sharing credentials, catalogs or fallback',async t=>{
  const token='fixture-private-local-claude-token';let mount;
  const server=http.createServer((req,res)=>{
    if(mount?.route(req,res))return;
    res.writeHead(req.headers.authorization==='Bearer fixture-codex-key'?200:401,{'content-type':'application/json'});
    res.end(JSON.stringify({object:'response',provider:'fixture-codex'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  t.after(async()=>{await mount?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  mount=await mountClaudeGateway({port,token,log:()=>{},start:async options=>createGateway({...options,
    models:[{id:'claude-opus-5.5',capabilities:{limits:{max_output_tokens:1024}}}],
    runtime:{snapshot:()=>({state:'ready'}),stop:async()=>{},release:()=>{},createSession:async()=>{throw new Error('Not used by catalog checks');}}})});
  mount.gateway.mountedListening=true;
  const base=`http://127.0.0.1:${port}`;
  const results=await Promise.all([
    fetch(base+'/claude/v1/models',{headers:{authorization:'Bearer '+token}}),
    fetch(base+'/v1/responses',{headers:{authorization:'Bearer fixture-codex-key'}}),
    fetch(base+'/claude/v1/models',{headers:{authorization:'Bearer fixture-codex-key'}}),
    fetch(base+'/v1/responses',{headers:{authorization:'Bearer '+token}}),
    fetch(base+'/claude/v1/models',{headers:{authorization:'Bearer '+token,origin:'https://untrusted.invalid'}})
  ]);
  assert.deepEqual(results.map(value=>value.status),[200,200,401,401,403]);
  assert.equal((await results[0].json()).data[0].id,'claude-opus-5-5');
  assert.equal((await results[1].json()).object,'response');
  assert.equal(mount.visibility().port,port);assert.equal(mount.visibility().listening,true);
  assert.ok(!JSON.stringify(mount.visibility()).includes(token));
  for(const response of results.slice(2))await response.text();
});
test('combined terminal prints only bounded metadata, not raw failures or prompt contents',()=>{
  assert.equal(publicGatewayEvent({type:'untrusted',message:'PRIVATE_SECRET'}),null);
  const text=publicGatewayEvent({type:'claude.usage',requestedModel:'claude-opus-5-5',selectedModel:'claude-opus-5.5',
    inputTokens:11,outputTokens:1,aiCredits:0.0064,message:'PRIVATE_SECRET',prompt:'PRIVATE_PROMPT'});
  assert.match(text,/AI-credits=0.0064/);assert.doesNotMatch(text,/PRIVATE/);
  assert.doesNotMatch(publicGatewayEvent({type:'response.failed',model:'bad\nPRIVATE'}),/PRIVATE/);
});
test('combined IPC reports real events despite file logging and bounds console backpressure',()=>{
  const sent=[],callbacks=[];const report=createGatewayReporter((message,done)=>{sent.push(message);callbacks.push(done);});
  const event={type:'claude.completed',requestedModel:'claude-opus-5-5',selectedModel:'claude-opus-5.5',prompt:'PRIVATE'};
  for(let i=0;i<40;i++)report(event);
  assert.equal(sent.length,32);callbacks.forEach(done=>done());report(event);
  assert.equal(sent.length,33);assert.equal(sent.at(-1).skipped,8);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE/);
  assert.doesNotThrow(()=>createGatewayReporter(()=>{throw new Error('closed pipe');})(event));
});
test('combined page contains current routes and excludes unrelated repair/restore commands',()=>{
  const html=renderUnifiedSetupPage(4265);
  assert.match(html,/http:\/\/127\.0\.0\.1:4265\/claude/);assert.match(html,/http:\/\/127\.0\.0\.1:4265\/v1/);
  assert.doesNotMatch(html,/Repair-Codex-CopilotProxy|Start-Claude-With-Copilot|gpt-6-astra|__DASHBOARD_URL__/);
  assert.match(html,/does not automatically switch/);assert.match(html,/Each launch generates new local keys/);
  assert.throws(()=>renderUnifiedSetupPage('4265<script>'));
});
async function freePort(){const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
test('combined retained ownership produces an actionable safe error and never changes history',async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'relay-startup-error-')),port=await freePort();
  const directory=path.join(root,'runtime','unified',String(port));mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'gateway.owner.json'),receipt=JSON.stringify({version:1,pid:process.pid,owner:'PRIVATE_OWNER'});
  writeFileSync(file,receipt);writeFileSync(path.join(directory,'proxy-metrics.json'),'PRIVATE_HISTORY');
  await assert.rejects(launch(['--port',String(port),'--check'],{root}),error=>{
    assert.equal(error.code,'claude_runtime_owned');assert.match(error.publicMessage??'',/RecoverStopped/);
    assert.doesNotMatch(error.publicMessage,/PRIVATE/);return true;
  });
  assert.equal(readFileSync(file,'utf8'),receipt);
  assert.equal(readFileSync(path.join(directory,'proxy-metrics.json'),'utf8'),'PRIVATE_HISTORY');
});
test('combined launch check and console exit clean both owned adapters without saving keys',async()=>{
  for(const mode of ['check','quit','eof','signal']){
    const root=mkdtempSync(path.join(os.tmpdir(),'relay-unified-test-'));
    writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'fixture'}));
    const port=await freePort(),logs=[],revealed=[],signals=new EventEmitter();
    const code=await launch(['--port',String(port),...(mode==='check'?['--check']:[])],{
      root,signals,log:value=>logs.push(value),reveal:value=>revealed.push(value),
      serverEntry:fileURLToPath(new URL('./fixtures/unified-lifecycle-server.mjs',import.meta.url)),
      createConsole:()=>{const terminal=new EventEmitter();terminal.close=()=>terminal.emit('close');
        setImmediate(()=>{terminal.emit('line','key');terminal.emit('line','codex-key');
          if(mode==='signal')signals.emit('SIGTERM');else if(mode==='eof')terminal.emit('close');else terminal.emit('line','quit');});return terminal;}
    });
    assert.equal(code,mode==='signal'?130:0);assert.equal(revealed.length,mode==='check'?0:2);
    for(const key of revealed){assert.match(key,/^[a-f0-9]{64}$/);assert.ok(!logs.join('\n').includes(key));}
    if(revealed.length)assert.notEqual(revealed[0],revealed[1]);
    assert.equal(existsSync(path.join(root,'runtime','unified',String(port),'gateway.owner.json')),false);
    assert.equal(signals.listenerCount('SIGTERM'),0);
    assert.ok(logs.some(line=>line.startsWith('[Claude Code]')),'IPC events must reach the console');
  }
});
