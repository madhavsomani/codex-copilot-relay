import {gatewayRequestVisibility} from './claude-gateway/visibility.mjs';
const count=value=>Number.isFinite(value)&&value>=0?value:0;
export function identifySession(record,names=()=>null){
 const client=record.client||'codex',id=record.taskId;
 const name=id&&id!=='unattributed'?names(client,id):null;
 return {...record,client,clientLabel:client==='claude-code'?'Claude Code':client==='codex'?'Codex':'OpenAI helper',
  sessionName:name||(id&&id!=='unattributed'?`${client==='claude-code'?'Claude':'Codex'} session ${id.slice(0,8)} · title unavailable`:'Unattributed · session not reported'),
  sessionNameSource:name?'local title index':'unavailable',dollarCost:null};
}
export function claudeHistoryRecord(raw){
 const row=gatewayRequestVisibility(raw),metered=row.sdkApiCalls>0;
 return {id:row.id,client:'claude-code',provider:'github-copilot-sdk',requestPath:'/claude/v1/messages',taskId:row.session,
  receivedAt:row.at,completedAt:row.completedAt,status:row.status,latencyMs:row.durationMs,
  requestedModel:row.requestedModel,selectedModel:row.selectedModel,selectedReasoningEffort:row.effort,requestedReasoningEffort:row.requestedEffort,
  reasoningSource:row.effort?'recorded_session':null,routingMode:'per-request',requestClass:row.requestClass,
  toolCalls:row.toolRequests,toolResults:row.toolResults,replayCount:null,inputBytes:null,outputBytes:null,
  errorCode:row.errorType,rejectReason:row.reason,httpStatus:row.httpStatus,continuationMode:row.continuationMode,continuationChanges:row.continuationChanges,
  detailTier:'metadata',detailAvailable:false,usageNote:'Metadata only. Tokens are SDK receipt subtotals; older receipts may normalize missing token fields to zero. Dollar charge is not reported.',
  usage:{metered,sdkApiCalls:row.sdkApiCalls,inputTokens:metered?row.inputTokens:null,outputTokens:metered?row.outputTokens:null,
   cacheReadTokens:metered?row.cacheReadTokens:null,cacheWriteTokens:metered?row.cacheWriteTokens:null,totalNanoAiu:row.totalNanoAiu,
   creditMeteredApiCalls:row.creditReportedCalls,models:row.actualModels.map(model=>({model}))}};
}
export function mergeDashboardHistory(snapshot,claudeState=null,names=()=>null){
 const codex=(snapshot.records||[]).map(row=>identifySession({...row,client:'codex',provider:'github-copilot-sdk'},names));
 const claude=(claudeState?.recent||[]).slice(-1000).map(claudeHistoryRecord).filter(row=>row.id).map(row=>identifySession(row,names));
 const records=[...codex,...claude].sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt)||a.id.localeCompare(b.id));
 const tasks=[...(snapshot.analytics?.taskDaily||[]).map(row=>identifySession({...row,client:'codex'},names)),
  ...(claudeState?.taskDaily||[]).map(row=>identifySession({...row,client:'claude-code'},names))];
 const total={sdkApiCalls:count(snapshot.summary?.sdkApiCalls),inputTokens:count(snapshot.summary?.inputTokens),outputTokens:count(snapshot.summary?.outputTokens)};
 for(const row of claudeState?.usage||[])for(const key of Object.keys(total))total[key]+=count(row[key]);
 return {...snapshot,records,taskCosts:{rows:tasks,claudeMeteringStartedAt:claudeState?.taskMeteringStartedAt||null},unifiedCopilot:total,
  historyCoverage:{codex:codex.length,claude:claude.length,maxPerClient:1000,note:'Merged retained inference calls; separate source ledgers, no duplicate mileage. Native OpenAI helpers remain in Where calls actually go.'}};
}
// Whole-session totals for both clients across every retained Pacific day,
// with the per-day split. Served at /dashboard/api/sessions for querying.
export function sessionTotals(rows=[]){
 const map=new Map(),fields=['completed','failed','sdkApiCalls','inputTokens','outputTokens','cacheReadTokens','totalNanoAiu','creditMeteredApiCalls'];
 for(const row of rows){
  const key=row.client+'|'+row.taskId;
  const total=map.get(key)??{client:row.client,clientLabel:row.clientLabel,taskId:row.taskId,sessionName:row.sessionName,
   ...Object.fromEntries(fields.map(field=>[field,0])),firstDay:row.day,lastDay:row.day,perDay:[]};
  for(const field of fields)total[field]+=count(row[field]);
  if(row.day<total.firstDay)total.firstDay=row.day;if(row.day>total.lastDay)total.lastDay=row.day;
  total.perDay.push({day:row.day,sdkApiCalls:count(row.sdkApiCalls),aiCredits:count(row.creditMeteredApiCalls)>0?count(row.totalNanoAiu)/1e9:null});
  map.set(key,total);
 }
 return [...map.values()].map(({totalNanoAiu,creditMeteredApiCalls,...total})=>({...total,
  aiCredits:creditMeteredApiCalls>0?totalNanoAiu/1e9:null,perDay:total.perDay.sort((a,b)=>a.day.localeCompare(b.day))}))
  .sort((a,b)=>(b.aiCredits??0)-(a.aiCredits??0));
}
