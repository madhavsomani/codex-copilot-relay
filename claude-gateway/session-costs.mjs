import {digest} from './protocol.mjs';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
export const pacificSessionDay=value=>Number.isFinite(Date.parse(value))?dayFormat.format(new Date(value)):null;
const count=value=>Number.isFinite(value)&&value>=0?value:0;
const completedRollups=new WeakMap();
export function sessionHash(headers={},body){
 const value=headers['x-claude-code-session-id'];
 if(typeof value==='string'&&value.length>0&&value.length<=256)return digest(value).slice(0,16);
 // Stock clients can supply structured user metadata. Retain only the hash
 // of a validated UUID, never the user/account/device identity or raw metadata.
 try{const raw=body?.metadata?.user_id;const data=typeof raw==='string'&&raw.length<=4096?JSON.parse(raw):null;
  if(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data?.session_id||''))return digest(data.session_id).slice(0,16);
 }catch{}return null;
}
export function recordSessionCost(state,row,{legacy=false,previous=null}={}){
 const day=pacificSessionDay(row.completedAt||row.at);if(!day)return;
 state.taskDaily??=[];
 const taskId=/^[a-f0-9]{16}$/.test(row.session||'')?row.session:'unattributed';
 // Bounded daily mileage is independent of the recent-request ring.
 const key=state.taskDaily.some(r=>r.day===day&&r.taskId===taskId)||state.taskDaily.length<2048?taskId:'unattributed';
 let target=previous?completedRollups.get(row):state.taskDaily.find(r=>r.day===day&&r.taskId===key);
 // Late receipts retain their original overflow bucket and completion day.
 // Lifetime receipts still update after a daily bucket ages out; never recreate
 // an expired bucket with negative unmetered counts or fabricate task coverage.
 if(previous&&(!target||!state.taskDaily.includes(target)))return;
 if(!target){target={day,taskId:key,completed:0,failed:0,sdkApiCalls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,totalNanoAiu:0,creditMeteredApiCalls:0,meteredCalls:0,unmeteredCalls:0};state.taskDaily.push(target);}
 if(!previous)completedRollups.set(row,target);
 if(!previous)target[row.status==='completed'?'completed':'failed']++;
 target[row.sdkApiCalls>0?'meteredCalls':'unmeteredCalls']++;
 if(previous)target[previous.sdkApiCalls>0?'meteredCalls':'unmeteredCalls']--;
 for(const field of ['sdkApiCalls','inputTokens','outputTokens','cacheReadTokens','totalNanoAiu'])target[field]+=count(row[field])-count(previous?.[field]);
 target.creditMeteredApiCalls+=count(row.creditReportedCalls)-count(previous?.creditReportedCalls);
 if(legacy)target.retainedHistoryOnly=true;
 if(key!==taskId)target.attributionOverflow=true;
 const days=[...new Set(state.taskDaily.map(r=>r.day))].sort().slice(-31);state.taskDaily=state.taskDaily.filter(r=>days.includes(r.day));
}
