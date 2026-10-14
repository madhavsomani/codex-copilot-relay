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
