import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readResponsesBody} from './responses-body.mjs';
const image = value => ({type:'input_image',image_url:'data:image/png;base64,'+value.repeat(600)});
const body = () => ({model:'gpt-6-astra',instructions:'Preserve this instruction.',input:[
  {role:'user',content:[{type:'input_text',text:'Reference'},image('A')]},
  {type:'function_call',name:'screenshot',call_id:'call1',arguments:'{}'},
  {type:'function_call_output',call_id:'call1',output:[image('B')]},
  {role:'user',content:[{type:'input_text',text:'Read the newest'},image('C')]},
]});
const options={maxBytes:1700,maxWireBytes:5000,maxImageChars:1300,maxImages:2};
function request(value,{declared=true,split=71}={}) {
  const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  const chunks=Array.from({length:Math.ceil(bytes.length/split)},(_,i)=>bytes.subarray(i*split,(i+1)*split));
  const stream=Readable.from(chunks);stream.headers=declared?{'content-length':String(bytes.length)}:{};return stream;
}
test('oversized history compacts while preserving text, calls and newest image',async()=>{
  const original=body(),result=await readResponsesBody(request(original),options);
  assert.equal(result.body.instructions,original.instructions);
  assert.deepEqual(result.body.input[1],original.input[1]);assert.equal(result.body.input[2].call_id,'call1');
  assert.deepEqual(result.body.input.at(-1),original.input.at(-1));
  assert.equal(result.body.input[0].content[0].text,'Reference');
  assert.equal(result.body.input[0].content[1].type,'input_text');
  assert.match(result.body.input[0].content[1].text,/Historical image omitted/);
  assert.ok(result.bytes>options.maxBytes);assert.ok(result.ingress.retainedBytes<=options.maxBytes);
  assert.ok(result.ingress.omittedHistoricalImages>0);
});
test('chunked uploads receive the same bounded compaction',async()=>{
  const result=await readResponsesBody(request(body(),{declared:false,split:1}),options);
  assert.ok(result.ingress.omittedHistoricalImages>0);
  assert.equal(result.body.input.at(-1).content[1].image_url,image('C').image_url);
});
test('small payloads match JSON.parse for split UTF-8, escapes and prototype keys',async()=>{
  const source='{"input":"Café 🧪 \\uD800 \\n \\\"", "__proto__":{"polluted":true},"a":[0,-0,1e5,true,false,null,{"b":"ok"}]}';
  const result=await readResponsesBody(request(source,{split:1}),options);
  assert.deepEqual(result.body,JSON.parse(source));assert.equal({}.polluted,undefined);
  assert.equal(result.ingress.omittedHistoricalImages,0);
});
test('wire cap rejects declared and chunked uploads',async()=>{
  for(const declared of [true,false])await assert.rejects(readResponsesBody(request({input:'x'.repeat(6000)},{declared}),options),{code:'request_too_large',statusCode:413});
});
test('large text and tool arguments are rejected, never truncated',async()=>{
  for(const value of [{input:'x'.repeat(2000)},{instructions:'x'.repeat(2000)},
    {input:[{type:'function_call',arguments:JSON.stringify({image_url:image('A').image_url.repeat(4)})}]}])
    await assert.rejects(readResponsesBody(request(value),options),{code:'request_too_large'});
});
test('newest batch cannot be silently evicted',async()=>{
  await assert.rejects(readResponsesBody(request({input:[{role:'user',content:[image('A'),image('B'),image('C')]}]}),options),{code:'vision_budget_exceeded',statusCode:400});
});
test('instructions and unrecognized image-like objects are not disposable history',async()=>{
  for(const value of [{instructions:[image('A'),image('B'),image('C')]},
    {input:[{role:'user',content:[{type:'arbitrary_data',image_url:image('A').image_url.repeat(4)}]}]}])
    await assert.rejects(readResponsesBody(request(value),options),{code:'request_too_large'});
});
test('explicit OpenAI and known upstream continuations fail unchanged including late model fields',async()=>{
  const value=body();delete value.model;value.model='openai/test';
  await assert.rejects(readResponsesBody(request(value),options),{code:'request_too_large'});
  await assert.rejects(readResponsesBody(request({...body(),previous_response_id:'resp_known'}),{
    ...options,preserveBody:b=>b.previous_response_id==='resp_known'}),{code:'request_too_large'});
});
test('a bounded explicit OpenAI request retains all images and options unchanged',async()=>{
  const value={...body(),model:'openai/test',temperature:0.7};
  const result=await readResponsesBody(request(value),{...options,maxBytes:4000});
  assert.deepEqual(result.body,value);assert.equal(result.ingress.omittedHistoricalImages,0);
});
test('type and image_url field ordering does not change historical pruning',async()=>{
  const value=body();for(const item of [value.input[0].content[1],value.input[2].output[0],value.input[3].content[1]]){
    delete item.type;item.type='input_image';
  }
  const result=await readResponsesBody(request(value),options);
  assert.ok(result.ingress.omittedHistoricalImages>0);assert.deepEqual(result.body.input.at(-1),value.input.at(-1));
});
test('malformed JSON, duplicate keys and excessive nesting fail closed',async()=>{
  for(const value of ['{"input":','{"input":1,"input":2}','['.repeat(140)+'0'+']'.repeat(140)])
    await assert.rejects(readResponsesBody(request(value),options),e=>['invalid_json','request_too_large'].includes(e.code));
});
test('later text does not make the newest image batch disposable',async()=>{
  const value=body();value.input.push({role:'user',content:'Continue using the latest screenshot.'});
  const result=await readResponsesBody(request(value),options);
  assert.deepEqual(result.body.input.at(-2),value.input.at(-2));assert.deepEqual(result.body.input.at(-1),value.input.at(-1));
});
test('system and developer images survive even with role fields last',async()=>{
  for(const role of ['system','developer']){
    const value={input:[{content:[image('A')],role},{role:'user',content:[image('B')]},{role:'user',content:[image('C')]}]};
    const result=await readResponsesBody(request(value),{...options,maxBytes:2200});
    assert.deepEqual(result.body.input[0],value.input[0]);assert.equal(result.body.input[1].content[0].type,'input_text');
  }
});
test('unknown image detail data and oversized UTF-8 text are never silently removed',async()=>{
  const value={input:[{role:'user',content:[{...image('A'),detail:{note:'keep'}}]},{role:'user',content:[image('B')]}]};
  assert.deepEqual((await readResponsesBody(request(value),{...options,maxBytes:2200,maxImages:1})).body,value);
  await assert.rejects(readResponsesBody(request({input:'界'.repeat(900)}),options),{code:'request_too_large'});
});
test('retained UTF-8 byte boundary is inclusive despite conservative working overhead',async()=>{
  for(const value of [{input:'x'.repeat(1600)},{input:Array(150).fill(123)},{input:'界'.repeat(400)}]){
    const maxBytes=Buffer.byteLength(JSON.stringify(value));
    assert.deepEqual((await readResponsesBody(request(value),{...options,maxBytes})).body,value);
    await assert.rejects(readResponsesBody(request(value),{...options,maxBytes:maxBytes-1}),{code:'request_too_large'});
  }
});
