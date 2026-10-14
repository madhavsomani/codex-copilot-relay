import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export class SessionLease {
  constructor(client){this.id='lease_'+randomUUID();this.client=client;this.revision=0;this.createdAt=Date.now();}
  set(state,timeoutMs){
    if(state!==this.state){this.revision++;this.waitingSince=state==='waiting-for-tools'?Date.now():null;}
    this.state=state;this.lastActivityAt=Date.now();this.expiresAt=this.lastActivityAt+timeoutMs;
  }
  view({model=null,taskId=null,pendingTools=0}={}){
    const now=Date.now();
    return {id:this.id,client:this.client,revision:this.revision,state:this.state,model,taskId,
      ageMs:Math.max(0,now-this.createdAt),idleMs:Math.max(0,now-this.lastActivityAt),
      waitingMs:this.waitingSince?Math.max(0,now-this.waitingSince):0,
      expiresAt:new Date(this.expiresAt).toISOString(),pendingTools};
  }
}

// Local-user file control only; no browser POST endpoint, bulk cancellation or
// age-based eviction. A stale screen/command cannot cancel a resumed tool turn.
export function createSessionControl({directory,instanceId,entries,onResult=()=>{}}){
  const file=path.join(directory,'relay-session-cancel.json');
  let checking=false;
  return {snapshot:()=>({control:'local-session-file-v1',sessions:entries().map(entry=>entry.view)}),async check(){
    if(checking)return;checking=true;
    try{
      const dir=fs.lstatSync(directory),stat=fs.lstatSync(file);
      if(!dir.isDirectory()||dir.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)return;
      const raw=fs.readFileSync(file,'utf8'),command=JSON.parse(raw);
      if(command.instanceId!==instanceId||!/^lease_[a-f0-9-]{36}$/.test(command.id??'')||!Number.isInteger(command.revision))return;
      if(fs.readFileSync(file,'utf8')!==raw)return;
      fs.unlinkSync(file);
      const entry=entries().find(entry=>entry.view.id===command.id);
      if(!entry||entry.view.revision!==command.revision||entry.view.state!=='waiting-for-tools'||!entry.canCancel()){
        onResult('refused',command.id);return 'refused';
      }
      // Claim synchronously before cleanup's first await and any new admission.
      const cleanup=entry.cancel();await cleanup;
      onResult('cancelled',command.id);return 'cancelled';
    }catch(error){if(error.code!=='ENOENT')onResult('control-error',null);return 'unavailable';}
    finally{checking=false;}
  }};
}
