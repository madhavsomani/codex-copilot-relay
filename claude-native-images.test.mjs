import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {admitNativeImages,nativeImageLimits} from './claude-gateway/native-images.mjs';
const hook={bind(){}};
const model={capabilities:{supports:{vision:true},limits:{vision:{max_prompt_images:1,max_prompt_image_size:3145728,supported_media_types:['image/png']}}}};
const png=async()=>({mimeType:'image/png',data:(await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer()).toString('base64')});
test('native image admission preserves bytes and repeated occurrences; no decode or overview',async()=>{
  const image=await png(),images=Array(13).fill(image),before=JSON.stringify(images);
  assert.doesNotThrow(()=>admitNativeImages(images,model,hook));assert.equal(JSON.stringify(images),before);
});
test('native image admission bounds byte/count budgets and fails before SDK work',async()=>{
  const image=await png();
  for(const [images,selected,handler] of [
    [[image],model,null],[[image],{capabilities:{supports:{vision:false}}},hook],
    [[{...image,mimeType:'image/jpeg'}],model,hook],[[{...image,data:'AAAA'}],model,hook],
    [[{...image,data:'!!!!'}],model,hook],[[{...image,data:image.data+'='}],model,hook],
    [Array(nativeImageLimits.count+1).fill(image),model,hook],
    [[{...image,data:'A'.repeat(nativeImageLimits.base64Chars+4)}],model,hook],
    [[image],{capabilities:{limits:{vision:{max_prompt_image_size:1}}}},hook],
  ])assert.throws(()=>admitNativeImages(images,selected,handler),e=>e.statusCode===400&&e.shouldRetry==='false');
  assert.doesNotThrow(()=>admitNativeImages([],model,null));
});
