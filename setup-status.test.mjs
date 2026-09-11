import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connectionStates,createSetupStatus,sameOriginLocal,inspectInstallation} from './setup-status.mjs';
import {SETUP_HTML,CONNECTION_SCRIPT} from './setup-ui.mjs';

test('connections distinguish installed/configured/recent traffic and sign-in/model access',()=>{
  const now=Date.now(),installation={installed:true,configured:true};
  const relay={ok:true,lastCodexRequestAt:new Date(now-1000).toISOString()};
  const copilot={authenticated:true,models:['gpt-5.4']};
  assert.equal(connectionStates({installation,copilot,relay,now}).codex,'traffic-observed');
  assert.equal(connectionStates({installation,copilot,relay,now:now+120000}).codex,'configured');
  assert.equal(connectionStates({installation,copilot,relay:null}).codex,'relay-offline');
  assert.equal(connectionStates({installation:{installed:true}}).codex,'not-configured');
  assert.equal(connectionStates({installation:{checkFailed:true}}).codex,'unknown');
  assert.equal(connectionStates({}).codex,'not-found');
  assert.equal(connectionStates({copilot}).copilot,'ready');
  assert.equal(connectionStates({copilot:{authenticated:true,models:[]}}).copilot,'no-models');
  assert.equal(connectionStates({copilot:{unavailable:true}}).copilot,'unavailable');
  assert.equal(connectionStates({}).copilot,'sign-in');
});

test('dashboard same-origin guard rejects DNS rebinding and browser cross-site mutations',()=>{
  const check=headers=>sameOriginLocal({headers},4144);
  assert.equal(check({host:'127.0.0.1:4144'}),true);
  assert.equal(check({host:'localhost:4144',origin:'http://localhost:4144'}),true);
  for(const headers of [{host:'evil.test:4144'},{host:'127.0.0.1:4144',origin:'https://evil.test'},
    {host:'127.0.0.1:4144','sec-fetch-site':'cross-site'},{host:'127.0.0.1:4145'},{}])assert.equal(check(headers),false);
});

test('Windows setup diagnostics recover the built-in module path without changing parent environment',{skip:process.platform!=='win32'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'relay-setup-env-'));
  const env={...process.env,PSModulePath:path.join(root,'missing-modules')};
  try {
    await fs.writeFile(path.join(root,'Inspect-RelaySetup.ps1'),"$ErrorActionPreference='Stop'; Get-FileHash -LiteralPath $PSCommandPath | Out-Null; @{installed=$true;configured=$false;backup='verified'} | ConvertTo-Json -Compress");
    const result=await inspectInstallation({root,port:4144,env});
    assert.equal(result.backup,'verified');assert.equal(env.PSModulePath,path.join(root,'missing-modules'));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('setup status works before npm install, then detects installation without fake connected state',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'relay-setup-test-'));let calls=0,time=Date.now();
  const read=createSetupStatus({root,port:4144,now:()=>time,
    inspect:async()=>({installed:false,configured:false,backup:'not-created'}),relay:async()=>null,
    auth:async()=>{calls++;return {authenticated:true,models:['gpt-5.4']};}});
  try {
    let s=await read();assert.equal(s.dependencies,false);assert.equal(calls,0);assert.equal(s.states.codex,'not-found');
    const dep=path.join(root,'node_modules/@github/copilot-sdk/dist');await fs.mkdir(dep,{recursive:true});await fs.writeFile(path.join(dep,'index.js'),'');
    await read();assert.equal(calls,0);time+=31000;
    const concurrent=await Promise.all([read(),read(),read()]);assert.equal(calls,1);
    s=concurrent[0];assert.equal(s.dependencies,true);assert.equal(s.states.copilot,'ready');
    assert.equal(s.codexBinaryModified,false);assert.equal(s.setupMode,'guided-read-only');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('connection UI has valid script, no remote dependencies or claimed automatic installation',()=>{
  new vm.Script(CONNECTION_SCRIPT);
  assert.ok(SETUP_HTML.includes('-File .\\Repair-Codex-CopilotProxy.ps1'));
  assert.ok(!SETUP_HTML.includes('-File .Repair-Codex-CopilotProxy.ps1'));
  assert.match(SETUP_HTML,/not a one-click installer/);
  assert.match(SETUP_HTML,/Native app voice is unsupported/);
  assert.doesNotMatch(SETUP_HTML,/Start-Relay\.cmd|<script\s+src=/);
  assert.doesNotMatch(CONNECTION_SCRIPT,/innerHTML|method\s*:\s*['"]POST/);
});

test('fresh-install portal starts with no node_modules and refuses write operations',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'relay-setup-http-'));
  const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const files=['setup-server.mjs','setup-status.mjs','setup-ui.mjs','Inspect-RelaySetup.ps1','Codex-Copilot-Config.ps1'];
  for(const file of files)await fs.copyFile(new URL(file,import.meta.url),path.join(root,file));
  const child=spawn(process.execPath,[path.join(root,'setup-server.mjs')],{cwd:root,windowsHide:true,
    env:{...process.env,RELAY_SETUP_PORT:String(port),BRIDGE_PORT:String(port===65535?65534:port+1),CODEX_HOME:path.join(root,'synthetic-codex-home')},stdio:'ignore'});
  const exit=once(child,'exit');
  try{
    const base=`http://127.0.0.1:${port}`;let ready=false;
    for(let i=0;i<50;i++){try{ready=(await fetch(base+'/setup-health')).ok;if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.ok(ready,'Dependency-free server did not start');
    const page=await fetch(base+'/dashboard/setup');assert.equal(page.status,200);assert.match(await page.text(),/connection center/i);
    const status=await (await fetch(base+'/dashboard/setup/status')).json();assert.equal(status.dependencies,false);assert.equal(status.states.copilot,'sign-in');
    assert.equal((await fetch(base+'/dashboard/setup/action',{method:'POST',body:'{}'})).status,405);
    assert.equal((await fetch(base+'/dashboard/setup/status',{headers:{Origin:'https://malicious.invalid'}})).status,403);
    assert.equal((await fetch(base+'/auth.json')).status,404);
    assert.equal(await fs.access(path.join(root,'synthetic-codex-home/config.toml')).then(()=>true,()=>false),false);
  } finally {child.kill();await exit;await fs.rm(root,{recursive:true,force:true,maxRetries:4});}
});
