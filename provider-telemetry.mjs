import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import readline from 'node:readline';

export const PROVIDERS=['openai-codex','openai-platform'];
const FIELDS=['inputTokens','outputTokens','cachedInputTokens','reasoningTokens','inputAudioTokens','outputAudioTokens','inputImageTokens','outputImageTokens'];
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:/-]{1,120}$/.test(value)?value:null;
const digest=value=>createHash('sha256').update(value).digest('hex');
const emptyUsage=()=>Object.fromEntries(FIELDS.map(key=>[key,null]));
const sum=(a,b)=>a===null?b:b===null?a:a+b;

export function normalizeProviderUsage(usage) {
  const input=usage?.input_tokens_details || usage?.input_token_details || {};
  const output=usage?.output_tokens_details || usage?.output_token_details || {};
  return {inputTokens:number(usage?.input_tokens),outputTokens:number(usage?.output_tokens),
    cachedInputTokens:number(input.cached_tokens ?? usage?.cached_input_tokens ?? usage?.cache_read_input_tokens),
    reasoningTokens:number(output.reasoning_tokens),inputAudioTokens:number(input.audio_tokens),
    outputAudioTokens:number(output.audio_tokens),inputImageTokens:number(input.image_tokens),outputImageTokens:number(output.image_tokens)};
}

export function featureFailure(error, status) {
  const value=String(error?.code || error?.type || error || '');
  const message=String(error?.message || '');
  if(/insufficient_quota|usage_limit|quota_exceeded|quota_exhausted|billing_hard_limit|usage limit|quota|out of credits/i.test(value+' '+message))return 'quota_exhausted';
  if(status===429 || /rate_limit|rate limit|too many requests/i.test(value+' '+message))return 'rate_limited';
  if(status===401 || status===403 || /unauthorized|authentication|sign.in/i.test(value))return 'authentication_required';
  if(/abort|cancel/i.test(value))return 'cancelled';
  return 'feature_unavailable';
}

export function nativeFeatureError(error) {
  return {ok:false,feature:'native_web_search',provider:'openai-codex',code:featureFailure(error),
    retryable:false,message:'Native OpenAI search is unavailable. No provider fallback or automatic retry was performed. Continue independent work with Copilot; disclose missing search evidence and do not invent results.'};
}

// Separate ledger: never changes existing Copilot mileage or billing. Only
// allowlisted numeric metadata is retained; no prompts, images, keys or audio.
export class ProviderTelemetry {
  constructor({directory,limit=1000,onEvent=()=>{}}={}) {
    this.file=directory?path.join(directory,'provider-telemetry.json'):null;
    this.limit=Math.min(1000,Math.max(1,limit));this.onEvent=onEvent;this.listeners=new Set();
    this.records=[];this.totals={};this.seen=new Map();this.observedLimits={};
    this.since=new Date().toISOString();this.legacyImported=false;this.storageError=null;
    try {if(this.file&&fs.existsSync(this.file)) {
      if(fs.statSync(this.file).size>8*1024*1024)throw new Error('oversize');
      const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.version!==1)throw new Error('schema');
      this.records=(data.records||[]).slice(-this.limit);this.totals=data.totals||{};
      this.since=data.since;this.legacyImported=data.legacyImported;
      this.seen=new Map(data.seen||[]);this.observedLimits=data.observedLimits||{};
      for(const record of this.records)if(['active','submitted'].includes(record.status)){record.status='interrupted';record.completedAt=new Date().toISOString();}
    }} catch {this.storageError='provider_telemetry_unreadable';}
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  emit(record) {if(this.importing)return;const event={type:'provider.activity',at:new Date().toISOString(),record};
    try{this.onEvent(event);}catch{}for(const listener of this.listeners)try{listener(event);}catch{}
  }
  persist(){if(!this.file||this.storageError||this.importing)return;try{
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const value=JSON.stringify({version:1,since:this.since,legacyImported:this.legacyImported,records:this.records,
      totals:this.totals,seen:[...this.seen],observedLimits:this.observedLimits});
    if(Buffer.byteLength(value)>8*1024*1024)throw new Error('bounded ledger exceeded');
    fs.writeFileSync(this.file+'.tmp',value,{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
  }catch{this.storageError='provider_telemetry_write_failed';}}
  total(provider){return this.totals[provider]??=( {calls:0,submitted:0,completed:0,failed:0,limited:0,usageReports:0,...emptyUsage()} );}
  start({provider,kind,model,featureModel,parentId,source='live',at}={}) {
    if(!PROVIDERS.includes(provider))return null;
    const record={id:'provider_'+randomUUID(),provider,kind:identifier(kind)||'unknown',
      model:identifier(model),featureModel:identifier(featureModel),parentId:identifier(parentId),
      source:source==='legacy-log'?'legacy-log':'live',receivedAt:at||new Date().toISOString(),status:'active',
      submitted:false,usage:emptyUsage(),usageReports:0,usageSource:'not_reported',usageComplete:false};
    this.records.push(record);while(this.records.length>this.limit)this.records.shift();
    this.total(provider).calls++;this.emit(record);this.persist();return record;
  }
  submitted(record){if(!record||record.submitted)return;record.submitted=true;record.status='submitted';this.total(record.provider).submitted++;this.emit(record);this.persist();}
  usage(record,usage,{key,model,source='provider_response',complete=true,billable=true}={}) {
    if(!record)return;const normalized=normalizeProviderUsage(usage);
    if(!FIELDS.some(field=>normalized[field]!==null))return;
    const id=digest(record.provider+':'+(key||record.id));
    if(this.seen.has(id))return;
    this.seen.set(id,Date.now());while(this.seen.size>10000)this.seen.delete(this.seen.keys().next().value);
    for(const field of FIELDS){record.usage[field]=sum(record.usage[field],normalized[field]);
      if(billable)this.total(record.provider)[field]=sum(this.total(record.provider)[field],normalized[field]);}
    record.model=identifier(model)||record.model;record.usageReports++;record.usageSource=source;
    record.usageComplete=complete;if(billable)this.total(record.provider).usageReports++;
    this.emit(record);this.persist();
  }
  observeLimit(record,reason,retryAfter,rateLimits) {
    if(!record)return;
    const rates=Array.isArray(rateLimits)?rateLimits.slice(0,8).map(row=>({name:identifier(row.name),limit:number(row.limit),remaining:number(row.remaining),resetSeconds:number(row.reset_seconds)})):undefined;
    this.observedLimits[record.provider]={at:new Date().toISOString(),kind:record.kind,model:record.model,
      state:['quota_exhausted','rate_limited'].includes(reason)?reason:'observed',retryAfterSeconds:number(retryAfter),...(rates?{rates}:{})};
    this.persist();
  }
  finish(record,{status='completed',error,statusCode,at}={}) {
    if(!record||record.completedAt)return;
    record.completedAt=at||new Date().toISOString();record.latencyMs=Math.max(0,Date.parse(record.completedAt)-Date.parse(record.receivedAt));
    const failure=error?featureFailure(error,statusCode):null;
    record.status=failure==='quota_exhausted'||failure==='rate_limited'?'limited':status;
    record.errorCode=failure;record.statusCode=Number.isInteger(statusCode)?statusCode:null;
    this.total(record.provider)[record.status==='completed'?'completed':'failed']++;
    if(record.status==='limited'){this.total(record.provider).limited++;this.observeLimit(record,failure);}
    this.emit(record);this.persist();
  }
  snapshot(){return {since:this.since,legacyImported:this.legacyImported,storageError:this.storageError,
    maxRecords:this.limit,totals:this.totals,records:[...this.records].reverse(),observedLimits:this.observedLimits,
    storageBytes:this.storageBytes()};}
  storageBytes(){try{return this.file?fs.statSync(this.file).size:0;}catch{return 0;}}
  async importLegacy(file) {
    if(this.legacyImported||this.storageError||!file||!fs.existsSync(file))return;
    const pending=new Map();const events=[];
    this.importing=true;
    try{const lines=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
      for await(const line of lines){if(line.length>65536||!line.includes('native_tool.'))continue;
        try{const event=JSON.parse(line);if(['native_tool.started','native_tool.completed','native_tool.failed'].includes(event.type)&&['image','search'].includes(event.kind)){events.push(event);if(events.length>3000)events.shift();}}catch{}}
      for(const event of events){
        if(event.type==='native_tool.started'){const list=pending.get(event.kind)||[];list.push(event);pending.set(event.kind,list);continue;}
        const start=pending.get(event.kind)?.shift();
        const record=this.start({provider:'openai-codex',kind:event.kind,featureModel:event.model,source:'legacy-log',at:start?.timestamp||event.timestamp,parentId:start?.responseId});
        if(event.type==='native_tool.completed')this.submitted(record);
        this.usage(record,event.usage,{key:'legacy:'+event.timestamp+':'+event.kind,source:'legacy_helper_turn',complete:event.kind!=='image'});
        this.finish(record,{status:event.type==='native_tool.completed'?'completed':'failed',error:event.code,at:event.timestamp});
      }
      this.legacyImported=true;
    }catch{this.storageError='provider_legacy_import_failed';}finally{this.importing=false;this.persist();}
  }
}
