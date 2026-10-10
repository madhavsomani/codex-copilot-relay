// Explicit, small real-provider verification. No client GUI is driven here.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {launch} from './unified-launch.mjs';
if(!process.argv.includes('--live'))throw new Error('Use --live to authorize bounded Copilot inference probes.');
const port=Number(process.env.UNIFIED_PROBE_PORT??4265),base=`http://127.0.0.1:${port}`;
let terminal,claudeKey,codexKey,phase=0;
async function verify(){
  const headers={'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+claudeKey,
    'x-claude-code-session-id':'unified-verification'};
  const message=async body=>{const response=await fetch(base+'/claude/v1/messages',{method:'POST',headers,
    body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const result=await response.json();
    assert.equal(response.status,200,`Claude HTTP ${response.status}: ${result.error?.message??''}`);return result;};
  const started=Date.now();
  const [tiny,codexResponse]=await Promise.all([
    message({model:'claude-opus-5-5',max_tokens:1,messages:[{role:'user',content:'Hi'}]}),
    fetch(base+'/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+codexKey},
      body:JSON.stringify({model:'gpt-6.1-sol',stream:true,reasoning:{effort:'low'},
        input:[{role:'user',content:[{type:'input_text',text:'Reply exactly UNIFIED_CODEX_OK. Do not call tools.'}]}]}),signal:AbortSignal.timeout(45000)})]);
  assert.equal(tiny.stop_reason,'max_tokens');assert.equal(codexResponse.status,200);
  const wire=await codexResponse.text();
  const events=wire.split(/\r?\n\r?\n/).map(block=>block.split(/\r?\n/).find(line=>line.startsWith('data: ')))
    .filter(Boolean).map(line=>JSON.parse(line.slice(6)));
  const completed=events.find(event=>event.type==='response.completed');assert.ok(completed,'Codex stream requires response.completed');
  const text=completed.response.output.filter(item=>item.type==='message').flatMap(item=>item.content??[]).map(item=>item.text??'').join('');
  assert.equal(text,'UNIFIED_CODEX_OK');
  const body={model:'claude-opus-5-5',max_tokens:1024,output_config:{effort:'low'},
    tools:[{name:'Echo',description:'Returns a verification marker. Call this once with value UNIFIED_TOOL_OK.',
      input_schema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}],
    messages:[{role:'user',content:'Call Echo exactly once with value UNIFIED_TOOL_OK, then reply with exactly the returned marker. This is a synthetic test.'}]};
  const first=await message(body),tools=first.content.filter(block=>block.type==='tool_use');
  assert.equal(first.stop_reason,'tool_use');assert.equal(tools.length,1);assert.equal(tools[0].name,'Echo');
  const next={...body,max_tokens:2048,messages:[...body.messages,{role:'assistant',content:first.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:tools[0].id,content:'UNIFIED_TOOL_OK'}]}]};
  const final=await message(next);
  assert.equal(final.content.filter(block=>block.type==='text').map(block=>block.text).join(''),'UNIFIED_TOOL_OK');
  assert.equal(final.stop_reason,'end_turn');
  const receipt=await (await fetch(base+'/claude/metrics',{headers:{authorization:'Bearer '+claudeKey}})).json();
  assert.equal(receipt.recent.at(-1).continuationMode,'rebuilt');
  assert.equal(receipt.recent.at(-1).status,'completed');
  console.log(JSON.stringify({verified:true,guiVerified:false,elapsedMs:Date.now()-started,
    codex:{model:completed.response.model,usage:completed.response.usage,marker:text},
    claude:{version:'0.1.15',completed:receipt.completed,failed:receipt.failed,usage:receipt.usage,
      continuationChanges:receipt.recent.at(-1).continuationChanges}},null,2));
}
await launch(['--port',String(port)],{reveal:key=>{if(phase++===0)claudeKey=key;else codexKey=key;},
  createConsole:()=>{
    terminal=createInterface({input:process.stdin,output:process.stdout});
    setImmediate(async()=>{
      terminal.emit('line','key');terminal.emit('line','codex-key');
      try{await verify();if(process.argv.includes('--hold'))console.log('Probe complete; connection page stays up until quit.');}
      catch(error){console.error(error.message);process.exitCode=1;terminal.emit('line','quit');}
      finally{claudeKey=null;codexKey=null;if(!process.argv.includes('--hold'))terminal.emit('line','quit');}
    });return terminal;
  }});
