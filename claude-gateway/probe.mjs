import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startSdkGateway} from './server.mjs';
import {clientEnvironment,clientArguments} from './launch.mjs';
import {ClaudeRequestHandler} from './request-handler.mjs';
import {digest} from './protocol.mjs';
import {bounded} from '../copilot-runtime.mjs';
import sharp from 'sharp';

// Explicit opt-in: uses the signed-in Copilot account and incurs Copilot usage.
// All source files/configuration edits and MCP execution stay in this fixture.
if(!process.argv.includes('--live'))throw new Error('Add --live to authorize the finite Copilot inference probe.');
const root=fileURLToPath(new URL('../',import.meta.url));const runtime=path.join(root,'runtime');mkdirSync(runtime,{recursive:true});
const workspace=mkdtempSync(path.join(runtime,'claude-live-proof-'));
const diagnostics=[];
// Fixture-only observations: no prompts, credentials, URLs or header values.
const markers=value=>({sonnet:JSON.stringify(value).includes('SONNET_PROOF_OK'),haiku:JSON.stringify(value).includes('HAIKU_PROOF_OK')});
const signed=value=>(value??[]).flatMap(message=>Array.isArray(message.content)?message.content:[])
  .filter(block=>['thinking','redacted_thinking'].includes(block.type)).map(block=>({type:block.type,
    hash:createHash('sha256').update(JSON.stringify(block)).digest('hex'),
    signatureChars:(block.signature??block.data??'').length}));
const shape=value=>(value??[]).map(message=>({role:message.role,keys:Object.keys(message),
  blocks:(typeof message.content==='string'?[{type:'text',text:message.content}]:message.content)
    .map(block=>({type:block.type,keys:Object.keys(block),hash:digest(block)}))}));
let injectActiveOutage=false,outageInjected=false;
// Fixture-only transport fault injection through the existing session-bound
// callback. No client/library binary, system network or production port changes.
class ProbeHandler extends ClaudeRequestHandler{
  bind(sessionId,body,selected,nativeMessages,onEvent){
    // This finite case has only one active request while injection is armed.
    const target=injectActiveOutage;
    super.bind(sessionId,body,selected,nativeMessages,onEvent&&((event)=>{
      onEvent(event);
      if(target)diagnostics.push({boundary:'outage-event',type:event.type,deltaType:event.delta?.type,
        blockType:event.content_block?.type,hasText:Boolean(event.delta?.text||event.content_block?.text)});
      if(target&&!outageInjected&&(event.type==='content_block_delta'&&event.delta?.type==='text_delta'&&event.delta.text
        ||event.type==='content_block_start'&&event.content_block?.type==='text'&&event.content_block.text)){
        outageInjected=true;onEvent({type:'relay_transport_error'});
        onEvent({type:'error',error:{type:'api_error',message:'Fixture injected active transport loss after partial output.'}});
        throw new Error('Fixture injected active stream disconnection.');
      }
    }));
  }
}
const observer=new ProbeHandler(body=>{
    diagnostics.push({boundary:'sdk',keys:Object.keys(body),model:body.model,
      roles:body.messages?.map(m=>m.role),systemChars:JSON.stringify(body.system??body.instructions??body.messages?.filter(m=>m.role==='system')).length,
      markers:markers(body),thinking:body.thinking,signed:signed(body.messages),toolChoice:body.tool_choice,
      outputFormatHash:body.output_config?.format?digest(body.output_config.format):null,
      strictTools:body.tools?.filter(tool=>tool.strict===true).map(tool=>tool.name)});
});
const token=randomBytes(32).toString('hex');const startOptions={token,port:0,workingDirectory:workspace,
  runtimeDirectory:path.join(workspace,'metering'),requestHandler:observer,onFault(error,turn){
    diagnostics.push({boundary:'fault',message:error.message.slice(0,240),
      expected:turn.expectedCalls,native:turn.sink?.blocks.map(block=>({type:block.type,id:block.id,name:block.name,
        inputHash:block.input?createHash('sha256').update(JSON.stringify(block.input)).digest('hex'):null})),
      pending:[...turn.pending.values()].map(call=>({id:call.item.id,name:call.item.name,
        inputHash:createHash('sha256').update(JSON.stringify(call.item.input)).digest('hex')}))});
  },onRequest(body,headers){
    const toolResults=body.messages.at(-1)?.content;
    const holder=Array.isArray(toolResults)?[...gateway.turns].find(turn=>toolResults.some(block=>turn.pending.has(block.tool_use_id))):null;
    diagnostics.push({boundary:'client',requestKeys:Object.keys(body),temperature:body.temperature,toolChoice:body.tool_choice,
      betaControls:headers['anthropic-beta']?.split(',').map(value=>value.trim()),
      requestClass:headers['x-claude-code-request-class'],model:body.model,
      systemChars:JSON.stringify(body.system).length,systemMarkers:markers(body.system),messageMarkers:markers(body.messages),
      thinking:body.thinking,outputConfig:body.output_config,signed:signed(body.messages),
      ...(holder?{historyShape:shape(body.messages.slice(0,-1)),expectedShape:shape(holder.expectedHistory)}:{})});
  }};
let gateway=await startSdkGateway(startOptions);
const env=clientEnvironment(gateway,token,{...process.env,CLAUDE_CONFIG_DIR:path.join(workspace,'client-state')});
const executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude');
const version=await new Promise((resolve,reject)=>{const p=spawn(executable,['--version'],{env,windowsHide:true});let text='';
  p.stdout.on('data',s=>text+=s);p.once('error',reject);p.once('exit',()=>resolve(text.trim()));});
const baseArgs=['--model','claude-opus-5-5','--effort','low','--strict-mcp-config','--setting-sources','project,local','--output-format','json'];
const reports=[];
async function run(name,prompt,args=[]) {
  const started=Date.now();const firstRow=gateway.ledger.state.recent.length;
  const child=spawn(executable,clientArguments([...baseArgs,...args,'-p',prompt],gateway),{env,cwd:workspace,windowsHide:true});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill('SIGTERM'),name==='signed-thinking-tools'?60000:240000);
  child.stdin.end();
  child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
  const result=stdout.trim()?JSON.parse(stdout.trim()):null;
  const report={name,exitCode:code,isError:result?.is_error,result:result?.result,sessionId:result?.session_id,
    subagents:result?.subagent_stats,structuredOutput:result?.structured_output,permissionDenials:result?.permission_denials,wallMs:Date.now()-started,
    requests:gateway.ledger.state.recent.slice(firstRow),stderr:stderr.slice(0,1200)};
  reports.push(report);writeFileSync(path.join(workspace,'report.json'),JSON.stringify({version,reports,diagnostics},null,2));
  console.log(JSON.stringify({name,code,error:report.isError,result:report.result,requests:report.requests.length}));
  assert.equal(code,0,stderr||result?.result||name+' failed');assert.equal(result?.is_error,false,result?.result);
  return result;
}
try {
  const chosen=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7)??'all';
  if(!['all','files','structured','outage','thinking','recovery','mcp','agents','auto','images','skills','resume','local'].includes(chosen))
    throw new Error('Unknown probe case; refusing an empty success report.');
  if(chosen==='structured'){
    const schema={type:'object',properties:{marker:{type:'string',enum:['STOCK_SCHEMA_OK']},answer:{type:'integer',enum:[42]}},
      required:['marker','answer'],additionalProperties:false};
    const r=await run('structured-output','Return marker STOCK_SCHEMA_OK and answer 42 using the supplied output schema.',
      ['--json-schema',JSON.stringify(schema),'--tools','Read','--permission-mode','dontAsk']);
    assert.deepEqual(r.structured_output,{marker:'STOCK_SCHEMA_OK',answer:42});
    assert.ok(reports.at(-1).requests.every(row=>row.status==='completed'),'Stock schema request included failed/rejected gateway calls.');
    const nativeRequested=diagnostics.some(row=>row.boundary==='client'&&row.outputConfig?.format);
    const nativeForwarded=diagnostics.some(row=>row.boundary==='sdk'&&row.outputFormatHash);
    if(nativeRequested)assert.equal(nativeForwarded,true,'Client native format was not forwarded.');
    // Tested stock versions may implement --json-schema without requesting
    // native grammar constraints. Do not mislabel parsed client output as proof
    // of an output_config.format or strict-tool request it never made.
    reports.at(-1).schemaPath={nativeRequested,nativeForwarded,stockParsedOutputVerified:true};
    writeFileSync(path.join(workspace,'report.json'),JSON.stringify({version,reports,diagnostics},null,2));
    console.log(JSON.stringify({stockSchemaPath:reports.at(-1).schemaPath}));
  }
  if(chosen==='outage'){
    const first=await run('outage-context-start','Remember OUTAGE_CONTEXT_51392 and reply STORED.',
      ['--tools','Read','--permission-mode','dontAsk']);
    const start=gateway.ledger.state.recent.length;injectActiveOutage=true;
    const response=await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/messages`,{method:'POST',
      headers:{'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+token,
        'x-claude-code-session-id':'active-outage-fixture'},signal:AbortSignal.timeout(90000),
      body:JSON.stringify({model:'claude-opus-5-5',max_tokens:2048,stream:true,output_config:{effort:'low'},
        system:'Write 20 separate lines describing a harmless fixture.',messages:[{role:'user',content:'ACTIVE_OUTAGE_FIXTURE'}]})});
    const wire=await response.text();injectActiveOutage=false;
    writeFileSync(path.join(workspace,'outage-observation.json'),JSON.stringify({outageInjected,diagnostics,rows:gateway.ledger.state.recent.slice(start)},null,2));
    assert.equal(outageInjected,true);assert.match(wire,/event: content_block_(delta|start)/);assert.match(wire,/event: error/);
    assert.doesNotMatch(wire,/event: message_stop/);assert.equal(gateway.turns.size,0);
    const rows=gateway.ledger.state.recent.slice(start);assert.equal(rows.length,1);assert.equal(rows[0].status,'failed');
    assert.equal(rows[0].partialOutput,true);assert.equal(rows[0].sdkTransportAttempts,1);
    reports.push({name:'active-outage-injection',ok:true,requests:rows,
      note:'Injected response-path failure during real SDK inference, not a physical network disconnect. Unreported usage is unknown, not free.'});
    const result=await run('outage-context-resume','Return the exact fixture value from the previous saved turn.',
      ['--tools','Read','--permission-mode','dontAsk','--resume',first.session_id]);
    assert.match(result.result,/OUTAGE_CONTEXT_51392/);
    assert.equal(gateway.ledger.state.failed,1);assert.equal(gateway.ledger.state.completed,2);
    console.log(JSON.stringify({activeOutageInjected:true,relayReplayAfterPartial:false,savedContextResumed:true,
      physicalNetworkOutageVerified:false}));
  }
  if(['all','files'].includes(chosen)){
    writeFileSync(path.join(workspace,'input.txt'),'alpha=17\nbeta=25\n');
    const r=await run('files','Read input.txt using Read. Add the numbers alpha and beta. Use Write to create answer.txt with exactly SUM=42, then Read answer.txt to verify it. Reply FILE_ROUNDTRIP_OK only after tools verify it.',
      ['--tools','Read,Write,Edit','--allowedTools','Read,Write,Edit','--permission-mode','acceptEdits']);
    assert.match(r.result,/FILE_ROUNDTRIP_OK/);assert.equal(readFileSync(path.join(workspace,'answer.txt'),'utf8').trim(),'SUM=42');
  }
  if(chosen==='thinking'){
    writeFileSync(path.join(workspace,'thinking-input.txt'),'a=17\nb=25\n');
    const r=await run('signed-thinking-tools','Read thinking-input.txt. Think through the sum of a and b. Write thinking-answer.txt with SUM=42, Read it back, and reply SIGNED_TOOL_ROUNDTRIP_OK only after verifying.',
      ['--model','claude-haiku-4-5','--effort','high','--tools','Read,Write','--allowedTools','Read,Write','--permission-mode','acceptEdits']);
    assert.match(r.result,/SIGNED_TOOL_ROUNDTRIP_OK/);assert.equal(readFileSync(path.join(workspace,'thinking-answer.txt'),'utf8').trim(),'SUM=42');
    assert.ok(reports.at(-1).requests.every(row=>row.status==='completed'),'Signed-thinking round trip included a failed/rejected gateway request.');
    const client=diagnostics.filter(row=>row.boundary==='client'&&row.signed.length);
    assert.ok(client.length,'No actual signed thinking returned on the stock-client tool loop.');
    for(const row of client)assert.ok(diagnostics.some(candidate=>candidate.boundary==='sdk'
      &&JSON.stringify(candidate.signed)===JSON.stringify(row.signed)),'Client signatures changed before SDK inference.');
  }
  if(['all','mcp'].includes(chosen)){
    const config={mcpServers:{relay_fixture:{command:process.execPath,args:[path.join(root,'claude-gateway','mcp-fixture.mjs')]}}};
    const r=await run('mcp','Call the relay_fixture echo MCP tool with marker CLAUDE_COPILOT_MCP_OK. Reply with its exact result.',
      ['--tools','Read','--allowedTools','mcp__relay_fixture__echo','--mcp-config',JSON.stringify(config)]);
    assert.match(r.result,/MCP_PROOF:CLAUDE_COPILOT_MCP_OK/);
  }
  if(['all','local','images'].includes(chosen)){
    const left=await sharp({create:{width:160,height:200,channels:3,background:'#ff6600'}}).png().toBuffer();
    const right=await sharp({create:{width:160,height:200,channels:3,background:'#00ccff'}}).png().toBuffer();
    await sharp({create:{width:320,height:200,channels:3,background:'#ffffff'}}).composite([{input:left,left:0,top:0},{input:right,left:160,top:0}]).png().toFile(path.join(workspace,'color-proof.png'));
    const r=await run('images','Use Read to open color-proof.png. Identify the color of its left half and right half. Answer LEFT=<color>, RIGHT=<color>. Do not infer colors from the filename.',
      ['--tools','Read','--allowedTools','Read','--permission-mode','dontAsk']);
    assert.match(r.result.toLowerCase(),/orange/);assert.match(r.result.toLowerCase(),/cyan|blue|turquoise/);
  }
  if(['all','local','skills'].includes(chosen)){
    const skillFolder=path.join(workspace,'.claude','skills','relay-proof');mkdirSync(skillFolder,{recursive:true});
    writeFileSync(path.join(skillFolder,'SKILL.md'),'---\nname: relay-proof\ndescription: Fixture verification skill.\n---\nReply with SKILL_CONTEXT_PROOF_OK, exactly as written here.\n');
    writeFileSync(path.join(workspace,'CLAUDE.md'),'For all fixture responses, also include REPO_CONTEXT_PROOF_OK.\n');
    const hookScript=path.join(workspace,'hook-proof.cjs');
    writeFileSync(hookScript,`require('node:fs').writeFileSync(${JSON.stringify(path.join(workspace,'hook-ran.txt'))},'HOOK_PROOF_OK');`);
    const settings={hooks:{UserPromptSubmit:[{hooks:[{type:'command',command:JSON.stringify(process.execPath)+' '+JSON.stringify(hookScript)}]}]}};
    const r=await run('skills-hooks','Use the relay-proof skill now. Return the marker it instructs, plus any repository-context marker.',
      ['--tools','Skill,Read','--allowedTools','Skill,Read','--permission-mode','dontAsk','--settings',JSON.stringify(settings)]);
    assert.match(r.result,/SKILL_CONTEXT_PROOF_OK/);assert.match(r.result,/REPO_CONTEXT_PROOF_OK/);
    assert.equal(readFileSync(path.join(workspace,'hook-ran.txt'),'utf8'),'HOOK_PROOF_OK');
  }
  if(['all','local','resume'].includes(chosen)){
    const first=await run('resume-start','Remember the private fixture value RESUME_CONTEXT_82941. Reply STORED.',
      ['--tools','Read','--permission-mode','dontAsk']);
    const r=await run('resume-next','What exact fixture value did I give you in the previous turn?',
      ['--tools','Read','--permission-mode','dontAsk','--resume',first.session_id]);
    assert.match(r.result,/RESUME_CONTEXT_82941/);
  }
  if(chosen==='recovery'){
    const first=await run('recovery-start','Remember RECOVERY_CONTEXT_62418 and reply STORED.',
      ['--tools','Read','--permission-mode','dontAsk']);
    assert.equal(gateway.turns.size,0,'Do not interrupt active fixture inference.');
    const generation=gateway.runtime.generation;
    await bounded(()=>gateway.runtime.client.forceStop(),5000,'Owned fixture worker stop');
    await gateway.runtime.checkHealth();await gateway.runtime.ready();
    assert.ok(gateway.runtime.generation>generation);assert.ok(gateway.runtime.recoveries>0);
    const worker=await run('worker-recovery','Return the exact fixture value from the previous turn.',
      ['--tools','Read','--permission-mode','dontAsk','--resume',first.session_id]);
    assert.match(worker.result,/RECOVERY_CONTEXT_62418/);
    await gateway.close();gateway=await startSdkGateway(startOptions);
    Object.assign(env,clientEnvironment(gateway,token,env));
    const restart=await run('gateway-restart','Return the exact fixture value from before the gateway restarted.',
      ['--tools','Read','--permission-mode','dontAsk','--resume',first.session_id]);
    assert.match(restart.result,/RECOVERY_CONTEXT_62418/);
    assert.equal(gateway.ledger.state.received,3);assert.equal(gateway.ledger.state.completed,3);
    assert.equal(gateway.ledger.state.failed,0);
  }
  if(['all','agents','auto'].includes(chosen)){
    const agents={proof_sonnet:{description:'Returns the SONNET marker.',prompt:'You are a verification worker. Return SONNET_PROOF_OK. Do not use tools.',model:'sonnet'},
      proof_haiku:{description:'Returns the HAIKU marker.',prompt:'You are a verification worker. Return HAIKU_PROOF_OK. Do not use tools.',model:'haiku'}};
    const r=await run('agents','Use Agent twice in parallel in one turn: run proof_sonnet and proof_haiku independently. Wait for both actual replies. Then report both proof markers. Do not produce the markers yourself.',
      ['--tools','Agent','--allowedTools','Agent','--permission-mode',chosen==='auto'?'auto':'dontAsk','--agents',JSON.stringify(agents)]);
    assert.match(r.result,/SONNET_PROOF_OK/);assert.match(r.result,/HAIKU_PROOF_OK/);assert.ok(r.subagent_stats?.completed>=2);
    const actual=new Set(gateway.ledger.state.usage.map(row=>row.model));
    assert.ok(actual.has('claude-sonnet-5.5'));assert.ok(actual.has('claude-haiku-4.5'));
  }
  assert.ok(reports.length,'No live acceptance cases ran.');
  const modelCache=path.join(env.CLAUDE_CONFIG_DIR,'cache','gateway-models.json');
  console.log(JSON.stringify({ok:true,version,workspace,modelsCacheCreated:existsSync(modelCache),usage:gateway.ledger.state.usage,
    codexConfigChanged:false,automaticFallback:false},null,2));
  writeFileSync(path.join(workspace,'summary.json'),JSON.stringify({ok:true,version,workspace,usage:gateway.ledger.state.usage,
    modelsCacheCreated:existsSync(modelCache)},null,2));
}finally{await gateway.close();}
