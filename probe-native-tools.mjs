import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadNativeToolsConfig, nativeEnvironment} from './native-codex-tools.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const runtime=path.join(root,'runtime','native-probe-'+Date.now()); await fs.mkdir(runtime,{recursive:true});
const reservation=net.createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
const port=reservation.address().port; await new Promise(resolve=>reservation.close(resolve)); assert.notEqual(port,4144);
const env={...process.env,BRIDGE_PORT:String(port),BRIDGE_RUNTIME_DIRECTORY:runtime,BRIDGE_DEFAULT_MODEL:'gpt-6-astra'};
delete env.BRIDGE_AUTH_TOKEN; delete env.BRIDGE_EVENT_LOG_PATH;
const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
const events=[]; child.stdout.on('data',data=>events.push(data.toString())); child.stderr.resume();
const report={port,runtime,checks:[],startedAt:new Date().toISOString()};
try {
  for(let i=0;i<120;i++) {
    try {const h=await(await fetch('http://127.0.0.1:'+port+'/health')).json();if(h.ok){report.health=h;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(report.health?.nativeTools.enabled); console.log(JSON.stringify({stage:'ready',port,version:report.health.version}));
  const base='http://127.0.0.1:'+port+'/v1';
  const response=await fetch(base+'/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'gpt-6-astra',reasoning:{effort:'low'},tools:[{type:'web_search'}],tool_choice:{type:'web_search'},input:'First say Searching now as brief commentary. Then find the official OpenAI Codex documentation using live web search and return one actual source URL.'}),signal:AbortSignal.timeout(240000)});
  const wire=await response.text(); await fs.writeFile(path.join(runtime,'search.sse'),wire);
  assert.equal(response.status,200); const parsed=wire.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
  const complete=parsed.find(e=>e.type==='response.completed');
  assert.ok(complete,'Native search must complete: '+wire.slice(-1000));
  assert.ok(complete.response.output.some(item=>item.type==='web_search_call'&&item.status==='completed'));
  assert.ok(complete.response.output.some(item=>item.type==='message'&&JSON.stringify(item).includes('https://')));
  assert.ok(!complete.response.output.some(item=>item.type==='function_call'),'Internal search tool must not escape to Codex');
  const doneItems=parsed.filter(e=>e.type==='response.output_item.done').sort((a,b)=>a.output_index-b.output_index);
  assert.deepEqual(complete.response.output.map(item=>item.id),doneItems.map(event=>event.item.id),'Terminal response must preserve all streamed items in order');
  report.checks.push('native search SSE, actual search action, source URL, terminal event'); console.log(JSON.stringify({stage:'search_passed'}));
  if(process.argv.includes('--desktop')) {
    const config=await loadNativeToolsConfig(root);
    const catalog=JSON.parse(await fs.readFile(path.join(root,'runtime','codex-copilot-models.json'),'utf8'));
    for(const model of catalog.models) model.supports_search_tool=true;
    const catalogPath=path.join(runtime,'native-models.json'); await fs.writeFile(catalogPath,JSON.stringify(catalog));
    const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--json','--sandbox','read-only','--model','gpt-6-astra','--cd',runtime,
      '-c','model_provider="relay_fixture"','-c','model_providers.relay_fixture.name="Isolated relay probe"',
      '-c','model_providers.relay_fixture.base_url="'+base+'"','-c','model_providers.relay_fixture.wire_api="responses"',
      '-c','model_providers.relay_fixture.requires_openai_auth=true','-c','model_providers.relay_fixture.experimental_bearer_token="codex-copilot-local-only"',
      '-c','model_catalog_json="'+catalogPath.replaceAll('\\','/')+'"','-c','web_search="live"','-c','model_reasoning_effort="low"','-c','features.shell_tool=false','-c','features.multi_agent=false','-c','features.apps=false','-c','features.image_generation=false','-'];
    const cli=spawn(config.codexPath,args,{cwd:runtime,env:nativeEnvironment(),windowsHide:true,stdio:['pipe','pipe','pipe']});
    const exit=once(cli,'close'); let stdout='';cli.stdout.on('data',data=>{stdout+=data;});cli.stderr.resume();
    const timer=setTimeout(()=>cli.kill(),240000);
    cli.stdin.end('Search the live web for the official OpenAI Codex documentation and return one actual source URL. Use only built-in web search.');
    const [code]=await exit;clearTimeout(timer);await fs.writeFile(path.join(runtime,'desktop.jsonl'),stdout);
    assert.equal(code,0,stdout.slice(-2000));
    const items=stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.ok(items.some(e=>e.type==='item.completed'&&e.item?.type==='web_search'),'Real Codex must recognize the search item.');
    assert.ok(items.some(e=>e.type==='turn.completed'));
    report.checks.push('installed Codex engine recognized native search through relay');console.log(JSON.stringify({stage:'desktop_passed'}));
  }
  const editIndex=process.argv.indexOf('--edit-source');
  if(process.argv.includes('--image') || editIndex >= 0) {
    const imageBody={model:'gpt-image-2',prompt:'A small square watercolor image of an orange robot reading a blue book at a white desk. No words or people.',quality:'auto',size:'auto',background:'auto'};
    if(editIndex >= 0) {
      imageBody.prompt='Change only the blue book to a red book. Preserve the orange robot, watercolor style, composition and all other objects.';
      imageBody.images=[{image_url:'data:image/png;base64,'+(await fs.readFile(process.argv[editIndex+1])).toString('base64')}];
    }
    const image=await fetch(base+(editIndex >= 0 ? '/images/edits' : '/images/generations'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(imageBody),signal:AbortSignal.timeout(600000)});
    const output=await image.json(); assert.equal(image.status,200,JSON.stringify(output));
    const bytes=Buffer.from(output.data[0].b64_json,'base64'); assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    await fs.writeFile(path.join(runtime,'native-image.png'),bytes); report.imagePath=path.join(runtime,'native-image.png');
    report.checks.push('native Images '+(editIndex >= 0 ? 'edits' : 'generations')+' endpoint returned real PNG'); console.log(JSON.stringify({stage:'image_passed',path:report.imagePath}));
  }
  report.ok=true;
} finally {
  report.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(runtime,'report.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(runtime,'events.jsonl'),events.join(''));
  child.kill(); console.log(JSON.stringify({report:path.join(runtime,'report.json'),ok:report.ok===true}));
}
