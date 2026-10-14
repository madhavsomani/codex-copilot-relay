import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createGateway} from './claude-gateway/server.mjs';
import {sessionInput} from './claude-gateway/protocol.mjs';
import {gatewayRequestVisibility} from './claude-gateway/visibility.mjs';

test('Claude SDK bootstrap does not tokenize opaque signatures or redacted payloads as natural-language history',()=>{
  const body={messages:[{role:'assistant',content:[{type:'thinking',thinking:'Actual reasoning text',signature:'PRIVATE_SIGNATURE'.repeat(10000)},
    {type:'redacted_thinking',data:'PRIVATE_OPAQUE'.repeat(10000)},{type:'text',text:'Visible answer'}]}]};
  const before=structuredClone(body),input=sessionInput(body);
  assert.ok(input.prompt.length<256);assert.match(input.prompt,/Actual reasoning text/);
  assert.ok(!input.prompt.includes('PRIVATE_'));assert.deepEqual(body,before);
});

test('Claude context rejection is recognizable, numeric, non-retryable, and metadata-only',async t=>{
  let calls=0;
  const model={id:'claude-opus-5.5',capabilities:{limits:{max_prompt_tokens:64,max_context_window_tokens:256,max_output_tokens:128}}};
  const gateway=await createGateway({token:'local-compaction-test-credential',models:[model],
    runtime:{snapshot:()=>({}),stop:async()=>{},createSession:async()=>{calls++;throw new Error('Must reject before inference');}}});
  await gateway.listen(0);t.after(()=>gateway.close());
  const response=await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/messages`,{method:'POST',headers:{
    authorization:'Bearer local-compaction-test-credential','content-type':'application/json','anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:'claude-opus-5-5',max_tokens:64,messages:[{role:'user',content:'PRIVATE_CONTENT '.repeat(1000)}]})});
  const error=(await response.json()).error;
  assert.equal(response.status,400);assert.equal(error.type,'invalid_request_error');
  assert.match(error.message,/^prompt is too long.*\d+ tokens > \d+/i);
  assert.match(error.message,/estimate/i);assert.equal(response.headers.get('x-should-retry'),'false');
  assert.equal(calls,0);
  const row=gateway.ledger.state.recent[0];
  assert.equal(row.errorCode,'claude_context_budget');assert.equal(row.contextBudget.promptLimit,64);
  assert.equal(row.contextBudget.outputReserve,64);assert.ok(row.contextBudget.estimatedInputTokens>64);
  assert.equal(row.sdkTransportAttempts,0);assert.ok(!JSON.stringify(row).includes('PRIVATE_CONTENT'));
  row.contextBudget.private='PRIVATE_DIAGNOSTIC';
  const visible=gatewayRequestVisibility(row);
  assert.equal(visible.errorCode,'claude_context_budget');assert.equal(visible.contextBudget.outputReserve,64);
  assert.ok(!JSON.stringify(visible).includes('PRIVATE_'));
});

test('Large opaque signed history survives native binding while the bootstrap stays within its text budget',async t=>{
  let bound,bootstrap;
  const model={id:'claude-opus-5.5',capabilities:{limits:{max_prompt_tokens:512,max_context_window_tokens:1024,max_output_tokens:128}}};
  const gateway=await createGateway({token:'local-compaction-test-credential',models:[model],requestHandler:{bind(_id,_body,_selected,messages){bound=messages;},release(){}},
    runtime:{snapshot:()=>({}),stop:async()=>{},release(){},createSession:async()=>{
      const events=new EventEmitter();return {generation:1,session:{sessionId:'signed-local',on(fn){events.on('event',fn);return()=>events.off('event',fn);},
        async send({prompt}){bootstrap=prompt;setImmediate(()=>{
          events.emit('event',{type:'assistant.message',data:{content:'OK'}});events.emit('event',{type:'session.idle',data:{}});
        });},async abort(){},async disconnect(){}}};
    }}});
  await gateway.listen(0);t.after(()=>gateway.close());
  const messages=[{role:'user',content:'Previous request'},{role:'assistant',content:[
    {type:'thinking',thinking:'Earlier reasoning',signature:'opaque+SIGNATURE/'.repeat(10000)},
    {type:'redacted_thinking',data:'redacted+DATA/'.repeat(10000)},{type:'text',text:'Answer'}]},{role:'user',content:'Continue'}];
  const response=await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/messages`,{method:'POST',headers:{
    authorization:'Bearer local-compaction-test-credential','content-type':'application/json','anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:'claude-opus-5-5',max_tokens:64,messages})});
  assert.equal(response.status,200,await response.clone().text());await response.text();
  assert.deepEqual(bound,messages);assert.ok(bootstrap.length<512);
  assert.equal(gateway.ledger.state.recent[0].selectedModel,'claude-opus-5.5');
});
