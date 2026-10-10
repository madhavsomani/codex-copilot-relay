import test from 'node:test';
import assert from 'node:assert/strict';
import {clientArguments,startClientGateway} from './claude-gateway/launch.mjs';
import {preflightClientSettings,validateClientSettings,parseClientArguments,readWindowsPolicies} from './claude-gateway/client-settings.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const gateway={models:[{id:'claude-opus-5.5',name:'Claude Opus 5.5',capabilities:{}}]};
test('Claude supplied settings cannot replace child-only routing or expose values in errors',()=>{
  const settings={env:{ANTHROPIC_BASE_URL:'http://127.0.0.1:1234',ANTHROPIC_AUTH_TOKEN:'fixture-secret-do-not-print'}};
  assert.throws(()=>clientArguments(['--settings',JSON.stringify(settings)],gateway),error=>
    /ANTHROPIC_BASE_URL/.test(error.message)&&!error.message.includes('fixture-secret-do-not-print'));
});
test('Claude supplied credential helpers and provider fallback are rejected, not silently stripped',()=>{
  assert.throws(()=>clientArguments(['--settings','{"apiKeyHelper":"fixture-helper"}'],gateway),/apiKeyHelper/);
  assert.throws(()=>clientArguments(['--fallback-model','sonnet'],gateway),/fallback/i);
});
function fixture(t){
  const root=mkdtempSync(path.join(os.tmpdir(),'claude-routing-fixture-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cwd=path.join(root,'project'),config=path.join(root,'config'),managed=path.join(root,'managed');
  for(const file of [cwd,config,managed])mkdirSync(file,{recursive:true});
  return {root,cwd,config,managed,options:{cwd,env:{CLAUDE_CONFIG_DIR:config},platform:'linux',managedDirectory:managed},
    save(file,value){mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value));}};
}
test('Claude supplied routing conflicts reject before any SDK factory starts',async()=>{
  let started=0;
  await assert.rejects(startClientGateway(['--settings','{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:1"}}'],{},()=>{started++;}),/ANTHROPIC_BASE_URL/);
  assert.equal(started,0);
});
test('Claude preflight inspects user, project, local and cached managed configuration without writes',async t=>{
  for(const [source,location] of [['user','config'],['project','shared'],['local','local'],['cached server-managed','remote']]){
    const f=fixture(t);const file=location==='config'?path.join(f.config,'settings.json'):location==='remote'?path.join(f.config,'remote-settings.json'):
      path.join(f.cwd,'.claude',location==='shared'?'settings.json':'settings.local.json');
    f.save(file,{env:{ANTHROPIC_AUTH_TOKEN:'fixture-private-not-printed'}});const before=readFileSync(file);
    await assert.rejects(preflightClientSettings([],f.options),error=>error.message.includes(source)&&!error.message.includes('fixture-private-not-printed'));
    assert.deepEqual(readFileSync(file),before);
  }
});
test('Claude nested project checks repository-root and legacy local settings',async t=>{
  const f=fixture(t);mkdirSync(path.join(f.cwd,'.git'));const nested=path.join(f.cwd,'nested');mkdirSync(nested);
  f.save(path.join(f.cwd,'.claude','settings.local.json'),{env:{CLAUDE_CODE_USE_VERTEX:'1'}});
  await assert.rejects(preflightClientSettings([],{...f.options,cwd:nested}),/repository local settings.*CLAUDE_CODE_USE_VERTEX/);
});
test('Claude managed main/drop-in policies stay enforced even with empty setting sources',async t=>{
  for(const name of ['managed-settings.json',path.join('managed-settings.d','20-routing.json')]){
    const f=fixture(t),file=path.join(f.managed,name);f.save(file,{model:'organization-pinned-model'});
    await assert.rejects(preflightClientSettings(['--setting-sources',''],f.options),/managed.*model/);
    assert.equal(JSON.parse(readFileSync(file)).model,'organization-pinned-model');
  }
});
test('Claude Windows registry policy conflicts and inspection failures fail closed',async t=>{
  const f=fixture(t);let reads=0;
  await assert.rejects(preflightClientSettings([],{...f.options,platform:'win32',registryReader:async()=>{reads++;return [{source:'HKLM fixture policy',settings:{env:{ANTHROPIC_BASE_URL:'fixture-endpoint'}}}];}}),/HKLM fixture policy.*ANTHROPIC_BASE_URL/);
  assert.equal(reads,1);
  await assert.rejects(preflightClientSettings([],{...f.options,platform:'win32',registryReader:async()=>{throw new Error('fixture-policy-inspection-failed');}}),/fixture-policy-inspection-failed/);
});
test('Claude safe settings retain hooks, MCP, env and permissions; parent files/env remain unchanged',async t=>{
  const f=fixture(t),settings={env:{PROJECT_TOKEN:'fixture-unrelated'},permissions:{defaultMode:'plan',deny:['Bash'],allow:['Read']},
    hooks:{Stop:[]},mcpServers:{fixture:{command:'fixture-only'}},theme:'dark'};
  const file=path.join(f.cwd,'supplied.json');f.save(file,settings);const before=readFileSync(file),original=structuredClone(f.options.env);
  const parsed=await preflightClientSettings(['--settings',file,'-p','Hi'],f.options);
  assert.deepEqual(parsed.settings,settings);assert.deepEqual(f.options.env,original);assert.deepEqual(readFileSync(file),before);
  const args=clientArguments(['--settings',file,'-p','Hi'],gateway),actual=JSON.parse(args[1]);
  for(const key of Object.keys(settings))assert.deepEqual(actual[key],settings[key]);
  assert.equal(actual.modelPicker.options[0].model,'claude-opus-5-5');
});
test('Claude scoped sources are honored without disabling managed inspection',async t=>{
  const f=fixture(t);f.save(path.join(f.config,'settings.json'),{env:{ANTHROPIC_API_KEY:'fixture-user-key'}});
  await assert.doesNotReject(preflightClientSettings(['--setting-sources=project,local'],f.options));
  f.save(path.join(f.config,'remote-settings.json'),{apiKeyHelper:'fixture-never-executed'});
  await assert.rejects(preflightClientSettings(['--setting-sources='],f.options),/cached server-managed.*apiKeyHelper/);
});
test('Claude malformed/null/oversized settings fail without printing sensitive contents',async t=>{
  const f=fixture(t),file=path.join(f.config,'settings.json');
  assert.throws(()=>parseClientArguments(['--settings',f.config]),/regular JSON file/);
  writeFileSync(file,'{"env":{"ANTHROPIC_AUTH_TOKEN":"fixture-sensitive-json');
  await assert.rejects(preflightClientSettings([],f.options),error=>/Invalid JSON/.test(error.message)&&!error.message.includes('fixture-sensitive'));
  writeFileSync(file,'null');await assert.rejects(preflightClientSettings([],f.options),/JSON settings object/);
  writeFileSync(file,' '.repeat(1024*1024+1));await assert.rejects(preflightClientSettings([],f.options),/1 MiB/);
  assert.throws(()=>parseClientArguments(['--settings','{"private":"fixture-sensitive-json"']),error=>!error.message.includes('fixture-sensitive'));
});
test('Claude repeated settings and aliases cannot hide earlier conflicts; host override is never enabled',async t=>{
  assert.throws(()=>parseClientArguments(['--settings={"env":{"anthropic_base_url":"fixture"}}','--settings={}']),/anthropic_base_url/);
  assert.throws(()=>parseClientArguments(['--setting-sources','managed']),/Invalid --setting-sources/);
  assert.throws(()=>parseClientArguments(['--setting-sources']),/requires/);
  const f=fixture(t);await assert.rejects(preflightClientSettings([],{...f.options,env:{...f.options.env,CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST:'1'}}),/PROVIDER_MANAGED_BY_HOST/);
  for(const settings of [{policyHelper:'fixture-not-run'},{wslInheritsWindowsSettings:true},{forceLoginMethod:'gateway'},{env:[]}])
    assert.throws(()=>validateClientSettings(settings));
});
test('Claude real Windows registry inspection is metadata-safe and read-only',{skip:process.platform!=='win32'},async()=>{
  const rows=await readWindowsPolicies();assert.ok(Array.isArray(rows));
  for(const row of rows){assert.equal(typeof row.source,'string');assert.equal(typeof row.settings,'object');}
});
