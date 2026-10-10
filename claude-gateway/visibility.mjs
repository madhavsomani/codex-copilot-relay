// Deliberate public projection for the in-process, read-only connection center.
// Never return the gateway/SDK object, raw ledger, credentials or tool payloads.
import {adapterVersion,catalog} from './protocol.mjs';
const count=value=>Number.isFinite(value)&&value>=0?value:0;
const model=value=>typeof value==='string'&&/^[\w.-]{1,100}$/.test(value)?value:null;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const usage=value=>({sdkApiCalls:count(value.sdkApiCalls),inputTokens:count(value.inputTokens),outputTokens:count(value.outputTokens),
  cacheReadTokens:count(value.cacheReadTokens),cacheWriteTokens:count(value.cacheWriteTokens),
  totalNanoAiu:Number.isFinite(value.totalNanoAiu)&&value.totalNanoAiu>=0?value.totalNanoAiu:null,creditReportedCalls:count(value.creditReportedCalls)});
function credits(value){return {...value,aiCredits:value.creditReportedCalls===0||value.totalNanoAiu===null?null:value.totalNanoAiu/1e9,
  creditReporting:value.creditReportedCalls===0?'unreported':value.creditReportedCalls<value.sdkApiCalls?'partial':'reported'};}
export function gatewayRequestVisibility(row){return {
  id:typeof row.id==='string'&&/^req_[a-f0-9-]{36}$/.test(row.id)?row.id:null,at:stamp(row.at),
  durationMs:Number.isFinite(row.durationMs)&&row.durationMs>=0?row.durationMs:null,
  status:['active','completed','failed','rejected','interrupted'].includes(row.status)?row.status:'unknown',
  toolRequests:Number.isInteger(row.toolRequests)&&row.toolRequests>=0?row.toolRequests:null,
  toolResults:Number.isInteger(row.toolResults)&&row.toolResults>=0?row.toolResults:null,
  requestedModel:model(row.requestedModel),selectedModel:model(row.selectedModel),
  actualModels:(row.actualModels??[]).slice(0,16).map(model).filter(Boolean),
  continuationMode:row.continuationMode==='rebuilt'?'rebuilt':null,
  continuationChanges:(row.continuationChanges??[]).filter(key=>['system','tools','effort','format','betas','choice','thinking','maxTokens','temperature','top_p','top_k','stop_sequences'].includes(key)),
  httpStatus:Number.isInteger(row.httpStatus)&&row.httpStatus>=400&&row.httpStatus<=599?row.httpStatus:null,
  ...credits(usage(row))};}

export function gatewayDashboardEvent(type,row){
  const phases={received:'received',selected:'selected',forwarded:'forwarded',tool_requested:'tool_requested',tool_resolved:'tool_resolved',usage:'usage',completed:'completed',failed:'failed',rejected:'failed',interrupted:'failed'};
  if(!phases[type])return null;
  const view=gatewayRequestVisibility(row);if(!view.id)return null;
  return {type:'relay.'+phases[type],at:new Date().toISOString(),record:{
    id:view.id,client:'claude-code',provider:'github-copilot-sdk',requestPath:'/claude/v1/messages',
    receivedAt:view.at,status:view.status,requestedModel:view.requestedModel,selectedModel:view.selectedModel,
    latencyMs:view.durationMs,httpStatus:view.httpStatus,continuationMode:view.continuationMode,
    toolRequests:view.toolRequests,toolResults:view.toolResults,
    usage:{metered:view.sdkApiCalls>0,sdkApiCalls:view.sdkApiCalls,
      inputTokens:view.sdkApiCalls?view.inputTokens:null,outputTokens:view.sdkApiCalls?view.outputTokens:null,
      totalNanoAiu:view.creditReportedCalls?view.totalNanoAiu:null,creditMeteredApiCalls:view.creditReportedCalls,
      models:view.actualModels.map(model=>({model}))}}};
}
export function gatewayVisibility(gateway){
  const state=gateway.ledger.state,sdk=gateway.runtime.snapshot();
  const buckets=(state.usage??[]).slice(0,129).map(value=>({model:model(value.model)??'unreported',...credits(usage(value))}));
  const total={sdkApiCalls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,totalNanoAiu:null,creditReportedCalls:0};
  for(const value of buckets){
    for(const key of ['sdkApiCalls','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','creditReportedCalls'])total[key]+=value[key];
    if(value.totalNanoAiu!==null)total.totalNanoAiu=(total.totalNanoAiu??0)+value.totalNanoAiu;
  }
  const rows=(state.recent??[]).slice(-1000);
  const times=rows.map(row=>stamp(row.at)).filter(Boolean).sort();
  return {provider:'github-copilot-sdk',version:adapterVersion,listening:gateway.mountPort?gateway.mountedListening===true:gateway.server.listening===true,
    port:gateway.mountPort??(gateway.server.listening?gateway.server.address().port:null),
    sdkState:['ready','starting','recovering','degraded','lost','stopped'].includes(sdk.state)?sdk.state:'unknown',
    models:catalog(gateway.models).map(value=>value.id),modelCatalogSource:'SDK catalog at gateway startup',automaticFallback:false,
    received:count(state.received),completed:count(state.completed),failed:count(state.failed),
    activeRequests:Math.max(0,count(state.received)-count(state.completed)-count(state.failed)),activeTurns:gateway.turns.size,
    lastRequestAt:times.at(-1)??null,...credits(total),usage:buckets,usageSource:'SDK assistant.usage receipts; failed attempts may be unreported',
    transport:Object.fromEntries(['attempts','httpResponses','httpErrors','networkErrors'].map(key=>[key,count(state.transport?.[key])])),
    recent:rows.slice(-20).reverse().map(gatewayRequestVisibility)};
}
