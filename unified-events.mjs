// Fixed metadata projection, shared by the server and its owning console.
export function publicGatewayEvent(event){
  const safe=value=>typeof value==='string'&&/^[\w.-]{1,100}$/.test(value)?value:'unreported';
  const number=value=>Number.isFinite(value)&&value>=0?String(value):'unreported';
  if(/^claude\.(received|selected|usage|completed|failed|rejected)$/.test(event?.type)){
    return `[Claude Code] ${event.type.slice(7)} ${safe(event.requestedModel)} -> ${safe(event.selectedModel)}`+
      (event.type==='claude.usage'?` input=${number(event.inputTokens)} output=${number(event.outputTokens)} AI-credits=${number(event.aiCredits)}`:'')+
      (event.httpStatus?` HTTP=${number(event.httpStatus)}`:'')+(event.continuationMode==='rebuilt'?' continuation=rebuilt':'');
  }
  if(['request.started','request.continued','response.completed','response.failed','bridge.ready'].includes(event?.type))
    return `[Codex] ${event.type} model=${safe(event.model)} id=${safe(event.responseId)}`;
  return null;
}
export function createGatewayReporter(send){
  let pending=0,dropped=0;
  return event=>{
    const text=publicGatewayEvent(event);if(!text)return;
    if(pending>=32){dropped++;return;}
    const skipped=dropped;dropped=0;pending++;
    // Console backpressure must never stall inference or grow an unbounded queue.
    let settled=false;const done=()=>{if(!settled){settled=true;pending--;}};
    try{send({type:'relay_console',text,skipped},done);}catch{done();}
  };
}
