import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSessionInput,normalizeToolOutput} from './bridge-core.mjs';
import sharp from 'sharp';
import {prepareVisionAttachments,visionCollectionBudget} from './vision-attachments.mjs';

test('new tool screenshot outranks an older user image during history rebuild', () => {
  const image = value => ({type:'input_image', image_url:'data:image/png;base64,' + Buffer.from(value).toString('base64')});
  const result = buildSessionInput({input:[
    {type:'message',role:'user',content:[image('old reference')]},
    {type:'function_call_output',call_id:'screen',output:[image('new screen')]},
  ]}, process.cwd(), {maxImageAttachments:1});
  assert.equal(Buffer.from(result.attachments[0].data,'base64').toString(), 'new screen');
});

const limits={maxImageAttachments:1,maxAttachmentBase64Chars:4194304,maxSingleAttachmentBase64Chars:4194304};
const raster=async(color,name)=>({type:'blob',mimeType:'image/png',displayName:name,
  data:(await sharp({create:{width:120,height:80,channels:3,background:color}}).png().toBuffer()).toString('base64')});

test('single screenshots retain exact bytes with a stable hash',async()=>{
  const image=await raster('#ff0000','screen');const result=await prepareVisionAttachments([image],limits);
  assert.equal(result.attachments[0].data,image.data);assert.equal(result.note,'');assert.match(result.evidence[0].sha256,/^[a-f0-9]{64}$/);
});

test('multiple screenshots become one labelled overview retaining both images',async()=>{
  const images=[await raster('#ff0000','old'),await raster('#0000ff','new')];
  const result=await prepareVisionAttachments(images,limits);
  assert.equal(result.attachments.length,1);assert.match(result.note,/Panel 1 = old; Panel 2 = new/);
  assert.match(result.note,/may be reduced/);assert.equal(result.evidence.length,2);
  const {data,info}=await sharp(Buffer.from(result.attachments[0].data,'base64')).raw().toBuffer({resolveWithObject:true});
  const pixel=(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
  assert.deepEqual(pixel(20,60),[255,0,0]);assert.deepEqual(pixel(156,60),[0,0,255]);
});

test('history packing collects older references and new screenshots in order',async()=>{
  const images=[await raster('#00ff00','old'),await raster('#ff00ff','new')];
  const result=buildSessionInput({input:[{type:'message',role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+images[0].data}]},
    {type:'function_call_output',call_id:'screen',output:[{type:'input_image',image_url:'data:image/png;base64,'+images[1].data}]}]},process.cwd(),visionCollectionBudget(limits));
  assert.equal(result.attachments.length,2);assert.equal(result.contextStats.omittedImageAttachments,0);
  const prepared=await prepareVisionAttachments(result.attachments,limits);assert.equal(prepared.evidence.length,2);
});

test('unfit images fail explicitly rather than disappear',async()=>{
  const images=[await raster('#ff0000','one'),await raster('#0000ff','two')];
  await assert.rejects(prepareVisionAttachments(images,{...limits,maxAttachmentBase64Chars:4,maxSingleAttachmentBase64Chars:4}),{code:'vision_budget_exceeded'});
  await assert.rejects(prepareVisionAttachments(images,{...limits,maxImageAttachments:0}),{code:'vision_budget_exceeded'});
});

test('current image batches are never dropped to make the collection budget fit',()=>{
  const images=Array.from({length:13},()=>({type:'input_image',image_url:'data:image/png;base64,bmV3'}));
  assert.throws(()=>normalizeToolOutput({output:images},visionCollectionBudget(limits)),{code:'vision_budget_exceeded'});
  assert.throws(()=>buildSessionInput({input:[{role:'user',content:images}]},process.cwd(),visionCollectionBudget(limits)),{code:'vision_budget_exceeded'});
});
