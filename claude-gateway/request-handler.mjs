import {CopilotRequestHandler} from '@github/copilot-sdk';
import {invalid,sdkToolName} from './protocol.mjs';
import {observeStream} from './upstream-stream.mjs';
import {readProviderError} from './errors.mjs';

// Upstream rejects every request that contains an encrypted PDF, and the PDF
// stays in client history, so one Read would break the whole conversation.
// Replace it, identically on every turn, with a visible note.
export function encryptedPdf(block){
  if(block.source?.type!=='base64'||block.source.media_type!=='application/pdf')return false;
  return Buffer.from(block.source.data,'base64').toString('latin1').includes('/Encrypt');
}
function readableDocument(block){
  if(!encryptedPdf(block))return block;
  const name=typeof block.title==='string'?' "'+block.title.slice(0,200)+'"':'';
  return {type:'text',text:'[Relay: the PDF'+name+' is encrypted or password-protected, which the model cannot read. '
    +'Ask the user for an unlocked copy, or decrypt it locally (for example: qpdf --decrypt in.pdf out.pdf) and read that file.]'};
}

// Documented SDK extension. Never changes destination, credentials, model or
// entitlement headers. Plans are scoped to actual SDK sessions, not global turns.
export class ClaudeRequestHandler extends CopilotRequestHandler {
  constructor(observe){super();this.plans=new Map();this.released=new Set();this.observe=observe;}
  bind(sessionId,body,selected,nativeMessages,onEvent){
    const previous=this.plans.get(sessionId);
    this.plans.set(sessionId,{body,selected,nativeMessages:nativeMessages??previous?.nativeMessages,sent:previous?.sent??false,onEvent,attempts:0});
  }
  release(sessionId){
    this.plans.delete(sessionId);this.released.add(sessionId);
    if(this.released.size>1024)this.released.delete(this.released.values().next().value);
  }
  async sendRequest(request,context){
    if(this.released.has(context.sessionId))throw new DOMException('Owned SDK session was released.','AbortError');
    // The SDK also routes startup model discovery through this hook. It has no
    // session or native transcript and must retain SDK routing/auth unchanged.
    // Keep the exception exact: every inference request still requires a plan.
    const pathname=new URL(request.url).pathname;
    if(request.method==='GET'&&pathname==='/models'||request.method==='POST'&&pathname==='/models/session')
      return super.sendRequest(request,context);
    const plan=this.plans.get(context.sessionId);
    if(!plan)throw invalid('SDK inference has no native request binding; no transport was attempted.',502,'api_error');
    const wire=await request.clone().json();
    if(this.plans.get(context.sessionId)!==plan||plan.nativeLimitReached||plan.nativeStarted||plan.nonRetryable||plan.attempts>=2)
      throw new DOMException('Native response cannot be replayed after output, a terminal error or the bounded retry limit.','AbortError');
    if(wire.model!==plan.selected.model.id||!Array.isArray(wire.messages)||wire.stream!==true)
      throw invalid('SDK request dialect changed; native Claude mapping refused.',502,'api_error');
    const {body,selected}=plan;
    const names=new Map(selected.tools.map((tool,index)=>[tool.name,sdkToolName(tool,index)]));
    // Production turns always send the exact native prefix retained by the
    // gateway, not the SDK's flattened bootstrap. SDK still owns pending tools.
    if(plan.onEvent||!plan.sent)wire.messages=(plan.nativeMessages??body.messages).map(message=>({...message,
      content:typeof message.content==='string'?message.content:message.content.map(block=>
        block.type==='tool_use'?{...block,name:names.get(block.name)??block.name}
        :block.type==='document'?readableDocument(block)
        // Tool search results name deferred client tools; use their SDK names.
        :block.type==='tool_result'&&Array.isArray(block.content)?{...block,content:block.content.map(item=>
          item.type==='tool_reference'?{...item,tool_name:names.get(item.tool_name)??item.tool_name}
          :item.type==='document'?readableDocument(item):item)}:block)}));
    wire.system=body.system??'';
    wire.max_tokens=body.max_tokens;
    for(const key of ['thinking','output_config','temperature','top_p','top_k','stop_sequences','context_management']){
      if(body[key]!==undefined)wire[key]=body[key];else delete wire[key];
    }
    // SDK names are retained because they identify client-owned external tools.
    // Schemas/descriptions/cache annotations otherwise come from the client.
    wire.tools=selected.tools.map(tool=>{
      const {type,...definition}=tool;
      return {...definition,name:names.get(tool.name)};
    });
    if(wire.tools.length||body.tool_choice!==undefined){
      wire.tool_choice={...selected.choice};
      if(wire.tool_choice.type==='tool')wire.tool_choice.name=names.get(wire.tool_choice.name);
    }else delete wire.tool_choice;
    this.observe?.(wire,context);
    const headers=new Headers(request.headers);headers.delete('content-length');
    // Versioned client controls are not auth. Preserve them alongside the
    // SDK-owned flags, credentials and destination; upstream validates support.
    if(selected.betas?.length){
      // Copilot's native endpoint accepts tool search only under its
      // first-party beta name; the cloud-provider alias is rejected outright.
      const combined=new Set([...(headers.get('anthropic-beta')??'').split(',').map(value=>value.trim()).filter(Boolean),...selected.betas]
        .map(value=>value==='tool-search-tool-2025-10-19'?'advanced-tool-use-2025-11-20':value));
      headers.set('anthropic-beta',[...combined].join(','));
    }
    plan.attempts++;plan.onEvent?.({type:'relay_transport_attempt'});
    let response;
    try{response=await super.sendRequest(new Request(request,{headers,body:JSON.stringify(wire)}),context);}
    catch(error){plan.onEvent?.({type:'relay_transport_error'});throw error;}
    const error=!response.ok&&plan.onEvent?await readProviderError(response):undefined;
    if(error?.shouldRetry==='false'||response.status>=400&&response.status<500&&![408,429].includes(response.status))plan.nonRetryable=true;
    plan.onEvent?.({type:'relay_transport_response',status:response.status,...(error?{error}:{})});
    if(!plan.onEvent){if(response.ok)plan.sent=true;return response;}
    return observeStream(response,event=>{
      if(event.type==='message_start')plan.nativeStarted=true;
      if(event.type==='message_delta')plan.nativeStopReason=event.delta?.stop_reason??plan.nativeStopReason;
      if(event.type==='message_stop'){plan.sent=true;plan.nativeLimitReached=plan.nativeStopReason==='max_tokens';}
      plan.onEvent(event);
    });
  }
}
