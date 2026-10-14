import {invalid} from './protocol.mjs';

// Native Messages are not the SDK's flattened attachment prompt. Keep every
// occurrence in its original block, including signed history and tool results.
// In particular, never deduplicate, repack, decode/re-encode or relocate pixels.
// These are local admission bounds, not promises about provider acceptance.
export const nativeImageLimits=Object.freeze({count:100,base64Chars:32*1024*1024});
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
  if(images.length>nativeImageLimits.count||images.reduce((n,image)=>n+image.data.length,0)>nativeImageLimits.base64Chars)
    deny('Native image history exceeds the local 100-image / 32 MiB base64 safety budget. Start a new conversation with a text handoff and the required images; the original transcript was not altered.');
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
  // Do not use max_prompt_images to collapse a complete native transcript to
  // a flattened attachment prompt: historical images and signatures
  // must replay unchanged. The native endpoint remains authoritative about
  // full-history count/token limits and its errors pass through without fallback.
}
