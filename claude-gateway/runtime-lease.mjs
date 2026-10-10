import {mkdirSync,openSync,writeFileSync,closeSync,readFileSync,unlinkSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const defaultRoot=path.resolve(fileURLToPath(new URL('../runtime/claude-preview/',import.meta.url)));

export function defaultRuntimeDirectory(port){
  if(!Number.isInteger(port)||port<1024||port>65535||port===4144)throw new Error('A stable isolated port or an explicit runtime directory is required.');
  // Keep previously recorded default-port mileage in place; other ports must
  // never load/recover that ledger while its gateway is still writing it.
  return port===4246?defaultRoot:path.join(defaultRoot,'ports',String(port));
}
export function acquireRuntimeLease(directory){
  mkdirSync(directory,{recursive:true});
  const root=realpathSync(directory),file=path.join(root,'gateway.owner.json');
  const metadata=JSON.stringify({version:1,pid:process.pid,owner:randomUUID(),at:new Date().toISOString()});
  let descriptor;
  try{descriptor=openSync(file,'wx',0o600);}
  catch(error){
    if(error.code==='EEXIST')throw Object.assign(new Error('Claude runtime directory is already owned. Close its gateway first or choose a different port/runtime directory. After a crash, inspect gateway.owner.json and confirm every writer is stopped before manually removing only that ownership file; existing ledger history must be kept.'),{code:'claude_runtime_owned'});
    throw error;
  }
  try{writeFileSync(descriptor,metadata);}
  catch(error){closeSync(descriptor);unlinkSync(file);throw error;}
  closeSync(descriptor);
  let released=false;
  return {directory:root,release(){
    if(released)return;released=true;
    // Never reclaim an uncertain owner automatically (PID reuse, live writers,
    // stale-file races). Graceful shutdown removes only our own exact receipt.
    try{if(readFileSync(file,'utf8')===metadata)unlinkSync(file);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }};
}
