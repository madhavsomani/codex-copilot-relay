// Finite stock-client acceptance using a synthetic HTTP error, not an outage
// injection, Copilot authentication or provider inference. No SDK client starts.
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createGateway} from './server.mjs';
import {ClaudeRequestHandler} from './request-handler.mjs';
import {clientEnvironment,clientArguments} from './launch.mjs';
import {preflightClientSettings} from './client-settings.mjs';

export function retryProbeArguments(args){
  if(args.length!==1||args[0]!=='--local')throw new Error('Use --local for the synthetic non-retryable error proof. Paid inference and outage injection are unavailable.');
}
export async function createLocalRetryFixture(){
  const handler=new ClaudeRequestHandler(),sessions=new Set();let upstreamRequests=0,released=0,gateway;
  const upstream=http.createServer(async(req,res)=>{
    for await(const chunk of req){};upstreamRequests++;
    res.writeHead(500,{'content-type':'application/json','x-should-retry':'false','retry-after':'0',
      'request-id':'local-retry-fixture','x-private-fixture':'never-forward'});
    res.end(JSON.stringify({type:'error',error:{type:'api_error',message:'LOCAL_NON_RETRYABLE_FIXTURE'}}));
  });
  await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(0,'127.0.0.1',resolve);});
  class Session{
    constructor(){this.events=new EventEmitter();this.sessionId='local-retry-'+randomUUID();sessions.add(this);}
    on(fn){this.events.on('event',fn);return()=>this.events.off('event',fn);}
    async send(){setImmediate(()=>void this.perform().catch(error=>
      this.events.emit('event',{type:'session.error',data:{message:error.message}})));}
    async perform(){
      if(this.stopped)return;
      const response=await handler.sendRequest(new Request(`http://127.0.0.1:${upstream.address().port}/v1/messages`,{
        method:'POST',body:JSON.stringify({model:'claude-opus-5.5',messages:[],stream:true})}),
        {sessionId:this.sessionId,signal:new AbortController().signal});
      await response.text();if(this.stopped)return;
      assert.equal(response.status,500);this.events.emit('event',{type:'session.error',data:{message:'Synthetic SDK error'}});
    }
    async abort(){this.stopped=true;}async disconnect(){sessions.delete(this);}
  }
  const runtime={snapshot:()=>({state:'local-fixture-not-authenticated'}),createSession:async()=>({session:new Session(),generation:1}),
    release:()=>released++,stop:async()=>{}};
  const models=[{id:'claude-opus-5.5',name:'Local fixture, not a Copilot model receipt',supportedReasoningEfforts:['low'],
    capabilities:{limits:{max_prompt_tokens:1000000,max_context_window_tokens:1000000,max_output_tokens:128000}}}];
  const token=randomBytes(32).toString('hex');
  const closeUpstream=async()=>{upstream.closeAllConnections();if(upstream.listening)await new Promise(resolve=>upstream.close(resolve));};
  try{
    gateway=await createGateway({runtime,models,token,requestHandler:handler,modelTimeoutMs:30000});await gateway.listen(0);
    return {gateway,token,stats:()=>({upstreamRequests,released,activeSessions:sessions.size,bindings:handler.plans.size}),
      async close(){await gateway.close();await closeUpstream();}};
  }catch(error){await gateway?.close();await closeUpstream();throw error;}
}
export async function runRetryProof(args=process.argv.slice(2)){
  retryProbeArguments(args);
  const root=fileURLToPath(new URL('../runtime/',import.meta.url));mkdirSync(root,{recursive:true});
  const workspace=mkdtempSync(path.join(root,'claude-stock-retry-local-')),fixture=await createLocalRetryFixture();
  const executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude');
  const env=clientEnvironment(fixture.gateway,fixture.token,{...process.env,CLAUDE_CONFIG_DIR:path.join(workspace,'client-state'),DISABLE_UPDATES:'1'});
  const capture=async arguments_=>{
    const child=spawn(executable,arguments_,{cwd:workspace,env,windowsHide:true});let stdout='',stderr='',timedOut=false;
    child.stdin.end();child.stdout.on('data',value=>{stdout+=value;if(stdout.length>2*1024*1024)child.kill('SIGTERM');});
    child.stderr.on('data',value=>{stderr=(stderr+value).slice(-16384);});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},45000);
    try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
      assert.equal(timedOut,false,'Stock retry proof timed out.');return {code,stdout,stderr};}
    finally{clearTimeout(timer);}
  };
  try{
    const version=await capture(['--version']);assert.equal(version.code,0);
    const arguments_=['--model','claude-opus-5-5','--effort','low','--strict-mcp-config','--setting-sources','project,local',
      '--tools','','--no-session-persistence','--max-turns','1','--output-format','json','-p','Return only the local retry fixture response.'];
    await preflightClientSettings(arguments_,{cwd:workspace,env});
    const result=await capture(clientArguments(arguments_,fixture.gateway));
    writeFileSync(path.join(workspace,'client-stdout.log'),result.stdout);writeFileSync(path.join(workspace,'client-stderr.log'),result.stderr);
    const output=JSON.parse(result.stdout.trim());assert.notEqual(result.code,0);assert.equal(output.is_error,true);
    assert.match(output.result,/LOCAL_NON_RETRYABLE_FIXTURE/);
    const stats=fixture.stats();assert.equal(stats.upstreamRequests,1);assert.equal(stats.released,1);
    assert.equal(stats.activeSessions,0);assert.equal(stats.bindings,0);
    const state=fixture.gateway.ledger.state;assert.equal(state.received,1);assert.equal(state.failed,1);assert.equal(state.completed,0);
    assert.ok(state.recent.every(row=>row.sdkApiCalls===0&&row.totalNanoAiu===null));
    assert.equal(fixture.gateway.turns.size,0);assert.equal(fixture.gateway.byTool.size,0);
    const report={ok:true,platform:process.platform,node:process.version,stockClient:version.stdout.trim(),
      scope:'scripted loopback non-retryable HTTP error only; not active-outage or sustained/provider proof',
      stockStoppedWithoutRetry:true,upstreamRequests:1,failedRequests:1,completedRequests:0,ownedSessionsReleased:1,
      sdkInferenceReceipts:0,copilotAuthenticationVerified:false,globalClientSettingsChanged:false};
    writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,workspace}));return report;
  }catch(error){
    writeFileSync(path.join(workspace,'report.json'),JSON.stringify({ok:false,platform:process.platform,
      scope:'scripted loopback non-retryable HTTP error only',error:String(error.message).slice(0,1024),...fixture.stats()}));
    throw new Error('Local stock retry proof failed. Inspect isolated evidence: '+workspace,{cause:error});
  }finally{await fixture.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
  runRetryProof().catch(error=>{console.error(error.message);process.exitCode=1;});
