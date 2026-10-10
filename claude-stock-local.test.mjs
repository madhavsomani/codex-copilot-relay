import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {localProbeArguments,createLocalStockFixture} from './claude-gateway/probe-stock-local.mjs';
import {toolResults,digest,historyFingerprint,sdkToolName} from './claude-gateway/protocol.mjs';

test('Stock local protocol proof is explicit and cannot start paid acceptance or fallback',()=>{
  assert.doesNotThrow(()=>localProbeArguments(['--local']));
  for(const args of [[],['--live'],['--local','--live'],['--local','--fallback']])assert.throws(()=>localProbeArguments(args),/scripted loopback/);
});

test('Stock continuation lookup skips trailing system messages but never an intervening assistant or user turn',()=>{
  const result={role:'user',content:[{type:'tool_result',tool_use_id:'owned',content:'ok'}]};
  const suffix={role:'system',content:'stock reminder'};
  assert.deepEqual(toolResults({messages:[result,suffix,suffix]}),result.content);
  for(const next of [{role:'assistant',content:'completed'},{role:'user',content:'new task'}])
    assert.deepEqual(toolResults({messages:[result,next,suffix]}),[]);
});

test('Stock trailing system messages preserve exact native tool history through a file-tool roundtrip',async t=>{
  const workspace=mkdtempSync(path.join(os.tmpdir(),'relay-stock-system-test-')),f=await createLocalStockFixture(workspace);t.after(()=>f.close());
  const headers={'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+f.token};
  const tools=['Read','Write'].map(name=>({name,input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}}}}));
  const body={model:'claude-opus-5-5',max_tokens:1024,tools,messages:[{role:'user',content:'local fixture'},{role:'system',content:'initial stock reminder'}]};
  const results=['alpha=17\nbeta=25','Write completed','SUM=42'];
  for(let i=0;i<4;i++){
    const response=await fetch(`http://127.0.0.1:${f.gateway.server.address().port}/v1/messages`,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal(response.status,200);const reply=await response.json();
    assert.equal(f.observations.at(-1).historyHash,digest(historyFingerprint(body.messages.map(message=>({...message,
      content:typeof message.content==='string'?message.content:message.content.map(block=>block.type==='tool_use'
        ?{...block,name:sdkToolName(tools.find(tool=>tool.name===block.name),tools.findIndex(tool=>tool.name===block.name))}:block)})))));
    if(i<3)body.messages.push({role:'assistant',content:reply.content},
      {role:'user',content:[{type:'tool_result',tool_use_id:reply.content[0].id,content:results[i]},{type:'text',text:'Keep this user suffix.'}]},
      {role:'system',content:'stock reminder '+i},{role:'system',content:[{type:'text',text:'second reminder '+i}]});
    else assert.equal(reply.content[0].text,'LOCAL_STOCK_FILE_ROUNDTRIP_OK');
  }
  assert.deepEqual(f.observations.map(row=>row.stage),[0,1,2,3]);
  assert.deepEqual(f.observations.at(-1).trailingMessages.map(row=>row.role),['assistant','user','system','system']);
  assert.equal(f.gateway.ledger.state.completed,4);assert.equal(f.gateway.ledger.state.failed,0);
  assert.deepEqual(f.faults,[]);assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.byTool.size,0);
});

test('Stock trailing-system continuation rejection leaves owned pending tools available',async t=>{
  const workspace=mkdtempSync(path.join(os.tmpdir(),'relay-stock-system-guard-')),f=await createLocalStockFixture(workspace);t.after(()=>f.close());
  const headers={'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+f.token,'x-claude-code-agent-id':'original'};
  const tools=['Read','Write'].map(name=>({name,input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}}}}));
  const initial={model:'claude-opus-5-5',max_tokens:1024,tools,messages:[{role:'user',content:'local fixture'},{role:'system',content:'original prefix'}]};
  const post=(body,h=headers)=>fetch(`http://127.0.0.1:${f.gateway.server.address().port}/v1/messages`,{method:'POST',headers:h,body:JSON.stringify(body)});
  const first=await (await post(initial)).json();
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:first.content[0].id,content:'alpha=17\nbeta=25'}]},
    {role:'system',content:'new suffix'}]};
  const changed=structuredClone(next);changed.messages[1].content='tampered prefix';
  assert.equal((await post(changed)).status,409);
  assert.equal((await post(next,{...headers,'x-claude-code-agent-id':'different'})).status,409);
  const duplicate=structuredClone(next);duplicate.messages.at(-2).content.push({...duplicate.messages.at(-2).content[0]});
  assert.equal((await post(duplicate)).status,409);
  assert.equal(f.gateway.byTool.size,1);assert.equal(f.observations.length,1);
  const valid=await post(next);assert.equal(valid.status,200);assert.equal((await valid.json()).content[0].name,'Write');
  assert.deepEqual(f.observations.map(row=>row.stage),[0,1]);assert.equal(f.gateway.byTool.size,1);
});
test('Stock trailing system messages participate in context admission before any owned result is consumed',async t=>{
  const workspace=mkdtempSync(path.join(os.tmpdir(),'relay-stock-system-budget-')),f=await createLocalStockFixture(workspace);t.after(()=>f.close());
  const headers={'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+f.token};
  const tools=['Read','Write'].map(name=>({name,input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}}}}));
  const initial={model:'claude-opus-5-5',max_tokens:1024,tools,messages:[{role:'user',content:'local fixture'}]};
  const post=body=>fetch(`http://127.0.0.1:${f.gateway.server.address().port}/v1/messages`,{method:'POST',headers,body:JSON.stringify(body)});
  const first=await (await post(initial)).json(),receipt=structuredClone(f.gateway.ledger.state.recent[0]);
  f.model.capabilities.limits.max_prompt_tokens=512;
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:first.content[0].id,content:'alpha=17\nbeta=25'}]},
    {role:'system',content:'stock reminder '.repeat(1000)}]};
  const rejected=await post(next);assert.equal(rejected.status,400);assert.match((await rejected.json()).error.message,/context budget/);
  assert.equal(f.gateway.byTool.size,1);assert.equal(f.observations.length,1);
  assert.deepEqual(f.gateway.ledger.state.recent.find(row=>row.id===receipt.id),receipt);
  next.messages.at(-1).content='short reminder';
  const valid=await post(next);assert.equal(valid.status,200);assert.equal((await valid.json()).content[0].name,'Write');
  assert.deepEqual(f.observations.map(row=>row.stage),[0,1]);
});

test('Stock local fixture validates three native tool continuations without provider usage',async t=>{
  const workspace=mkdtempSync(path.join(os.tmpdir(),'relay-stock-local-test-')),f=await createLocalStockFixture(workspace);t.after(()=>f.close());
  const headers={'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer '+f.token};
  const tools=['Read','Write'].map(name=>({name,input_schema:{type:'object',properties:{file_path:{type:'string'},content:{type:'string'}}}}));
  const body={model:'claude-opus-5-5',max_tokens:1024,tools,messages:[{role:'user',content:'local fixture'}]};
  const results=['alpha=17\nbeta=25','Write completed','SUM=42'];
  for(let i=0;i<4;i++){
    const response=await fetch(`http://127.0.0.1:${f.gateway.server.address().port}/v1/messages`,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal(response.status,200);const reply=await response.json();
    if(i<3){assert.equal(reply.stop_reason,'tool_use');assert.equal(reply.content[0].name,i===1?'Write':'Read');
      body.messages.push({role:'assistant',content:reply.content},{role:'user',content:[{type:'tool_result',tool_use_id:reply.content[0].id,content:results[i]}]});
    }else{assert.equal(reply.stop_reason,'end_turn');assert.equal(reply.content[0].text,'LOCAL_STOCK_FILE_ROUNDTRIP_OK');}
  }
  assert.equal(f.gateway.ledger.state.received,4);assert.equal(f.gateway.ledger.state.completed,4);assert.equal(f.gateway.ledger.state.failed,0);
  assert.ok(f.gateway.ledger.state.recent.every(row=>row.sdkApiCalls===0&&row.totalNanoAiu===null));
  assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.byTool.size,0);
});
