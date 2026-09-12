import {parser} from 'stream-json';
import {RequestBodyError,RequestBodyTooLargeError} from './request-body.mjs';

export const DEFAULT_RESPONSES_WIRE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_RESPONSES_READ_MS = 120_000;
const OMITTED = '[Historical image omitted by relay ingress budget. Its source remains in the original task/files; request it again for exact comparison.]';
const invalid = () => new RequestBodyError('Request body is not valid JSON.',{code:'invalid_json',statusCode:400});
const visionLimit = () => new RequestBodyError('The newest image batch exceeds the local image collection budget. Request fewer images or smaller crops.',{code:'vision_budget_exceeded',statusCode:400});
let readers = 0;

// Bound the transport independently of the assembled body. Only embedded image
// nodes in older input items are eligible for eviction, with visible markers.
// This is not general text/history truncation or an upstream-provider fallback.
export async function readResponsesBody(request, {maxBytes,maxWireBytes=DEFAULT_RESPONSES_WIRE_BYTES,
  maxImages=12,maxImageChars=32*1024*1024,maxReadMs=DEFAULT_RESPONSES_READ_MS,preserveBody=()=>false}={}) {
  for (const limit of [maxBytes,maxWireBytes,maxImages,maxImageChars,maxReadMs])
    if (!Number.isSafeInteger(limit)||limit<=0) throw new TypeError('Body limits must be positive safe integers.');
  if (readers>=4) throw new RequestBodyError('Relay request readers are busy. Retry after an active upload finishes.',{code:'request_reader_busy',statusCode:429});
  const declared=Number(request.headers?.['content-length']);
  if (Number.isSafeInteger(declared)&&declared>maxWireBytes) throw new RequestBodyTooLargeError(declared,maxWireBytes);
  readers++;
  const stream=parser.asStream({packKeys:false,packStrings:false,packNumbers:false});
  let bytes=0,units=0,nodes=0,root,scalar='',scalarKind=null,failed;
  // Decoded-unit accounting is a working-memory guard, not exact UTF-8 JSON
  // sizing. Allow conservative punctuation overhead; enforce exact bytes last.
  const maxUnits=maxBytes+Math.min(maxBytes,1_500_000);
  let imageChars=0,imageCount=0,omitted=0,omittedChars=0,newestSource=-1;
  const stack=[],images=[];
  let deadlineTimer,iterator;
  const deadline=new Promise((_,reject)=>{deadlineTimer=setTimeout(()=>reject(new RequestBodyError(
    'Request upload timed out. Retry with a complete, bounded request.',{code:'request_upload_timeout',statusCode:408})),maxReadMs);});
  const explicitUpstream=()=>Boolean(root && (typeof root.model==='string'&&root.model.startsWith('openai/')||preserveBody(root)));
  const sourceIndex=path=>path?.[0]==='input'&&Number.isInteger(path[1])?path[1]:-1;
  const writable=(parent,key,value)=>Object.defineProperty(parent,key,{value,writable:true,enumerable:true,configurable:true});
  const location=()=>{
    const parent=stack.at(-1),key=parent?.array?parent.index++:parent?.key;
    return {parent,key,path:parent?parent.path.concat(key):[]};
  };
  const add=(place,value)=>{if(!place.parent)root=value;else writable(place.parent.value,place.key,value);};
  const eligible=item=>item.source<newestSource && !['system','developer'].includes(root?.input?.[item.source]?.role)
    && (['user','assistant','tool'].includes(root?.input?.[item.source]?.role)
      || ['message','function_call_output','custom_tool_call_output'].includes(root?.input?.[item.source]?.type));
  function evict() {
    if(explicitUpstream())return false;
    const index=images.findIndex(eligible);if(index<0)return false;
    const item=images.splice(index,1)[0];
    writable(item.parent,item.key,{type:'input_text',text:OMITTED});
    imageChars-=item.chars;imageCount--;omitted++;omittedChars+=item.chars;
    units-=item.chars;units+=OMITTED.length+40;
    return true;
  }
  function enforce() {
    if(explicitUpstream()) {
      if(units>maxUnits)throw new RequestBodyTooLargeError(bytes,maxBytes);
    } else {
      while(imageCount>maxImages||imageChars>maxImageChars||units>maxUnits) {
        if(!evict()) {
          if(imageCount>maxImages||imageChars>maxImageChars)throw visionLimit();
          throw new RequestBodyTooLargeError(bytes,maxBytes);
        }
      }
    }
  }
  function register(frame) {
    const path=frame.path, value=frame.value,source=sourceIndex(path);
    const slot=(path.length===4&&['content','output'].includes(path[2])&&Number.isInteger(path[3]))
      || (path.length===3&&path[2]==='output')
      || (path.length===5&&path[2]==='output'&&path[3]==='content'&&Number.isInteger(path[4]));
    if(source<0||!slot||value.type!=='input_image'||typeof value.image_url!=='string'
      ||!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(value.image_url)
      ||(value.detail!==undefined&&!['auto','low','high','original'].includes(value.detail))
      ||Object.keys(value).some(key=>!['type','image_url','detail'].includes(key)))return;
    newestSource=Math.max(newestSource,source);
    images.push({source,parent:frame.parent.value,key:frame.slot,chars:value.image_url.length});
    imageCount++;imageChars+=value.image_url.length;
  }
  function consume(token) {
    if(failed)return;
    try {
      switch(token.name) {
        case 'startObject': case 'startArray': {
          if(++nodes>250000||stack.length>=128)throw new RequestBodyTooLargeError(bytes,maxBytes);
          const place=location(),array=token.name==='startArray',value=array?[]:{};
          add(place,value);stack.push({value,array,path:place.path,parent:place.parent,slot:place.key,index:0,key:null});
          units+=2;break;
        }
        case 'endObject': case 'endArray': {
          const frame=stack.pop();if(!frame.array)register(frame);enforce();break;
        }
        case 'startKey': case 'startString': case 'startNumber': scalar='';scalarKind=token.name;break;
        case 'stringChunk': case 'numberChunk': {
          scalar+=token.value;units+=token.value.length;
          // A scalar itself may never grow without bound, even when it merely
          // resembles base64. Earlier completed images can free assembled space.
          if(scalar.length>maxBytes)throw new RequestBodyTooLargeError(bytes,maxBytes);
          if(units>maxUnits) {
            while(units>maxUnits&&evict()){}
            const frame=stack.at(-1);
            const imageSlot=sourceIndex(frame?.path)>=0&&((frame?.key==='image_url'&&scalar.startsWith('data:image/'))
              ||typeof frame?.value?.image_url==='string'&&frame.value.image_url.startsWith('data:image/'));
            if(units>maxUnits&&!imageSlot)throw new RequestBodyTooLargeError(bytes,maxBytes);
            if(units>maxUnits+maxImageChars)throw visionLimit();
          }
          break;
        }
        case 'endKey': {
          const parent=stack.at(-1);if(Object.hasOwn(parent.value,scalar))throw invalid();
          parent.key=scalar;units+=3;scalar='';scalarKind=null;break;
        }
        case 'endString': case 'endNumber': {
          if(++nodes>250000)throw new RequestBodyTooLargeError(bytes,maxBytes);
          const place=location();add(place,scalarKind==='startNumber'?Number(scalar):scalar);
          units+=3;scalar='';scalarKind=null;break;
        }
        case 'trueValue': case 'falseValue': case 'nullValue': {
          if(++nodes>250000)throw new RequestBodyTooLargeError(bytes,maxBytes);
          add(location(),token.value);units+=6;enforce();break;
        }
      }
    } catch(error) {failed=error;stream.destroy(error);}
  }
  stream.on('data',consume);
  stream.on('error',error=>{failed??=error instanceof RequestBodyError?error:invalid();});
  try {
    // Do not destroy IncomingMessage on a bounded rejection: the HTTP handler
    // still needs to return the actual 400/413 instead of a reset connection.
    const iterable=request.iterator?request.iterator({destroyOnReturn:false}):request;
    iterator=iterable[Symbol.asyncIterator]();
    for(let entry=await Promise.race([iterator.next(),deadline]);!entry.done;entry=await Promise.race([iterator.next(),deadline])) {
      const raw=entry.value;
      const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
      bytes+=chunk.length;if(bytes>maxWireBytes)throw new RequestBodyTooLargeError(bytes,maxWireBytes);
      // Limit parser token bursts even if a caller supplies a huge single chunk.
      for(let offset=0;offset<chunk.length;offset+=65536) {
        if(failed)throw failed;
        await new Promise((resolve,reject)=>stream.write(chunk.subarray(offset,offset+65536),error=>error?reject(failed||invalid()):resolve()));
      }
    }
    if(failed)throw failed;
    await new Promise((resolve,reject)=>{
      stream.once('end',resolve);stream.once('error',()=>reject(failed||invalid()));stream.end();
    });
    if(failed)throw failed;
    if(!root||typeof root!=='object'||Array.isArray(root))throw invalid();
    enforce();
    let retainedBytes=Buffer.byteLength(JSON.stringify(root));
    while(retainedBytes>maxBytes&&evict())retainedBytes=Buffer.byteLength(JSON.stringify(root));
    if(retainedBytes>maxBytes)throw new RequestBodyTooLargeError(bytes,maxBytes);
    // Routing fields can occur last in valid JSON. Never forward a pruned body
    // to the separately authorized public API, regardless of property order.
    if(omitted&&explicitUpstream())
      throw new RequestBodyTooLargeError(bytes,maxBytes);
    return {body:root,bytes,ingress:{wireBytes:bytes,retainedBytes,omittedHistoricalImages:omitted,
      omittedImageChars:omittedChars,retainedImages:imageCount,maxWireBytes,maxRetainedBytes:maxBytes}};
  } finally {
    clearTimeout(deadlineTimer);stream.destroy();readers--;
    // A timed-out upload may still have a pending next(). The HTTP owner closes
    // the connection after its error response; do not wait on that client here.
    iterator?.return?.().catch(()=>{});
  }
}
