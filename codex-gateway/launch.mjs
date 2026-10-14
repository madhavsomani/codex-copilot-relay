import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {buildCodexModelCatalog,validateCatalogClientVersion} from './model-catalog.mjs';
import {createSetupPortal} from '../setup-server.mjs';
import {createCodexObserver} from './observer.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const fail=message=>Object.assign(new Error(message),{publicMessage:message});
const efforts=['none','low','medium','high','xhigh','max'];
const protectedKey=/^(model|model_provider|model_providers|model_reasoning_effort|model_catalog_json|model_context_window|model_auto_compact_token_limit|profile|profiles|openai_base_url|chatgpt_base_url|cli_auth_credentials_store)(\.|$)/i;

export function validateCodexClientArguments(args){
  if(['login','logout'].includes(args[0]))throw fail('Run account login/logout with stock Codex separately; the relay does not manage client account credentials.');
  for(let index=0;index<args.length;index++){
    const arg=args[index];
    if(arg==='--')break; // The remaining arguments are a prompt, not client options.
    if(/^(--(?:model|profile|oss|local-provider))(=|$)/.test(arg)||/^-[mp](?:$|[^-])/.test(arg))
      throw fail('Set model/effort with launcher options. Client provider/profile overrides are not supported by this process-scoped route.');
    if(arg==='-c'||arg==='--config'||arg.startsWith('--config=')||arg.startsWith('-c')&&arg.length>2){
      const value=arg==='-c'||arg==='--config'?args[++index]:arg.startsWith('--config=')?arg.slice(9):arg.slice(2);
      const match=typeof value==='string'&&value.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=/);
      if(!match||protectedKey.test(match[1]))throw fail('A client config override is ambiguous or changes model routing/authentication; it was not applied.');
    }
  }
}

export function parseCodexLaunchArguments(args){
  const result={port:4141,model:'gpt-6.1-sol',effort:null,setupPort:0,openSetup:false,clientArgs:[]},seen=new Set();
  let index=0;
  while(index<args.length&&args[index]!=='--'){
    const option=args[index++];
    if(!['--port','--model','--effort','--setup-port','--open-setup','--no-setup'].includes(option)||seen.has(option))throw fail('Unknown or repeated launcher option. See node launch.mjs --help.');
    seen.add(option);
    if(option==='--open-setup'){result.openSetup=true;continue;}
    if(option==='--no-setup'){result.setupPort=null;continue;}
    const value=args[index++];
    if(!value||value.startsWith('--'))throw fail('A launcher option is missing its value.');
    if(option==='--setup-port')result.setupPort=Number(value);
    else result[option.slice(2)]=option==='--port'?Number(value):value;
  }
  if(index<args.length)result.clientArgs=args.slice(index+1);
  if(!Number.isInteger(result.port)||result.port<1024||result.port>65535||[4144,4246].includes(result.port))
    throw fail('Choose an isolated port between 1024 and 65535; 4144 and 4246 are reserved for existing gateways.');
  if(!/^gpt-[a-z0-9.-]+$/.test(result.model))throw fail('Choose an exact entitled Copilot GPT model ID; other providers are not relabelled.');
  if(result.effort!==null&&!efforts.includes(result.effort))throw fail('Unsupported effort spelling; use none, low, medium, high, xhigh, or max.');
  if(seen.has('--no-setup')&&(seen.has('--setup-port')||result.openSetup))throw fail('--no-setup cannot be combined with observer options.');
  if(result.setupPort!==null&&(!Number.isInteger(result.setupPort)||result.setupPort<0||result.setupPort>65535||result.setupPort>0&&result.setupPort<1024||[4144,4246,result.port].includes(result.setupPort)))
    throw fail('Choose a separate isolated setup port, or 0 for an available port.');
  validateCodexClientArguments(result.clientArgs);return result;
}

function cleanEnvironment(environment){
  const child={...environment};
  for(const name of Object.keys(child))if(/^(BRIDGE_|RELAY_OPENAI_|CODEX_COPILOT_)/i.test(name))delete child[name];
  return child;
}
export function codexServerEnvironment({port,model,runtimeDirectory,cwd,token},environment=process.env){
  return {...cleanEnvironment(environment),BRIDGE_PORT:String(port),BRIDGE_DEFAULT_MODEL:model,
    BRIDGE_MODEL_ROUTING_MODE:'per-request',BRIDGE_AUTH_TOKEN:token,
    BRIDGE_RUNTIME_DIRECTORY:runtimeDirectory,BRIDGE_WORKING_DIRECTORY:cwd,RELAY_OPENAI_ENABLED:'0',
    BRIDGE_HISTORY_MAX_MIB:'64',BRIDGE_EVENT_LOG_MAX_MIB:'8',BRIDGE_EVENT_LOG_PATH:path.join(runtimeDirectory,'relay-events.jsonl')};
}
export function codexClientEnvironment(token,environment=process.env){
  return {...cleanEnvironment(environment),CODEX_COPILOT_BRIDGE_KEY:token};
}
export function codexClientArguments({port,model,effort,providerId,catalogPath,clientArgs}){
  const provider=`{ name="Copilot process-scoped relay", base_url="http://127.0.0.1:${port}/v1", wire_api="responses", env_key="CODEX_COPILOT_BRIDGE_KEY", requires_openai_auth=false, request_max_retries=2, stream_max_retries=2, stream_idle_timeout_ms=1800000 }`;
  const overrides=[`model_provider=${JSON.stringify(providerId)}`,`model_providers.${providerId}=${provider}`,`model=${JSON.stringify(model)}`];
  if(catalogPath)overrides.push(`model_catalog_json=${JSON.stringify(catalogPath)}`);
  if(effort!==null)overrides.push(`model_reasoning_effort=${JSON.stringify(effort)}`);
  return [...overrides.flatMap(value=>['-c',value]),...clientArgs];
}

function acquireLease(directory){
  fs.mkdirSync(directory,{recursive:true});
  if(fs.lstatSync(directory).isSymbolicLink())throw fail('The Codex runtime directory must not be a symbolic link.');
  const root=fs.realpathSync(directory),file=path.join(root,'gateway.owner.json');
  let receipt=JSON.stringify({version:1,pid:process.pid,serverPid:null,owner:randomUUID(),at:new Date().toISOString()});
  try{fs.writeFileSync(file,receipt,{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')throw fail('This isolated Codex history has an ownership receipt. Inspect the launcher/server processes before removing only a confirmed stale gateway.owner.json; keep its history.');throw error;}
  return {directory:root,setServerPid(pid){
    if(fs.readFileSync(file,'utf8')!==receipt)throw fail('Runtime ownership changed unexpectedly.');
    receipt=JSON.stringify({...JSON.parse(receipt),serverPid:pid});fs.writeFileSync(file,receipt,{mode:0o600});
  },release(){if(fs.readFileSync(file,'utf8')===receipt)fs.unlinkSync(file);}};
}

async function assertPortAvailable(port){
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{
    listener.once('error',()=>reject(fail('The isolated port is occupied. Nothing was adopted or terminated; choose another port.')));
    listener.listen({host:'127.0.0.1',port,exclusive:true},resolve);
  });
  await new Promise(resolve=>listener.close(resolve));
}
function capture(command,args,environment,timeout=10000){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env:environment,windowsHide:true,stdio:['ignore','pipe','ignore']});
    let text='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(fail('A client or authentication metadata check timed out.'));},timeout);
    child.stdout.on('data',chunk=>{text+=chunk.toString();if(Buffer.byteLength(text)>65536){child.kill();finish(fail('A metadata check exceeded its output bound.'));}});
    child.once('error',()=>finish(fail('The stock client or metadata probe could not be started.')));
    child.once('exit',code=>finish(code===0?null:fail('A stock client or authentication metadata check failed.'),text));
  });
}
function defaultCommand(root,environment){
  if(environment.CODEX_EXECUTABLE){
    if(!path.isAbsolute(environment.CODEX_EXECUTABLE))throw fail('CODEX_EXECUTABLE must be an absolute path to an unmodified stock Codex executable.');
    return {command:environment.CODEX_EXECUTABLE,prefix:[]};
  }
  const bundled=path.join(root,'node_modules','@openai','codex','bin','codex.js');
  return fs.existsSync(bundled)?{command:process.execPath,prefix:[bundled]}:{command:'codex',prefix:[]};
}
async function dependencies(root){
  if(Number(process.versions.node.split('.')[0])<22)throw fail('Use Node.js 22 or later.');
  const expected={'@github/copilot-sdk':'1.0.11',sharp:'0.35.5'};
  for(const [name,version] of Object.entries(expected)){
    let installed;try{installed=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8')).version;}catch{}
    if(installed!==version)throw fail('Dependencies are missing or do not match the reviewed candidate. Run npm ci in a separate checkout; do not install under a running relay.');
  }
}

async function metadataJson(response){
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){
    bytes+=chunk.byteLength;
    if(bytes>65536)throw fail('Relay metadata exceeded its 64 KiB bound; no values were accepted.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Experimental injection points are API-only for deterministic lifecycle tests;
// there are no environment switches to bypass the normal authentication checks.
export async function launch(args=process.argv.slice(2),options={}){
  const config=parseCodexLaunchArguments(args),root=options.root??sourceRoot,environment=options.environment??process.env;
  const cwd=options.cwd??process.cwd(),log=options.log??console.log,signals=options.signals??process;
  await (options.dependencies??dependencies)(root);
  const command=options.clientCommand??defaultCommand(root,environment);
  const version=await capture(command.command,[...command.prefix,'--version'],cleanEnvironment(environment));
  validateCatalogClientVersion(version);
  const auth=options.authProbe?await options.authProbe():JSON.parse(await capture(process.execPath,[path.join(root,'probe-setup-auth.mjs'),'--model-metadata'],cleanEnvironment(environment),25000));
  if(auth?.authenticated!==true)throw fail('Copilot is not authenticated here. Sign in with the official Copilot CLI on this system; no other account/provider was used.');
  if(!Array.isArray(auth.models)||!auth.models.includes(config.model))throw fail('The requested GPT model is not advertised as enabled for this signed-in Copilot account.');
  const advertisedEfforts=auth.modelDetails?.find(model=>model.id===config.model)?.supportedReasoningEfforts;
  if(config.effort!==null&&Array.isArray(advertisedEfforts)&&!advertisedEfforts.includes(config.effort))
    throw fail('The requested effort is not advertised for this model. It was not silently substituted.');
  await assertPortAvailable(config.port);
  const lease=acquireLease(path.join(root,'runtime','codex-cli','ports',String(config.port)));
  const token=randomBytes(32).toString('hex'),providerId=`copilot_cli_${randomBytes(8).toString('hex')}`;
  let gateway=null,client=null,portal=null,interrupted=false,exited=null,graceful=false,initialized=false,operationError=null,catalogPath=null;
  const interrupt=()=>{interrupted=true;if(client)client.kill('SIGTERM');};
  signals.on('SIGINT',interrupt);signals.on('SIGTERM',interrupt);
  try{
    gateway=spawn(process.execPath,[options.serverEntry??path.join(root,'codex-gateway','server-child.mjs')],{
      cwd:root,env:codexServerEnvironment({...config,runtimeDirectory:lease.directory,cwd,token},environment),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    lease.setServerPid(gateway.pid);
    gateway.on('message',message=>{if(message?.type==='initialized')initialized=true;});
    gateway.once('exit',(code,signal)=>{exited={code,signal};if(client&&!interrupted)client.kill('SIGTERM');});
    gateway.once('error',()=>{exited={code:1,spawnError:true};});
    // Drain without forwarding prompts, raw errors, or credential-bearing logs.
    gateway.stdout.on('data',()=>{});gateway.stderr.on('data',()=>{});
    const started=Date.now(),timeout=options.readyTimeoutMs??45000;
    let health;
    while(Date.now()-started<timeout){
      if(interrupted)throw fail('Launch interrupted; no client was started.');
      if(exited)throw fail('The owned relay exited during startup. Its runtime receipt is retained for safe inspection.');
      if(!initialized){await delay(50);continue;}
      try{
        const response=await fetch(`http://127.0.0.1:${config.port}/health`,{redirect:'error',signal:AbortSignal.timeout(500)});
        if(response.ok)health=await metadataJson(response);
        else await response.body?.cancel();
        if(health?.ok&&health.provider==='github-copilot-sdk'){
          const unauthenticated=await fetch(`http://127.0.0.1:${config.port}/v1/models`,{redirect:'error',signal:AbortSignal.timeout(500)});
          await unauthenticated.body?.cancel();
          const authenticated=await fetch(`http://127.0.0.1:${config.port}/v1/models`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(500)});
          await authenticated.body?.cancel();
          if(unauthenticated.status===401&&authenticated.ok)break;
        }
      }catch(error){if(error.publicMessage)throw error;} // Transient connection refusal during startup is expected.
      health=null;await delay(50);
    }
    if(!health)throw fail('The owned authenticated relay did not become ready before the startup deadline.');
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
    if(health.version!==manifest.version||health.model!==config.model||health.routing?.mode!=='per-request'||health.sdk?.ok!==true)
      throw fail('The owned relay reported incompatible version/model/routing/SDK health. No stock client was started.');
    const capability=health.modelCapabilities?.[config.model];
    if(config.effort!==null&&!capability?.supportedReasoningEfforts?.includes(config.effort))
      throw fail('The requested effort is not advertised for this model. It was not silently substituted.');
    if(config.effort===null)config.effort=capability?.supportedReasoningEfforts?.includes(capability.defaultReasoningEffort)?capability.defaultReasoningEffort:null;
    const catalog=buildCodexModelCatalog({modelDetails:auth.modelDetails,modelCapabilities:health.modelCapabilities,selectedModel:config.model});
    catalogPath=path.join(lease.directory,`models-${randomUUID()}.json`);
    fs.writeFileSync(catalogPath,JSON.stringify(catalog),{flag:'wx',mode:0o600});
    log(`Stock ${version.trim()}; Copilot ${config.model}; effort ${config.effort??'unspecified'}; isolated loopback port ${config.port}.`);
    log('Process-scoped CLI route only. Saved TOML/account/Remote settings and the live desktop relay are unchanged. No automatic fallback.');
    log('The inference gateway remains bearer-protected; a separate read-only observer never receives its key. History stays in runtime/codex-cli/ports/<port>.');
    if(config.setupPort!==null){
      try{
        const read=createCodexObserver({port:config.port,version:manifest.version,model:config.model,effort:config.effort,
          clientVersion:version.trim(),isAlive:()=>initialized&&!exited&&!interrupted});
        portal=await (options.createPortal??createSetupPortal)({root,port:config.setupPort,relayPort:config.port,codexObserver:read,
          inspect:async()=>({installed:true,configured:true,processScoped:true,backup:'not-needed'}),
          auth:async()=>({authenticated:true,models:[...auth.models],authenticationScope:'startup-check-only'}),
          relay:async()=>{const view=await read();return view.listening?{ok:view.sdkReady,version:view.version,model:view.selectedModel,
            activeExchanges:view.activeExchanges,lastCodexRequestAt:view.lastRequestAt}:null;},
          claude:async()=>({installation:{checkFailed:true},gateway:null})});
        const url=await portal.listen();log('Read-only owned Codex connection center: '+url);
        if(config.openSetup){
          const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
          const browser=spawn(command,[url],{windowsHide:true,stdio:'ignore'});browser.on('error',()=>log('Open the connection-center URL above manually.'));
        }
      }catch{try{await portal?.close();}catch{}portal=null;log('Connection center unavailable; inference unchanged. Choose another --setup-port or --no-setup.');}
    }
    client=spawn(command.command,[...command.prefix,...codexClientArguments({...config,providerId,catalogPath})],{
      cwd,env:codexClientEnvironment(token,environment),windowsHide:true,stdio:options.clientStdio??'inherit'});
    if(exited||interrupted)client.kill('SIGTERM');
    const outcome=await new Promise(resolve=>{
      client.once('error',()=>resolve({code:1,spawnError:true}));client.once('exit',(code,signal)=>resolve({code,signal}));
    });
    if(exited&&!interrupted)throw fail('The owned relay stopped while Codex was running; the stock client was stopped and no alternate provider was attempted.');
    return interrupted?130:outcome.code??1;
  }catch(error){operationError=error;throw error;}
  finally{
    signals.removeListener('SIGINT',interrupt);signals.removeListener('SIGTERM',interrupt);
    try{await portal?.close();}catch{log('Observer close failed; owned inference cleanup still runs.');}
    if(gateway){
      if(!exited&&gateway.connected)try{gateway.send({type:'shutdown'});}catch{}
      const deadline=Date.now()+(options.stopTimeoutMs??15000);
      while(!exited&&Date.now()<deadline)await delay(25);
      graceful=exited?.code===0&&!exited?.signal;
      if(!exited){gateway.kill('SIGKILL');log('The owned server did not acknowledge graceful exit. Its ownership receipt is retained; inspect any remaining Copilot workers before reusing this history.');}
    }else graceful=true;
    if(graceful){if(catalogPath)fs.unlinkSync(catalogPath);lease.release();}
    else if(!operationError&&!interrupted)throw fail('The owned relay did not confirm graceful shutdown. Its receipt is retained for inspection; saved client configuration is unchanged.');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  launch().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error?.publicMessage??'Codex launch failed without provider fallback.');process.exitCode=1;});
}
