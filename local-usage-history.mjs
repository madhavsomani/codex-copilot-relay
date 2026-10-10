import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

const MiB=1024*1024,maxSources=32,maxReadBytes=32*MiB;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
const count=(value,key,required=false)=>{
  if(value?.[key]===undefined||value?.[key]===null){if(required)throw new Error('schema');return null;}
  if(!numeric(value[key])||!Number.isInteger(value[key]))throw new Error('schema');return value[key];
};
const model=value=>typeof value==='string'&&/^(?:gpt-|claude-)[a-z0-9.-]{1,94}$/.test(value)?value:'unreported';
const stamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const sum=(left,right)=>{const value=left===null?right:right===null?left:left+right;
  if(value!==null&&!numeric(value))throw new Error('numeric-bound');return value;};
const reporting=(reported,total)=>!reported?'unreported':reported<total?'partial':'reported';
const usageReporting=receipts=>receipts>0?'receipt-subtotal':'unreported';
function creditFields(value,receipts,key){
  const reported=count(value,key)??0,nano=count(value,'totalNanoAiu');
  if(reported>receipts||reported>0&&nano===null)throw new Error('schema');
  return {creditReportedCalls:reported,aiCredits:reported? nano/1e9:null,creditReporting:reporting(reported,receipts)};
}
function usageFields(value,creditKey){
  const receipts=count(value,'sdkApiCalls',true);
  return {usageReportedCalls:receipts,sdkApiCalls:receipts,
    ...Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].map(key=>[key,receipts?count(value,key):null])),
    ...creditFields(value,receipts,creditKey)};
}
function requestFields(value,received='received'){
  const result={received:count(value,received,true),completed:count(value,'completed',true),failed:count(value,'failed',true)};
  if(result.completed+result.failed>result.received)throw new Error('schema');
  return {...result,unfinishedRecorded:result.received-result.completed-result.failed};
}
function copilotProjection(data,source){
  if(![1,2].includes(data?.version)||!object(data.lifetime))throw new Error('schema');
  const fields=data.version===2?usageFields(data.lifetime,'creditMeteredApiCalls'):
    {sdkApiCalls:0,usageReportedCalls:0,inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,
      creditReportedCalls:0,aiCredits:null,creditReporting:'unreported'};
  const entries=object(data.models)?Object.entries(data.models):[];if(entries.length>128)throw new Error('schema');
  const reportedModels=entries.filter(([,row])=>row?.sdkApiCalls>0);
  const models=data.version===2?reportedModels.slice(0,16)
    .map(([id,row])=>({model:model(id),...usageFields(row,'creditMeteredApiCalls')})):[];
  const metered=count(data.lifetime,'meteredCalls'),unmetered=count(data.lifetime,'unmeteredCalls');
  if(metered!==null&&unmetered!==null&&metered+unmetered>data.lifetime.completed+data.lifetime.failed)throw new Error('schema');
  return [{...source,status:'available',provider:'github-copilot-sdk',lastUpdatedAt:stamp(data.updatedAt),
    ...requestFields(data.lifetime),...fields,usageReporting:usageReporting(fields.usageReportedCalls),
    meteredRequestOutcomes:metered,unmeteredRequestOutcomes:unmetered,
    modelAttribution:'SDK usage or selected-model fallback',models,modelsTruncated:reportedModels.length>16}];
}
function claudeProjection(data,source){
  if(!object(data)||!Array.isArray(data.usage)||data.usage.length>129||!Array.isArray(data.recent)||data.recent.length>1000)throw new Error('schema');
  const models=data.usage.map(row=>({model:model(row?.model),...usageFields(row,'creditReportedCalls')}));
  const totals=combineUsage(models);
  const last= data.recent.map(row=>stamp(row?.at)).filter(Boolean).sort().at(-1)??null;
  return [{...source,status:'available',provider:'github-copilot-sdk',lastUpdatedAt:last,...requestFields(data),...totals,
    usageReporting:usageReporting(totals.usageReportedCalls),meteredRequestOutcomes:null,unmeteredRequestOutcomes:null,
    modelAttribution:'SDK usage receipts',models:models.slice(0,16),modelsTruncated:models.length>16}];
}
function providerProjection(data,source){
  if(data?.version!==1||!object(data.totals))throw new Error('schema');
  return ['openai-codex','openai-platform'].filter(provider=>own(data.totals,provider)).map(provider=>{
    const value=data.totals[provider],requests=requestFields(value,'calls'),reports=count(value,'usageReports',true);
    return {...source,id:source.id+':'+provider,status:'available',provider,lastUpdatedAt:null,...requests,
      submitted:count(value,'submitted',true),sdkApiCalls:null,usageReportedCalls:reports,
      inputTokens:reports?count(value,'inputTokens'):null,outputTokens:reports?count(value,'outputTokens'):null,
      cacheReadTokens:reports?count(value,'cachedInputTokens'):null,cacheWriteTokens:null,
      creditReportedCalls:0,aiCredits:null,creditReporting:'not-applicable',usageReporting:usageReporting(reports),
      meteredRequestOutcomes:null,unmeteredRequestOutcomes:null,
      modelAttribution:'Separate provider ledger; not Copilot',models:[],modelsTruncated:false};
  });
}
function combineUsage(rows){
  const fields=['sdkApiCalls','usageReportedCalls','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','creditReportedCalls','aiCredits'];
  const result=Object.fromEntries(fields.map(key=>[key,null]));
  for(const row of rows)for(const key of fields)result[key]=sum(result[key],row[key]??null);
  result.usageReportedCalls??=0;result.creditReportedCalls??=0;
  result.creditReporting=reporting(result.creditReportedCalls,result.sdkApiCalls);
  return result;
}
async function checkedDirectory(directory){
  const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe-path');
  return directory;
}
const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
async function checkedChain(root,directory){
  const relative=path.relative(root,directory);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('unsafe-path');
  let current=root;await checkedDirectory(current);
  const rootReal=await fs.realpath(root);
  for(const name of relative.split(path.sep).filter(Boolean)){
    current=path.join(current,name);await checkedDirectory(current);
    if(!samePath(await fs.realpath(current),path.join(rootReal,path.relative(root,current))))throw new Error('unsafe-path');
  }
  return fs.lstat(directory);
}
async function readJson(root,file,limit,budget){
  let handle;
  try{
    const directory=path.dirname(file),before=await checkedChain(root,directory);
    const info=await fs.lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('unsafe-file');
    handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=await handle.stat();
    if(!opened.isFile()||opened.nlink!==1||opened.ino!==info.ino||opened.dev!==info.dev)throw new Error('unsafe-file');
    if(opened.size>limit||opened.size+1>budget.remaining)throw new Error('read-bound');
    budget.remaining-=opened.size+1;
    const buffer=Buffer.alloc(opened.size+1);let used=0;
    while(used<buffer.length){const chunk=await handle.read(buffer,used,buffer.length-used,null);if(!chunk.bytesRead)break;used+=chunk.bytesRead;}
    const after=await checkedChain(root,directory),finished=await handle.stat();
    if(used!==opened.size||finished.size!==opened.size||finished.mtimeMs!==opened.mtimeMs||finished.ctimeMs!==opened.ctimeMs||
      before.ino!==after.ino||before.dev!==after.dev)throw new Error('changed-file');
    return JSON.parse(buffer.subarray(0,used).toString('utf8'));
  }finally{await handle?.close();}
}
async function portDirectories(root,directory,scan){
  let stream;const result=[];let visited=0;
  try{await checkedChain(root,directory);stream=await fs.opendir(directory);}catch(error){if(error.code!=='ENOENT')scan.unavailable=true;return [];}
  try{for await(const entry of stream){
    if(++visited>128){scan.truncated=true;break;}
    if(!/^\d{4,5}$/.test(entry.name)||Number(entry.name)>65535||Number(entry.name)<1024||String(Number(entry.name))!==entry.name)continue;
    if(!entry.isDirectory()||entry.isSymbolicLink()) {scan.unavailable=true;continue;}
    result.push({directory:path.join(directory,entry.name),port:Number(entry.name)});
  }}catch{scan.unavailable=true;}
  return result.sort((a,b)=>a.port-b.port);
}

// Project fixed metadata files only. No SDK/ledger constructors, credentials,
// full histories, automatic recovery writes, or network requests are used.
export async function readLocalUsageHistory({root,now=Date.now,runtimeDirectory}={}){
  const sampledAt=new Date(now()).toISOString(),scan={truncated:false,unavailable:false};
  const view={sampledAt,scanStatus:'available',scope:'This checkout canonical local ledgers only; imports or copied histories may overlap. Not account-wide usage.',
    automaticFallback:false,sources:[],providers:[],truncated:false,omittedSources:0};
  const trustedRoot=path.resolve(root),runtime=runtimeDirectory?path.resolve(runtimeDirectory):path.join(trustedRoot,'runtime');
  try{await checkedChain(trustedRoot,runtime);}catch(error){view.scanStatus=error.code==='ENOENT'?'empty':'unavailable';return view;}
  const candidates=[{id:runtimeDirectory?'unified-codex':'codex-desktop',client:runtimeDirectory?'codex-cli':'codex-desktop',port:null,directory:runtime,kind:'codex'}];
  if(!runtimeDirectory){
    candidates.push({id:'desktop-claude',client:'claude-code',port:null,directory:path.join(runtime,'claude'),kind:'claude'});
    for(const value of await portDirectories(trustedRoot,path.join(runtime,'unified'),scan)){
      candidates.push({id:'preview-codex:'+value.port,client:'codex-cli',...value,kind:'codex'});
      candidates.push({id:'preview-claude:'+value.port,client:'claude-code',port:value.port,directory:path.join(value.directory,'claude'),kind:'claude'});
    }
  }
  if(runtimeDirectory){
    view.scope='This combined gateway ledger only. Older desktop/preview histories remain separate and unchanged.';
    candidates.push({id:'unified-claude',client:'claude-code',port:null,directory:path.join(runtime,'claude'),kind:'claude'});
  }
  const codexBase=path.join(runtime,'codex-cli'),claudeBase=path.join(runtime,'claude-preview');
  for(const [base,client,kind] of runtimeDirectory?[]:[[codexBase,'codex-cli','codex'],[claudeBase,'claude-code','claude']]){
    try{await checkedChain(trustedRoot,base);}catch(error){if(error.code!=='ENOENT')scan.unavailable=true;continue;}
    if(kind==='claude')candidates.push({id:'claude-code:4246',client,port:4246,directory:base,kind});
    for(const value of await portDirectories(trustedRoot,path.join(base,'ports'),scan))
      candidates.push({id:client+':'+value.port,client,...value,kind});
  }
  const budget={remaining:maxReadBytes};
  for(const candidate of candidates){
    if(view.sources.length>=maxSources){scan.truncated=true;view.omittedSources++;continue;}
    const {directory,kind,...identity}=candidate,source={...identity,liveness:'not-verified',evidence:'Saved local ledger; not a live connection'};
    for(const spec of kind==='claude'?[['ledger.json',4*MiB,claudeProjection]]:
      [['proxy-metrics.json',16*MiB,copilotProjection],['provider-telemetry.json',8*MiB,providerProjection]]){
      if(view.sources.length>=maxSources){scan.truncated=true;view.omittedSources++;break;}
      try{const data=await readJson(trustedRoot,path.join(directory,spec[0]),spec[1],budget);
        const rows=spec[2](data,source),remaining=maxSources-view.sources.length;
        if(rows.length>remaining){scan.truncated=true;view.omittedSources+=rows.length-remaining;}
        view.sources.push(...rows.slice(0,remaining));
      }catch(error){if(error.code==='ENOENT')continue;if(error.message==='read-bound')scan.truncated=true;
        view.sources.push({...source,id:source.id+':'+spec[0],status:'unavailable',provider:null});scan.unavailable=true;}
    }
  }
  for(const provider of ['github-copilot-sdk','openai-codex','openai-platform']){
    const rows=view.sources.filter(row=>row.status==='available'&&row.provider===provider);if(!rows.length)continue;
    const totals=combineUsage(rows);
    view.providers.push({provider,sourceCount:rows.length,received:rows.reduce((total,row)=>sum(total,row.received),0),
      completed:rows.reduce((total,row)=>sum(total,row.completed),0),failed:rows.reduce((total,row)=>sum(total,row.failed),0),...totals,
      creditReporting:provider==='github-copilot-sdk'?totals.creditReporting:'not-applicable',
      usageReporting:usageReporting(totals.usageReportedCalls)});
  }
  view.truncated=scan.truncated;view.scanStatus=scan.unavailable||scan.truncated?'partial':view.sources.length?'available':'empty';
  if(Buffer.byteLength(JSON.stringify(view))>256*1024)throw new Error('Projected metadata exceeded its response bound.');
  return view;
}
export function createLocalUsageReader(options){
  let pending,cached,expires=0;const now=options.now??Date.now;
  return async()=>{
    if(pending)return pending;if(cached&&now()<expires)return cached;
    pending=readLocalUsageHistory({...options,now}).then(value=>{cached=value;expires=now()+10000;return value;}).finally(()=>{pending=null;});
    return pending;
  };
}
