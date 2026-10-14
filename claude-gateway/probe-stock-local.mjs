// Explicit local protocol acceptance. The stock client executes real file tools;
// a scripted loopback provider and fixture SDK events replace paid inference.
// No Copilot client, login, external provider, or global config is started here.
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createGateway} from './server.mjs';
import {ClaudeRequestHandler} from './request-handler.mjs';
import {clientEnvironment,clientArguments} from './launch.mjs';
import {preflightClientSettings} from './client-settings.mjs';
import {digest,historyFingerprint} from './protocol.mjs';
import sharp from 'sharp';

export function localProbeArguments(args){
  if(args[0]!=='--local'||args.length>2||args.length===2&&!['--images','--edit'].includes(args[1]))throw new Error('Use --local [--images|--edit] for scripted loopback acceptance only. Paid inference and fallbacks are not available in this probe.');
}
export async function createLocalStockFixture(workspace,{signedEmptyBlocks=false,imageReads=false,editTools=false}={}){
  const sessions=new Map(),observations=[],faults=[];
  const model={id:'claude-opus-5.5',name:'Local fixture, not Copilot inference',supportedReasoningEfforts:['low','medium','high','xhigh','max'],
    capabilities:{limits:{max_prompt_tokens:1000000,max_context_window_tokens:1000000,max_output_tokens:128000},supports:{structured_outputs:true}}};
  const handler=new ClaudeRequestHandler();let gateway;
  const provider=http.createServer(async(req,res)=>{
    try{
      assert.equal(req.headers.host,'127.0.0.1:'+provider.address().port);
      let data='';for await(const chunk of req){data+=chunk;if(data.length>4*1024*1024)throw new Error('Local fixture request too large.');}
      const body=JSON.parse(data),session=sessions.get(req.headers['x-local-fixture-session']);
      assert.ok(session,'An owned fixture session is required.');assert.equal(body.model,model.id);
      const stage=session.results.length,last=body.messages.findLast(message=>message.role==='user');
      if(stage){
        assert.equal(last.role,'user');const result=last.content.find(block=>block.type==='tool_result');
        assert.ok(result&&!result.is_error,'Actual stock tool result must succeed.');
        assert.equal(result.tool_use_id,'toolu_local_stage_'+(stage-1));
        if(!imageReads&&stage===1){assert.match(JSON.stringify(result.content),/alpha=17/);assert.match(JSON.stringify(result.content),/beta=25/);}
        if(!imageReads&&stage===3)assert.match(JSON.stringify(result.content),editTools?/beta=42/:/SUM=42/);
      }
      const nativeImages=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).flatMap(b=>b.type==='tool_result'&&Array.isArray(b.content)?b.content:[]).filter(b=>b.type==='image');
      if(imageReads){
        assert.equal(nativeImages.length,stage,'Every actual stock Read screenshot must survive its native position');
        for(const [i,image] of nativeImages.entries())assert.equal(image.source.data,readFileSync(path.join(workspace,'screen-'+(i%2)+'.png')).toString('base64'));
      }
      assert.ok(stage<=3,'Unexpected extra fixture turn.');
      const toolName=!imageReads&&stage===1?(editTools?'Edit':'Write'):'Read';
      const definition=body.tools.find(tool=>tool.name.endsWith('_'+toolName));
      if(stage<3)assert.ok(definition,'Stock client must declare the requested tool.');
      session.reply=stage<3?{id:'toolu_local_stage_'+stage,name:definition.name,input:imageReads?{file_path:path.join(workspace,'screen-'+(stage%2)+'.png')}:stage===1
        ?editTools?{file_path:path.join(workspace,'input.txt'),old_string:'beta=25',new_string:'beta=42'}
          :{file_path:path.join(workspace,'answer.txt'),content:'SUM=42\n'}
        :{file_path:path.join(workspace,stage===0||editTools?'input.txt':'answer.txt')}}:null;
      observations.push({stage,model:body.model,tool:stage<3?toolName:null,toolResultVerified:stage>0,nativeImages:nativeImages.length,
        historyHash:digest(historyFingerprint(body.messages)),
        ...(editTools?{editReplayDefaults:body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[])
          .filter(block=>block.type==='tool_use'&&block.name.endsWith('_Edit')).map(block=>({replaceAll:block.input.replace_all??null}))}:{}),
        trailingMessages:body.messages.slice(-4).map(message=>({role:message.role,
          content:typeof message.content==='string'?'string':message.content.map(block=>({type:block.type,
            ...(block.tool_use_id?{tool_use_id:block.tool_use_id}:{})}))}))});
      const block=session.reply?{type:'tool_use',id:session.reply.id,name:session.reply.name,input:{}}:{type:'text',text:''};
      const frames=[{type:'message_start',message:{id:'msg_local_'+stage,type:'message',role:'assistant',model:body.model,content:[],
        stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}},
        {type:'content_block_start',index:0,content_block:block},
        {type:'content_block_delta',index:0,delta:session.reply?{type:'input_json_delta',partial_json:JSON.stringify(session.reply.input)}
          :{type:'text_delta',text:'LOCAL_STOCK_FILE_ROUNDTRIP_OK'}},
        {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:session.reply?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:0}},
        {type:'message_stop'}];
      // Observed Desktop transcripts contain consecutive empty signed blocks.
      // Exercise their stock-client replay locally, without model inference.
      if(signedEmptyBlocks){
        for(const event of frames)if(event.index!==undefined)event.index+=2;
        frames.splice(1,0,...[0,1].flatMap(index=>[
          {type:'content_block_start',index,content_block:{type:'thinking',thinking:'',signature:''}},
          {type:'content_block_delta',index,delta:{type:'signature_delta',signature:'local-opaque-'+stage+'-'+index}},
          {type:'content_block_stop',index}]));
      }
      res.writeHead(200,{'content-type':'text/event-stream'});
      for(const event of frames)res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
      res.end();
    }catch(error){
      if(faults.length<32)faults.push({source:'scripted-provider',message:String(error.message).slice(0,1024)});
      res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Local stock fixture assertion failed."}');
    }
  });
  await new Promise((resolve,reject)=>{provider.once('error',reject);provider.listen(0,'127.0.0.1',resolve);});
  class LocalSession{
    constructor(config){
      this.config=config;this.sessionId='local-'+randomUUID();this.events=new EventEmitter();this.results=[];sessions.set(this.sessionId,this);
      this.rpc={tools:{handlePendingToolCall:async result=>{
        assert.equal(result.requestId,this.reply?.id);this.results.push(result);
        setImmediate(()=>void this.perform().catch(error=>this.emit('session.error',{message:error.message})));
      }}};
    }
    on(callback){this.events.on('event',callback);return()=>this.events.off('event',callback);}
    emit(type,data={}){this.events.emit('event',{type,data});}
    async send(){setImmediate(()=>void this.perform().catch(error=>this.emit('session.error',{message:error.message})));}
    async perform(){
      if(this.stopped)return;
      const response=await handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{
        method:'POST',headers:{'x-local-fixture-session':this.sessionId},body:JSON.stringify({model:model.id,messages:[],stream:true})}),
        {sessionId:this.sessionId,signal:new AbortController().signal});
      if(!response.ok)throw new Error('Scripted local provider rejected stock tool history.');
      await response.text();if(this.stopped)return;
      if(this.reply){
        this.emit('assistant.message',{content:'',toolRequests:[{toolCallId:this.reply.id}]});
        this.emit('external_tool.requested',{toolCallId:this.reply.id,requestId:this.reply.id,toolName:this.reply.name,arguments:this.reply.input});
      }else{this.emit('assistant.message',{content:'LOCAL_STOCK_FILE_ROUNDTRIP_OK'});this.emit('session.idle');}
    }
    async abort(){this.stopped=true;}
    async disconnect(){sessions.delete(this.sessionId);}
  }
  const runtime={snapshot:()=>({state:'local-fixture'}),release:()=>{},stop:async()=>{},
    createSession:async config=>({session:new LocalSession(config),generation:1})};
  const token=randomBytes(32).toString('hex');
  try{
    gateway=await createGateway({runtime,models:[model],token,workingDirectory:workspace,requestHandler:handler,modelTimeoutMs:45000,
      onFault:error=>{if(faults.length<32)faults.push({source:'gateway',message:String(error.message).slice(0,1024)});}});
    await gateway.listen(0);
    return {gateway,model,token,observations,faults,async close(){await gateway.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}};
  }catch(error){await gateway?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));throw error;}
}
export async function runLocalStockProof(args=process.argv.slice(2)){
  localProbeArguments(args);
  const root=fileURLToPath(new URL('../runtime/',import.meta.url));mkdirSync(root,{recursive:true});
  const workspace=mkdtempSync(path.join(root,'claude-stock-local-'));writeFileSync(path.join(workspace,'input.txt'),'alpha=17\nbeta=25\n');
  const imageReads=args.includes('--images'),editTools=args.includes('--edit');
  if(imageReads)for(const [i,color] of ['#ff5500','#0066ff'].entries())await sharp({create:{width:48,height:48,channels:3,background:color}}).png().toFile(path.join(workspace,'screen-'+i+'.png'));
  const fixture=await createLocalStockFixture(workspace,{signedEmptyBlocks:true,imageReads,editTools}),executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude');
  const env=clientEnvironment(fixture.gateway,fixture.token,{...process.env,CLAUDE_CONFIG_DIR:path.join(workspace,'client-state'),DISABLE_UPDATES:'1'});
  const run=async args=>{
    const child=spawn(executable,args,{cwd:workspace,env,windowsHide:true});let stdout='',stderr='';
    child.stdin.end();child.stdout.on('data',value=>{stdout+=value;if(stdout.length>2*1024*1024)child.kill();});
    child.stderr.on('data',value=>{stderr=(stderr+value).slice(-8192);});
    const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
    try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
      assert.equal(code,0,'Stock local probe failed; inspect the isolated report.');return stdout;
    }finally{
      clearTimeout(timer);writeFileSync(path.join(workspace,'client-stderr.log'),stderr);
      writeFileSync(path.join(workspace,'client-stdout.log'),stdout);
    }
  };
  try{
    const version=(await run(['--version'])).trim();
    const args=['--model','claude-opus-5-5','--effort','low','--strict-mcp-config','--setting-sources','project,local',
      '--tools',editTools?'Read,Edit':'Read,Write','--allowedTools',editTools?'Read,Edit':'Read,Write','--permission-mode','acceptEdits','--max-turns','6','--output-format','json',
      '-p','Perform the local fixture Read, Write and Read requests, then return its final marker.'];
    await preflightClientSettings(args,{cwd:workspace,env});
    const client=JSON.parse((await run(clientArguments(args,fixture.gateway))).trim());
    assert.equal(client.is_error,false);assert.equal(client.result,'LOCAL_STOCK_FILE_ROUNDTRIP_OK');
    if(!imageReads)assert.equal(readFileSync(path.join(workspace,editTools?'input.txt':'answer.txt'),'utf8'),editTools?'alpha=17\nbeta=42\n':'SUM=42\n');
    assert.deepEqual(fixture.observations.map(row=>row.tool),['Read',imageReads?'Read':editTools?'Edit':'Write','Read',null]);
    assert.equal(fixture.gateway.ledger.state.received,4);assert.equal(fixture.gateway.ledger.state.completed,4);assert.equal(fixture.gateway.ledger.state.failed,0);
    assert.ok(fixture.gateway.ledger.state.recent.every(row=>row.sdkApiCalls===0&&row.totalNanoAiu===null));
    assert.equal(fixture.gateway.turns.size,0);assert.equal(fixture.gateway.byTool.size,0);
    const report={ok:true,platform:process.platform,node:process.version,stockClient:version,fixtureProvider:'scripted-loopback-not-Copilot',
      actualStockFileRoundtrip:true,actualStockImageReads:imageReads,actualStockEdit:editTools,signedEmptyBlockReplay:true,completedRequests:4,failedRequests:0,sdkInferenceReceipts:0,copilotAuthenticationVerified:false,
      permissions:'explicit Read/Write allowlist with acceptEdits; no bypass',observations:fixture.observations};
    writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,workspace}));
    return report;
  }catch(error){
    writeFileSync(path.join(workspace,'report.json'),JSON.stringify({ok:false,platform:process.platform,node:process.version,
      fixtureProvider:'scripted-loopback-not-Copilot',sdkInferenceReceipts:0,copilotAuthenticationVerified:false,
      error:String(error.message).slice(0,1024),observations:fixture.observations,faults:fixture.faults,
      completedRequests:fixture.gateway.ledger.state.completed,failedRequests:fixture.gateway.ledger.state.failed},null,2));
    throw new Error(error.message+'\nIsolated evidence: '+workspace,{cause:error});
  }finally{await fixture.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
  runLocalStockProof().catch(error=>{console.error(error.message);process.exitCode=1;});
