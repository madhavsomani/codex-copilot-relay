import {invalid} from './protocol.mjs';
import {bounded} from '../copilot-runtime.mjs';

const statuses={invalid_request_error:400,authentication_error:401,permission_error:403,not_found_error:404,
  request_too_large:413,rate_limit_error:429,api_error:500,overloaded_error:529};
const byStatus=Object.fromEntries(Object.entries(statuses).map(([type,status])=>[status,type]));
const retryDecision=value=>value==='true'||value==='false'?value:undefined;
function retryDelay(value,now=Date.now){
  if(typeof value!=='string'||value.length>128)return;
  if(/^\d{1,10}$/.test(value)){
    const seconds=Number(value);if(seconds<=2147483647)return String(seconds);return;
  }
  // IMF-fixdate is the standard HTTP-date. Do not let permissive Date.parse
  // interpret arbitrary text, negative numbers or fractional seconds as dates.
  if(!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))return;
  const at=Date.parse(value),sample=now();
  if(!Number.isFinite(at)||!Number.isFinite(sample)||new Date(at).toUTCString()!==value)return;
  const seconds=Math.max(0,Math.ceil((at-sample)/1000));if(seconds<=2147483647)return String(seconds);
}
export function providerError(status,payload={},headers=new Headers(),now=Date.now){
  const detail=payload?.error??payload;
  const type=Object.hasOwn(statuses,detail?.type)?detail.type:byStatus[status]??'api_error';
  const statusCode=Number.isInteger(status)&&status>=400&&status<=599?status:statuses[type];
  const message=typeof detail?.message==='string'?detail.message.slice(0,2000):`Copilot upstream returned HTTP ${statusCode}.`;
  const error=invalid(message,statusCode,type);
  const id=payload?.request_id??detail?.requestId??headers.get('request-id')??headers.get('x-request-id');
  if(typeof id==='string'&&/^[\w.:-]{1,128}$/.test(id))error.requestId=id;
  const retry=retryDelay(headers.get('retry-after')??detail?.retryAfter,now);
  if(retry!==undefined)error.retryAfter=retry;
  const decision=retryDecision(headers.get('x-should-retry')??detail?.shouldRetry);
  if(decision!==undefined)error.shouldRetry=decision;
  return error;
}
// Project only documented failure controls. Copilot authentication, cookies,
// private transport and unrelated plan-limit headers never reach the client.
export function errorResponseHeaders(error){
  const headers={},retry=retryDelay(error.retryAfter),decision=retryDecision(error.shouldRetry);
  if(retry!==undefined)headers['retry-after']=retry;
  if(decision!==undefined)headers['x-should-retry']=decision;
  if(typeof error.requestId==='string'&&/^[\w.:-]{1,128}$/.test(error.requestId))headers['request-id']=error.requestId;
  return headers;
}
export async function readProviderError(response){
  let reader,payload={};
  try{
    reader=response.clone().body?.getReader();let size=0;const chunks=[];const deadline=Date.now()+2500;
    while(reader){
      const remaining=deadline-Date.now();if(remaining<=0)break;
      const {value,done}=await bounded(()=>reader.read(),remaining,'Bounded provider error body');
      if(done){payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));break;}
      size+=value.byteLength;if(size>65536)break;chunks.push(Buffer.from(value));
    }
  }catch{/* Do not expose HTML, huge bodies, malformed JSON or error-read failures. */}
  finally{void reader?.cancel().catch(()=>{});reader?.releaseLock();}
  const error=providerError(response.status,payload,response.headers);
  return {type:error.type,message:error.message,requestId:error.requestId,retryAfter:error.retryAfter,shouldRetry:error.shouldRetry};
}
