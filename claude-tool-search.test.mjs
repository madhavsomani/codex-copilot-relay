import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {validate,sessionInput,sdkToolName} from './claude-gateway/protocol.mjs';
import {ClaudeRequestHandler} from './claude-gateway/request-handler.mjs';
const models=[{id:'claude-opus-5.5',capabilities:{limits:{max_output_tokens:128000},supports:{vision:true,structured_outputs:true}}}];
const schema={type:'object',properties:{query:{type:'string'}}};
const tools=[{name:'ToolSearch',description:'Find deferred tools',input_schema:schema},
  {name:'mcp__heygen__get_video',description:'Get a video',input_schema:schema,defer_loading:true}];
// Shapes copied from a native (pre-relay) stock Claude Code transcript.
const body=(extra={})=>({model:'claude-opus-5-5',max_tokens:2048,stream:true,tools,messages:[
  {role:'user',content:'find the video tool'},
  {role:'assistant',content:[{type:'tool_use',id:'toolu_1',name:'ToolSearch',input:{query:'select:mcp__heygen__get_video'},caller:{type:'direct'}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:[{type:'tool_reference',tool_name:'mcp__heygen__get_video'}]}]}],...extra});
test('stock tool search requests are admitted: deferred tools, tool_reference results, context management',()=>{
  const selected=validate(body({context_management:{edits:[{type:'clear_tool_uses_20250919'}]}}),models,{betaHeader:'advanced-tool-use-2025-11-20'});
  assert.equal(selected.tools[1].defer_loading,true);assert.deepEqual(selected.betas,['advanced-tool-use-2025-11-20']);
  assert.match(sessionInput(body()).prompt,/Tool reference: mcp__heygen__get_video/);
  assert.notEqual(selected.signature,validate(body(),models).signature);
});
test('malformed tool search fields fail before SDK work',()=>{
  for(const bad of [
    {tools:[tools[0],{...tools[1],defer_loading:'yes'}]},
    {tools:[{...tools[0],defer_loading:true},tools[1]]},
    {context_management:[]},
  ])assert.throws(()=>validate(body(bad),models),e=>e.statusCode===400);
  const request=body();request.messages[2].content[0].content[0]={type:'tool_reference'};
  assert.throws(()=>validate(request,models),/tool_reference/);
});
test('native wire keeps defer_loading and context_management and maps tool_reference to SDK names',async t=>{
  let wire,beta;const provider=http.createServer((request,response)=>{beta=request.headers['anthropic-beta'];let text='';request.on('data',chunk=>text+=chunk).on('end',()=>{
    wire=JSON.parse(text);response.writeHead(200,{'content-type':'text/event-stream'});
    response.end(['message_start','message_stop'].map(type=>'data: '+JSON.stringify({type})+'\n\n').join(''));});});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const request=body({context_management:{edits:[{type:'clear_tool_uses_20250919'}]}}),selected=validate(request,models,{betaHeader:'tool-search-tool-2025-10-19,context-management-2025-06-27'});
  const handler=new ClaudeRequestHandler();handler.bind('search',request,selected,request.messages,()=>{});
  const response=await handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{method:'POST',
    body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),{sessionId:'search',signal:new AbortController().signal});
  await response.text();
  const deferred=sdkToolName(tools[1],1);
  assert.equal(wire.tools[1].name,deferred);assert.equal(wire.tools[1].defer_loading,true);assert.equal(wire.tools[0].defer_loading,undefined);
  assert.deepEqual(wire.messages[2].content[0].content,[{type:'tool_reference',tool_name:deferred}]);
  assert.equal(wire.messages[1].content[0].name,sdkToolName(tools[0],0));
  assert.deepEqual(beta.split(',').sort(),['advanced-tool-use-2025-11-20','context-management-2025-06-27']);
  assert.deepEqual(wire.context_management,{edits:[{type:'clear_tool_uses_20250919'}]});
});
