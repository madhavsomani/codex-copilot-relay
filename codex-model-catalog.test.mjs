import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildCodexModelCatalog,selectSdkGptModelDetails,validateCatalogClientVersion} from './codex-gateway/model-catalog.mjs';

const detail=(id='gpt-6.1-sol')=>({id,name:'GPT-6.1 Sol',policy:{state:'enabled'},
  capabilities:{supports:{vision:true,reasoningEffort:true},limits:{max_context_window_tokens:400000,max_prompt_tokens:272000}},
  supportedReasoningEfforts:['none','low','medium','high','xhigh'],defaultReasoningEffort:'high'});
const capability=()=>({maxContextWindowTokens:400000,maxPromptTokens:272000,maxOutputTokens:128000,
  maxImageAttachments:1,supportedReasoningEfforts:['none','low','medium','high','xhigh'],defaultReasoningEffort:'xhigh'});
const build=(modelDetails=[detail()],modelCapabilities={'gpt-6.1-sol':capability()})=>
  buildCodexModelCatalog({modelDetails,modelCapabilities,selectedModel:'gpt-6.1-sol'});

test('Codex catalog uses exact entitled SDK identity and relay-effective capabilities, not stock fallbacks',()=>{
  const catalog=build(),model=catalog.models[0];
  assert.equal(model.slug,'gpt-6.1-sol');assert.equal(model.display_name,'GPT-6.1 Sol');
  assert.equal(model.context_window,400000);assert.equal(model.max_context_window,400000);
  assert.equal(model.effective_context_window_percent,68);assert.equal(model.auto_compact_token_limit,244800);
  assert.equal(model.default_reasoning_level,'xhigh');
  assert.deepEqual(model.supported_reasoning_levels.map(value=>value.effort),detail().supportedReasoningEfforts);
  assert.deepEqual(model.input_modalities,['text','image']);assert.equal(model.supports_parallel_tool_calls,true);
  assert.equal(model.supports_search_tool,false);assert.equal(model.use_responses_lite,false);
  assert.equal(model.supports_image_detail_original,false);assert.deepEqual(model.service_tiers,[]);
  assert.doesNotMatch(JSON.stringify(catalog),/used_fallback_model_metadata|billing|account|PRIVATE_CREDENTIAL/);
});

test('SDK model metadata selection is allowlisted, policy-aware, bounded, and credential-free',()=>{
  const original={...detail(),PRIVATE_CREDENTIAL:'do-not-copy',billing:{multiplier:99}};
  const selected=selectSdkGptModelDetails([original,{...detail('gpt-disabled'),policy:{state:'disabled'}},detail('claude-opus-5.5')]);
  assert.deepEqual(selected.map(value=>value.id),['gpt-6.1-sol']);
  assert.equal(selected[0].PRIVATE_CREDENTIAL,undefined);assert.equal(selected[0].billing,undefined);
  original.capabilities.limits.max_context_window_tokens=1;
  assert.equal(selected[0].capabilities.limits.max_context_window_tokens,400000);
  assert.throws(()=>selectSdkGptModelDetails(Array.from({length:129},()=>detail())));
});

test('catalog intersects authenticated discovery with relay capabilities and does not invent image support',()=>{
  const other=detail('gpt-fixture-text');other.capabilities.supports.vision=false;
  const catalog=build([detail(),other,detail('gpt-not-in-relay')],{
    'gpt-6.1-sol':capability(),'gpt-fixture-text':{...capability(),maxImageAttachments:0},'gpt-not-entitled':capability()});
  assert.deepEqual(catalog.models.map(value=>value.slug),['gpt-6.1-sol','gpt-fixture-text']);
  assert.deepEqual(catalog.models[1].input_modalities,['text']);
});

test('catalog rejects unknown, duplicate, inconsistent, or missing metadata before launching Codex',()=>{
  const badDetails=[[],[detail(),detail()],[{...detail(),capabilities:{supports:{vision:true},limits:{}}}]];
  for(const value of badDetails)assert.throws(()=>build(value));
  for(const change of [{maxContextWindowTokens:500000},{maxPromptTokens:300000},
    {maxContextWindowTokens:null},{supportedReasoningEfforts:['ultra']},{defaultReasoningEffort:'max'}])
    assert.throws(()=>build([detail()],{'gpt-6.1-sol':{...capability(),...change}}));
});

test('catalog keeps the reviewed stock generic prompt and ships its source attribution',()=>{
  const model=build().models[0];
  const prompt=fs.readFileSync(new URL('./codex-gateway/stock-client-0.147.0/prompt.md',import.meta.url),'utf8');
  assert.equal(model.model_messages.instructions_template,prompt);
  assert.equal(createHash('sha256').update(prompt).digest('hex'),'ac8ae107a0d72fe3476b430afb161ea4e67da2e446d778aefc44828160559807');
  assert.ok(fs.readFileSync(new URL('./codex-gateway/stock-client-0.147.0/LICENSE',import.meta.url),'utf8').includes('Apache License'));
  assert.ok(fs.readFileSync(new URL('./codex-gateway/stock-client-0.147.0/NOTICE',import.meta.url),'utf8').includes('OpenAI'));
});

test('catalog protocol/prompt support is version-gated rather than silently applied to an unreviewed stock client',()=>{
  assert.doesNotThrow(()=>validateCatalogClientVersion('codex-cli 0.147.0\n'));
  for(const value of ['codex-cli 0.148.0','codex-cli 0.147.0-custom','not codex-cli 0.147.0'])
    assert.throws(()=>validateCatalogClientVersion(value));
});

test('actual stock Codex 0.147.0 model/list uses the exact isolated catalog and effort picker without inference',async t=>{
  const stock=fileURLToPath(new URL('./node_modules/@openai/codex/bin/codex.js',import.meta.url));
  if(!fs.existsSync(stock)){t.skip('Pinned stock Codex is not installed.');return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-model-catalog-'));
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const catalogPath=path.join(root,'models.json');fs.writeFileSync(catalogPath,JSON.stringify(build()));
  const child=spawn(process.execPath,[stock,'-c',`model_catalog_json=${JSON.stringify(catalogPath)}`,
    '-c','model="gpt-6.1-sol"','-c','model_provider="fixture"',
    '-c','model_providers.fixture={name="Local fixture",base_url="http://127.0.0.1:1/v1",wire_api="responses",env_key="LOCAL_TEST_KEY",requires_openai_auth=false}',
    'app-server','--stdio'],{cwd:root,windowsHide:true,env:{...process.env,CODEX_HOME:root,LOCAL_TEST_KEY:'LOCAL_ONLY',RUST_LOG:'codex_models_manager=warn'},stdio:['pipe','pipe','pipe']});
  const stopped=once(child,'close');let buffer='',errors='',bytes=0,timer;
  const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  const result=await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Stock catalog RPC timed out')),10000);
    child.once('error',()=>reject(new Error('Stock catalog RPC failed to start')));
    child.stderr.on('data',chunk=>{if(errors.length<65536)errors+=chunk.toString();});
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>1048576)return reject(new Error('Stock catalog RPC exceeded its output bound'));
      buffer+=chunk.toString();let boundary;
      while((boundary=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);let message;
        try{message=JSON.parse(line);}catch{continue;}
        if(message.error)return reject(new Error('Stock catalog RPC rejected its request'));
        if(message.id===1){send({method:'initialized',params:{}});send({id:2,method:'model/list',params:{includeHidden:true}});}
        if(message.id===2)resolve(message.result);
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'catalog_fixture',version:'1.0.0'}}});
  }).finally(()=>{clearTimeout(timer);child.stdin.end();child.kill();});
  await stopped;
  assert.deepEqual(result.data.map(value=>value.model),['gpt-6.1-sol']);
  const model=result.data[0];assert.equal(model.displayName,'GPT-6.1 Sol');assert.equal(model.isDefault,true);
  assert.equal(model.defaultReasoningEffort,'xhigh');
  assert.deepEqual(model.supportedReasoningEfforts.map(value=>value.reasoningEffort),detail().supportedReasoningEfforts);
  assert.deepEqual(model.inputModalities,['text','image']);
  assert.equal(/Unknown model|fallback model metadata/i.test(errors),false);
});
