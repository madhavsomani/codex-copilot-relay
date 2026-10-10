// Local filesystem control, not a browser/network admin endpoint. A command
// targets one random process incarnation and only takes effect when work drains.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function createRelayStopControl({directory,active,stop}){
  const file=path.join(directory,'relay-stop.json'),instanceId=randomUUID();
  let stopping=false;
  return {instanceId,get stopping(){return stopping;},check(){
    if(stopping)return;
    try{
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)return;
      const raw=fs.readFileSync(file,'utf8'),command=JSON.parse(raw);
      if(command.instanceId!==instanceId||active()!==0)return;
      if(fs.readFileSync(file,'utf8')!==raw)return;
      fs.unlinkSync(file);
      // Synchronous state change before stop(): request admission cannot race it.
      stopping=true;stop();
    }catch{/* Missing, malformed or concurrently replaced commands fail closed. */}
  }};
}
