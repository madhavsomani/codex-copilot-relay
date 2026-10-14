import {createHash} from 'node:crypto';

const key=(kind,value)=>typeof value==='string'&&value.length>0&&value.length<=256
  ?createHash('sha256').update(kind+'\0'+value).digest('hex'):null;
// Bounded process-local identities, never token-total deduplication. No raw
// provider/event IDs are serialized into telemetry. Missing identity is unknown.
export class UsageReceipts {
  constructor(limit=4096){this.limit=limit;this.seen=new Set();}
  accept(value,event={}){
    if(!value||typeof value!=='object')return false;
    const ids=[key('call:'+value.model,value.apiCallId),key('event',event.id)].filter(Boolean);
    const duplicate=ids.some(id=>this.seen.has(id));
    for(const id of ids)this.seen.add(id);
    while(this.seen.size>this.limit)this.seen.delete(this.seen.values().next().value);
    return !duplicate;
  }
}
// Provider completion identity binds late receipts to the HTTP turn which
// produced them, even after the next tool-result request has attached.
export class UsageOwners {
  constructor(limit=16){this.limit=limit;this.owners=new Map();}
  bind(value,owner){
    const id=key('call',value?.apiCallId);
    if(!id||!owner||this.owners.has(id))return;
    this.owners.set(id,owner);
    while(this.owners.size>this.limit)this.owners.delete(this.owners.keys().next().value);
  }
  get(value,fallback){return this.owners.get(key('call',value?.apiCallId))??fallback;}
}
