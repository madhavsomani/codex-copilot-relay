import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {nativeEnvironment, nativeArguments, prepareNativeSearch, validateImageRequest,
  runNativeCodex, nativeJobs, loadNativeToolsConfig, imageWithNativeCodex} from './native-codex-tools.mjs';
import {extractToolDeclarations, resolveRequestCompatibility} from './bridge-core.mjs';
import {ResponsesEventStream} from './responses-stream.mjs';

async function nativeConfigFixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-native-config-'));
  context.after(async () => {
    assert.equal(await fs.realpath(root), root);
    assert.ok(path.basename(root).startsWith('relay-native-config-'));
    await fs.rm(root, {recursive:true, force:true});
  });
  const localAppData = path.join(root, 'Local');
  const bin = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
  const file = path.join(root, 'runtime', 'native-tools.json');
  const versions = new Map();
  const inspected = [];
  await fs.mkdir(path.dirname(file), {recursive:true});
  const options = {localAppData, inspectVersion:async executable => {
    inspected.push(executable);
    return versions.get(executable) ?? 'codex-cli 0.155.0-alpha.9';
  }};
  const write = config => fs.writeFile(file, JSON.stringify(config));
  const install = async (name, modified, version) => {
    const executable = path.join(bin, name, 'codex.exe');
    await fs.mkdir(path.dirname(executable), {recursive:true});
    await fs.writeFile(executable, 'synthetic executable; never launched');
    await fs.utimes(executable, modified, modified);
    if (version) versions.set(executable, version);
    return executable;
  };
  return {root, bin, file, options, write, install, inspected};
}

test('native settings recover successive desktop upgrades without rewriting preferences', async context => {
  const fixture = await nativeConfigFixture(context);
  const retired = path.join(fixture.bin, '1111111111111111', 'codex.exe');
  await fixture.write({enabled:false, imageEnabled:true, searchEnabled:false, codexPath:retired, model:'chosen-model'});
  const before = await fs.readFile(fixture.file, 'utf8');
  const first = await fixture.install('2222222222222222', 100);
  let loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.equal(loaded.imageEnabled, true);
  assert.equal(loaded.codexPath, first);
  assert.equal(loaded.executableSource, 'desktop-update');
  assert.equal(loaded.model, 'chosen-model');
  assert.equal(loaded.searchEnabled, false);
  await fs.unlink(first);
  const second = await fixture.install('3333333333333333', 200);
  loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.equal(loaded.codexPath, second);
  assert.equal(await fs.readFile(fixture.file, 'utf8'), before);
});

test('desktop recovery skips incomplete and unsupported installs', async context => {
  const fixture = await nativeConfigFixture(context);
  await fixture.write({imageEnabled:true, codexPath:path.join(fixture.bin, '11111111', 'codex.exe')});
  const supported = await fixture.install('22222222', 100);
  await fixture.install('33333333', 200, 'codex-cli 0.147.0');
  await fs.mkdir(path.join(fixture.bin, '44444444'), {recursive:true});
  await fixture.install('not-a-desktop-build', 500);
  const loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.equal(loaded.codexPath, supported);
  assert.equal(loaded.codexVersion, '0.155.0-alpha.9');
});

test('native resolution preserves an existing explicitly configured executable', async context => {
  const fixture = await nativeConfigFixture(context);
  const configured = await fixture.install('11111111', 100);
  await fixture.install('22222222', 200);
  await fixture.write({imageEnabled:true, codexPath:configured});
  const loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.equal(loaded.codexPath, configured);
  assert.equal(loaded.executableSource, 'configured');
});

test('recovery selects the newest compatible build and retries after a partial update', async context => {
  const fixture = await nativeConfigFixture(context);
  await fixture.write({imageEnabled:true, codexPath:path.join(fixture.bin, '11111111', 'codex.exe')});
  assert.match((await loadNativeToolsConfig(fixture.root, fixture.options)).error, /No compatible/);
  await fixture.install('22222222', 100);
  const newest = await fixture.install('33333333', 200);
  assert.equal((await loadNativeToolsConfig(fixture.root, fixture.options)).codexPath, newest);
});

test('recovery rejects redirected desktop build directories', async context => {
  const fixture = await nativeConfigFixture(context);
  const external = path.join(fixture.root, 'other-installation');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'codex.exe'), 'not an installed desktop build');
  await fs.mkdir(fixture.bin, {recursive:true});
  await fs.symlink(external, path.join(fixture.bin, '22222222'), process.platform === 'win32' ? 'junction' : 'dir');
  await fixture.write({imageEnabled:true, codexPath:path.join(fixture.bin, '11111111', 'codex.exe')});
  assert.match((await loadNativeToolsConfig(fixture.root, fixture.options)).error, /No compatible/);
  assert.equal(fixture.inspected.length, 0);
});

test('missing custom executables fail visibly instead of falling back to another installation', async context => {
  const fixture = await nativeConfigFixture(context);
  await fixture.install('22222222', 200);
  await fixture.write({imageEnabled:true, codexPath:path.join(fixture.root, 'custom', 'codex.exe')});
  const loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.match(loaded.error, /configured Codex executable.*missing/i);
  assert.equal(loaded.imageEnabled, false);
  assert.equal(fixture.inspected.length, 0);
});

test('missing settings and explicit opt-out never discover or enable native images', async context => {
  const fixture = await nativeConfigFixture(context);
  await fixture.install('22222222', 200);
  for (const config of [null, {enabled:true, imageEnabled:false}, {enabled:false}, {imageEnabled:'false'}]) {
    if (config) await fixture.write(config);
    const loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
    assert.notEqual(loaded.imageEnabled, true);
    assert.equal(fixture.inspected.length, 0);
  }
});

test('legacy image opt-in remains compatible but cannot restore search', async context => {
  const fixture = await nativeConfigFixture(context);
  const executable = await fixture.install('22222222', 200);
  await fixture.write({enabled:true, codexPath:executable});
  const loaded = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.equal(loaded.imageEnabled, true);
  assert.equal(loaded.searchEnabled, false);
  assert.equal(loaded.enabled, false);
});

test('invalid settings and removed installations are not reported as an intentional disable', async context => {
  const fixture = await nativeConfigFixture(context);
  await fs.writeFile(fixture.file, '{invalid');
  assert.match((await loadNativeToolsConfig(fixture.root, fixture.options)).error, /Invalid native-tools.json/);
  await fixture.write({imageEnabled:true, codexPath:path.join(fixture.bin, '11111111', 'codex.exe')});
  const unavailable = await loadNativeToolsConfig(fixture.root, fixture.options);
  assert.match(unavailable.error, /No compatible.*Codex.*installation/i);
  await assert.rejects(imageWithNativeCodex(unavailable, {model:'gpt-image-2', prompt:'not submitted'}), {code:'native_tools_unavailable', statusCode:503});
  await assert.rejects(runNativeCodex(unavailable, 'image', 'not submitted'), {code:'native_tools_unavailable', statusCode:503});
});

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
  assert.deepEqual(validateImageRequest({...body,background:'opaque'}),[]);
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
