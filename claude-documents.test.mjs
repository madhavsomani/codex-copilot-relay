import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate,sessionInput} from './claude-gateway/protocol.mjs';
const models=[{id:'claude-opus-5.5',capabilities:{limits:{max_output_tokens:128000},supports:{vision:true}}}];
const pdf={type:'document',source:{type:'base64',media_type:'application/pdf',data:Buffer.from('%PDF-1.4 test').toString('base64')}};
const body=content=>({model:'claude-opus-5-5',max_tokens:1024,messages:[
  {role:'user',content:'read it'},
  {role:'assistant',content:[{type:'tool_use',id:'toolu_1',name:'Read',input:{file_path:'a.pdf'}}]},
  {role:'user',content}]});
test('stock Read PDF results and user documents are admitted unchanged',()=>{
  const request=body([{type:'tool_result',tool_use_id:'toolu_1',content:[pdf]}]),before=JSON.stringify(request);
  assert.doesNotThrow(()=>validate(request,models));assert.equal(JSON.stringify(request),before);
  assert.doesNotThrow(()=>validate(body([{...pdf,title:'Spec'},{type:'text',text:'summarize'}]),models));
  assert.doesNotThrow(()=>validate(body([{type:'document',source:{type:'text',media_type:'text/plain',data:'plain'}}]),models));
  // Bootstrap text never inlines the PDF bytes.
  assert.doesNotMatch(sessionInput(request).prompt,new RegExp(pdf.source.data));
});
test('fetched, malformed or misplaced documents fail before SDK work',()=>{
  for(const content of [
    [{type:'document',source:{type:'url',url:'https://example.com/a.pdf'}}],
    [{type:'document',source:{type:'file',file_id:'file_1'}}],
    [{type:'document',source:{type:'base64',media_type:'application/pdf',data:'!!!'}}],
    [{...pdf,unknown:true}],
  ])assert.throws(()=>validate(body(content),models),e=>e.statusCode===400);
  const assistant=body('x');assistant.messages[1].content.push(pdf);
  assert.throws(()=>validate(assistant,models),/user content/);
});
test('encrypted PDFs reach upstream as a visible note; normal PDFs stay native',async t=>{
  const {ClaudeRequestHandler,encryptedPdf}=await import('./claude-gateway/request-handler.mjs');
  const http=(await import('node:http')).default;
  const locked={type:'document',title:'Statement',cache_control:{type:'ephemeral'},source:{type:'base64',media_type:'application/pdf',
    data:Buffer.from('%PDF-1.4\n'+'x'.repeat(100000)+'\ntrailer<</Root 1 0 R/Encrypt 5 0 R>>').toString('base64')}};
  // Page text that merely mentions /Encrypt is not an encryption dictionary.
  const mention={...pdf,source:{...pdf.source,data:Buffer.from('%PDF-1.4 (see /Encrypt in the spec)\ntrailer<</Root 1 0 R>>').toString('base64')}};
  assert.equal(encryptedPdf(locked),true);assert.equal(encryptedPdf(locked),true);assert.equal(encryptedPdf(pdf),false);assert.equal(encryptedPdf(mention),false);
  let wire;const provider=http.createServer((request,response)=>{let text='';request.on('data',chunk=>text+=chunk).on('end',()=>{
    wire=JSON.parse(text);response.writeHead(200,{'content-type':'text/event-stream'});
    response.end(['message_start','message_stop'].map(type=>'data: '+JSON.stringify({type})+'\n\n').join(''));});});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const request=body([{type:'tool_result',tool_use_id:'toolu_1',content:[locked]},pdf]),selected=validate(request,models);
  const handler=new ClaudeRequestHandler();handler.bind('pdf',request,selected,request.messages,()=>{});
  await (await handler.sendRequest(new Request(`http://127.0.0.1:${provider.address().port}/v1/messages`,{method:'POST',
    body:JSON.stringify({model:'claude-opus-5.5',stream:true,messages:[]})}),{sessionId:'pdf',signal:new AbortController().signal})).text();
  const [result,plain]=wire.messages[2].content;
  assert.equal(result.content[0].type,'text');assert.match(result.content[0].text,/"Statement" is encrypted/);
  assert.deepEqual(result.content[0].cache_control,{type:'ephemeral'});
  assert.deepEqual(plain,pdf);assert.equal(request.messages[2].content[0].content[0],locked);
});
