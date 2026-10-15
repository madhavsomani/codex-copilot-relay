import {invalid} from './protocol.mjs';

// Native Messages are not the SDK's flattened attachment prompt. Keep every
// image in its original block; never deduplicate, repack or re-encode pixels.
// The one exception is fitImageHistory below: when a long chat's images would
// exceed Copilot's request-size limit, the oldest are left out of the upstream
// copy (never the client transcript) instead of breaking every later turn.
//
// Measured October 2026 on Copilot's native Claude endpoint: 150 images were
// accepted; 31 MiB of base64 image data was accepted and 42 MiB rejected with
// 413 request_too_large. Image count is therefore not a limit; bytes are.
export const nativeImageLimits=Object.freeze({upstreamBase64Chars:24*1024*1024,omitGroup:16});
const rasterTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
function rasterType(bytes){
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
}
export function admitNativeImages(images,model,requestHandler){
  if(!images.length)return;
  const deny=message=>{throw Object.assign(invalid(message),{code:'claude_native_image_admission'});};
  if(typeof requestHandler?.bind!=='function')deny('Native images require the session-bound Claude request handler; no text-only fallback was attempted.');
  if(model.capabilities?.supports?.vision===false)deny('The selected Copilot model does not support images. No model fallback was attempted.');
  const vision=model.capabilities?.limits?.vision??{};
  const maxBytes=vision.max_prompt_image_size??3*1024*1024;
  for(const image of images){
    if(!rasterTypes.has(image.mimeType)||vision.supported_media_types?.length&&!vision.supported_media_types.includes(image.mimeType))
      deny('An embedded image media type is unsupported by the selected Copilot model. No conversion was attempted.');
    if(image.data.length%4===1||image.data.includes('=')&&image.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))deny('An embedded image has malformed base64 data.');
    const bytes=Buffer.from(image.data,'base64');
    if(bytes.length>maxBytes)deny('An original image exceeds the selected model image-byte limit. The relay will not resize signed history. Use a new conversation with a smaller source image.');
    if(bytes.toString('base64').replace(/=+$/,'')!==image.data.replace(/=+$/,'')||rasterType(bytes)!==image.mimeType)
      deny('An embedded image has malformed raster data or a mismatched media type.');
  }
  // The native endpoint remains authoritative about token limits; its errors
  // pass through without fallback.
}

export const omittedImageNote='[Relay: an earlier image was left out here to keep this long chat within Copilot\'s request-size limit. '
  +'Ask the user to share it again if it is still needed.]';
// Leave out the oldest images, in fixed groups, until the rest fit the budget.
// Groups are counted from the start of the chat, so the cut point only moves
// when a whole new group is needed and the cached prefix stays stable.
export function fitImageHistory(messages,{budget=nativeImageLimits.upstreamBase64Chars,group=nativeImageLimits.omitGroup}={}){
  const sizes=[];
  const visit=content=>{if(Array.isArray(content))for(const block of content){
    if(block?.type==='image'&&block.source?.type==='base64')sizes.push(block.source.data.length);
    else if(block?.type==='tool_result')visit(block.content);
  }};
  for(const message of messages)visit(message.content);
  let total=sizes.reduce((sum,size)=>sum+size,0),omit=0;
  while(total>budget&&omit<sizes.length){
    const next=Math.min(sizes.length,omit+group);
    for(let i=omit;i<next;i++)total-=sizes[i];
    omit=next;
  }
  if(!omit)return {messages,omitted:0};
  let index=0;
  const rewrite=content=>Array.isArray(content)?content.map(block=>{
    if(block?.type==='image'&&block.source?.type==='base64')return index++<omit
      ?{type:'text',text:omittedImageNote,...(block.cache_control!==undefined?{cache_control:block.cache_control}:{})}:block;
    if(block?.type==='tool_result'&&Array.isArray(block.content))return {...block,content:rewrite(block.content)};
    return block;
  }):content;
  return {messages:messages.map(message=>({...message,content:rewrite(message.content)})),omitted:omit};
}
