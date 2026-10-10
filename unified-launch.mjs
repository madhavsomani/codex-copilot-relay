import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {codexServerEnvironment} from './codex-gateway/launch.mjs';
import {acquireRuntimeLease} from './claude-gateway/runtime-lease.mjs';
import {publicGatewayEvent} from './unified-events.mjs';
export {publicGatewayEvent} from './unified-events.mjs';

const sourceRoot=fileURLToPath(new URL('./',import.meta.url));
const fail=message=>Object.assign(new Error(message),{publicMessage:message});
export function parseUnifiedArguments(args){
  const config={port:4265,open:false,check:false},seen=new Set();
  for(let index=0;index<args.length;index++){
    const flag=args[index];if(seen.has(flag))throw fail('Repeated combined gateway option.');seen.add(flag);
    if(flag==='--open'){config.open=true;continue;}
    if(flag==='--check'){config.check=true;continue;}
    if(flag!=='--port'||!/^\d+$/.test(args[index+1]??''))throw fail('Use gateway [--port 4265] [--open] [--check].');
    config.port=Number(args[++index]);
  }
  if(config.port<1024||config.port>65535||[4144,4246,4261,4263].includes(config.port))
    throw fail('Choose a free isolated port; existing Codex/Claude preview ports are reserved.');
  if(config.check&&config.open)throw fail('--check does not open a browser.');
  return config;
}
async function available(port){
  const probe=net.createServer();await new Promise((resolve,reject)=>{
    probe.once('error',()=>reject(fail('Combined gateway port is occupied; no existing process was adopted or stopped.')));
    probe.listen(port,'127.0.0.1',()=>probe.close(resolve));
  });
}
export async function launch(args=[],options={}){
  const config=parseUnifiedArguments(args),root=options.root??sourceRoot,signals=options.signals??process;
  const log=options.log??console.log,reveal=options.reveal??console.log;
  await available(config.port);
  const directory=path.join(root,'runtime','unified',String(config.port));
  let lease;
  try{lease=acquireRuntimeLease(directory);}catch(error){
    if(error.code==='claude_runtime_owned')throw Object.assign(fail(
      'Combined gateway ownership remains from an earlier launch. Do not delete its history. '+
      `If it has stopped, run .\\Start-Copilot-Gateway.ps1 -Port ${config.port} -RecoverStopped; `+
      'recovery verifies stopped owners before archiving lock files. Use quit for normal shutdown.'),{code:error.code});
    throw error;
  }
  const codexKey=randomBytes(32).toString('hex'),claudeKey=randomBytes(32).toString('hex');
  let child,terminal,exited,initialized=false,interrupted=false,resolveStop,buffer='',failure;
  const completion=new Promise(resolve=>{resolveStop=resolve;});
  const interrupt=()=>{interrupted=true;resolveStop();};
  signals.on('SIGINT',interrupt);signals.on('SIGTERM',interrupt);
  try{
    const env=codexServerEnvironment({port:config.port,model:'gpt-6.1-sol',runtimeDirectory:directory,cwd:process.cwd(),token:codexKey},options.environment??process.env);
    env.BRIDGE_CLAUDE_TOKEN=claudeKey;
    child=spawn(process.execPath,[options.serverEntry??path.join(root,'codex-gateway','server-child.mjs')],
      {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    child.on('message',message=>{
      if(message?.type==='initialized')initialized=true;
      if(message?.type==='relay_console'&&typeof message.text==='string'&&message.text.length<1024&&!/[\r\n\x1b]/.test(message.text)){
        if(Number.isSafeInteger(message.skipped)&&message.skipped>0)log(`[Console] ${message.skipped} events suppressed under backpressure; file receipts retained.`);
        log(message.text);
      }
    });
    child.once('exit',(code,signal)=>{exited={code,signal};resolveStop();});
    child.once('error',()=>{exited={code:1};resolveStop();});
    child.stderr.on('data',()=>{}); // Never display raw SDK errors/credentials.
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString();if(buffer.length>65536){buffer='';return;}
      let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        try{const text=publicGatewayEvent(JSON.parse(line));if(text)log(text);}catch{}}
    });
    const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
    const deadline=Date.now()+(options.readyTimeoutMs??60000);let ready=false;
    while(Date.now()<deadline&&!interrupted&&!exited){
      if(initialized)try{
        const response=await fetch(`http://127.0.0.1:${config.port}/health`,{redirect:'error',signal:AbortSignal.timeout(1000)});
        const text=await response.text();if(text.length>128000)throw new Error('metadata bound');const health=JSON.parse(text);
        if(health.ok&&health.sdk?.ok&&health.version===version&&health.unified&&health.claude?.sdkState==='ready'){
          ready=true;break;
        }
      }catch{}
      await delay(50);
    }
    if(interrupted)return 130;
    if(!ready)throw fail('Both adapters did not become ready. Existing relays and client configuration were not changed.');
    const base=`http://127.0.0.1:${config.port}`;
    log(`Copilot Gateway ${version}: Codex ${base}/v1 | Claude ${base}/claude`);
    log(`Connection center: ${base}/dashboard/setup. Readiness is not GUI prompt/reply proof.`);
    log('Commands: key (Claude key), codex-key, status, quit. Keys are session-scoped and shown only on request.');
    log('Configure each stock client once using docs/UNIFIED-GATEWAY.md. No saved settings or active relays were changed.');
    if(config.check){log('Metadata check passed; no inference was requested.');return 0;}
    if(config.open){const browser=spawn(process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open',
      [base+'/dashboard/setup'],{windowsHide:true,stdio:'ignore'});browser.on('error',()=>log('Open the connection-center URL manually.'));}
    terminal=(options.createConsole??(()=>createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY===true})))();
    terminal.on('line',line=>{
      if(line==='key')reveal(claudeKey);
      else if(line==='codex-key')reveal(codexKey);
      else if(line==='status')log(`Combined gateway ${version}: ${exited?'stopped':'running'}; details at ${base}/dashboard/setup`);
      else if(['quit','exit'].includes(line))resolveStop();
      else log('Commands: key, codex-key, status, quit.');
    });
    terminal.once('close',resolveStop);await completion;
    if(exited&&!interrupted)throw fail('Combined gateway stopped unexpectedly. No provider fallback occurred.');
    return interrupted?130:0;
  }catch(error){failure=error;throw error;}
  finally{
    terminal?.close();signals.off('SIGINT',interrupt);signals.off('SIGTERM',interrupt);
    if(child&&!exited&&child.connected)try{child.send({type:'shutdown'});}catch{}
    const deadline=Date.now()+(options.stopTimeoutMs??15000);
    while(child&&!exited&&Date.now()<deadline)await delay(25);
    if(!child||exited?.code===0&&!exited?.signal)lease.release();
    else{
      // Preserve ownership on ambiguous failure. Never kill another listener or
      // delete its ledger, and never force-restart an active production relay.
      child.unref();child.disconnect?.();
      if(!failure)throw fail('Gateway shutdown was not confirmed. Ownership history retained for inspection.');
    }
  }
}
