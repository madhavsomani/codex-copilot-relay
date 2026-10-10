import {CopilotRequestHandler} from '@github/copilot-sdk';
import {invalid,sdkToolName} from './protocol.mjs';
import {observeStream} from './upstream-stream.mjs';
import {readProviderError} from './errors.mjs';

// Documented SDK extension. Never changes destination, credentials, model or
// entitlement headers. Plans are scoped to actual SDK sessions, not global turns.
export class ClaudeRequestHandler extends CopilotRequestHandler {
  constructor(observe){super();this.plans=new Map();this.released=new Set();this.observe=observe;}
  bind(sessionId,body,selected,nativeMessages,onEvent){
    const previous=this.plans.get(sessionId);
    this.plans.set(sessionId,{body,selected,nativeMessages:nativeMessages??previous?.nativeMessages,sent:previous?.sent??false,onEvent});
  }
  release(sessionId){
    this.plans.delete(sessionId);this.released.add(sessionId);
    if(this.released.size>1024)this.released.delete(this.released.values().next().value);
  }
  async sendRequest(request,context){
    if(this.released.has(context.sessionId))throw new DOMException('Owned SDK session was released.','AbortError');
    const plan=this.plans.get(context.sessionId);
    if(!plan)return super.sendRequest(request,context);
    const wire=await request.clone().json();
    if(this.plans.get(context.sessionId)!==plan||plan.nativeLimitReached)
      throw new DOMException('Native max-token completion cannot be replayed.','AbortError');
    if(wire.model!==plan.selected.model.id||!Array.isArray(wire.messages)||wire.stream!==true)
      throw invalid('SDK request dialect changed; native Claude mapping refused.',502,'api_error');
    const {body,selected}=plan;
    const names=new Map(selected.tools.map((tool,index)=>[tool.name,sdkToolName(tool,index)]));
    // Production turns always send the exact native prefix retained by the
    // gateway, not the SDK's flattened bootstrap. SDK still owns pending tools.
    if(plan.onEvent||!plan.sent)wire.messages=(plan.nativeMessages??body.messages).map(message=>({...message,
      content:typeof message.content==='string'?message.content:message.content.map(block=>
        block.type==='tool_use'?{...block,name:names.get(block.name)??block.name}:block)}));
    wire.system=body.system??'';
    wire.max_tokens=body.max_tokens;
    for(const key of ['thinking','output_config','temperature','top_p','top_k','stop_sequences']){
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
      const combined=new Set([...(headers.get('anthropic-beta')??'').split(',').map(value=>value.trim()).filter(Boolean),...selected.betas]);
      headers.set('anthropic-beta',[...combined].join(','));
    }
    plan.onEvent?.({type:'relay_transport_attempt'});
    let response;
    try{response=await super.sendRequest(new Request(request,{headers,body:JSON.stringify(wire)}),context);}
    catch(error){plan.onEvent?.({type:'relay_transport_error'});throw error;}
    const error=!response.ok&&plan.onEvent?await readProviderError(response):undefined;
    plan.onEvent?.({type:'relay_transport_response',status:response.status,...(error?{error}:{})});
    if(!plan.onEvent){if(response.ok)plan.sent=true;return response;}
    return observeStream(response,event=>{
      if(event.type==='message_delta')plan.nativeStopReason=event.delta?.stop_reason??plan.nativeStopReason;
      if(event.type==='message_stop'){plan.sent=true;plan.nativeLimitReached=plan.nativeStopReason==='max_tokens';}
      plan.onEvent(event);
    });
  }
}
