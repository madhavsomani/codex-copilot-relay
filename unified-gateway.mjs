// One HTTP listener, separate protocol/session owners. No provider fallback.
import {startSdkGateway} from './claude-gateway/server.mjs';
import {gatewayVisibility,gatewayDashboardEvent} from './claude-gateway/visibility.mjs';

export async function mountClaudeGateway({port,token,runtimeDirectory,workingDirectory,log=()=>{},start=startSdkGateway}){
  const gateway=await start({port:0,mountPort:port,token,runtimeDirectory,workingDirectory});
  const listeners=new Set();
  gateway.ledger.onChange=(type,row)=>{
    // Observers are metadata-only and cannot interrupt model/tool continuations.
    try{log('claude.'+type,{client:'claude-code',provider:'github-copilot-sdk',requestId:row.id,
    requestedModel:row.requestedModel,selectedModel:row.selectedModel,actualModels:row.actualModels,
    inputTokens:row.inputTokens,outputTokens:row.outputTokens,sdkApiCalls:row.sdkApiCalls,
    aiCredits:row.creditReportedCalls&&row.totalNanoAiu!==null?row.totalNanoAiu/1e9:null,httpStatus:row.httpStatus??null,
    continuationMode:row.continuationMode??null,continuationChanges:row.continuationChanges??[]});}catch{}
    const event=gatewayDashboardEvent(type,row);
    if(event)for(const listener of listeners){try{listener(event);}catch{}}
  };
  return {gateway,visibility:()=>gatewayVisibility(gateway),close:()=>{listeners.clear();return gateway.close();},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    route(request,response){
      // A distinct base path makes model discovery unambiguous for both clients.
      if(!request.url?.startsWith('/claude/'))return false;
      request.url=request.url.slice('/claude'.length);
      void gateway.handle(request,response);return true;
    }};
}
