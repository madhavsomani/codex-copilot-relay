import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startSdkGateway} from './server.mjs';
import {ClaudeRequestHandler} from './request-handler.mjs';
import {adapterVersion,digest,sdkToolName} from './protocol.mjs';

// Finite fixture inference only. Never patches clients, changes account/config,
// executes user tools or touches the existing Codex listener.
if(!process.argv.includes('--live'))throw new Error('Add --live for finite authenticated Copilot control probes.');
const root=fileURLToPath(new URL('../',import.meta.url));const directory=path.join(root,'runtime');mkdirSync(directory,{recursive:true});
const workspace=mkdtempSync(path.join(directory,'claude-control-proof-'));const observations=[];
const handler=new ClaudeRequestHandler(wire=>observations.push({model:wire.model,choice:wire.tool_choice,
  formatHash:wire.output_config?.format?digest(wire.output_config.format):null,
  tools:wire.tools.map(tool=>({name:tool.name,strict:tool.strict,schemaHash:digest(tool.input_schema)}))}));
const token=randomBytes(32).toString('hex');const reports=[];
const gateway=await startSdkGateway({token,port:0,workingDirectory:workspace,requestHandler:handler,runtimeDirectory:path.join(workspace,'metering')});
const headers={'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+token,
  'x-claude-code-session-id':'finite-control-fixture'};
const base=`http://127.0.0.1:${gateway.server.address().port}`;
const body=(model,extra={})=>({model,max_tokens:4096,output_config:{effort:'low'},messages:[{role:'user',content:'Return CONTROL_OK.'}],...extra});
const schema={type:'object',properties:{answer:{type:'integer',enum:[42]}},required:['answer'],additionalProperties:false};
const tool=name=>({name,description:'Fixture only; report answer 42.',strict:true,input_schema:schema});
async function ask(request,expectedStatus=200){
  const response=await fetch(base+'/v1/messages',{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(120000)});
  let result;
  if(request.stream&&response.ok){
    const frames=(await response.text()).split(/\r?\n\r?\n/).map(frame=>frame.split(/\r?\n/).find(line=>line.startsWith('data: ')))
      .filter(Boolean).map(line=>JSON.parse(line.slice(6)));
    assert.ok(!frames.some(frame=>frame.type==='error'),JSON.stringify(frames.find(frame=>frame.type==='error')));
    assert.equal(frames.at(-1).type,'message_stop');
    result={content:[],stop_reason:frames.findLast(frame=>frame.type==='message_delta')?.delta.stop_reason};
    for(const frame of frames){
      if(frame.type==='content_block_start')result.content[frame.index]=structuredClone(frame.content_block);
      if(frame.type==='content_block_delta'&&frame.delta.type==='text_delta')result.content[frame.index].text+=frame.delta.text;
    }
  }else result=await response.json();
  assert.equal(response.status,expectedStatus,JSON.stringify(result));return result;
}
async function discardPending(){for(const turn of [...gateway.turns])await turn.dispose();}
async function run(name,fn){const start=gateway.ledger.state.recent.length;await fn();
  const rows=gateway.ledger.state.recent.slice(start);reports.push({name,ok:true,rows});
  console.log(JSON.stringify({name,ok:true,requests:rows.length}));await discardPending();}
try{
  await run('specific-strict-long-name',async()=>{
    const definition=tool('T'.repeat(128));const request=body('claude-opus-5',{tools:[definition],thinking:{type:'adaptive'},
      tool_choice:{type:'tool',name:definition.name,disable_parallel_tool_use:true}});
    const result=await ask(request);const calls=result.content.filter(block=>block.type==='tool_use');
    assert.equal(result.stop_reason,'tool_use');assert.equal(calls.length,1);assert.equal(calls[0].name,definition.name);
    assert.deepEqual(calls[0].input,{answer:42});
    const observed=observations.at(-1);assert.equal(observed.choice.name,sdkToolName(definition,0));assert.ok(observed.choice.name.length<=64);
    assert.equal(observed.tools[0].schemaHash,digest(schema));assert.equal(observed.tools[0].strict,true);
  });
  await run('required-any',async()=>{
    const result=await ask(body('claude-opus-5',{tools:[tool('RequiredFixture')],tool_choice:{type:'any',disable_parallel_tool_use:true}}));
    assert.equal(result.stop_reason,'tool_use');assert.equal(result.content.filter(block=>block.type==='tool_use').length,1);
  });
  await run('serial-tools-native-continuation',async()=>{
    const request=body('claude-opus-5-5',{tools:[tool('ObserveA'),tool('ObserveB')],
      tool_choice:{type:'auto',disable_parallel_tool_use:true},messages:[{role:'user',content:
        'Call ObserveA and ObserveB, each once with answer 42. Only after both fixture results, reply SERIAL_TOOLS_OK.'}]});
    const seen=[];let finished=false;
    for(let step=0;step<4;step++){
      const result=await ask(request);const calls=result.content.filter(block=>block.type==='tool_use');assert.ok(calls.length<=1);
      if(!calls.length){assert.equal(result.stop_reason,'end_turn');assert.match(result.content.filter(b=>b.type==='text').map(b=>b.text).join(''),/SERIAL_TOOLS_OK/);finished=true;break;}
      assert.equal(result.stop_reason,'tool_use');seen.push(calls[0].name);assert.deepEqual(calls[0].input,{answer:42});
      request.messages.push({role:'assistant',content:result.content},{role:'user',content:[{type:'tool_result',tool_use_id:calls[0].id,content:'FIXTURE_OK'}]});
    }
    assert.equal(finished,true);assert.deepEqual([...seen].sort(),['ObserveA','ObserveB']);
  });
  await run('none-with-native-streamed-schema',async()=>{
    const format={type:'json_schema',schema};const request=body('claude-opus-5-5',{stream:true,tools:[tool('NeverCall')],tool_choice:{type:'none'},
      output_config:{effort:'low',format},messages:[{role:'user',content:'Return answer 42 in the required JSON shape. Do not call any tools.'}]});
    const result=await ask(request);assert.equal(result.stop_reason,'end_turn');assert.ok(result.content.every(block=>block.type!=='tool_use'));
    assert.deepEqual(JSON.parse(result.content.filter(b=>b.type==='text').map(b=>b.text).join('')),{answer:42});
    const observed=observations.at(-1);assert.deepEqual(observed.choice,{type:'none'});assert.equal(observed.tools.length,1);assert.equal(observed.formatHash,digest(format));
  });
  await run('capability-rejections-without-inference',async()=>{
    const count=observations.length;
    for(const model of ['claude-opus-5-5','claude-sonnet-5-5'])await ask(body(model,{tools:[tool('Forced')],tool_choice:{type:'any'}}),400);
    await ask(body('claude-haiku-4-5',{output_config:{format:{type:'json_schema',schema}}}),400);
    assert.equal(observations.length,count);
  });
}finally{
  await gateway.close();
  const rows=gateway.ledger.state.recent;const used=rows.filter(row=>row.sdkApiCalls>0);
  const receipt={adapterVersion,ok:reports.length===5,reports,observations,
    reportedAiCredits:used.reduce((sum,row)=>sum+(row.totalNanoAiu??0)/1e9,0),
    receiptCalls:used.reduce((sum,row)=>sum+row.sdkApiCalls,0),
    note:'Reported usage only, not an invoice or remaining entitlement; intentional admission rejections are separate.'};
  writeFileSync(path.join(workspace,'report.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({workspace,ok:receipt.ok,reportedAiCredits:receipt.reportedAiCredits,receiptCalls:receipt.receiptCalls}));
}
