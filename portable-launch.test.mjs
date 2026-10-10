import test from 'node:test';
import assert from 'node:assert/strict';

test('one portable entry point selects stock Codex or Claude without a shell',async()=>{
  const {selectClient}=await import('./launch.mjs');
  assert.deepEqual(selectClient(['codex','--port','4141','--','exec','hello']),{client:'codex',args:['--port','4141','--','exec','hello']});
  assert.deepEqual(selectClient(['claude','--','-p','hello']),{client:'claude',args:['--','-p','hello']});
  for(const args of [[],['unknown'],['cmd.exe']])assert.throws(()=>selectClient(args));
});

test('Codex launch arguments require isolated ports and validate model/effort',async()=>{
  const {parseCodexLaunchArguments}=await import('./codex-gateway/launch.mjs');
  assert.deepEqual(parseCodexLaunchArguments(['--port','4151','--model','gpt-6.1-sol','--effort','high','--','exec','hello']),
    {port:4151,model:'gpt-6.1-sol',effort:'high',setupPort:0,openSetup:false,clientArgs:['exec','hello']});
  for(const args of [['--port','4144','--'],['--port','0','--'],['--effort','ultra','--'],
    ['--model','openai/gpt-6.1-sol','--'],['--port','4151','--port','4152','--']])assert.throws(()=>parseCodexLaunchArguments(args));
});

test('Codex client routing/auth/profile overrides cannot defeat the portable wrapper',async()=>{
  const {validateCodexClientArguments}=await import('./codex-gateway/launch.mjs');
  for(const args of [['-m','gpt-other'],['--oss'],['--profile','work'],['-c','model_provider="other"'],
    ['-c','model_catalog_json="other.json"'],['-c','model_context_window=10000000'],
    ['--config=model_providers.x.base_url="https://example.invalid"'],['-c','"model_provider"="other"'],['login'],['logout']])
    assert.throws(()=>validateCodexClientArguments(args));
  assert.doesNotThrow(()=>validateCodexClientArguments(['exec','--sandbox','read-only','-c','approval_policy="on-request"','hello']));
});

test('Codex environment and CLI overrides are child-only and do not replace saved auth',async()=>{
  const {codexServerEnvironment,codexClientEnvironment,codexClientArguments}=await import('./codex-gateway/launch.mjs');
  const original={BRIDGE_PORT:'4144',BRIDGE_RUNTIME_DIRECTORY:'PRIVATE_EXISTING',RELAY_OPENAI_ENABLED:'1',
    RELAY_OPENAI_API_KEY:'PRIVATE_API',CODEX_HOME:'PRIVATE_HOME',GITHUB_TOKEN:'PRIVATE_GITHUB'};
  const server=codexServerEnvironment({port:4141,model:'gpt-6.1-sol',runtimeDirectory:'PRIVATE_ISOLATED',cwd:'PRIVATE_CWD',token:'LOCAL_TEST_TOKEN'},original);
  const child=codexClientEnvironment('LOCAL_TEST_TOKEN',original);
  assert.equal(server.BRIDGE_PORT,'4141');assert.equal(server.BRIDGE_RUNTIME_DIRECTORY,'PRIVATE_ISOLATED');
  assert.equal(server.BRIDGE_AUTH_TOKEN,'LOCAL_TEST_TOKEN');
  assert.equal(server.RELAY_OPENAI_ENABLED,'0');assert.equal(server.RELAY_OPENAI_API_KEY,undefined);
  assert.equal(child.CODEX_COPILOT_BRIDGE_KEY,'LOCAL_TEST_TOKEN');assert.equal(child.BRIDGE_PORT,undefined);
  assert.equal(original.BRIDGE_PORT,'4144');assert.equal(original.RELAY_OPENAI_ENABLED,'1');
  assert.equal(child.CODEX_HOME,'PRIVATE_HOME');assert.equal(server.GITHUB_TOKEN,'PRIVATE_GITHUB');
  const args=codexClientArguments({port:4141,model:'gpt-6.1-sol',effort:'xhigh',providerId:'copilot_cli_fixture',catalogPath:'/isolated/catalog.json',clientArgs:['exec','hello']});
  assert.ok(args.includes('model_catalog_json="/isolated/catalog.json"'));
  assert.ok(args.includes('model_provider="copilot_cli_fixture"'));
  const provider=args.find(value=>value.startsWith('model_providers.'));
  assert.match(provider,/env_key="CODEX_COPILOT_BRIDGE_KEY"/);assert.match(provider,/requires_openai_auth=false/);
  assert.doesNotMatch(provider,/PRIVATE|LOCAL_TEST_TOKEN|experimental_bearer_token/);
  assert.deepEqual(args.slice(-2),['exec','hello']);
});
