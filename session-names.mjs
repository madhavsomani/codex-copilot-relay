import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {digest} from './claude-gateway/protocol.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const title=value=>typeof value==='string'&&value.trim()?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,180):null;
// Read local title indexes only, never conversation bodies, credentials or DBs.
// Titles stay in memory and in the loopback dashboard, not telemetry/Git.
export function createSessionNames({codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),claudeHome=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),now=Date.now,ttl=30000}={}){
 let cache=new Map(),expires=0,budget=0;
 function read(file,max=262144){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max||budget+stat.size>4*1024*1024)return null;budget+=stat.size;return fs.readFileSync(file,'utf8');}catch{return null;}}
 function dirs(root,limit){const result=[];try{const dir=fs.opendirSync(root);try{for(let i=0;i<4096;i++){const entry=dir.readSync();if(!entry)break;if(entry.isDirectory()&&!entry.isSymbolicLink())result.push(entry.name);if(result.length>=limit)break;}}finally{dir.closeSync();}}catch{}return result;}
 function put(client,id,value){const name=title(value);if(uuid.test(id||'')&&name)cache.set(client+':'+(client==='claude-code'?digest(id).slice(0,16):id),name);}
 return (client,id)=>{
  if(now()>=expires){expires=now()+ttl;cache=new Map();budget=0;
   const text=read(path.join(codexHome,'session_index.jsonl'),2*1024*1024);
   for(const line of (text||'').split('\n').slice(-10000)){try{const row=JSON.parse(line);put('codex',row.id,row.thread_name);}catch{}}
   let remaining=1024;
   for(const project of dirs(path.join(claudeHome,'projects'),128)){
    const root=path.join(claudeHome,'projects',project);
    try{const index=JSON.parse(read(path.join(root,'sessions-index.json'))||'null');for(const row of (index?.entries||[]).slice(0,1024))put('claude-code',row.sessionId,row.customTitle||row.summary);}catch{}
    for(const id of dirs(root,remaining)){if(!uuid.test(id))continue;remaining--;try{put('claude-code',id,JSON.parse(read(path.join(root,id,'custom-title.json'),4096)||'null')?.customTitle);}catch{}}
    if(remaining<=0)break;
   }
  }
  return cache.get(client+':'+id)||null;
 };
}
