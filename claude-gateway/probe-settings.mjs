// Local stock-client precedence proof: two loopback mock providers, no SDK,
// service credential, paid inference, persistent client setting or binary edit.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {clientEnvironment,clientArguments} from './launch.mjs';
import {preflightClientSettings} from './client-settings.mjs';

const root=fileURLToPath(new URL('../runtime/',import.meta.url));mkdirSync(root,{recursive:true});
const workspace=mkdtempSync(path.join(root,'claude-settings-proof-'));
const models=[{id:'claude-opus-5.5',name:'Claude Opus 5.5',capabilities:{}}];
async function mock(marker){
  let messages=0;
  const server=http.createServer(async(req,res)=>{
    for await(const chunk of req){} // Never retain prompts, tokens or headers.
    if(req.url.startsWith('/v1/messages/count_tokens')){res.setHeader('content-type','application/json');res.end('{"input_tokens":30}');return;}
    if(req.url.startsWith('/v1/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'claude-opus-5-5',type:'model',display_name:'Fixture Opus'}],has_more:false}));return;}
    if(!req.url.startsWith('/v1/messages')){res.setHeader('content-type','application/json');res.end('{}');return;}
    messages++;res.setHeader('content-type','text/event-stream');
    const events=[{type:'message_start',message:{id:'msg_fixture_'+marker,type:'message',role:'assistant',model:'claude-opus-5-5',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:30,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:marker}},
      {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}},
      {type:'message_stop'}];
    for(const event of events)res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server,messages:()=>messages,close:()=>new Promise(resolve=>server.close(resolve))};
}
const intended=await mock('INTENDED_ROUTE_OK'),settingsEndpoint=await mock('SETTINGS_OVERRIDDEN_ROUTE');
const env=clientEnvironment({models,server:intended.server},'fixture-local-not-service-auth',{
  ...process.env,CLAUDE_CONFIG_DIR:path.join(workspace,'client-state')});
delete env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
const settings={env:{ANTHROPIC_BASE_URL:`http://127.0.0.1:${settingsEndpoint.server.address().port}`}};
const executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude');
try{
  const args=['--settings',JSON.stringify(settings),'--setting-sources','project,local','--strict-mcp-config',
    '--model','claude-opus-5-5','--effort','low','--tools','','--max-turns','1','--output-format','json','-p','Reply with the fixture marker.'];
  const child=spawn(executable,args,{cwd:workspace,env,windowsHide:true});let stdout='';
  child.stdin.end();child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',()=>{});
  const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
  assert.equal(code,0,'Stock mock-client run failed.');
  const result=JSON.parse(stdout.trim());assert.equal(result.result,'SETTINGS_OVERRIDDEN_ROUTE');
  assert.equal(intended.messages(),0);assert.ok(settingsEndpoint.messages()>0);
  const options={cwd:workspace,env,managedDirectory:path.join(workspace,'managed'),registryReader:async()=>[]};
  await assert.rejects(preflightClientSettings(args,options),/ANTHROPIC_BASE_URL/);
  assert.throws(()=>clientArguments(args,{models}),/ANTHROPIC_BASE_URL/);
  assert.equal(intended.messages(),0);assert.equal(settingsEndpoint.messages(),1);
  const cleanArgs=args.slice();cleanArgs[1]='{"env":{"FIXTURE_SAFE_SETTING":"keep"},"permissions":{"deny":["Bash"]}}';
  await preflightClientSettings(cleanArgs,options);
  const clean=spawn(executable,clientArguments(cleanArgs,{models}),{cwd:workspace,env,windowsHide:true});let cleanOut='';
  clean.stdin.end();clean.stdout.on('data',value=>cleanOut+=value);clean.stderr.on('data',()=>{});
  const cleanTimer=setTimeout(()=>clean.kill('SIGTERM'),45000);
  const cleanCode=await new Promise((resolve,reject)=>{clean.once('error',reject);clean.once('exit',resolve);}).finally(()=>clearTimeout(cleanTimer));
  assert.equal(cleanCode,0);assert.equal(JSON.parse(cleanOut.trim()).result,'INTENDED_ROUTE_OK');
  assert.equal(intended.messages(),1);assert.equal(settingsEndpoint.messages(),1);
  const report={stockClientSettingsOverride:true,protectedConflictRejected:true,cleanClientIntendedRoute:true,
    intendedMessages:intended.messages(),settingsMessages:settingsEndpoint.messages(),sdkInferenceReceipts:0};
  writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await Promise.all([intended.close(),settingsEndpoint.close()]);}
