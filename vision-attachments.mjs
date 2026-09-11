import sharp from 'sharp';
import {createHash} from 'node:crypto';

const MAX_PACKED_IMAGES = 12;
const MAX_PACKED_BASE64 = 32 * 1024 * 1024;
sharp.cache({memory:16,files:0,items:16});
sharp.concurrency(2);
let activePacks=0;
const waitingPacks=[];
const hash = data => createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
const failure = message => Object.assign(new Error(message), {code:'vision_budget_exceeded',statusCode:400});

// Gather a bounded recent history before reducing to the provider's real limits.
export function visionCollectionBudget(compatibility) {
  if (!compatibility.maxImageAttachments) return {...compatibility,requireRecentImages:true};
  return {...compatibility, maxImageAttachments:MAX_PACKED_IMAGES,
    maxAttachmentBase64Chars:MAX_PACKED_BASE64,
    maxSingleAttachmentBase64Chars:MAX_PACKED_BASE64,requireRecentImages:true};
}

export function imageEvidence(attachments) {
  return attachments.map(image => ({name:image.displayName || image.description,
    mimeType:image.mimeType,base64Chars:image.data.length,sha256:hash(image.data)}));
}

export async function prepareVisionAttachments(attachments, compatibility) {
  if (!attachments.length) return {attachments, note:'', evidence:[]};
  const maxCount = compatibility.maxImageAttachments ?? 1;
  const maxBytes = Math.min(compatibility.maxAttachmentBase64Chars ?? MAX_PACKED_BASE64,
    compatibility.maxSingleAttachmentBase64Chars ?? MAX_PACKED_BASE64);
  const total = attachments.reduce((sum, image) => sum + image.data.length, 0);
  if (!maxCount) throw failure('This model does not support images. Select a vision-capable model.');
  if (attachments.length > MAX_PACKED_IMAGES || total > MAX_PACKED_BASE64)
    throw failure('Too many image bytes for local packing. Request a smaller image batch.');
  const evidence=imageEvidence(attachments), seen=new Map(), unique=[], aliases=[];
  for (const [index,image] of attachments.entries()) {
    const digest=evidence[index].sha256;
    if (seen.has(digest)) {
      const first=seen.get(digest);
      aliases.push(`Source ${index+1} (${String(image.displayName || image.description || 'image').slice(0,128)}) is byte-identical to Source ${first.source+1} (Panel ${first.panel+1})`);
    } else {
      seen.set(digest,{source:index,panel:unique.length});unique.push(image);
    }
  }
  const aliasNote=aliases.length ? `[Relay exact-duplicate mapping: ${aliases.join('; ')}. Every occurrence still refers to the same source pixels; panel order is first occurrence, not last appearance.]` : '';
  const finish=result=>({...result,evidence,deduplicatedImages:aliases.length,note:[result.note,aliasNote].filter(Boolean).join('\n')});
  if (unique.length <= maxCount && unique.reduce((sum,image)=>sum+image.data.length,0) <= maxBytes)
    return finish({attachments:unique,note:''});
  if(activePacks>=2) {
    if(waitingPacks.length>=8)throw Object.assign(failure('Local image packing is busy. Retry a smaller batch.'),{code:'vision_busy',statusCode:429});
    await new Promise(resolve=>waitingPacks.push(resolve));
  } else activePacks++;
  try {return finish(await packImages(unique,maxBytes,compatibility.supportedMediaTypes));}
  finally {if(waitingPacks.length)waitingPacks.shift()();else activePacks--;}
}

async function packImages(attachments,maxBytes,supportedMediaTypes) {
  // No remote URLs or filesystem paths are fetched here. Decode only supplied
  // raster bytes, with a decompression-bomb limit and no animated-frame expansion.
  const tiles = [];
  for (const [index, image] of attachments.entries()) {
    const bytes = Buffer.from(image.data, 'base64');
    const rasterMagic=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
      bytes.subarray(0,3).equals(Buffer.from([255,216,255])) ||
      ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')) ||
      (bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP');
    if(!rasterMagic)throw failure('Only embedded raster image bytes can be packed.');
    const metadata = await sharp(bytes, {limitInputPixels:32_000_000}).metadata();
    if (!['png','jpeg','webp','gif'].includes(metadata.format))
      throw failure('Image packing supports PNG/JPEG/WebP/GIF raster images only.');
    tiles.push({bytes, label:`Panel ${index + 1}`, name:image.displayName || image.description || `image-${index + 1}`});
  }
  // Small text retains full resolution where possible; a large batch is an
  // explicitly labelled overview, never represented as native multi-image input.
  for (const edge of [1600, 1200, 900, 640]) {
    const rendered = [];
    for (const tile of tiles) {
      const {data,info} = await sharp(tile.bytes,{limitInputPixels:32_000_000})
        .rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true})
        .flatten({background:'#ffffff'}).png().toBuffer({resolveWithObject:true});
      rendered.push({...tile,data,width:info.width,height:info.height});
    }
    const columns = rendered.length > 1 ? 2 : 1;
    const width = Math.max(...rendered.map(tile=>tile.width)) + 16;
    const rowHeights = [];
    for (let i=0;i<rendered.length;i+=columns)
      rowHeights.push(Math.max(...rendered.slice(i,i+columns).map(tile=>tile.height)) + 48);
    const layers = []; let top = 0;
    for (const [index,tile] of rendered.entries()) {
      const left = (index % columns)*width;
      // Labels are generated from numeric indexes, never user-controlled SVG.
      const label = Buffer.from(`<svg width="${width}" height="32"><rect width="100%" height="100%" fill="#eef2f6"/><text x="8" y="23" font-family="Arial" font-size="20" fill="#111827">${tile.label}</text></svg>`);
      layers.push({input:label,left,top},{input:tile.data,left:left+8,top:top+36});
      if (index%columns===columns-1) top += rowHeights[Math.floor(index/columns)];
    }
    const png = await sharp({create:{width:columns*width,height:rowHeights.reduce((a,b)=>a+b,0),channels:3,background:'#ffffff'}})
      .composite(layers).png({compressionLevel:9}).toBuffer();
    const formats=[{mimeType:'image/png',quality:null}];
    if (!supportedMediaTypes?.length || supportedMediaTypes.includes('image/jpeg'))
      formats.push({mimeType:'image/jpeg',quality:90},{mimeType:'image/jpeg',quality:80});
    for (const format of formats) {
      const bytes=format.quality ? await sharp(png).flatten({background:'#ffffff'})
        .jpeg({quality:format.quality,chromaSubsampling:'4:4:4'}).toBuffer() : png;
      // Check encoded size too: the transport carries base64, not just the raster.
      if (4*Math.ceil(bytes.length/3)>maxBytes) continue;
      const data=bytes.toString('base64');
      const displayName = 'visual-panels-' + hash(data).slice(0,12);
      const attachment = {type:'blob',mimeType:format.mimeType,data,displayName};
      return {attachments:[attachment], evidence:imageEvidence(attachments),
        note:`[Relay visual overview: ${rendered.map(tile=>`${tile.label} = ${String(tile.name).slice(0,128)}`).join('; ')}. Panels follow first-occurrence order. Images may be reduced to ${edge}px per edge. Encoding: ${format.quality ? 'lossy JPEG quality '+format.quality : 'lossless PNG'}. For small text or exact comparison request each source separately. This is a packed overview, not separate native image inputs. Original files are unchanged.]`};
    }
  }
  throw failure('Images cannot fit the provider byte limit. Request individual images or smaller crops.');
}
