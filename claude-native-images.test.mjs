import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {admitNativeImages,fitImageHistory,omittedImageNote} from './claude-gateway/native-images.mjs';
const hook={bind(){}};
const model={capabilities:{supports:{vision:true},limits:{vision:{max_prompt_images:1,max_prompt_image_size:3145728,supported_media_types:['image/png']}}}};
const png=async()=>({mimeType:'image/png',data:(await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer()).toString('base64')});
test('native image admission preserves bytes and repeated occurrences; no decode or overview',async()=>{
  const image=await png(),images=Array(13).fill(image),before=JSON.stringify(images);
  assert.doesNotThrow(()=>admitNativeImages(images,model,hook));assert.equal(JSON.stringify(images),before);
  // Image count is not an upstream limit (150 measured accepted); long chats are admitted.
  assert.doesNotThrow(()=>admitNativeImages(Array(250).fill(image),model,hook));
});
test('native image admission rejects malformed or unsupported images before SDK work',async()=>{
  const image=await png();
  for(const [images,selected,handler] of [
    [[image],model,null],[[image],{capabilities:{supports:{vision:false}}},hook],
    [[{...image,mimeType:'image/jpeg'}],model,hook],[[{...image,data:'AAAA'}],model,hook],
    [[{...image,data:'!!!!'}],model,hook],[[{...image,data:image.data+'='}],model,hook],
    [[image],{capabilities:{limits:{vision:{max_prompt_image_size:1}}}},hook],
  ])assert.throws(()=>admitNativeImages(images,selected,handler),e=>e.statusCode===400&&e.shouldRetry==='false');
  assert.doesNotThrow(()=>admitNativeImages([],model,null));
});
const image=(label,size)=>({type:'image',source:{type:'base64',media_type:'image/png',data:label.padEnd(size,'A')}});
const chat=count=>[{role:'user',content:'start'},...Array.from({length:count},(_,i)=>[
  {role:'assistant',content:[{type:'tool_use',id:'t'+i,name:'Read',input:{}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'t'+i,content:[{type:'text',text:'shot '+i},image('img'+i,1000)]}]}]).flat()];
const images=messages=>messages.flatMap(message=>Array.isArray(message.content)?message.content:[])
  .flatMap(block=>block.type==='tool_result'?block.content:[block]).filter(block=>block.type==='image');
test('image history within budget is sent unchanged',()=>{
  const messages=chat(5),result=fitImageHistory(messages,{budget:5000,group:2});
  assert.equal(result.omitted,0);assert.equal(result.messages,messages);
});
test('over-budget history leaves out the oldest images in whole groups and keeps the newest',()=>{
  const messages=chat(10),before=JSON.stringify(messages);
  const result=fitImageHistory(messages,{budget:5500,group:4});
  // 10 x 1000 > 5500: omit one group of 4 -> 6000, still over; second group -> 2000.
  assert.equal(result.omitted,8);
  const kept=images(result.messages);assert.deepEqual(kept.map(block=>block.source.data.slice(0,4)),['img8','img9']);
  const notes=result.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).flatMap(block=>block.content??[]).filter(block=>block.text===omittedImageNote);
  assert.equal(notes.length,8);
  assert.equal(JSON.stringify(messages),before,'client transcript is never modified');
  assert.equal(result.messages[2].content[0].content[0].text,'shot 0','text around omitted images stays');
});
test('cut point is stable as the chat grows, so the cached prefix is reused',()=>{
  const first=fitImageHistory(chat(10),{budget:5500,group:4});
  const later=fitImageHistory(chat(11),{budget:5500,group:4});
  assert.equal(later.omitted,first.omitted);
  assert.deepEqual(later.messages.slice(0,first.messages.length-2),first.messages.slice(0,first.messages.length-2));
});
test('omitted image keeps its cache breakpoint and top-level user images count too',()=>{
  const messages=[{role:'user',content:[{...image('a',3000),cache_control:{type:'ephemeral'}},image('b',3000),{type:'text',text:'compare'}]}];
  const result=fitImageHistory(messages,{budget:4000,group:1});
  assert.equal(result.omitted,1);assert.deepEqual(result.messages[0].content[0],{type:'text',text:omittedImageNote,cache_control:{type:'ephemeral'}});
  assert.equal(result.messages[0].content[1].source.data[0],'b');
});
