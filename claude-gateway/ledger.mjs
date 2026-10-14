import {existsSync, readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from './protocol.mjs';
import {sessionHash,recordSessionCost} from './session-costs.mjs';
import {observeBrowserCatalog,observeBrowserSignal} from './browser-telemetry.mjs';
import {UsageReceipts} from '../usage-receipts.mjs';

// Metadata only: never persist prompts, tool arguments/results, tokens used to
// authenticate, paths, GitHub login names, or raw SDK errors.
export class Ledger {
  constructor(file = null) {
    this.receipts=new UsageReceipts();
    this.file = file; this.state = {received:0,completed:0,failed:0,usage:[],recent:[],taskDaily:[],taskMeteringStartedAt:new Date().toISOString(),transport:{attempts:0,httpResponses:0,httpErrors:0,networkErrors:0}};
    if (file && existsSync(file)) {
      if (readFileSync(file).length > 4 * 1024 * 1024) throw new Error('Isolated telemetry file exceeds its bounded size.');
      this.state = JSON.parse(readFileSync(file,'utf8'));
      if(!Array.isArray(this.state.taskDaily)){
        this.state.taskDaily=[];this.state.taskMeteringStartedAt=new Date().toISOString();
        for(const row of this.state.recent??[])if(row.status!=='active')recordSessionCost(this.state,row,{legacy:true});
      }
      this.state.transport??={attempts:0,httpResponses:0,httpErrors:0,networkErrors:0};
      for(const row of this.state.recent)if(row.status==='active')this.finish(row,'interrupted');
      // A very old unfinished row may already have left the 1000-row index.
      this.state.failed+=Math.max(0,this.state.received-this.state.completed-this.state.failed);
      this.save();
    }
  }
  start(body, headers, selected) {
    const row = {id:'req_' + randomUUID(),at:new Date().toISOString(),client:'claude-code',
      provider:'github-copilot-sdk',requestedModel:typeof body?.model==='string'&&/^[\w.-]{1,100}$/.test(body.model)?body.model:null,
      selectedModel:selected?.model?.id??null,effort:selected?.effort ?? null,
      requestClass:['main','subagent','workflow','compaction','auxiliary'].includes(headers['x-claude-code-request-class'])?headers['x-claude-code-request-class']:null,
      session:sessionHash(headers,body),
      agent:headers['x-claude-code-agent-id'] ? digest(headers['x-claude-code-agent-id']).slice(0,16) : null,
      status:'active',toolRequests:0,toolResults:0,sdkApiCalls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,
      totalNanoAiu:null,creditReportedCalls:0,actualModels:[],sdkTransportAttempts:0,sdkTransportResponses:0,sdkTransportErrors:0};
    this.state.received++; this.state.recent.push(row); this.state.recent = this.state.recent.slice(-1000); this.save();
    this.onChange?.('received',row);
    return row;
  }
  reject(body,headers,error){
    this.failure(this.start(body,headers,null),error,'rejected');
  }
  select(row,body,selected){
    if(!row||row.status!=='active')return;
    row.requestedModel=typeof body?.model==='string'&&/^[\w.-]{1,100}$/.test(body.model)?body.model:null;
    row.session??=sessionHash({},body);
    row.requestedEffort=['none','low','medium','high','xhigh','max'].includes(body?.output_config?.effort)?body.output_config.effort:null;
    row.selectedModel=selected?.model?.id??null;row.effort=selected?.effort??null;
    if(selected)observeBrowserCatalog(row,selected.tools);
    this.save();
    if(selected)this.onChange?.('selected',row);
  }
  failure(row,error,status='failed',partialOutput=false){
    // Pending tools may expire after their HTTP turn completed. Its receipt is
    // final: dispose the session without adding failure metadata to that row.
    if(!row||row.status!=='active')return;
    row.errorType=typeof error.type==='string'&&/^[a-z_]{1,64}$/.test(error.type)?error.type:'api_error';
    if(['relay_session_capacity','claude_history_prefix_mismatch','claude_context_budget'].includes(error.code))row.errorCode=error.code;
    row.httpStatus=Number.isInteger(error.statusCode)&&error.statusCode>=400&&error.statusCode<=599?error.statusCode:502;
    row.partialOutput=Boolean(partialOutput);this.finish(row,status);
  }
  transport(row,event){
    if(!row)return;
    if(event.type==='relay_transport_attempt'){row.sdkTransportAttempts++;this.state.transport.attempts++;}
    if(event.type==='relay_transport_response'){
      row.sdkTransportResponses++;this.state.transport.httpResponses++;row.lastUpstreamStatus=event.status;
      if(event.status>=400){row.sdkTransportErrors++;this.state.transport.httpErrors++;}
    }
    if(event.type==='relay_transport_error'){row.sdkTransportErrors++;this.state.transport.networkErrors++;}
    this.save();
    if(event.type==='relay_transport_attempt')this.onChange?.('forwarded',row);
  }
  toolSignal(row, type, details={}) {
    // Counts/categories only; never persist tool names, arguments or results.
    // Observability must not interrupt an otherwise valid client handoff.
    if(!row||row.status!=='active'||!['tool_requested','tool_resolved'].includes(type))return;
    const key=type==='tool_requested'?'toolRequests':'toolResults';
    row[key]=(row[key]??0)+1;
    observeBrowserSignal(row,type,details);
    try{this.onChange?.(type,row);}catch{}
    // Persist with the next normal usage/final receipt, not another write per tool.
  }
  usage(row, value, event={}) {
    if(!row||!this.receipts.accept(value,event))return false;
    const previous=row.status==='active'?null:{...row};
    const number = key => Number.isFinite(value[key]) ? Math.max(0,value[key]) : 0;
    row.sdkApiCalls++;
    for (const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']) row[key] += number(key);
    const model=typeof value.model==='string'&&/^[\w.-]{1,100}$/.test(value.model)?value.model:'unreported';
    if(!row.actualModels.includes(model)&&row.actualModels.length<16)row.actualModels.push(model);
    const credits = value.copilotUsage?.totalNanoAiu;
    if (Number.isFinite(credits)){row.totalNanoAiu = (row.totalNanoAiu ?? 0) + Math.max(0,credits);row.creditReportedCalls=(row.creditReportedCalls??0)+1;}
    const bucket=this.state.usage.some(item=>item.model===model)||this.state.usage.length<128?model:'other-sdk-models';
    const total = this.state.usage.find(item => item.model === bucket) ?? {model:bucket,
      sdkApiCalls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,totalNanoAiu:null,creditReportedCalls:0};
    if (!this.state.usage.includes(total)) this.state.usage.push(total);
    total.sdkApiCalls++; for (const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']) total[key] += number(key);
    if (Number.isFinite(credits)){total.totalNanoAiu = (total.totalNanoAiu ?? 0) + Math.max(0,credits);total.creditReportedCalls=(total.creditReportedCalls??0)+1;}
    if(previous)recordSessionCost(this.state,row,{previous});
    this.save();
    this.onChange?.('usage',row);
    return true;
  }
  finish(row, status) {
    if (!row || row.status !== 'active') return;
    row.status = status; row.completedAt=new Date().toISOString();row.durationMs = Date.now()-Date.parse(row.at);
    recordSessionCost(this.state,row);
    this.state[status === 'completed' ? 'completed' : 'failed']++; this.save();
    this.onChange?.(status,row);
  }
  save() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file),{recursive:true});
    const text=JSON.stringify(this.state);
    if(Buffer.byteLength(text)>4*1024*1024)throw new Error('Metadata ledger exceeds its hard 4 MiB storage guard.');
    writeFileSync(this.file+'.tmp',text,{mode:0o600}); renameSync(this.file+'.tmp',this.file);
  }
}
