// Explicit, offline inference fixture: stock Claude performs its own compaction.
// Never starts Copilot/authentication, changes global settings, or resumes user data.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createGateway} from './server.mjs';
import {clientEnvironment,clientArguments} from './launch.mjs';
import {countModelTokens} from '../context-tokenizer.mjs';

export async function runStockCompaction(args=process.argv.slice(2)){
  assert.ok(args.length===2&&args[0]==='--local'&&['--manual','--auto'].includes(args[1]),'Use --local --manual or --local --auto. No paid mode.');
  const mode=args[1].slice(2),root=fileURLToPath(new URL('../runtime/',import.meta.url));mkdirSync(root,{recursive:true});
  const workspace=mkdtempSync(path.join(root,'claude-compact-'+mode+'-')),observations=[],runs=[];
  const model={id:'claude-opus-5.5',name:'Scripted local compaction fixture',supportedReasoningEfforts:['low','medium','high','xhigh','max'],
    capabilities:{limits:{max_prompt_tokens:1000000,max_context_window_tokens:1000000,max_output_tokens:128000},supports:{structured_outputs:true}}};
  let phase='seed',compactions=0;
  class Session{
    constructor(config){this.config=config;this.sessionId=randomUUID();this.events=new EventEmitter();}
    on(fn){this.events.on('event',fn);return()=>this.events.off('event',fn);}
    async send({prompt}){setImmediate(()=>{
      // Only the fixture classifies synthetic requests to choose a scripted answer;
      // production admission never exempts compaction or changes request content.
      const compact=/summari[sz]e|summary of (?:the|our|this) conversation/i.test(prompt.slice(-18000));
      if(compact)compactions++;
      const text=phase==='seed'?'Fixture history. '.repeat(6000)+' Keep the task marker COMPACTION_TASK_42.':
        compact?'The task marker is COMPACTION_TASK_42. Continue the local compaction acceptance test.':'LOCAL_STOCK_COMPACTION_OK';
      observations.push({phase,compact,model:this.config.model,promptTokens:countModelTokens(prompt),promptLength:prompt.length});
      this.events.emit('event',{type:'assistant.message',data:{content:text}});
      this.events.emit('event',{type:'session.idle',data:{}});
    });}
    async abort(){} async disconnect(){}
  }
  const token=randomBytes(32).toString('hex');
  const gateway=await createGateway({token,models:[model],workingDirectory:workspace,modelTimeoutMs:30000,
    runtime:{snapshot:()=>({state:'local-fixture'}),release(){},stop:async()=>{},createSession:async config=>({session:new Session(config),generation:1})}});
  await gateway.listen(0);
  const env=clientEnvironment(gateway,token,{...process.env,CLAUDE_CONFIG_DIR:path.join(workspace,'client-state'),DISABLE_UPDATES:'1'});
  // Disable nonessential integrations and inherit no provider credentials.
  const executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude');
  const version=spawnSync(executable,['--version'],{cwd:workspace,env,windowsHide:true,timeout:10000,encoding:'utf8'});
  assert.equal(version.status,0,'Stock client version check failed');
  const base=['--model','claude-opus-5-5','--effort','low','--strict-mcp-config','--setting-sources','project,local',
    '--tools','','--max-turns','8','--output-format','json'];
  const run=async(prompt,sessionId)=>{
    const child=spawn(executable,clientArguments([...base,...sessionId?['--resume',sessionId]:[],'-p',prompt],gateway),{cwd:workspace,env,windowsHide:true});
    let stdout='',stderr='';child.stdin.end();child.stdout.on('data',v=>{stdout+=v;if(stdout.length>2*1024*1024)child.kill();});
    child.stderr.on('data',v=>{stderr=(stderr+v).slice(-16000);});const timer=setTimeout(()=>child.kill(),60000);
    try{
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
      writeFileSync(path.join(workspace,'run-'+runs.length+'.log'),stdout+'\n'+stderr);
      const result=JSON.parse(stdout.trim());runs.push({phase,code,isError:result.is_error,result:result.result?.slice(0,600),sessionId:result.session_id});
      return result;
    }finally{clearTimeout(timer);}
  };
  try{
    let session;
    for(let i=0;i<4;i++){const result=await run('Seed fixture exchange '+i+'. Remember COMPACTION_TASK_42.',session);assert.equal(result.is_error,false);session=result.session_id;}
    phase='recover';model.capabilities.limits.max_prompt_tokens=40000;
    const recovered=await run(mode==='manual'?'/compact':'Continue and return the task marker.',session);
    assert.equal(recovered.is_error,false,'Stock compaction did not recover. Inspect isolated evidence.');
    assert.ok(!/Error during compaction/i.test(recovered.result??''),'Manual /compact must not return a local error as a successful result.');
    if(mode==='manual')assert.equal((await run('Continue and return the task marker.',session)).is_error,false);
    assert.ok(compactions>0,'Stock client must make a real compaction request.');
    assert.ok(gateway.ledger.state.recent.some(row=>row.status==='rejected'&&row.httpStatus===400),'Must exercise oversize recovery.');
    assert.equal(observations.at(-1).compact,false);assert.equal(runs.at(-1).result,'LOCAL_STOCK_COMPACTION_OK');
    assert.ok(observations.every(row=>row.model===model.id));
    assert.ok(gateway.ledger.state.recent.every(row=>row.sdkApiCalls===0&&row.sdkTransportAttempts===0));
    const projects=path.join(workspace,'client-state','projects');
    const transcript=readdirSync(projects).map(name=>path.join(projects,name,session+'.jsonl')).find(file=>{
      try{return readFileSync(file).length>0;}catch{return false;}
    });
    assert.ok(transcript,'The stock client must save its own transcript.');
    const boundaries=readFileSync(transcript,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))
      .filter(row=>row.subtype==='compact_boundary').map(row=>({trigger:row.compactMetadata.trigger,
        preTokens:row.compactMetadata.preTokens,postTokens:row.compactMetadata.postTokens}));
    assert.ok(boundaries.some(row=>row.trigger===mode&&row.postTokens<row.preTokens),'Require stock-authored compaction evidence, not just a summary response.');
    assert.equal(gateway.ledger.state.recent.filter(row=>row.requestClass==='compaction'&&row.status==='completed').length,compactions);
    const report={ok:true,mode,provider:'scripted-local-not-Copilot',stockClient:version.stdout.trim(),stockClientUnmodified:true,compactions,boundaries,observations,runs,
      receipts:gateway.ledger.state.recent,sdkInferenceReceipts:0,liveCopilotCompactionVerified:false,workspace};
    writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,mode,compactions,workspace}));return report;
  }catch(error){writeFileSync(path.join(workspace,'report.json'),JSON.stringify({ok:false,mode,error:error.message,observations,runs,receipts:gateway.ledger.state.recent},null,2));
    throw new Error(error.message+'\nIsolated evidence: '+workspace,{cause:error});
  }finally{await gateway.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))runStockCompaction().catch(e=>{console.error(e.message);process.exitCode=1;});
