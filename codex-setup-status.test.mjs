import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {inspectInstallation,connectionStates} from './setup-status.mjs';
import {resolvePortableCodexConfig,inspectPortableRouting,inspectCodexCli} from './codex-setup-status.mjs';

const route=`model_provider = "github_copilot_bridge"
[model_providers.github_copilot_bridge]
base_url = "http://127.0.0.1:4144/v1"
wire_api = "responses"
`;
async function fixture(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'relay-portable-status-'));
  const env={CODEX_HOME:root};
  const inspect=(options={})=>inspectInstallation({root,port:4144,platform:'linux',env,
    codexProbe:async()=>({installed:true,version:'0.147.0'}),...options});
  try{return await run({root,env,inspect,config:path.join(root,'config.toml')});}
  finally{await fs.rm(root,{recursive:true,force:true});}
}

for(const platform of ['linux','darwin'])test(`${platform} diagnostics detect installed Codex and user-file routing without claiming traffic`,()=>fixture(async({config,inspect,env})=>{
  await fs.writeFile(config,route+'\n[model_providers.other.http_headers]\nAuthorization = "PRIVATE_FIXTURE_ONLY"\n');
  await fs.writeFile(path.join(env.CODEX_HOME,'auth.json'),'PRIVATE_AUTH_FIXTURE_ONLY');
  const before=await fs.readFile(config);
  const result=await inspect({platform});
  assert.equal(result.installed,true);assert.equal(result.version,'0.147.0');
  assert.equal(result.configured,true);assert.equal(result.configExists,true);assert.equal(result.customHome,true);
  assert.equal(result.configurationScope,'user-file-only');assert.equal(result.effectiveConfigurationVerified,false);
  assert.equal(result.backup,'not-managed');assert.equal(result.unsupportedPlatform,undefined);
  assert.equal(connectionStates({installation:result,relay:{ok:true}}).codex,'configured');
  assert.equal(connectionStates({installation:result,relay:null}).codex,'relay-offline');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|Authorization|auth\.json|CODEX_HOME/);
  assert.deepEqual(await fs.readFile(config),before);
  assert.equal(await fs.readFile(path.join(env.CODEX_HOME,'auth.json'),'utf8'),'PRIVATE_AUTH_FIXTURE_ONLY');
}));

test('portable missing-client and failed-version checks remain distinct',()=>fixture(async({config,inspect})=>{
  await fs.writeFile(config,route);
  let result=await inspect({codexProbe:async()=>({installed:false})});
  assert.equal(result.configured,true);assert.equal(connectionStates({installation:result}).codex,'not-found');
  result=await inspect({codexProbe:async()=>({checkFailed:true})});
  assert.equal(connectionStates({installation:result}).codex,'unknown');
}));

test('portable diagnostics do not create a missing user config',()=>fixture(async({root,config,inspect})=>{
  const result=await inspect();
  assert.equal(result.installed,true);assert.equal(result.configExists,false);assert.equal(result.configured,false);
  assert.equal(connectionStates({installation:result}).codex,'not-configured');
  assert.deepEqual(await fs.readdir(root),[]);assert.equal(await fs.access(config).then(()=>true,()=>false),false);
}));

test('portable routing reads only the selected provider and exact loopback port',()=>fixture(async({config,inspect})=>{
  for(const text of [route.replace('4144','4246'),route.replace('127.0.0.1','example.invalid'),
    route.replace('"responses"','"chat"'),route.replace('model_provider = "github_copilot_bridge"','model_provider = "openai"'),
    '# '+route.replaceAll('\n','\n# '), '[some.other.table]\n'+route]){
    await fs.writeFile(config,text);const result=await inspect();
    assert.equal(result.configured,false);assert.equal(result.checkFailed,undefined);
  }
  await fs.writeFile(config,`model_provider = 'github_copilot_bridge' # route
[model_providers."github_copilot_bridge"]
base_url = 'http://localhost:4144/v1/' # exact loopback
`);
  assert.equal((await inspect()).configured,true);
}));

test('ambiguous routing is unknown instead of a false configured or missing-client status',()=>fixture(async({config,inspect})=>{
  for(const text of [
    'profile = "work"\n'+route,
    'model_provider = "openai"\n'+route,
    route+'base_url = "http://example.invalid/v1"\n',
    route+'\n[model_providers.github_copilot_bridge]\nbase_url = "http://example.invalid/v1"\n',
    'instructions = """\n'+route+'"""\n',
    'instructions = \'\'\'\n'+route+"'''\n",
    'model_providers = {github_copilot_bridge = {base_url="http://127.0.0.1:4144/v1"}}\n'+route,
    'model_provider = "github_copilot_bridge\n'+route,
    'args = [\n"example"\n]\n'+route,
  ]){
    await fs.writeFile(config,text);const result=await inspect();
    assert.equal(result.installed,true);assert.equal(result.configured,false);assert.equal(result.checkFailed,true);
    assert.equal(connectionStates({installation:result,relay:{ok:true}}).codex,'unknown');
  }
}));

test('portable config read is bounded and an invalid home never falls back to the real profile',()=>fixture(async({config,inspect})=>{
  await fs.writeFile(config,route+'#'.repeat(1024*1024));
  const large=await inspect();assert.equal(large.checkFailed,true);assert.equal(large.configCheck,'too-large');
  const invalid=await inspect({env:{CODEX_HOME:'relative-private-home'}});
  assert.equal(invalid.checkFailed,true);assert.equal(invalid.configCheck,'invalid-home');assert.equal(invalid.configured,false);
  assert.doesNotMatch(JSON.stringify(invalid),/relative-private-home/);
}));

test('portable diagnostics retain observed-traffic expiry independently from routing',()=>fixture(async({config,inspect})=>{
  await fs.writeFile(config,route);const installation=await inspect();const now=Date.now();
  const relay={ok:true,lastCodexRequestAt:new Date(now-1000).toISOString()};
  assert.equal(connectionStates({installation,relay,now}).codex,'traffic-observed');
  assert.equal(connectionStates({installation,relay,now:now+120000}).codex,'configured');
}));

test('portable home selection supports absolute overrides and tilde without a hardcoded profile',()=>{
  const home=path.join(os.tmpdir(),'fixture-home');
  assert.deepEqual(resolvePortableCodexConfig({},home),{config:path.join(home,'.codex/config.toml'),customHome:false});
  assert.deepEqual(resolvePortableCodexConfig({HOME:home,CODEX_HOME:'~/relay-profile'}),
    {config:path.join(home,'relay-profile/config.toml'),customHome:true});
  assert.throws(()=>resolvePortableCodexConfig({CODEX_HOME:'relative'},home));
});

test('portable routing does not confuse quoted dotted keys, comments or unrelated strings with routing',()=>{
  for(const text of [
    `"model_provider.fake" = "github_copilot_bridge"\n["model_providers.github_copilot_bridge"]\nbase_url = "http://127.0.0.1:4144/v1"`,
    `note = 'model_provider = "github_copilot_bridge" # not a setting'\n[unrelated]\nbase_url = "http://127.0.0.1:4144/v1"`,
    route.replace('http://127.0.0.1:4144/v1','http://token@127.0.0.1:4144/v1'),
    route.replace('http://127.0.0.1:4144/v1','http://127.0.0.1:4144/v1?extra=1'),
  ])assert.equal(inspectPortableRouting(text,4144).configured,false);
  assert.equal(inspectPortableRouting('  '+route.replaceAll('\n','\n  '),4144).configured,true);
  assert.equal(inspectPortableRouting(route,0).checkFailed,true);
});

test('CLI diagnostic admits only a successful bounded Codex version and does not leak arbitrary output',async()=>{
  const probe=code=>inspectCodexCli({executable:process.execPath,arguments:['-e',code]});
  assert.deepEqual(await probe("console.log('codex-cli 0.147.0')"),{installed:true,version:'0.147.0'});
  for(const code of ["console.log('PRIVATE_FIXTURE');process.exit(1)","console.log('node v22')","console.log('x'.repeat(8192))"])
    assert.deepEqual(await probe(code),{checkFailed:true});
  const missing=await inspectCodexCli({executable:path.join(os.tmpdir(),'relay-nonexistent-client-72f864')});
  assert.deepEqual(missing,{installed:false});
});

test('CLI diagnostic ends its own stalled version process without mutating the parent environment',async()=>{
  // Never let an assertion failure print inherited credential values.
  const digest=()=>createHash('sha256').update(JSON.stringify(Object.entries(process.env).sort())).digest('hex');
  const original=digest();const start=Date.now();
  const result=await inspectCodexCli({executable:process.execPath,
    arguments:['-e','setInterval(()=>{},1000)'],timeoutMs:150});
  assert.deepEqual(result,{checkFailed:true});assert.ok(Date.now()-start<5000);
  assert.equal(digest(),original);
});

test('portable diagnostics reject directories and symlinked configs without touching their targets',()=>fixture(async({root,config,inspect})=>{
  await fs.mkdir(config);assert.equal((await inspect()).configCheck,'unavailable');
  await fs.rmdir(config);
  if(process.platform!=='win32'){
    const target=path.join(root,'private-target');await fs.writeFile(target,route);
    await fs.symlink(target,config);assert.equal((await inspect()).configCheck,'unavailable');
    assert.equal(await fs.readFile(target,'utf8'),route);
  }
}));

test('unknown platforms report unavailable rather than a fabricated missing installation',async()=>{
  const result=await inspectInstallation({root:process.cwd(),port:4144,platform:'freebsd'});
  assert.equal(result.unsupportedPlatform,true);assert.equal(connectionStates({installation:result}).codex,'unknown');
});
