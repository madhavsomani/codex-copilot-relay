import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {catalog, validate, messageUsage, sessionInput, historyFingerprint, nativeHistory} from './claude-gateway/protocol.mjs';
import {createGateway} from './claude-gateway/server.mjs';
import {MessageSink} from './claude-gateway/stream.mjs';
import {clientArguments,clientEnvironment,assertDependencies} from './claude-gateway/launch.mjs';
import {ClaudeRequestHandler} from './claude-gateway/request-handler.mjs';
import {Ledger} from './claude-gateway/ledger.mjs';
import {observeStream} from './claude-gateway/upstream-stream.mjs';
import {countModelTokens} from './context-tokenizer.mjs';
import http from 'node:http';
import {mkdtempSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const models=[{id:'claude-opus-5.5',name:'Claude Opus 5.5',supportedReasoningEfforts:['low','medium','high','xhigh','max'],
  capabilities:{limits:{max_prompt_tokens:1000000,max_output_tokens:128000,max_context_window_tokens:1000000},supports:{adaptive_thinking:'required',structured_outputs:true}}},
  {id:'gpt-test',name:'not Claude'}];
const request=(extra={})=>({model:'claude-opus-5-5',max_tokens:1024,messages:[{role:'user',content:'Hello'}],...extra});
const tools=[{name:'Read',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']}}];
const outputFormat={type:'json_schema',schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer'],additionalProperties:false}};
const olderModels=[{...models[0],id:'claude-opus-5'}];

async function nativeTestImage(color='#ff6600'){
  const sharp=(await import('sharp')).default;
  return {type:'image',source:{type:'base64',media_type:'image/png',data:(await sharp({create:{width:8,height:8,channels:3,background:color}}).png().toBuffer()).toString('base64')}};
}
test('Claude native images: signed replay preserves duplicates and accumulated screenshots exactly',async t=>{
  const a=await nativeTestImage(),b=await nativeTestImage('#113355'),bindings=[];
  const f=await fixture(t,s=>s.final('IMAGE_REPLAY_OK'),{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
  for(const images of [[a,a],[a,b],Array(13).fill(a)]){
    const body=request({messages:[{role:'user',content:[images[0]]},
      {role:'assistant',content:[{type:'thinking',thinking:'',signature:'local-fixture-only'},{type:'text',text:'Checked'}]},
      {role:'user',content:images.slice(1)}]});
    const before=structuredClone(body),response=await f.call(body);
    assert.equal(response.status,200,await response.clone().text());await response.text();
    assert.deepEqual(bindings.at(-1),body.messages);assert.deepEqual(body,before);
    assert.ok(!f.sessions.at(-1).input.attachments?.length,'Images travel once, in the native hook, not flattened SDK attachments');
  }
});
test('Claude native images: screenshot tool results preserve pixels and signed positions across continuation',async t=>{
  const image=await nativeTestImage(),bindings=[];
  const f=await fixture(t,s=>{
    nativeFixture([...f.gateway.turns].find(turn=>turn.session===s),['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
  const initial=request({tools,messages:[{role:'user',content:[image]}]}),first=await(await f.call(initial)).json();
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:first.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:[image]}))}]};
  const response=await f.call(next);assert.equal(response.status,200);await response.text();
  assert.deepEqual(bindings.at(-1),next.messages);
  assert.ok(f.sessions[0].results.every(r=>!r.result.binaryResultsForLlm),'No second SDK-side image packing');
});
test('Claude native images: malformed new screenshot rejects before consuming pending tools',async t=>{
  const f=await fixture(t,s=>{
    nativeFixture([...f.gateway.turns].find(turn=>turn.session===s),['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(){},release(){}}});
  const initial=request({tools}),first=await(await f.call(initial)).json(),image=await nativeTestImage();
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:first.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:[image]}))}]};
  const bad=structuredClone(next);bad.messages.at(-1).content[0].content[0].source.data='AAAA';
  const rejected=await f.call(bad);assert.equal(rejected.status,400);await rejected.text();
  assert.equal(rejected.headers.get('x-should-retry'),'false');assert.equal(f.sessions[0].results.length,0);assert.equal(f.gateway.byTool.size,2);
  const valid=await f.call(next);assert.equal(valid.status,200);await valid.text();assert.equal(f.sessions[0].results.length,2);
});
test('Claude native images: changed settings rebuild signed screenshot history without replaying tools',async t=>{
  const image=await nativeTestImage(),bindings=[];
  const f=await fixture(t,s=>{
    if(f.sessions.length>1)return s.final('REBUILT_IMAGE_OK');
    nativeFixture([...f.gateway.turns].find(turn=>turn.session===s),['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
  const initial=request({tools,messages:[{role:'user',content:[image]}]}),first=await(await f.call(initial)).json();
  const next={...initial,system:'Updated client instructions',messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:first.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:[image]}))}]};
  const response=await f.call(next);assert.equal(response.status,200);assert.match(await response.text(),/REBUILT_IMAGE_OK/);
  assert.deepEqual(bindings.at(-1),next.messages);assert.equal(f.sessions.length,2);
  assert.equal(f.sessions[0].results.length,0);assert.equal(f.sessions[1].results.length,0);assert.ok(f.sessions[0].released);
});

test('Claude tool controls validate exact model restrictions and parallel booleans',()=>{
  const body=request({model:'claude-opus-5',tools,tool_choice:{type:'tool',name:'Read',disable_parallel_tool_use:true},thinking:{type:'adaptive'}});
  assert.equal(validate(body,olderModels).model.id,'claude-opus-5');
  assert.doesNotThrow(()=>validate(request({tools,tool_choice:{type:'auto',disable_parallel_tool_use:true}}),models));
  for(const extra of [{tool_choice:{type:'tool',name:'missing'}},{tool_choice:{type:'any',name:'Read'}},
    {tool_choice:{type:'auto',disable_parallel_tool_use:'yes'}},{tool_choice:{type:'auto',unknown:true}},
    {tool_choice:{type:'none',disable_parallel_tool_use:false}},
    {max_tokens:4096,thinking:{type:'enabled',budget_tokens:1024},tool_choice:{type:'any'}}])
    assert.throws(()=>validate({...body,...extra},olderModels),error=>error.statusCode===400);
  assert.throws(()=>validate({...body,model:'claude-opus-5-5'},models),/forced tool choice/i);
  assert.throws(()=>validate({...body,tools:[]},olderModels),/declared tool/i);
});
test('Claude structured output is capability gated and bound to continuations without schema mutation',()=>{
  const body=request({output_config:{effort:'low',format:outputFormat},tools:[{...tools[0],strict:true}]});
  const before=JSON.stringify(body);assert.doesNotThrow(()=>validate(body,models));assert.equal(JSON.stringify(body),before);
  const changed=structuredClone(body);changed.output_config.format.schema.properties.answer.type='string';
  assert.notEqual(validate(body,models).signature,validate(changed,models).signature);
  const unsupported=[{...models[0],capabilities:{...models[0].capabilities,supports:{structured_outputs:false}}}];
  assert.throws(()=>validate(body,unsupported),/structured output/i);
  for(const extra of [{output_config:{format:{type:'json_object',schema:{}}}},{output_config:{format:{type:'json_schema',schema:null}}},
    {output_config:{format:{...outputFormat,unknown:true}}},{tools:[{...tools[0],strict:'true'}]}])
    assert.throws(()=>validate({...body,...extra},models),error=>error.statusCode===400);
});
test('Claude tool names support 128 characters without exceeding SDK internal name limits',async()=>{
  const {sdkToolName}=await import('./claude-gateway/protocol.mjs');
  const name='R'.repeat(128);const body=request({tools:[{name,input_schema:{type:'object'}}]});
  assert.doesNotThrow(()=>validate(body,models));assert.ok(sdkToolName({name},499).length<=64);
  assert.equal(sdkToolName(tools[0],0),'client_Read');assert.notEqual(sdkToolName({name},0),sdkToolName({name:'Q'+name.slice(1)},0));
  assert.throws(()=>validate(request({tools:[{name:name+'R',input_schema:{type:'object'}}]}),models),/128/);
});
test('Claude native hook forwards strict schema, output format, specific tool and none catalog',async t=>{
  const received=[];const server=http.createServer(async(req,res)=>{let wire='';for await(const chunk of req)wire+=chunk;received.push(JSON.parse(wire));res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler();const body=request({model:'claude-opus-5',tools:[{...tools[0],strict:true}],
    output_config:{format:outputFormat},tool_choice:{type:'tool',name:'Read',disable_parallel_tool_use:true}});
  const send=async value=>{handler.bind('controls',value,validate(value,olderModels));return handler.sendRequest(new Request(
    `http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',body:JSON.stringify({model:'claude-opus-5',stream:true,messages:[]})}),
    {sessionId:'controls',signal:new AbortController().signal});};
  await send(body);assert.deepEqual(received[0].tool_choice,{type:'tool',name:'client_Read',disable_parallel_tool_use:true});
  assert.deepEqual(received[0].output_config,body.output_config);assert.equal(received[0].tools[0].strict,true);
  await send({...body,tool_choice:{type:'none'}});assert.equal(received[1].tools.length,1);assert.deepEqual(received[1].tool_choice,{type:'none'});
});
test('Claude exact tool controls fail closed before emitting an invalid tool block',()=>{
  const make=choice=>{const response=new EventEmitter();let wire='';response.writeHead=()=>{};response.write=value=>wire+=value;response.end=()=>{};
    return {sink:new MessageSink(response,request({stream:true,tool_choice:choice}),()=>{}),wire:()=>wire};};
  const block={type:'tool_use',id:'one',name:'Read',input:{path:'x'}};
  for(const choice of [{type:'none'},{type:'tool',name:'Write'}]){
    const f=make(choice);assert.throws(()=>f.sink.tool(block),/tool_choice/);f.sink.fail(new Error('fixture'));
    assert.doesNotMatch(f.wire(),/content_block_start/);assert.doesNotMatch(f.wire(),/message_stop/);
  }
  const f=make({type:'auto',disable_parallel_tool_use:true});f.sink.tool(block);
  assert.throws(()=>f.sink.tool({...block,id:'two'}),/tool_choice/);f.sink.fail(new Error('fixture'));
  assert.equal(f.sink.blocks.length,1);
  const native=make({type:'none'});native.sink.native({type:'message_start'},new Map());
  assert.throws(()=>native.sink.native({type:'content_block_start',index:0,content_block:block},new Map([['Read','Read']])),/tool_choice/);
  native.sink.fail(new Error('fixture'));assert.doesNotMatch(native.wire(),/content_block_start/);
});
test('Claude required tool controls preserve refusal and max-token stops, never inventing a tool',()=>{
  for(const reason of ['refusal','max_tokens','end_turn']){
    const response=new EventEmitter();response.writeHead=()=>{};response.write=()=>{};response.end=()=>{};
    const sink=new MessageSink(response,request({tool_choice:{type:'any'}}),()=>{});sink.finishText('not a tool');
    if(reason==='end_turn'){assert.throws(()=>sink.finish(reason,[]),/required native tool/);sink.fail(new Error('fixture'));}
    else assert.doesNotThrow(()=>sink.finish(reason,[]));
  }
});
test('Claude structured output never repairs refusal or truncated JSON in either transport',async t=>{
  for(const reason of ['refusal','max_tokens']){
    const text=reason==='refusal'?'No.':'{"answer":';
    const f=await fixture(t,s=>{
      const turn=[...f.gateway.turns].find(item=>item.session===s);turn.nativeEvent({type:'message_start'});
      turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
      turn.nativeEvent({type:'content_block_delta',index:0,delta:{type:'text_delta',text}});
      turn.nativeEvent({type:'content_block_stop',index:0});turn.nativeEvent({type:'message_delta',delta:{stop_reason:reason}});
      turn.nativeEvent({type:'message_stop'});s.final(text);
    });
    const body=request({output_config:{format:outputFormat}});const response=await f.call(body);const result=await response.json();
    assert.equal(response.status,200);assert.equal(result.stop_reason,reason);assert.equal(result.content[0].text,text);
    const stream=await f.call({...body,stream:true});const wire=await stream.text();assert.match(wire,new RegExp('"stop_reason":"'+reason+'"'));
    assert.match(wire,/event: message_stop/);assert.equal(f.gateway.ledger.state.failed,0);
  }
});
test('Claude native max-token completion ends without SDK idle and preserves exact receipt and content',async t=>{
  for(const stream of [false,true])for(const receiptFirst of [false,true])for(const text of ['', 'partial']){
    const current=await fixture(t,session=>{
      const turn=[...current.gateway.turns].find(item=>item.session===session);
      const receipt=()=>session.emit('assistant.usage',{model:'claude-opus-5.5',inputTokens:11,outputTokens:1,
        copilotUsage:{totalNanoAiu:6400000},finishReason:'length'});
      turn.nativeEvent({type:'message_start'});
      if(text){
        turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text}});
        turn.nativeEvent({type:'content_block_stop',index:0});
      }
      if(receiptFirst)receipt();
      turn.nativeEvent({type:'message_delta',delta:{stop_reason:'max_tokens'}});
      turn.nativeEvent({type:'message_stop'});
      if(!receiptFirst)receipt();
    },{modelTimeoutMs:80});
    const response=await current.call(request({max_tokens:1,stream}));
    const wire=await response.text();assert.equal(response.status,200,wire);
    if(stream){assert.match(wire,/"stop_reason":"max_tokens"/);assert.match(wire,/event: message_stop/);assert.doesNotMatch(wire,/event: error/);}
    else{
      const result=JSON.parse(wire);assert.equal(result.stop_reason,'max_tokens');
      assert.deepEqual(result.content,text?[{type:'text',text}]:[]);
      assert.equal(result.usage.input_tokens,11);assert.equal(result.usage.output_tokens,1);
    }
    assert.equal(current.gateway.ledger.state.completed,1);assert.equal(current.gateway.ledger.state.failed,0);
    assert.equal(current.gateway.ledger.state.recent[0].totalNanoAiu,6400000);
    assert.equal(current.gateway.ledger.state.recent[0].sdkApiCalls,1);
    assert.equal(current.gateway.turns.size,0);assert.equal(current.sessions[0].aborted,true);
    assert.equal(current.sessions[0].released,true);
  }
});
test('Claude native limit without verified terminal or SDK receipt is not fabricated as success',async t=>{
  for(const missing of ['stop','receipt']){
    const current=await fixture(t,session=>{
      const turn=[...current.gateway.turns].find(item=>item.session===session);
      turn.nativeEvent({type:'message_start'});
      turn.nativeEvent({type:'message_delta',delta:{stop_reason:'max_tokens'}});
      if(missing!=='stop')turn.nativeEvent({type:'message_stop'});
      if(missing!=='receipt')session.emit('assistant.usage',{model:'claude-opus-5.5',inputTokens:11,outputTokens:1});
    },{modelTimeoutMs:40});
    // A terminated native stream that the SDK never settles fails as a 502.
    const response=await current.call(request({max_tokens:1}));assert.equal(response.status,missing==='stop'?504:502);await response.text();
    assert.equal(current.gateway.ledger.state.completed,0);assert.equal(current.gateway.ledger.state.failed,1);
    assert.equal(current.gateway.ledger.state.recent[0].totalNanoAiu,null);
    assert.equal(current.gateway.ledger.state.recent[0].failurePhase,missing==='stop'?'native-streaming':'after-native-stop');
  }
});
test('Claude turn stalled after a complete native stream delivers the finished answer instead of failing',async t=>{
  const current=await fixture(t,session=>{
    const turn=[...current.gateway.turns].find(item=>item.session===session);
    turn.nativeEvent({type:'message_start'});
    turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text:'partial'}});
    turn.nativeEvent({type:'content_block_stop',index:0});
    turn.nativeEvent({type:'message_delta',delta:{stop_reason:'end_turn'}});
    turn.nativeEvent({type:'message_stop'});
    // SDK never emits assistant.message/session.idle.
  },{modelTimeoutMs:60000,postStreamMs:60,heartbeatMs:10});
  const started=Date.now();const response=await current.call(request({stream:true}));const wire=await response.text();
  // The model finished and the client already has every block: deliver it, so a
  // stalled SDK no longer forces a paid retry. Fast, not after the long deadline.
  assert.ok(Date.now()-started<5000);assert.doesNotMatch(wire,/event: error/);
  assert.match(wire,/"stop_reason":"end_turn"/);assert.match(wire,/event: message_stop/);assert.match(wire,/partial/);
  const row=current.gateway.ledger.state.recent[0];
  assert.equal(row.status,'completed');assert.equal(row.recoveredAfterStall,true);assert.equal(current.gateway.turns.size,0);
});
test('Claude SDK error after a complete native stream delivers the answer the client already holds',async t=>{
  const current=await fixture(t,session=>{
    const turn=[...current.gateway.turns].find(item=>item.session===session);
    turn.nativeEvent({type:'message_start'});
    turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text:'done'}});
    turn.nativeEvent({type:'content_block_stop',index:0});
    turn.nativeEvent({type:'message_delta',delta:{stop_reason:'end_turn'}});
    turn.nativeEvent({type:'message_stop'});
    session.emit('session.error',{message:'late duplicate request failed'});
  });
  const wire=await (await current.call(request({stream:true}))).text();
  assert.doesNotMatch(wire,/event: error/);assert.match(wire,/"stop_reason":"end_turn"/);assert.match(wire,/done/);
  const row=current.gateway.ledger.state.recent[0];
  assert.equal(row.status,'completed');assert.equal(row.recoveredAfterError,true);assert.equal(current.gateway.turns.size,0);
});
test('Claude overlapping SDK attempts: the first native stream owns the client, a later one is dropped',async t=>{
  const provider=http.createServer((_request,response)=>{
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.end(['message_start','message_delta','message_stop'].map(type=>'data: '+JSON.stringify({type,
      ...(type==='message_delta'?{delta:{stop_reason:'end_turn'}}:{})})+'\n\n').join(''));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const handler=new ClaudeRequestHandler(),body=request({}),seen=[];
  handler.bind('overlap',body,validate(body,models),body.messages,event=>seen.push(event.type));
  const send=()=>handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{
    method:'POST',body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),
    {sessionId:'overlap',signal:new AbortController().signal});
  const [first,second]=await Promise.all([send(),send()]);
  await first.text();await second.text();
  assert.equal(seen.filter(type=>type==='message_start').length,1);assert.equal(seen.filter(type=>type==='message_stop').length,1);
  assert.equal(seen.filter(type=>type==='relay_transport_superseded').length,1);
});
test('Claude stall before the native stream terminates still fails fast with an error',async t=>{
  const current=await fixture(t,session=>{
    const turn=[...current.gateway.turns].find(item=>item.session===session);
    turn.nativeEvent({type:'message_start'});
    turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text:'partial'}});
  },{modelTimeoutMs:80,heartbeatMs:10});
  const response=await current.call(request({stream:true}));const wire=await response.text();
  assert.match(wire,/event: error/);assert.doesNotMatch(wire,/event: message_stop/);
  assert.equal(current.gateway.ledger.state.recent[0].failurePhase,'native-streaming');
});
test('Claude native max-token response and released sessions reject SDK retries before transport',async t=>{
  let requests=0;
  const provider=http.createServer((_request,response)=>{
    requests++;response.writeHead(200,{'content-type':'text/event-stream'});
    response.end(['message_start','message_delta','message_stop'].map(type=>'data: '+JSON.stringify({type,
      ...(type==='message_delta'?{delta:{stop_reason:'max_tokens'}}:{})})+'\n\n').join(''));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const handler=new ClaudeRequestHandler(),body=request({max_tokens:1});
  handler.bind('one-token-probe',body,validate(body,models),body.messages,()=>{});
  const send=()=>handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{
    method:'POST',body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),
    {sessionId:'one-token-probe',signal:new AbortController().signal});
  await (await send()).text();
  await assert.rejects(send(),error=>error.name==='AbortError');
  handler.release('one-token-probe');await assert.rejects(send(),error=>error.name==='AbortError');
  assert.equal(requests,1);assert.equal(handler.plans.size,0);
  for(let index=0;index<1100;index++)handler.release('expired-'+index);
  assert.equal(handler.released.size,1024);
});
test('Claude strict tool limit rejects before any SDK session without changing nonstrict tools',()=>{
  const extraTools=Array.from({length:21},(_,i)=>({...tools[0],name:'Tool'+i,strict:true}));
  assert.throws(()=>validate(request({tools:extraTools}),models),/20 native strict/);
  extraTools[20].strict=false;assert.equal(validate(request({tools:extraTools}),models).tools.length,21);
});
test('Claude upstream HTTP errors retain native status, type, retry hint and correlation without usage invention',async t=>{
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(item=>item.session===s);
    turn.nativeEvent({type:'relay_transport_attempt'});
    turn.nativeEvent({type:'relay_transport_response',status:429,error:{type:'rate_limit_error',message:'FIXTURE_RATE_LIMIT',requestId:'fixture-upstream-id',retryAfter:'2'}});
    s.emit('session.error',{message:'SDK execution failed after provider rejection'});
  });
  for(const stream of [false,true]){
    const response=await f.call(request({stream}));const result=await response.json();
    assert.equal(response.status,429);assert.equal(result.error.type,'rate_limit_error');assert.equal(result.error.message,'FIXTURE_RATE_LIMIT');
    assert.equal(result.request_id,'fixture-upstream-id');assert.equal(response.headers.get('retry-after'),'2');
  }
  assert.equal(f.gateway.ledger.state.failed,2);assert.equal(f.gateway.ledger.state.completed,0);
  assert.equal(f.gateway.ledger.state.recent[0].sdkApiCalls,0);assert.equal(f.gateway.ledger.state.recent[0].totalNanoAiu,null);
  assert.equal(f.gateway.ledger.state.recent[0].httpStatus,429);assert.equal(f.gateway.ledger.state.recent[0].errorType,'rate_limit_error');
});
test('Claude native SSE error is a failure terminal, not a truncated success or fabricated message_stop',async()=>{
  const event={type:'error',error:{type:'overloaded_error',message:'FIXTURE_OVERLOAD'},request_id:'native-fixture-id'};
  const wire='event: error\ndata: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n';const observed=[];
  const response=observeStream(new Response(wire,{headers:{'content-type':'text/event-stream'}}),value=>observed.push(value));
  assert.equal(await response.text(),wire);assert.deepEqual(observed,[event]);
});
test('Claude native errors after partial output fail once, clear tools and never report success',async t=>{
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(item=>item.session===s);turn.nativeEvent({type:'message_start'});
    turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
    turn.nativeEvent({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'partial'}});
    turn.nativeEvent({type:'error',error:{type:'overloaded_error',message:'FIXTURE_OVERLOAD'},request_id:'native-id'});
    s.final('ignored completion');
  });
  const response=await f.call(request({stream:true}));const wire=await response.text();
  assert.match(wire,/"type":"overloaded_error"/);assert.doesNotMatch(wire,/event: message_stop/);
  assert.doesNotMatch(wire,/ignored completion/);assert.equal(f.gateway.ledger.state.failed,1);assert.equal(f.gateway.ledger.state.completed,0);
  assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.ledger.state.recent[0].partialOutput,true);
});
test('Claude request hook preserves bounded upstream error details while leaving original HTTP bytes intact',async t=>{
  const events=[];const server=http.createServer((_req,res)=>{res.writeHead(400,{'content-type':'application/json','request-id':'fixture-request-id'});
    res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'FIXTURE_SCHEMA_ERROR'}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler();const body=request();handler.bind('error-fixture',body,validate(body,models),body.messages,event=>events.push(event));
  const response=await handler.sendRequest(new Request(`http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',
    body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),{sessionId:'error-fixture',signal:new AbortController().signal});
  assert.equal(response.status,400);assert.equal((await response.json()).error.message,'FIXTURE_SCHEMA_ERROR');
  const failure=events.find(event=>event.type==='relay_transport_response');
  assert.equal(failure.error.type,'invalid_request_error');assert.equal(failure.error.requestId,'fixture-request-id');
});
test('Claude beta controls are bound to native sessions, malformed values reject before inference',async t=>{
  const bindings=[];const f=await fixture(t,s=>s.final('OK'),{requestHandler:{bind(_id,_body,selected){bindings.push(selected.betas);},release(){}}});
  const response=await f.call(request(),{'anthropic-beta':'claude-code-20250219,effort-2025-11-24'});
  assert.equal(response.status,200);assert.deepEqual(bindings[0],['claude-code-20250219','effort-2025-11-24']);
  const denied=await f.call(request(),{'anthropic-beta':'invalid beta value'});assert.equal(denied.status,400);
  assert.equal(f.sessions.length,1);assert.equal(f.gateway.ledger.state.recent.at(-1).status,'rejected');
  assert.notEqual(validate(request(),models).signature,validate(request(),models,{betaHeader:'effort-2025-11-24'}).signature);
});
test('Claude native beta forwarding retains SDK controls and never replaces authentication',async t=>{
  const received=[];const server=http.createServer((req,res)=>{received.push(req.headers);res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler();const body=request();const selected=validate(body,models,{betaHeader:'claude-code-20250219,effort-2025-11-24'});
  handler.bind('beta-fixture',body,selected);
  await handler.sendRequest(new Request(`http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',
    headers:{authorization:'fixture-SDK-auth','anthropic-beta':'sdk-owned-flag'},body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),
    {sessionId:'beta-fixture',signal:new AbortController().signal});
  assert.equal(received[0].authorization,'fixture-SDK-auth');assert.equal(received[0]['anthropic-beta'],'sdk-owned-flag,claude-code-20250219,effort-2025-11-24');
});
class Session {
  constructor(config,action){this.config=config;this.action=action;this.events=new EventEmitter();this.results=[];
    this.rpc={tools:{handlePendingToolCall:async result=>{this.results.push(result);if(this.results.length===2)
      queueMicrotask(()=>this.final('BOTH_RESULTS_OK'));}}};}
  on(handler){this.events.on('event',handler);return()=>this.events.off('event',handler);}
  emit(type,data={}){this.events.emit('event',{type,data});}
  async send(input){this.input=input;setImmediate(()=>this.action(this));}
  final(text){this.emit('assistant.usage',{model:'claude-opus-5.5',inputTokens:120,outputTokens:5,cacheReadTokens:80,cacheWriteTokens:10,
    copilotUsage:{totalNanoAiu:1500000000},finishReason:'stop'});this.emit('assistant.message_delta',{deltaContent:text});
    this.emit('assistant.message',{content:text});this.emit('session.idle');}
  async abort(){this.aborted=true;}
  async disconnect(){this.disconnected=true;}
}
async function fixture(t,action,options={}){
  const sessions=[];const runtime={snapshot:()=>({ok:true}),release:s=>s.released=true,stop:async()=>{},
    createSession:async config=>{const session=new Session(config,action);sessions.push(session);return {session,generation:1};}};
  const token='fixture-token-not-a-service-secret';const gateway=await createGateway({runtime,models,token,preStartPingMs:0,...options});
  const address=await gateway.listen(0);t.after(()=>gateway.close());
  const headers={'content-type':'application/json','anthropic-version':'2023-06-01','authorization':'Bearer '+token,'x-claude-code-session-id':'session-1'};
  const call=async(body,custom={})=>fetch(`http://127.0.0.1:${address.port}/v1/messages`,{method:'POST',headers:{...headers,...custom},body:JSON.stringify(body)});
  return {gateway,runtime,sessions,headers,call,base:`http://127.0.0.1:${address.port}`};
}
test('Claude shutdown fails a streaming request, aborts SDK work and never emits success',async t=>{
  const f=await fixture(t,s=>s.emit('assistant.message_delta',{deltaContent:'partial'}));
  const response=await f.call(request({stream:true})),wire=response.text();
  let stopped=0;f.runtime.stop=async()=>{stopped++;};
  await f.gateway.close();await f.gateway.close();
  const text=await wire;
  assert.match(text,/event: error/);assert.doesNotMatch(text,/event: message_stop/);
  assert.equal(f.sessions[0].aborted,true);assert.equal(f.sessions[0].disconnected,true);
  assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.byTool.size,0);
  assert.equal(stopped,1);assert.equal(f.gateway.ledger.state.failed,1);
  assert.equal(f.gateway.ledger.state.recent[0].sdkApiCalls,0);
});
test('Claude shutdown releases retained tool ownership without replaying client tools',async t=>{
  const f=await fixture(t,s=>{
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'wait'}]});
    s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'wait',requestId:'pending',arguments:{path:'x'}});
  });
  await(await f.call(request({tools}))).text();assert.equal(f.gateway.byTool.size,1);
  await f.gateway.close();assert.equal(f.gateway.byTool.size,0);assert.equal(f.gateway.turns.size,0);
  assert.equal(f.sessions[0].aborted,true);assert.equal(f.sessions[0].disconnected,true);
  assert.equal(f.sessions[0].results.length,0);
});
test('Claude authenticated message failures before SDK attach each have one terminal ledger row',async t=>{
  const f=await fixture(t,s=>s.final('OK'));
  const attempts=[
    ()=>f.call(request(),{'anthropic-version':'invalid'}),
    ()=>fetch(f.base+'/v1/messages',{method:'POST',headers:f.headers,body:'{malformed'}),
    ()=>f.call(request({messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'https://fixture.invalid/private'}}]}]})),
    ()=>f.call(request({system:'x'.repeat(1000001)})),
  ];
  for(const attempt of attempts){const response=await attempt();assert.equal(response.status,400);await response.text();}
  assert.equal(f.gateway.ledger.state.received,4);assert.equal(f.gateway.ledger.state.failed,4);
  assert.equal(f.gateway.ledger.state.recent.length,4);assert.ok(f.gateway.ledger.state.recent.every(row=>row.status==='rejected'&&row.sdkApiCalls===0&&row.totalNanoAiu===null));
  assert.equal(f.sessions.length,0);assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('private'));
});
test('Claude SDK startup failure is counted once with actual selected model and no invented receipt',async t=>{
  const f=await fixture(t,s=>s.final('OK'));f.runtime.createSession=async()=>{throw Object.assign(new Error('PRIVATE_SDK_STARTUP_DETAIL'),{statusCode:503});};
  const response=await f.call(request());assert.equal(response.status,503);await response.text();
  assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
  const row=f.gateway.ledger.state.recent[0];assert.equal(row.selectedModel,'claude-opus-5.5');assert.equal(row.httpStatus,503);
  assert.equal(row.sdkApiCalls,0);assert.equal(row.sdkTransportAttempts,0);assert.equal(row.totalNanoAiu,null);
  assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_SDK_STARTUP_DETAIL'));
});
test('Claude generic startup error ledger status matches the actual HTTP failure',async t=>{
  const f=await fixture(t,s=>s.final('OK'));f.runtime.createSession=async()=>{throw new Error('PRIVATE_GENERIC_STARTUP');};
  const response=await f.call(request());assert.equal(response.status,500);await response.text();
  assert.equal(f.gateway.ledger.state.recent[0].httpStatus,response.status);
  assert.equal(f.gateway.ledger.state.recent[0].status,'failed');assert.equal(f.gateway.ledger.state.failed,1);
  assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_GENERIC_STARTUP'));
});
test('Claude SDK binding failure releases the owned session and keeps exactly one failure',async t=>{
  const f=await fixture(t,s=>s.final('SHOULD_NOT_SEND'),{requestHandler:{
    bind(){throw Object.assign(new Error('PRIVATE_BINDING_DETAIL'),{statusCode:503});},release(){}}});
  const response=await f.call(request());assert.equal(response.status,503);await response.text();
  assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].input,undefined);assert.equal(f.sessions[0].released,true);
  assert.equal(f.sessions[0].aborted,true);assert.equal(f.sessions[0].disconnected,true);assert.equal(f.gateway.turns.size,0);
  assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
  assert.equal(f.gateway.ledger.state.recent[0].httpStatus,503);
});
test('Claude byte-limit failure is accounted while unauthenticated requests stay outside accepted mileage',async t=>{
  const f=await fixture(t,s=>s.final('OK'),{maxBodyBytes:128});
  const denied=await f.call(request(),{authorization:'Bearer wrong'});assert.equal(denied.status,401);await denied.text();
  const response=await f.call(request({system:'x'.repeat(256)}));assert.equal(response.status,413);await response.text();
  assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
  assert.equal(f.gateway.ledger.state.recent[0].httpStatus,413);assert.equal(f.sessions.length,0);
});
test('Claude client cancellation during SDK creation is terminal and cleans the eventual owned session',async t=>{
  const f=await fixture(t,s=>s.final('SHOULD_NOT_SEND'));const original=f.runtime.createSession;
  let release,entered;const hold=new Promise(resolve=>release=resolve);const created=new Promise(resolve=>entered=resolve);
  f.runtime.createSession=async config=>{entered();await hold;return original(config);};
  const controller=new AbortController();const result=fetch(f.base+'/v1/messages',{method:'POST',headers:f.headers,body:JSON.stringify(request()),signal:controller.signal});
  await created;controller.abort();await assert.rejects(result);await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(f.gateway.ledger.state.failed,1);assert.equal(f.gateway.ledger.state.recent[0].httpStatus,499);
  const cancelled=structuredClone(f.gateway.ledger.state.recent[0]);release();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].input,undefined);assert.equal(f.sessions[0].released,true);
  assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
  assert.equal(f.gateway.ledger.state.recent[0].httpStatus,499);
  assert.deepEqual(f.gateway.ledger.state.recent[0],cancelled);
});
test('Claude authenticated upload abort is terminal before body parsing or SDK creation',async t=>{
  const f=await fixture(t,s=>s.final('SHOULD_NOT_SEND'));
  let entered;const admitted=new Promise(resolve=>entered=resolve);f.gateway.ledger.onChange=type=>{if(type==='received')entered();};
  const upload=http.request(f.base+'/v1/messages',{method:'POST',headers:f.headers});upload.on('error',()=>{});
  upload.write('{"model":"claude-opus-5-5","messages":[');await admitted;upload.destroy();
  for(let i=0;i<100&&f.gateway.ledger.state.failed===0;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
  assert.equal(f.gateway.ledger.state.recent[0].httpStatus,499);assert.equal(f.gateway.ledger.state.recent[0].status,'failed');
  assert.equal(f.sessions.length,0);assert.equal(f.gateway.ledger.state.recent[0].totalNanoAiu,null);
});
test('Claude concurrent admission rejections each retain their own sanitized request metadata',async t=>{
  const f=await fixture(t,s=>s.final('SHOULD_NOT_SEND'));
  await Promise.all(Array.from({length:16},async(_,index)=>{
    const response=await f.call(request({model:'missing-model-'+index}),{'x-claude-code-request-class':'PRIVATE_UNKNOWN_CLASS'});
    assert.equal(response.status,404);await response.text();
  }));
  assert.equal(f.gateway.ledger.state.received,16);assert.equal(f.gateway.ledger.state.failed,16);
  assert.equal(new Set(f.gateway.ledger.state.recent.map(row=>row.id)).size,16);
  assert.equal(new Set(f.gateway.ledger.state.recent.map(row=>row.requestedModel)).size,16);
  assert.ok(f.gateway.ledger.state.recent.every(row=>row.status==='rejected'&&row.requestClass===null&&row.totalNanoAiu===null));
  assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_UNKNOWN_CLASS'));assert.equal(f.sessions.length,0);
});
test('Claude changed unsigned history rebuilds from client history with its own receipt; no tool re-executes',async t=>{
  const f=await fixture(t,s=>{
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'}]});
    s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'a',requestId:'req-a',arguments:{path:'x'}});
  });
  const initial=request({tools});const result=await (await f.call(initial)).json();const first=structuredClone(f.gateway.ledger.state.recent[0]);
  const changed={...initial,messages:[...initial.messages,{role:'assistant',content:result.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:result.content[0].id,content:'value'}]}]};
  changed.messages[0].content='tampered history';
  // Previously a 409 that every retry repeated, leaving the chat stuck.
  const response=await f.call(changed);assert.equal(response.status,200);await response.text();
  const row=f.gateway.ledger.state.recent.at(-1);
  assert.deepEqual(row.historyMismatch,{expectedMessages:2,receivedMessages:2,messageIndex:0,blockIndex:0,reason:'content'});
  assert.equal(row.continuationMode,'rebuilt-history');
  assert.doesNotMatch(JSON.stringify(f.gateway.ledger.state),/tampered history/);
  assert.equal(f.sessions[0].results.length,0,'the original pending tool is not resolved or re-executed');
  assert.equal(f.sessions.length,2,'a new SDK session was built from the client history');
  assert.match(f.sessions[1].input.prompt,/tampered history/);
  assert.deepEqual(f.gateway.ledger.state.recent[0],first,'the completed tool turn receipt is untouched');
  assert.equal(f.gateway.byTool.size,f.gateway.turns.size?1:0);
});
test('Claude SDK-only ghost tool (superseded attempt) never blocks results for the tools the client saw',async t=>{
  const f=await fixture(t,s=>{
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'}]});
    s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'a',requestId:'req-a',arguments:{path:'x'}});
  });
  const initial=request({tools});const result=await (await f.call(initial)).json();
  // A late registration the client never received as a tool_use block.
  f.sessions[0].emit('external_tool.requested',{toolName:'client_Read',toolCallId:'ghost',requestId:'req-ghost',arguments:{path:'y'}});
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:result.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:result.content[0].id,content:'value'}]}]};
  // Previously a 409 on every retry and on /compact, leaving the chat stuck.
  const response=await f.call(next);assert.equal(response.status,200);await response.text();
  assert.equal(f.gateway.ledger.state.recent.at(-1).continuationMode,'rebuilt-history');
  assert.equal(f.sessions[0].results.length,0,'no tool re-executed');assert.equal(f.sessions.length,2);
  // A result genuinely missing for a visible tool call is still refused.
  const g=await fixture(t,s=>{
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  });
  const two=await (await g.call(initial)).json();
  const partial={...initial,messages:[...initial.messages,{role:'assistant',content:two.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:two.content[0].id,content:'value'}]}]};
  const refused=await g.call(partial);assert.equal(refused.status,409);await refused.text();assert.equal(g.gateway.turns.size,1);
});
test('Claude legitimate setting changes rebuild complete owned continuations without replaying tools',async t=>{
  for(const change of [{max_tokens:2048},{system:'Updated client instructions'},
    {output_config:{effort:'low'}},{tools:[...tools,{name:'Write',input_schema:{type:'object'}}]}]){
    let sends=0;const bound=[];
    const f=await fixture(t,s=>{
      if(++sends>1){s.final('REBUILT_OK');return;}
      s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'}]});
      s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'a',requestId:'req-a',arguments:{path:'x'}});
    },{requestHandler:{bind(_id,body,_selected,messages){bound.push({body,messages});},release(){}}});
    const initial=request({tools});const first=await (await f.call(initial)).json();
    const next={...initial,...change,messages:[...initial.messages,{role:'assistant',content:first.content},
      {role:'user',content:[{type:'tool_result',tool_use_id:first.content[0].id,content:'ALREADY_EXECUTED'}]}]};
    const response=await f.call(next);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.content[0].text,'REBUILT_OK');assert.equal(f.sessions.length,2);
    assert.equal(f.sessions[0].aborted,true);assert.deepEqual(f.sessions[0].results,[]);
    assert.deepEqual(bound.at(-1).messages,next.messages);assert.equal(f.gateway.byTool.size,0);
    assert.equal(f.gateway.ledger.state.recent.at(-1).continuationMode,'rebuilt');
    assert.equal(f.gateway.ledger.state.recent.at(-1).toolResults,1);
    assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('ALREADY_EXECUTED'));
  }
});
test('Claude rebuild failure preserves pending ownership for a valid retry',async t=>{
  let sends=0;
  const f=await fixture(t,s=>{
    if(++sends>1){s.final('RECOVERED');return;}
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'}]});
    s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'a',requestId:'req-a',arguments:{path:'x'}});
  });
  const initial=request({tools}),first=await (await f.call(initial)).json(),holder=[...f.gateway.turns][0];
  const next={...initial,max_tokens:2048,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:first.content[0].id,content:'RESULT'}]}]};
  const create=f.runtime.createSession;f.runtime.createSession=async()=>{throw new Error('fixture session failure');};
  const failed=await f.call(next);assert.equal(failed.status,500);await failed.text();
  assert.equal(holder.done,false);assert.equal(holder.rebuilding,false);assert.equal(holder.pending.size,1);
  f.runtime.createSession=create;const retried=await f.call(next);assert.equal(retried.status,200);await retried.text();
  assert.equal(holder.done,true);assert.equal(f.sessions.length,2);
});
test('Claude usage receipt identity is deduplicated without collapsing distinct equal-cost calls',()=>{
  const ledger=new Ledger(),row=ledger.start(request(),{},validate(request(),models));
  const usage={apiCallId:'provider-call-one',model:'claude-opus-5.5',inputTokens:12,outputTokens:2,copilotUsage:{totalNanoAiu:100}};
  ledger.usage(row,usage,{id:'event-one'});ledger.usage(row,usage,{id:'event-two'});
  ledger.usage(row,{...usage,apiCallId:'provider-call-two'},{id:'event-three'});
  assert.equal(row.sdkApiCalls,2);assert.equal(row.totalNanoAiu,200);assert.equal(ledger.state.usage[0].sdkApiCalls,2);
  assert.ok(!JSON.stringify(ledger.state).includes('provider-call-one'));
});

test('Claude metadata session IDs isolate continuations when GUI omits custom session headers',async t=>{
  const f=await fixture(t,s=>{
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'metadata-tool'}]});
    s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:'metadata-tool',requestId:'pending',arguments:{path:'x'}});
  });
  const meta=id=>({user_id:JSON.stringify({session_id:id})});
  const initial=request({tools,metadata:meta('00000000-0000-4000-8000-000000000001')});
  const first=await (await f.call(initial,{'x-claude-code-session-id':''})).json();
  f.sessions[0].rpc.tools.handlePendingToolCall=async result=>{f.sessions[0].results.push(result);f.sessions[0].final('WRONG_OWNER_ACCEPTED');};
  const next={...initial,metadata:meta('00000000-0000-4000-8000-000000000002'),messages:[...initial.messages,
    {role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:first.content[0].id,content:'result'}]}]};
  const response=await f.call(next,{'x-claude-code-session-id':''});
  assert.equal(response.status,409);await response.text();assert.equal(f.sessions[0].results.length,0);
  assert.equal(f.gateway.byTool.size,1);
});

test('Claude late SDK receipt after tool continuation updates the original request and task exactly once',async t=>{
  const f=await fixture(t,s=>{
    s.emit('assistant.message',{apiCallId:'original-call',content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  });
  const initial=request({tools}),reply=await(await f.call(initial)).json();
  const first=f.gateway.ledger.state.recent[0];assert.equal(first.sdkApiCalls,0);
  const session=f.sessions[0];
  session.rpc.tools.handlePendingToolCall=async result=>{
    session.results.push(result);
    if(session.results.length===2){
      const late={apiCallId:'original-call',model:'claude-opus-5.5',inputTokens:7,outputTokens:3,copilotUsage:{totalNanoAiu:1e9}};
      session.emit('assistant.usage',late);session.emit('assistant.usage',late);session.final('OK');
    }
  };
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:reply.content},
    {role:'user',content:reply.content.map(block=>({type:'tool_result',tool_use_id:block.id,content:'result'}))}]};
  const response=await f.call(next);assert.equal(response.status,200);const final=await response.json();
  assert.equal(final.usage.output_tokens,5);assert.equal(first.sdkApiCalls,1);assert.equal(first.totalNanoAiu,1e9);
  const second=f.gateway.ledger.state.recent[1];assert.equal(second.sdkApiCalls,1);assert.equal(second.totalNanoAiu,1.5e9);
  const task=f.gateway.ledger.state.taskDaily[0];assert.equal(task.completed,2);assert.equal(task.totalNanoAiu,2.5e9);
  assert.equal(task.unmeteredCalls,0);assert.equal(task.meteredCalls,2);
});

test('Claude late transport metadata remains on the request that initiated it',async t=>{
  const callbacks=[];const f=await fixture(t,s=>{
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,_selected,_messages,callback){callbacks.push(callback);},release(){}}});
  const initial=request({tools}),reply=await (await f.call(initial)).json(),first=f.gateway.ledger.state.recent[0];
  const old=callbacks.at(-1);old({type:'relay_transport_attempt'});
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:reply.content},
    {role:'user',content:reply.content.map(b=>({type:'tool_result',tool_use_id:b.id,content:'result'}))}]};
  // Leave the next request in flight while the previous transport completes.
  f.sessions[0].rpc.tools.handlePendingToolCall=async()=>{};
  const controller=new AbortController();const pending=fetch(f.base+'/v1/messages',{method:'POST',headers:f.headers,body:JSON.stringify(next),signal:controller.signal}).catch(()=>{});
  while(callbacks.length<2)await new Promise(resolve=>setTimeout(resolve,2));
  old({type:'relay_transport_response',status:200});
  const second=f.gateway.ledger.state.recent.at(-1);
  assert.equal(first.sdkTransportResponses,1);assert.equal(second.sdkTransportResponses,0);
  controller.abort();await pending;
});

test('Claude partial native stream cannot trigger another paid transport attempt',async t=>{
  let attempts=0;const provider=http.createServer((_req,res)=>{attempts++;res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: {"type":"message_start"}\n\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"partial"}}\n\n');});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const handler=new ClaudeRequestHandler(),body=request();handler.bind('partial',body,validate(body,models),body.messages,()=>{});
  const send=()=>handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{
    method:'POST',body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),{sessionId:'partial',signal:new AbortController().signal});
  await assert.rejects(async()=>await(await send()).text(),/before message_stop/);
  await assert.rejects(send(),error=>error.name==='AbortError');assert.equal(attempts,1);
});

test('Claude catalog maps only entitled Claude IDs, effort/context validation is explicit',()=>{
  assert.deepEqual(catalog(models).map(m=>m.id),['claude-opus-5-5']);
  assert.equal(validate(request({output_config:{effort:'xhigh'}}),models).model.id,'claude-opus-5.5');
  assert.throws(()=>validate(request({model:'claude-opus-madeup'}),models),/not exposed/);
  assert.throws(()=>validate(request({container:{}}),models),/Unsupported request field/);
  assert.throws(()=>validate(request({max_tokens:128001}),models),/max_tokens/);
});
test('Claude malformed message/tool contents fail as client errors, not internal TypeErrors',()=>{
  for(const body of [request({messages:[null]}),request({messages:[{role:'user',content:[null]}]}),
    request({system:[null]}),request({tools:[null]})]){
    assert.throws(()=>validate(body,models),error=>error.statusCode===400);
  }
});
test('Claude usage separates cache tokens and replay preserves tool call IDs',()=>{
  assert.deepEqual(messageUsage([{inputTokens:120,outputTokens:5,cacheReadTokens:80,cacheWriteTokens:10}]),
    {input_tokens:30,output_tokens:5,cache_read_input_tokens:80,cache_creation_input_tokens:10});
  assert.match(sessionInput(request({messages:[{role:'assistant',content:[{type:'tool_use',id:'id-a',name:'Read',input:{path:'x'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'id-a',content:'proof'}]}]})).prompt,/id-a/);
});
test('Claude streams full ordered lifecycle, heartbeat and final measured usage',async()=>{
  const response=new EventEmitter();let wire='';response.writeHead=()=>{};response.write=s=>wire+=s;response.end=()=>{};
  const sink=new MessageSink(response,request({stream:true}),()=>{},5);sink.text('HE');sink.finishText('HELLO');
  await new Promise(resolve=>setTimeout(resolve,12));sink.finish('end_turn',[{inputTokens:120,outputTokens:5}]);
  const frames=wire.split('\n\n').filter(Boolean).map(frame=>JSON.parse(frame.split('\ndata: ')[1]));
  assert.equal(frames[0].type,'message_start');assert.ok(frames.some(f=>f.type==='ping'));
  assert.equal(frames.at(-2).delta.stop_reason,'end_turn');assert.equal(frames.at(-1).type,'message_stop');
  assert.equal(frames.filter(f=>f.type==='content_block_stop').length,1);
});
test('Claude HTTP auth, browser isolation, beta URL, real usage and no built-in tool execution',async t=>{
  const f=await fixture(t,s=>s.final('HELLO'));
  assert.equal((await f.call(request(),{authorization:'Bearer wrong'})).status,401);
  assert.equal((await f.call(request(),{origin:'http://hostile.invalid'})).status,403);
  const response=await fetch(f.base+'/v1/messages?beta=true',{method:'POST',headers:f.headers,body:JSON.stringify(request())});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.content[0].text,'HELLO');
  assert.equal(body.usage.input_tokens,30);assert.equal(f.sessions[0].config.enableConfigDiscovery,false);
  assert.deepEqual(f.sessions[0].config.availableTools,[]);assert.equal(f.gateway.ledger.state.completed,1);
  assert.equal(f.gateway.ledger.state.usage[0].totalNanoAiu,1500000000);
  assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('fixture-token'));
  const discovery=await fetch(f.base+'/v1/models',{headers:f.headers});assert.equal((await discovery.json()).data[0].id,'claude-opus-5-5');
});
test('Claude two parallel client tools resume one SDK session, ownership mismatch is rejected',async t=>{
  const f=await fixture(t,s=>{
    s.emit('assistant.usage',{model:'claude-opus-5.5',inputTokens:20,outputTokens:10});
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  });
  const initial=request({tools});const r=await f.call(initial);const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));
  assert.equal(result.stop_reason,'tool_use');assert.equal(result.content.length,2);
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:result.content},
    {role:'user',content:result.content.map(block=>({type:'tool_result',tool_use_id:block.id,content:'value-'+block.id}))}]};
  assert.equal((await f.call(next,{'x-claude-code-session-id':'other-session'})).status,409);
  const second=await f.call(next);const final=await second.json();assert.equal(second.status,200,JSON.stringify(final));
  assert.equal(final.content[0].text,'BOTH_RESULTS_OK');assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].results.length,2);
  assert.equal(f.gateway.ledger.state.completed,2);assert.ok(f.sessions[0].released);
  assert.equal(f.gateway.ledger.state.received,3);assert.equal(f.gateway.ledger.state.failed,1);
  assert.deepEqual(f.gateway.ledger.state.recent.map(row=>row.status),['completed','rejected','completed']);
  assert.deepEqual(f.gateway.ledger.state.recent.map(row=>[row.toolRequests,row.toolResults]),[[2,0],[0,0],[0,2]]);
});
test('Claude SDK silent timeout terminates with a streamed error and releases the session',async t=>{
  const f=await fixture(t,()=>{},{modelTimeoutMs:25,heartbeatMs:5});const response=await f.call(request({stream:true}));
  const text=await response.text();assert.match(text,/event: ping/);assert.match(text,/event: error/);assert.doesNotMatch(text,/event: message_stop/);
  assert.equal(f.gateway.ledger.state.failed,1);assert.equal(f.gateway.turns.size,0);
});
test('Claude native thinking and sampling validation preserves exact budgets, no disabled model fallback',()=>{
  const body=request({max_tokens:4096,thinking:{type:'enabled',budget_tokens:2048},temperature:0,top_p:0.8,top_k:10});
  assert.equal(validate(body,models).model.id,models[0].id);
  assert.notEqual(validate(body,models).signature,validate({...body,thinking:{type:'enabled',budget_tokens:1024}},models).signature);
  for(const invalidBody of [request({thinking:{type:'enabled',budget_tokens:1024}}),request({temperature:2}),
    request({output_config:'bad'}),request({tool_choice:'bad'}),request({thinking:{type:'adaptive',budget_tokens:1234}}),request({stop_sequences:[null]})])
    assert.throws(()=>validate(invalidBody,models),error=>error.statusCode===400);
  const denied=[{...models[0],policy:{state:'disabled'}}];assert.equal(catalog(denied).length,0);
  assert.throws(()=>validate(request(),denied),/not exposed/);
});
test('Claude native SSE observer preserves split UTF8/CRLF bytes and exact stop metadata',async()=>{
  const frames=[{type:'message_start',message:{content:[]}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'hé🙂'}},
    {type:'message_delta',delta:{stop_reason:'stop_sequence',stop_sequence:'CLASSIFIER_STOP'}},{type:'message_stop'}];
  const wire=frames.map(f=>'event: '+f.type+'\r\ndata: '+JSON.stringify(f)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
  const bytes=Buffer.from(wire);const events=[];
  const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'content-type':'text/event-stream'}});
  assert.equal(await observeStream(response,e=>events.push(e)).text(),wire);assert.deepEqual(events,frames);
});
test('Claude native SSE parser fails truncated/oversized streams and leaves upstream HTTP errors intact',async()=>{
  const event='data: {"type":"message_start"}\n\n';
  await assert.rejects(observeStream(new Response(event,{headers:{'content-type':'text/event-stream'}}),()=>{}).text(),/before message_stop/);
  await assert.rejects(observeStream(new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),()=>{}).text(),/before native message_stop/);
  await assert.rejects(observeStream(new Response('data: '+ 'x'.repeat(100),{headers:{'content-type':'text/event-stream'}}),()=>{},32).text(),/bounded parser/);
  const response=new Response('UPSTREAM_ERROR',{status:429});assert.equal(observeStream(response,()=>{}),response);
});
test('Claude custom stop sequence survives both streaming and nonstreaming completions',async t=>{
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns][0];turn.nativeEvent({type:'message_start'});
    turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
    turn.nativeEvent({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'ALLOW'}});
    turn.nativeEvent({type:'content_block_stop',index:0});
    turn.nativeEvent({type:'message_delta',delta:{stop_reason:'stop_sequence',stop_sequence:'END_CLASSIFIER'}});
    turn.nativeEvent({type:'message_stop'});s.final('ALLOW');
  });
  const response=await f.call(request({stop_sequences:['END_CLASSIFIER']}));const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.stop_reason,'stop_sequence');assert.equal(result.stop_sequence,'END_CLASSIFIER');
  const stream=await f.call(request({stream:true,stop_sequences:['END_CLASSIFIER']}));
  assert.match(await stream.text(),/"stop_sequence":"END_CLASSIFIER"/);
});
test('Claude retry after an upstream HTTP error retains initial native history',async t=>{
  const sent=[];const server=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;sent.push(JSON.parse(text));
    res.writeHead(sent.length===1?503:200);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler();const body=request({messages:[{role:'user',content:'original-role-boundary'}]});
  handler.bind('retry-session',body,validate(body,models));
  const input={model:'claude-opus-5.5',max_tokens:100,stream:true,system:'SDK-system',messages:[{role:'user',content:'flattened-bootstrap'}]};
  const send=()=>handler.sendRequest(new Request(`http://127.0.0.1:${server.address().port}/v1/messages`,{method:'POST',body:JSON.stringify(input)}),
    {sessionId:'retry-session',signal:new AbortController().signal});
  assert.equal((await send()).status,503);assert.equal((await send()).status,200);
  assert.deepEqual(sent[0].messages,body.messages);assert.deepEqual(sent[1].messages,body.messages);
});
test('Claude transport attempts include failed upstream requests without inventing usage or credits',()=>{
  const ledger=new Ledger();const row=ledger.start(request(),{},validate(request(),models));
  ledger.transport(row,{type:'relay_transport_attempt'});ledger.transport(row,{type:'relay_transport_response',status:503});
  ledger.transport(row,{type:'relay_transport_attempt'});ledger.transport(row,{type:'relay_transport_error'});
  ledger.transport(row,{type:'relay_transport_attempt'});ledger.transport(row,{type:'relay_transport_response',status:200});
  assert.deepEqual(ledger.state.transport,{attempts:3,httpResponses:2,httpErrors:1,networkErrors:1});
  assert.equal(row.sdkApiCalls,0);assert.equal(row.totalNanoAiu,null);assert.equal(row.sdkTransportAttempts,3);assert.equal(row.sdkTransportErrors,2);
});
test('Claude preview refuses vulnerable or unknown sharp versions before launching a worker',()=>{
  assert.throws(()=>assertDependencies('0.35.4'),/patched sharp/);assert.throws(()=>assertDependencies('unknown'),/patched sharp/);
  assert.doesNotThrow(()=>assertDependencies('0.35.5'));assert.doesNotThrow(()=>assertDependencies('0.36.0'));
});
test('Claude history cache annotations never hide a similarly named tool argument',()=>{
  const a=[{role:'assistant',content:[{type:'tool_use',id:'one',name:'Read',input:{cache_control:'user-value'}}]}];
  const b=structuredClone(a);b[0].content[0].cache_control={type:'ephemeral'};
  assert.equal(historyFingerprint(a),historyFingerprint(b));
  b[0].content[0].input.cache_control='different';assert.notEqual(historyFingerprint(a),historyFingerprint(b));
});
test('Claude stock direct-caller omission is equivalent, but user arguments and other callers remain bound',()=>{
  const native=[{role:'assistant',content:[{type:'tool_use',id:'a',name:'Read',input:{caller:'private-user-value'},caller:{type:'direct'}}]}];
  const client=structuredClone(native);delete client[0].content[0].caller;
  assert.equal(historyFingerprint(native),historyFingerprint(client));
  client[0].content[0].input.caller='changed';assert.notEqual(historyFingerprint(native),historyFingerprint(client));
  client[0].content[0].input.caller='private-user-value';client[0].content[0].caller={type:'code_execution',tool_id:'other'};
  assert.notEqual(historyFingerprint(native),historyFingerprint(client));
});
test('Claude retained native history refreshes cache markers without touching opaque blocks or tool arguments',async()=>{
  const {refreshHistoryCache}=await import('./claude-gateway/protocol.mjs');
  const cached={type:'ephemeral'};
  const original=[{role:'user',content:[{type:'text',text:'prefix',cache_control:cached}]},
    {role:'assistant',content:[{type:'thinking',thinking:'fixture',signature:'opaque'},
      {type:'tool_use',id:'a',name:'Read',input:{cache_control:'user-value'},caller:{type:'direct'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'a',content:[{type:'text',text:'old',cache_control:cached}],cache_control:cached}]}];
  const client=structuredClone(original);delete client[0].content[0].cache_control;
  delete client[2].content[0].content[0].cache_control;
  const result=refreshHistoryCache(original,client);
  assert.deepEqual(result,client);assert.equal(original[0].content[0].cache_control.type,'ephemeral');
  assert.equal(result[1].content[0].signature,'opaque');assert.equal(result[1].content[1].input.cache_control,'user-value');
  const images=[{role:'user',content:[{type:'text',text:'image-note',cache_control:cached},{type:'image',source:{type:'base64',data:'packed'}}]}];
  const imageClient=[{role:'user',content:[{type:'image',source:{type:'base64',data:'original'},cache_control:cached}]}];
  const packed=refreshHistoryCache(images,imageClient);
  assert.equal(packed[0].content[0].cache_control,undefined);assert.deepEqual(packed[0].content.at(-1).cache_control,cached);
  assert.equal(packed[0].content.at(-1).source.data,'packed');
});
test('Claude process-scoped picker shows entitled models, preserves permissions and never edits parent env',()=>{
  const gateway={models,server:{address:()=>({port:4246})}};
  const original={ANTHROPIC_API_KEY:'fixture-private',CLAUDE_CODE_OAUTH_TOKEN:'fixture-oauth',UNRELATED:'keep'};
  const env=clientEnvironment(gateway,'fixture-local-credential',original);
  assert.equal(original.ANTHROPIC_API_KEY,'fixture-private');assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert.equal(env.ANTHROPIC_BASE_URL,'http://127.0.0.1:4246');assert.equal(env.UNRELATED,'keep');
  const args=clientArguments(['--settings','{"permissions":{"allow":["Read"],"defaultMode":"plan"},"theme":"dark"}','-p','Hi'],gateway);
  const settings=JSON.parse(args[1]);assert.equal(settings.theme,'dark');assert.deepEqual(settings.permissions.allow,['Read']);
  assert.equal(settings.permissions.defaultMode,'plan');assert.equal(settings.modelPicker.replaceBuiltInOptions,true);
  assert.deepEqual(settings.modelPicker.options.map(row=>row.model),['claude-opus-5-5']);
  assert.deepEqual(args.slice(2),['-p','Hi']);
});
test('Claude native SDK hook retains roles, fixed thinking, credentials and real signed continuation state',async t=>{
  const bodies=[];const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;
    bodies.push({body:JSON.parse(text),authorization:req.headers.authorization});res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler();const body=request({tools,system:[{type:'text',text:'SYSTEM_PROOF',cache_control:{type:'ephemeral'}}],
    max_tokens:4096,thinking:{type:'enabled',budget_tokens:2048},temperature:0,
    messages:[{role:'user',content:'first'},{role:'assistant',content:'prior'},{role:'user',content:'new'}]});
  const selected=validate(body,models);handler.bind('session-a',body,selected);
  const outbound={model:'claude-opus-5.5',max_tokens:100,stream:true,messages:[{role:'user',content:'serialized history'}],system:'sdk',tools:[]};
  const url=`http://127.0.0.1:${server.address().port}/v1/messages`;
  const send=wire=>handler.sendRequest(new Request(url,{method:'POST',headers:{authorization:'Bearer fixture-auth'},body:JSON.stringify(wire)}),
    {sessionId:'session-a',signal:new AbortController().signal});
  await send(outbound);assert.deepEqual(bodies[0].body.messages,body.messages);assert.deepEqual(bodies[0].body.system,body.system);
  assert.equal(bodies[0].body.thinking.budget_tokens,2048);assert.equal(bodies[0].body.temperature,0);
  assert.equal(bodies[0].body.tools[0].name,'client_Read');assert.equal(bodies[0].authorization,'Bearer fixture-auth');
  const continuation={...outbound,messages:[{role:'assistant',content:[{type:'thinking',thinking:'actual',signature:'actual-upstream-signature'}]}]};
  handler.bind('session-a',body,selected);await send(continuation);
  assert.deepEqual(bodies[1].body.messages,continuation.messages);
  await assert.rejects(send({...outbound,model:'unexpected'}),/dialect changed/);
  handler.release('session-a');assert.equal(handler.plans.size,0);
});
test('Claude native image history sends bounded packed pixels, never the original oversized batch',()=>{
  const image=data=>({type:'image',source:{type:'base64',media_type:'image/png',data}});
  const messages=[{role:'user',content:[image('AAAA'),image('BBBB')]}];
  const result=nativeHistory(messages,[{data:'AAAA'},{data:'BBBB'}],{attachments:[{data:'PACKED',mimeType:'image/jpeg'}],note:'Panel 1 and 2 overview'});
  const wire=JSON.stringify(result);assert.ok(wire.includes('PACKED'));assert.ok(wire.includes('overview'));
  assert.ok(!wire.includes('AAAA'));assert.ok(!wire.includes('BBBB'));
  assert.equal(result[0].content.filter(block=>block.type==='image').length,1);
  assert.equal(messages[0].content[0].source.data,'AAAA');
});
test('Claude rejected features are counted without saving private prompt content',async t=>{
  const f=await fixture(t,s=>s.final('OK'));const response=await f.call(request({system:'DO_NOT_SAVE_PRIVATE_TEXT',container:{}}));
  assert.equal(response.status,400);assert.equal(f.gateway.ledger.state.received,1);assert.equal(f.gateway.ledger.state.failed,1);
  assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('DO_NOT_SAVE_PRIVATE_TEXT'));assert.equal(f.sessions.length,0);
});
test('Claude metadata lifetime counters survive 1000-row retention and interrupted restart',()=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'claude-ledger-fixture-'));const file=path.join(folder,'ledger.json');
  const ledger=new Ledger();const selected=validate(request(),models);
  for(let i=0;i<1005;i++)ledger.finish(ledger.start(request(),{},selected),'completed');
  ledger.file=file;ledger.start(request(),{},selected);const recovered=new Ledger(file);
  assert.equal(recovered.state.received,1006);assert.equal(recovered.state.completed,1005);
  assert.equal(recovered.state.failed,1);assert.equal(recovered.state.recent.length,1000);
  assert.equal(recovered.state.recent.at(-1).status,'interrupted');assert.ok(readFileSync(file).length<4*1024*1024);
});
test('Claude client cancellation releases ownership and never reports a successful completion',async t=>{
  const f=await fixture(t,()=>{},{heartbeatMs:5});const controller=new AbortController();
  const response=await fetch(f.base+'/v1/messages',{method:'POST',headers:f.headers,body:JSON.stringify(request({stream:true})),signal:controller.signal});
  const reader=response.body.getReader();await reader.read();controller.abort();
  for(let i=0;i<20&&!f.sessions[0]?.released;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.gateway.turns.size,0);assert.equal(f.gateway.ledger.state.failed,1);assert.ok(f.sessions[0].aborted);
});
test('Claude a saved tool transcript rebuilds a fresh SDK session without reexecuting client tools',async t=>{
  const f=await fixture(t,s=>s.final('RESUME_OK'));
  const body=request({tools,messages:[{role:'user',content:'Read a file'},
    {role:'assistant',content:[{type:'tool_use',id:'saved-id',name:'Read',input:{path:'already-read'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'saved-id',content:'saved-value'}]}]});
  const response=await f.call(body);assert.equal(response.status,200);assert.equal((await response.json()).content[0].text,'RESUME_OK');
  assert.equal(f.sessions[0].results.length,0);assert.match(f.sessions[0].input.prompt,/saved-value/);
});

test('Claude signed and redacted input blocks remain opaque native history, not bootstrap prose',()=>{
  const thinking={type:'thinking',thinking:'fixture summary',signature:'opaque-fixture-signature'};
  const redacted={type:'redacted_thinking',data:'opaque-fixture-redaction'};
  const body=request({messages:[{role:'user',content:'earlier'},
    {role:'assistant',content:[thinking,redacted,{type:'text',text:'answer'}]},{role:'user',content:'next'}]});
  assert.doesNotThrow(()=>validate(body,models));
  assert.match(sessionInput(body).prompt,/fixture summary/);
  assert.doesNotMatch(sessionInput(body).prompt,/opaque-fixture-(signature|redaction)/);
  assert.deepEqual(nativeHistory(body.messages,[],{attachments:[]}),body.messages);
  for(const block of [{...thinking,signature:''},{...thinking,thinking:7},{...redacted,data:9}])
    assert.throws(()=>validate(request({messages:[{role:'assistant',content:[block]}]}),models),e=>e.statusCode===400);
  assert.throws(()=>validate(request({messages:[{role:'user',content:[thinking]}]}),models),e=>e.statusCode===400);
});

test('Claude native content stream keeps exact thinking signatures, redactions, IDs and order',()=>{
  const response=new EventEmitter();let wire='';response.writeHead=()=>{};response.write=s=>wire+=s;response.end=()=>{};
  const sink=new MessageSink(response,request({stream:true}),()=>{});
  const emit=event=>sink.native(event,new Map([['client_Read','Read']]));
  emit({type:'message_start'});
  emit({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}});
  emit({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'fixture summary'}});
  emit({type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'opaque-A'}});
  emit({type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'-B'}});
  emit({type:'content_block_stop',index:0});
  emit({type:'content_block_start',index:1,content_block:{type:'redacted_thinking',data:'opaque-redaction'}});
  emit({type:'content_block_stop',index:1});
  emit({type:'content_block_start',index:2,content_block:{type:'tool_use',id:'toolu_native',name:'client_Read',input:{}}});
  emit({type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"path":"fixture.txt"}'}});
  emit({type:'content_block_stop',index:2});emit({type:'message_stop'});
  sink.finish('tool_use',[]);
  assert.deepEqual(sink.blocks,[{type:'thinking',thinking:'fixture summary',signature:'opaque-A-B'},
    {type:'redacted_thinking',data:'opaque-redaction'},{type:'tool_use',id:'toolu_native',name:'Read',input:{path:'fixture.txt'}}]);
  assert.match(wire,/signature_delta/);assert.match(wire,/opaque-redaction/);
  assert.equal((wire.match(/event: content_block_stop/g)||[]).length,3);
});

test('Claude native block lifecycle rejects missing signatures, wrong deltas and truncated blocks',()=>{
  const make=()=>{const response=new EventEmitter();response.writeHead=()=>{};response.write=()=>{};response.end=()=>{};
    const sink=new MessageSink(response,request(),()=>{});sink.native({type:'message_start'},new Map());return sink;};
  const sink=make();sink.native({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}},new Map());
  assert.throws(()=>sink.native({type:'content_block_stop',index:0},new Map()),/signature/);
  assert.throws(()=>sink.native({type:'message_stop'},new Map()),/open native/);
  assert.throws(()=>sink.native({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'wrong'}},new Map()),/delta/);
});

function nativeFixture(turn,calls){
  turn.nativeEvent({type:'message_start'});
  turn.nativeEvent({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:''}});
  turn.nativeEvent({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'fixture'}});
  turn.nativeEvent({type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'opaque-original'}});
  turn.nativeEvent({type:'content_block_stop',index:0});
  for(const [i,id] of calls.entries()){
    turn.nativeEvent({type:'content_block_start',index:i+1,content_block:{type:'tool_use',id,name:'client_Read',input:{},caller:{type:'direct'}}});
    turn.nativeEvent({type:'content_block_delta',index:i+1,delta:{type:'input_json_delta',partial_json:JSON.stringify({path:id})}});
    turn.nativeEvent({type:'content_block_stop',index:i+1});
  }
  turn.nativeEvent({type:'message_delta',delta:{stop_reason:'tool_use'}});turn.nativeEvent({type:'message_stop'});
}
test('Claude native signed tool prefix survives continuation; modified signature is refused',async t=>{
  const bindings=[];
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
    s.emit('assistant.usage',{inputTokens:20,outputTokens:10});
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
  const initial=request({tools});const result=await (await f.call(initial)).json();
  assert.equal(result.stop_reason,'tool_use');assert.equal(result.content[0].signature,'opaque-original');
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:result.content},
    {role:'user',content:result.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:'value'}))}]};
  const changed=structuredClone(next);changed.messages[1].content[0].signature='modified';
  assert.equal((await f.call(changed)).status,409);
  const response=await f.call(next);assert.equal(response.status,200);assert.equal((await response.json()).content[0].text,'BOTH_RESULTS_OK');
  assert.deepEqual(bindings.at(-1),next.messages);assert.equal(f.sessions.length,1);
});
test('Claude concurrent owners may receive identical tool IDs without overwriting each other',async t=>{
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  });
  const initial=request({tools});
  const first=await (await f.call(initial)).json();
  const second=await (await f.call(initial,{'x-claude-code-session-id':'session-2'})).json();
  assert.equal(f.gateway.byTool.size,4);
  const next=result=>({...initial,messages:[...initial.messages,{role:'assistant',content:result.content},
    {role:'user',content:result.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:'value'}))}]});
  assert.equal((await f.call(next(first))).status,200);assert.equal(f.gateway.byTool.size,2);
  assert.equal((await f.call(next(second),{'x-claude-code-session-id':'session-2'})).status,200);
  assert.equal(f.gateway.byTool.size,0);assert.equal(f.sessions.length,2);
});
test('Claude client-tool continuation retains trailing user input, signed history and one-time results',async t=>{
  for(const stream of [false,true]){
    const bindings=[];
    const f=await fixture(t,s=>{
      const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
      s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
      for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
    },{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
    const initial=request({tools}),first=await (await f.call(initial)).json();
    const receipt=structuredClone(f.gateway.ledger.state.recent[0]);
    const results=first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,
      content:[{type:'text',text:'value-'+block.id}],is_error:block.id==='b'}));
    const suffix=[{type:'text',text:'STEERING_MARKER: explain the failure and then stop.',cache_control:{type:'ephemeral'}}];
    const next={...initial,stream,messages:[...initial.messages,{role:'assistant',content:first.content},
      {role:'user',content:[...results,...suffix]}]};
    const response=await f.call(next);assert.equal(response.status,200);
    if(stream){const wire=await response.text();assert.match(wire,/BOTH_RESULTS_OK/);assert.match(wire,/event: message_stop/);}
    else assert.equal((await response.json()).content[0].text,'BOTH_RESULTS_OK');
    assert.deepEqual(bindings.at(-1),next.messages);assert.equal(bindings.at(-1)[1].content[0].signature,'opaque-original');
    assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].results.length,2);
    assert.equal(f.sessions[0].results[1].result.resultType,'failure');
    assert.ok(f.sessions[0].results.every(row=>!row.result.textResultForLlm.includes('STEERING_MARKER')));
    assert.deepEqual(f.gateway.ledger.state.recent[0],receipt);
    assert.equal(f.gateway.ledger.state.completed,2);assert.equal(f.gateway.ledger.state.failed,0);assert.equal(f.gateway.byTool.size,0);
  }
});
test('Claude client-tool results must precede added user text or images in live and saved history',()=>{
  const result={type:'tool_result',tool_use_id:'a',content:'value'},text={type:'text',text:'user follow-up'};
  for(const content of [[text,result],[result,text,{...result,tool_use_id:'b'}]])
    assert.throws(()=>validate(request({messages:[{role:'user',content}]}),models),/tool_result.*first/i);
});
test('Claude invalid mixed continuations never resolve tools or consume another owner; valid retry remains possible',async t=>{
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  });
  const initial=request({tools}),first=await (await f.call(initial)).json(),receipt=structuredClone(f.gateway.ledger.state.recent[0]);
  const content=first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}));
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:[...content,{type:'text',text:'PRIVATE_FIXTURE_FOLLOW_UP'}]}]};
  const beforeResult=structuredClone(next);beforeResult.messages.at(-1).content.reverse();
  const interleaved=structuredClone(next);interleaved.messages.at(-1).content=[content[0],{type:'text',text:'follow-up'},content[1]];
  const duplicate=structuredClone(next);duplicate.messages.at(-1).content=[content[0],content[0],{type:'text',text:'follow-up'}];
  const missing=structuredClone(next);missing.messages.at(-1).content=[content[0],{type:'text',text:'follow-up'}];
  const modified=structuredClone(next);modified.messages[1].content[0].signature='tampered';
  for(const [body,headers,status] of [[beforeResult,{},400],[interleaved,{},400],[duplicate,{},409],[missing,{},409],
    [modified,{},409],[next,{'x-claude-code-agent-id':'other-agent'},409]]){
    const response=await f.call(body,headers);assert.equal(response.status,status);await response.text();
    assert.equal(f.sessions[0].results.length,0);assert.equal(f.gateway.byTool.size,2);assert.equal(f.gateway.turns.size,1);
    assert.deepEqual(f.gateway.ledger.state.recent[0],receipt);
  }
  assert.equal((await f.call(next)).status,200);assert.equal(f.sessions[0].results.length,2);assert.equal(f.sessions.length,1);
  assert.equal(f.gateway.ledger.state.received,8);assert.equal(f.gateway.ledger.state.completed,2);assert.equal(f.gateway.ledger.state.failed,6);
  assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_FIXTURE_FOLLOW_UP'));
});
test('Claude native request hook preserves mixed input, images, roles and signatures without relabelling user text as tool output',async t=>{
  const received=[];const provider=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;received.push({body:JSON.parse(text),auth:req.headers.authorization});
    res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: {"type":"message_start"}\n\ndata: {"type":"message_stop"}\n\n');
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const image={type:'image',source:{type:'base64',media_type:'image/png',data:'fixture-native-pixels'}};
  const body=request({tools,messages:[{role:'user',content:'initial'},
    {role:'assistant',content:[{type:'thinking',thinking:'native-reasoning',signature:'fixture-original-signature'},
      {type:'tool_use',id:'toolu_fixture',name:'Read',input:{path:'input.txt'},caller:{type:'direct'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'toolu_fixture',content:[{type:'text',text:'result'},image],is_error:true},
      {type:'text',text:'USER_STEERING_PROOF',cache_control:{type:'ephemeral'}},image]}]});
  const before=structuredClone(body);const handler=new ClaudeRequestHandler();handler.bind('mixed-input-fixture',body,validate(body,models),body.messages,()=>{});
  const bootstrap={model:'claude-opus-5.5',stream:true,messages:[{role:'user',content:'SDK_FLATTENED_NOT_AUTHORITATIVE'}]};
  const response=await handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{method:'POST',
    headers:{authorization:'fixture-SDK-credential-unchanged'},body:JSON.stringify(bootstrap)}),{sessionId:'mixed-input-fixture',signal:new AbortController().signal});
  await response.text();assert.deepEqual(body,before);assert.equal(received.length,1);assert.equal(received[0].auth,'fixture-SDK-credential-unchanged');
  const mapped=structuredClone(body.messages);mapped[1].content[1].name='client_Read';
  assert.deepEqual(received[0].body.messages,mapped);assert.equal(received[0].body.messages.at(-1).content[0].is_error,true);
  assert.equal(received[0].body.messages[1].content[0].signature,'fixture-original-signature');
  handler.release('mixed-input-fixture');assert.equal(handler.plans.size,0);
});
test('Claude mixed-input image admission keeps the new suffix outside tool results and leaves signed prefix unchanged',async t=>{
  const sharp=(await import('sharp')).default;
  const pixels=(await sharp({create:{width:2,height:2,channels:3,background:'#ff6600'}}).png().toBuffer()).toString('base64');
  const image={type:'image',source:{type:'base64',media_type:'image/png',data:pixels}};const bindings=[];
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
  const initial=request({tools}),first=await (await f.call(initial)).json();
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:[...first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'})),
      {type:'text',text:'Explain this additional picture.'},image]}]};
  const response=await f.call(next);assert.equal(response.status,200);await response.text();
  assert.deepEqual(bindings.at(-1),next.messages);assert.equal(bindings.at(-1).at(-1).content.at(-1).source.data,pixels);
  assert.ok(f.sessions[0].results.every(row=>row.result.binaryResultsForLlm===undefined));assert.equal(f.gateway.ledger.state.failed,0);
  const bad=structuredClone(next);bad.messages.at(-1).content=[image,bad.messages.at(-1).content[0]];
  assert.throws(()=>validate(bad,models),/tool_result.*first/i);
});
test('Claude active continuations reject oversized full context before resolving tools; a smaller retry remains possible',async t=>{
  for(const limits of [{max_prompt_tokens:512,max_context_window_tokens:4096},
    {max_prompt_tokens:8192,max_context_window_tokens:1024}]){
    const boundedModels=[{...models[0],capabilities:{...models[0].capabilities,limits:{...models[0].capabilities.limits,...limits}}}];
    const f=await fixture(t,s=>{
      const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
      s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
      for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
    },{models:boundedModels});
    const outputReserve=limits.max_context_window_tokens===1024;
    const initial=request({tools,max_tokens:outputReserve?512:64});const firstResponse=await f.call(initial);assert.equal(firstResponse.status,200);
    const first=await firstResponse.json(),receipt=structuredClone(f.gateway.ledger.state.recent[0]);
    const results=first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}));
    const next={...initial,stream:outputReserve,messages:[...initial.messages,{role:'assistant',content:first.content},
      {role:'user',content:[...results,{type:'text',text:outputReserve?'word '.repeat(450):'PRIVATE_LONG_INPUT '.repeat(1200)}]}]};
    if(outputReserve){const input=sessionInput(next);const tokens=countModelTokens(input.system+'\n'+input.prompt+'\n'+JSON.stringify(tools)+'\n{}');
      assert.ok(tokens<limits.max_context_window_tokens);assert.ok(tokens+next.max_tokens>limits.max_context_window_tokens);}
    const response=await f.call(next);assert.equal(response.status,400);assert.match((await response.json()).error.message,/context budget/i);
    assert.equal(f.sessions[0].results.length,0);assert.equal(f.sessions.length,1);assert.equal(f.gateway.byTool.size,2);
    assert.deepEqual(f.gateway.ledger.state.recent[0],receipt);const rejection=f.gateway.ledger.state.recent.at(-1);
    assert.equal(rejection.status,'rejected');assert.equal(rejection.sdkApiCalls,0);assert.equal(rejection.sdkTransportAttempts,0);assert.equal(rejection.totalNanoAiu,null);
    next.messages.at(-1).content.at(-1).text='Continue briefly.';
    const retry=await f.call(next);assert.equal(retry.status,200);await retry.text();assert.equal(f.sessions[0].results.length,2);assert.equal(f.gateway.byTool.size,0);
    assert.equal(f.gateway.ledger.state.completed,2);assert.equal(f.gateway.ledger.state.failed,1);
    assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_LONG_INPUT'));
  }
});
test('Claude continuation context guard counts oversized tool output and retained native prefix notes',async t=>{
  for(const source of ['tool-output','native-note']){
    const boundedModels=[{...models[0],capabilities:{...models[0].capabilities,limits:{...models[0].capabilities.limits,
      max_prompt_tokens:512,max_context_window_tokens:4096}}}];
    const f=await fixture(t,s=>{
      const turn=[...f.gateway.turns].find(turn=>turn.session===s);nativeFixture(turn,['a','b']);
      s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
      for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
    },{models:boundedModels});
    const initial=request({tools,max_tokens:64}),first=await (await f.call(initial)).json();
    const turn=[...f.gateway.turns][0],nativePrefix=structuredClone(turn.upstreamHistory),receipt=structuredClone(f.gateway.ledger.state.recent[0]);
    const results=first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}));
    if(source==='tool-output')results[0].content='PRIVATE_TOOL_OUTPUT '.repeat(1200);
    else {turn.upstreamHistory=structuredClone(turn.upstreamHistory);
      turn.upstreamHistory[0].content+='\n'+ 'PRIVATE_NATIVE_NOTE '.repeat(1200);} // Model-side overview/context fixture, absent from client history.
    const next={...initial,stream:true,messages:[...initial.messages,{role:'assistant',content:first.content},{role:'user',content:results}]};
    const response=await f.call(next);assert.equal(response.status,400);assert.match(response.headers.get('content-type'),/application\/json/);
    assert.match((await response.json()).error.message,/context budget/);assert.equal(f.sessions[0].results.length,0);assert.equal(f.gateway.byTool.size,2);
    assert.deepEqual(f.gateway.ledger.state.recent[0],receipt);
    turn.upstreamHistory=nativePrefix;results[0].content='value';const retry=await f.call(next);assert.equal(retry.status,200);await retry.text();
    assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].results.length,2);assert.equal(f.gateway.ledger.state.failed,1);
    assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_TOOL_OUTPUT'));assert.ok(!JSON.stringify(f.gateway.ledger.state).includes('PRIVATE_NATIVE_NOTE'));
  }
});

test('Claude tool catalog cache markers move and clear across native continuations without changing execution',async t=>{
  for(const stream of [false,true]){
    const received=[];
    const provider=http.createServer(async(req,res)=>{
      let text='';for await(const chunk of req)text+=chunk;
      received.push({body:JSON.parse(text),auth:req.headers.authorization});
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end('data: {"type":"message_start"}\n\ndata: {"type":"message_stop"}\n\n');
    });
    await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>provider.close(resolve)));
    const transport=new ClaudeRequestHandler();
    // The real hook maps to local HTTP; fixture SDK events supply native content.
    // No upstream model or provider usage is involved in these observations.
    const binding={bind(id,body,selected,messages){transport.bind(id,body,selected,messages,()=>{});},release(id){transport.release(id);}};
    const sendMapped=async s=>{
      const response=await transport.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{
        method:'POST',headers:{authorization:'fixture-unchanged-SDK-credential'},
        body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[{role:'user',content:'NOT_NATIVE_HISTORY'}]})}),
        {sessionId:s.sessionId,signal:new AbortController().signal});
      await response.text();
    };
    let f;
    const emitTools=(s,ids)=>{
      const turn=[...f.gateway.turns].find(item=>item.session===s);nativeFixture(turn,ids);
      s.emit('assistant.message',{content:'',toolRequests:ids.map(toolCallId=>({toolCallId}))});
      for(const id of ids)s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
    };
    f=await fixture(t,s=>void (async()=>{
      s.rpc.tools.handlePendingToolCall=async result=>{
        s.results.push(result);
        if(s.results.length%2)return;
        await sendMapped(s);
        if(s.results.length===2)emitTools(s,['c','d']);else s.final('CACHE_MARKERS_OK');
      };
      await sendMapped(s);emitTools(s,['a','b']);
    })().catch(error=>s.emit('session.error',{message:error.message})),{requestHandler:binding});
    const createSession=f.runtime.createSession;
    f.runtime.createSession=async config=>{const value=await createSession(config);value.session.sessionId='cache-fixture-'+stream;return value;};
    const definitions=[{...tools[0],strict:true,cache_control:{type:'ephemeral'}},
      {name:'Write',description:'unchanged definition',input_schema:{type:'object',properties:{text:{type:'string'}}}}];
    const initial=request({tools:definitions,tool_choice:{type:'auto'},output_config:{effort:'low'},
      system:[{type:'text',text:'UNCHANGED_SYSTEM',cache_control:{type:'ephemeral'}}]});
    const initialCopy=structuredClone(initial);const firstResponse=await f.call(initial);assert.equal(firstResponse.status,200);
    const first=await firstResponse.json(),receipt=structuredClone(f.gateway.ledger.state.recent[0]);
    const continuation=(prior,reply,nextTools)=>({...prior,tools:nextTools,messages:[...prior.messages,{role:'assistant',content:reply.content},
      {role:'user',content:reply.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}))}]});
    const moved=structuredClone(definitions);delete moved[0].cache_control;moved[1].cache_control={type:'ephemeral',ttl:'1h'};
    const secondBody=continuation(initial,first,moved),secondCopy=structuredClone(secondBody);
    assert.equal(validate(initial,models).signature,validate(secondBody,models).signature);
    const secondResponse=await f.call(secondBody);assert.equal(secondResponse.status,200);const second=await secondResponse.json();
    const cleared=structuredClone(moved);delete cleared[1].cache_control;
    const finalBody={...continuation(secondBody,second,cleared),stream},finalCopy=structuredClone(finalBody);
    const last=await f.call(finalBody);assert.equal(last.status,200);
    if(stream){const wire=await last.text();assert.match(wire,/CACHE_MARKERS_OK/);assert.match(wire,/event: message_stop/);}
    else assert.equal((await last.json()).content[0].text,'CACHE_MARKERS_OK');
    assert.equal(received.length,3);
    for(const [index,body] of [initial,secondBody,finalBody].entries()){
      const expected=body.tools.map((tool,i)=>({...tool,name:'client_'+tool.name}));
      assert.deepEqual(received[index].body.tools,expected,'Current client tool cache annotations must reach the native hook.');
      assert.equal(received[index].auth,'fixture-unchanged-SDK-credential');
      assert.deepEqual(received[index].body.system,body.system);assert.deepEqual(received[index].body.tool_choice,body.tool_choice);
      assert.deepEqual(received[index].body.output_config,body.output_config);
      const native=structuredClone(body.messages);
      for(const message of native)if(Array.isArray(message.content))for(const block of message.content)
        if(block.type==='tool_use')block.name='client_Read';
      assert.deepEqual(received[index].body.messages,native);
    }
    assert.deepEqual(initial,initialCopy);assert.deepEqual(secondBody,secondCopy);assert.deepEqual(finalBody,finalCopy);
    assert.deepEqual(f.gateway.ledger.state.recent[0],receipt);assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].results.length,4);
    assert.equal(f.gateway.ledger.state.completed,3);assert.equal(f.gateway.ledger.state.failed,0);
    assert.equal(f.gateway.byTool.size,0);assert.equal(f.gateway.turns.size,0);assert.equal(transport.plans.size,0);
  }
});
test('Claude tool catalog cache updates cannot change another owner or bypass rejected continuation controls',async t=>{
  const bindings=[];
  const f=await fixture(t,s=>{
    const turn=[...f.gateway.turns].find(item=>item.session===s);nativeFixture(turn,['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,selected){bindings.push(structuredClone(selected.tools));},release(){}}});
  const initial=request({tools:[{...tools[0],cache_control:{type:'ephemeral'}}]});
  const first=await (await f.call(initial)).json();const other=await f.call(initial,{'x-claude-code-agent-id':'other'});await other.text();
  const [holder,otherHolder]=[...f.gateway.turns],original=holder.selected,otherOriginal=otherHolder.selected;
  const receipt=structuredClone(f.gateway.ledger.state.recent[0]);const moved=[{...tools[0],cache_control:{type:'ephemeral',ttl:'1h'}}];
  const next={...initial,tools:moved,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}))}]};
  const changedTool=structuredClone(next);changedTool.tools[0].input_schema.properties.path.type='integer';
  const changedSignature=structuredClone(next);changedSignature.messages[1].content[0].signature='tampered';
  for(const [body,headers] of [[changedTool,{}],[changedSignature,{}],[next,{'x-claude-code-agent-id':'unknown'}]]){
    const denied=await f.call(body,headers);assert.equal(denied.status,409);await denied.text();
    assert.equal(holder.selected,original);assert.equal(otherHolder.selected,otherOriginal);assert.equal(bindings.length,2);
    assert.equal(f.sessions[0].results.length,0);assert.equal(f.gateway.byTool.size,4);assert.deepEqual(f.gateway.ledger.state.recent[0],receipt);
  }
  const response=await f.call(next);assert.equal(response.status,200);await response.text();
  assert.deepEqual(bindings.at(-1),moved,'Accepted current cache annotations must replace only this owner\'s catalog metadata.');
  assert.equal(holder.selected.signature,original.signature);assert.equal(otherHolder.selected,otherOriginal);
  assert.deepEqual(otherHolder.selected.tools,initial.tools);assert.equal(f.sessions[1].results.length,0);
  assert.equal(f.gateway.byTool.size,2);assert.equal(f.gateway.ledger.state.completed,3);assert.equal(f.gateway.ledger.state.failed,3);
});

test('Claude continuation batch spans adjacent result messages and system reminders without losing native boundaries',async t=>{
  const bindings=[];
  const f=await fixture(t,s=>{
    nativeFixture([...f.gateway.turns][0],['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{requestHandler:{bind(_id,_body,_selected,messages){bindings.push(structuredClone(messages));},release(){}}});
  const initial=request({tools}),first=await(await f.call(initial)).json();
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:'a',content:'A'}]},
    {role:'system',content:'between-result reminder'},
    {role:'user',content:[{type:'tool_result',tool_use_id:'b',content:'B'},{type:'text',text:'new steering'}]},
    {role:'system',content:'trailing reminder'}]};
  const response=await f.call(next);assert.equal(response.status,200,await response.clone().text());await response.text();
  assert.deepEqual(bindings.at(-1),next.messages);assert.equal(f.sessions.length,1);assert.equal(f.sessions[0].results.length,2);
  assert.equal(f.gateway.byTool.size,0);assert.equal(f.gateway.ledger.state.recent.at(-1).toolResults,2);
});

test('Claude native tools collect all SDK assistant chunks as one exact batch',async t=>{
  const f=await fixture(t,s=>{
    nativeFixture([...f.gateway.turns][0],['a','b']);
    for(const [chunkIndex,id] of ['a','b'].entries()){
      s.emit('assistant.message',{content:'',apiCallId:'batch',chunkIndex,chunkCount:2,toolRequests:[{toolCallId:id}]});
      s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
    }
  });
  const initial=request({tools}),response=await f.call(initial),first=await response.json();
  assert.equal(response.status,200,JSON.stringify(first));assert.equal(first.content.filter(block=>block.type==='tool_use').length,2);
  const next={...initial,messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:first.content.filter(block=>block.type==='tool_use').map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}))}]};
  assert.equal((await f.call(next)).status,200);assert.equal(f.sessions[0].results.length,2);
  assert.equal(f.gateway.ledger.state.recent[0].toolRequests,2);assert.equal(f.gateway.byTool.size,0);
});

test('Claude tool-result ownership is claimed atomically before interleaved SDK events',async t=>{
  const emitBatch=(s,ids)=>{
    nativeFixture([...f.gateway.turns][0],ids);
    s.emit('assistant.message',{content:'',toolRequests:ids.map(toolCallId=>({toolCallId}))});
    for(const id of ids)s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  };
  const f=await fixture(t,s=>{
    s.rpc.tools.handlePendingToolCall=async result=>{
      s.results.push(result);
      if(s.results.length===1)emitBatch(s,['c','d']);
      if(s.results.length===4)s.final('ALL_BATCHES_OK');
    };
    emitBatch(s,['a','b']);
  });
  const body=request({tools});
  for(let batch=0;batch<3;batch++){
    const response=await f.call(body),reply=await response.json();assert.equal(response.status,200,JSON.stringify(reply));
    if(batch===2){assert.equal(reply.content[0].text,'ALL_BATCHES_OK');break;}
    assert.equal(f.gateway.ledger.state.recent.at(-1).toolRequests,2);
    assert.equal([...f.gateway.turns][0].pending.size,2);
    body.messages.push({role:'assistant',content:reply.content},{role:'user',content:reply.content.filter(block=>block.type==='tool_use')
      .map(block=>({type:'tool_result',tool_use_id:block.id,content:'value'}))});
  }
  assert.equal(f.sessions[0].results.length,4);assert.equal(f.gateway.byTool.size,0);
});

test('Claude Edit replay accepts only the declared optional false default while preserving the original input',()=>{
  const definition={name:'Edit',input_schema:{type:'object',properties:{replace_all:{type:'boolean',default:false},
    file_path:{type:'string'},old_string:{type:'string'},new_string:{type:'string'}},required:['file_path','old_string','new_string']}};
  const original=[{role:'assistant',content:[{type:'thinking',thinking:'',signature:'original'},
    {type:'tool_use',id:'edit',name:'Edit',input:{file_path:'fixture.txt',old_string:'old',new_string:'new'}}]}];
  const replay=structuredClone(original);replay[0].content[1].input.replace_all=false;
  const before=structuredClone(original);
  assert.equal(historyFingerprint(original,[definition]),historyFingerprint(replay,[definition]));
  assert.deepEqual(original,before);
  for(const changed of [true,null,'false']){
    const invalid=structuredClone(replay);invalid[0].content[1].input.replace_all=changed;
    assert.notEqual(historyFingerprint(original,[definition]),historyFingerprint(invalid,[definition]));
  }
  assert.notEqual(historyFingerprint(original),historyFingerprint(replay));
  const undeclared=structuredClone(definition);delete undeclared.input_schema.properties.replace_all.default;
  assert.notEqual(historyFingerprint(original,[undeclared]),historyFingerprint(replay,[undeclared]));
  const required=structuredClone(definition);required.input_schema.required.push('replace_all');
  assert.notEqual(historyFingerprint(original,[required]),historyFingerprint(replay,[required]));
  const signature=structuredClone(replay);signature[0].content[0].signature='changed';
  assert.notEqual(historyFingerprint(original,[definition]),historyFingerprint(signature,[definition]));
});

test('Claude explicit entitled model changes rebuild owned tool continuations without re-executing tools',async t=>{
  const bindings=[],other={...models[0],id:'claude-sonnet-5.5',name:'Local Sonnet fixture'};
  const f=await fixture(t,s=>{
    if(f.sessions.length>1)return s.final('MODEL_CHANGED_OK');
    nativeFixture([...f.gateway.turns][0],['a','b']);
    s.emit('assistant.message',{content:'',toolRequests:[{toolCallId:'a'},{toolCallId:'b'}]});
    for(const id of ['a','b'])s.emit('external_tool.requested',{toolName:'client_Read',toolCallId:id,requestId:'req-'+id,arguments:{path:id}});
  },{models:[...models,other],requestHandler:{bind(_id,_body,selected,messages){bindings.push({model:selected.model.id,messages:structuredClone(messages)});},release(){}}});
  const initial=request({tools}),first=await(await f.call(initial)).json();
  const next={...initial,model:'claude-sonnet-5-5',messages:[...initial.messages,{role:'assistant',content:first.content},
    {role:'user',content:first.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:'ALREADY_EXECUTED'}))}]};
  const response=await f.call(next),reply=await response.json();assert.equal(response.status,200,JSON.stringify(reply));
  assert.equal(f.sessions.length,2);assert.equal(f.sessions[1].config.model,other.id);
  assert.deepEqual(bindings.at(-1),{model:other.id,messages:next.messages});
  assert.equal(f.sessions[0].results.length,0);assert.equal(f.sessions[1].results.length,0);
  assert.equal(f.gateway.byTool.size,0);assert.ok(f.sessions[0].released);
  assert.ok(f.gateway.ledger.state.recent.at(-1).continuationChanges.includes('model'));
});

test('Claude unbound inference fails closed before any transport or flattened bootstrap can spend credits',async t=>{
  let attempts=0;const server=http.createServer((_req,res)=>{attempts++;res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler();
  await assert.rejects(handler.sendRequest(new Request(`http://127.0.0.1:${server.address().port}/v1/messages`,{
    method:'POST',body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[{role:'user',content:'unbound SDK bootstrap'}]})}),
    {sessionId:'never-bound',signal:new AbortController().signal}),/no native request binding/i);
  assert.equal(attempts,0);
});

test('Claude transport retries stop after two pre-output attempts or one terminal client error',async t=>{
  let attempts=0,status=503;const server=http.createServer((_req,res)=>{attempts++;res.writeHead(status);res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler(),body=request(),selected=validate(body,models);
  const send=id=>handler.sendRequest(new Request(`http://127.0.0.1:${server.address().port}/v1/messages`,{
    method:'POST',body:JSON.stringify({model:selected.model.id,stream:true,messages:[]})}),{sessionId:id,signal:new AbortController().signal});
  handler.bind('bounded',body,selected,body.messages,()=>{});
  for(let i=0;i<2;i++){const response=await send('bounded');assert.equal(response.status,503);await response.text();}
  await assert.rejects(send('bounded'),error=>error.name==='AbortError');assert.equal(attempts,2);
  status=400;handler.bind('terminal',body,selected,body.messages,()=>{});
  const response=await send('terminal');assert.equal(response.status,400);await response.text();
  await assert.rejects(send('terminal'),error=>error.name==='AbortError');assert.equal(attempts,3);
});
test('Claude context tier is long for large-window models only; SDK tier refusal is a prompt-too-long 400',async t=>{
  const {contextTier}=await import('./claude-gateway/server.mjs');
  const big={capabilities:{limits:{max_context_window_tokens:1000000}}},small={capabilities:{limits:{max_context_window_tokens:200000}}};
  assert.equal(contextTier(150000,big),'long_context');assert.equal(contextTier(100,big),'long_context');assert.equal(contextTier(150000,small),'default');
  const f=await fixture(t,s=>{s.emit('session.warning',{warningType:'compaction_static_context_blocked',message:'Static context is using 90%'});s.emit('session.idle',{});});
  const response=await f.call(request());const result=await response.json();
  assert.equal(response.status,400);assert.match(result.error.message,/prompt is too long/);assert.equal(f.gateway.turns.size,0);
});
