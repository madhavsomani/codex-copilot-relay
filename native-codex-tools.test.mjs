import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {nativeEnvironment, nativeArguments, prepareNativeSearch, validateImageRequest,
  runNativeCodex, searchWithNativeCodex, nativeJobs} from './native-codex-tools.mjs';
import {extractToolDeclarations, resolveRequestCompatibility} from './bridge-core.mjs';
import {ResponsesEventStream} from './responses-stream.mjs';

test('native helpers retain login location but exclude credentials and endpoint/agent overrides', () => {
  const env = nativeEnvironment({Path:'bin', CODEX_HOME:'profile', OPENAI_API_KEY:'synthetic', OPENAI_BASE_URL:'http://relay', BRIDGE_AUTH_TOKEN:'synthetic', CODEX_THREAD_ID:'parent', NODE_OPTIONS:'injected'});
  assert.deepEqual(env, {Path:'bin',CODEX_HOME:'profile',RUST_LOG:'off'});
  const args = nativeArguments('search', 'gpt-6-astra', 'temporary');
  for (const value of ['--ignore-user-config','--ephemeral','read-only','model_provider="openai"','features.shell_tool=false','features.multi_agent=false','features.apps=false','features.image_generation=false','web_search="live"']) assert.ok(args.includes(value));
  assert.equal(args.at(-1), '-');
});

test('hosted search requires opt-in and refuses constraints it cannot enforce', () => {
  const body={tools:[{type:'web_search'}], tool_choice:{type:'web_search'}};
  assert.throws(()=>prepareNativeSearch(body,false),{code:'native_tools_disabled'});
  for (const extra of [{filters:{allowed_domains:['example.com']}},{user_location:{city:'Seattle'}},{external_web_access:false},{search_context_size:'high'}])
    assert.throws(()=>prepareNativeSearch({tools:[{type:'web_search',...extra}]},true),{code:'unsupported_parameter'});
  const prepared=prepareNativeSearch(body,true);
  assert.equal(prepared.search,true);
  assert.doesNotThrow(()=>resolveRequestCompatibility(prepared.body));
  assert.equal(extractToolDeclarations(prepared.body).sdkTools.length,1);
  assert.equal(body.tools[0].type,'web_search');
});

test('image adapter enforces its actual contract before performing native work', () => {
  const body={model:'gpt-image-2',prompt:'Synthetic fixture',quality:'auto',size:'auto',background:'auto'};
  assert.deepEqual(validateImageRequest(body),[]);
  for (const extra of [{model:'different'},{n:2},{size:'4096x4096'},{background:'transparent'},{mask:'local-file'}])
    assert.throws(()=>validateImageRequest({...body,...extra}),{code:'unsupported_parameter'});
  for (const value of ['file:///secret.png','https://example.com/image.png','data:image/png;base64,???'])
    assert.throws(()=>validateImageRequest({...body,images:[{image_url:value}]},true),{code:'invalid_image_reference'});
});

function fakeProcess(events, {finish=true, code=0}={}) {
  return () => {
    const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.stdin=new PassThrough();
    child.kill=()=>{setImmediate(()=>child.emit('close',1)); return true;};
    child.stdin.on('finish',()=>setImmediate(()=>{
      const bytes=Buffer.from(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
      for (let i=0;i<bytes.length;i++) child.stdout.write(bytes.subarray(i,i+1));
      if(finish) child.emit('close',code);
    }));
    return child;
  };
}
const config={enabled:true,codexPath:'fixture',model:'fixture'};
test('native JSONL preserves split UTF-8 and requires actual completed search evidence',async()=>{
  const events=[{type:'thread.started',thread_id:'00000000-0000-0000-0000-000000000000'},
    {type:'item.completed',item:{id:'search1',type:'web_search',action:{type:'search',query:'test'}}},
    {type:'item.completed',item:{type:'agent_message',text:'Café [source](https://example.com)'}},
    {type:'turn.completed',usage:{input_tokens:1,output_tokens:2}}];
  const progress=[];
  const result=await searchWithNativeCodex(config,'test',{spawnProcess:fakeProcess(events),onSearch:item=>progress.push(item)});
  assert.equal(result.text,'Café [source](https://example.com)'); assert.equal(progress.length,1);
  await assert.rejects(searchWithNativeCodex(config,'test',{spawnProcess:fakeProcess(events.filter(e=>e.item?.type!=='web_search'))}),{code:'native_search_not_performed'});
  assert.equal(nativeJobs.size,0);
});
test('cancelled and incomplete native jobs release their capacity',async()=>{
  await assert.rejects(runNativeCodex(config,'search','x',{spawnProcess:fakeProcess([])}),{code:'native_turn_incomplete'});
  const controller=new AbortController();
  const result=runNativeCodex(config,'search','x',{signal:controller.signal,spawnProcess:fakeProcess([],{finish:false})});
  controller.abort(); await assert.rejects(result,{code:'native_tool_cancelled'}); assert.equal(nativeJobs.size,0);
});
test('native search SSE keeps stable output indexes and does not duplicate terminal items',()=>{
  const events=[]; const stream=new ResponsesEventStream({responseId:'r',model:'m',emit:e=>events.push(e)}); stream.start();
  const first={id:'ws1',type:'web_search_call',status:'in_progress',action:{type:'search',query:'test'}};
  stream.observeWebSearch(first); stream.appendTextDelta('Found it.');
  const done={...first,status:'completed'}; stream.observeWebSearch(done);
  const message=stream.finishText('Found it.'); stream.complete([done,message],null);
  const added=events.filter(e=>e.type==='response.output_item.added');
  assert.deepEqual(added.map(e=>e.output_index),[0,1]);
  assert.equal(events.filter(e=>e.type==='response.output_item.done'&&e.item.id==='ws1').length,1);
  assert.equal(events.at(-1).type,'response.completed');
});
