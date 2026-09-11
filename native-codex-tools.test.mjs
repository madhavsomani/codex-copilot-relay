import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {nativeEnvironment, nativeArguments, prepareNativeSearch, validateImageRequest,
  runNativeCodex, nativeJobs} from './native-codex-tools.mjs';
import {extractToolDeclarations, resolveRequestCompatibility} from './bridge-core.mjs';
import {ResponsesEventStream} from './responses-stream.mjs';

test('disabled optional search does not break ordinary tools or continuations', () => {
  const fn={type:'function',name:'echo',parameters:{type:'object'}};
  const body={tools:[{type:'web_search'},fn],input:[{type:'function_call_output',call_id:'pending',output:'ok'}]};
  const result=prepareNativeSearch(body,false);
  assert.equal(result.search,false);
  assert.deepEqual(result.body.tools,[fn]);
  assert.deepEqual(result.body.input,body.input);
  assert.equal(body.tools.length,2);
  assert.throws(()=>prepareNativeSearch({tools:[{type:'web_search'}],tool_choice:'required'},false),{code:'native_tools_disabled'});
});

test('images-only settings block search before any helper is spawned', async () => {
  let spawned=false;
  await assert.rejects(runNativeCodex({enabled:false,imageEnabled:true,searchEnabled:false},'search','fixture',{
    spawnProcess:()=>{spawned=true;throw new Error('must not spawn');}
  }),{code:'native_tools_disabled'});
  assert.equal(spawned,false);
});

test('native helpers retain login location but exclude credentials and endpoint/agent overrides', () => {
  const env = nativeEnvironment({Path:'bin', CODEX_HOME:'profile', OPENAI_API_KEY:'synthetic', OPENAI_BASE_URL:'http://relay', BRIDGE_AUTH_TOKEN:'synthetic', CODEX_THREAD_ID:'parent', NODE_OPTIONS:'injected'});
  assert.deepEqual(env, {Path:'bin',CODEX_HOME:'profile',RUST_LOG:'off'});
  const args = nativeArguments('image', 'gpt-6-astra', 'temporary');
  assert.ok(args.includes('features.plugins=false'));
  for (const value of ['--ignore-user-config','--ephemeral','read-only','model_provider="openai"','features.shell_tool=false','features.multi_agent=false','features.apps=false','features.image_generation=true','web_search="disabled"']) assert.ok(args.includes(value));
  assert.equal(args.at(-1), '-');
});

test('legacy enabled flag cannot restore removed search', () => {
  assert.equal(prepareNativeSearch({tools:[{type:'web_search'}]},true).search,false);
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
test('image helper preserves split UTF-8',async()=>{
  const events=[{type:'item.completed',item:{type:'agent_message',text:'Café'}},{type:'turn.completed',usage:{input_tokens:1,output_tokens:2}}];
  const result=await runNativeCodex(config,'image','fixture',{spawnProcess:fakeProcess(events)});
  assert.equal(result.text,'Café');
});
test('cancelled and incomplete native jobs release their capacity',async()=>{
  await assert.rejects(runNativeCodex(config,'image','x',{spawnProcess:fakeProcess([])}),{code:'native_turn_incomplete'});
  const controller=new AbortController();
  const result=runNativeCodex(config,'image','x',{signal:controller.signal,spawnProcess:fakeProcess([],{finish:false})});
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
