import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseClientArguments,preflightClientSettings} from './client-settings.mjs';
import {startSdkGateway} from './server.mjs';
import {catalog} from './protocol.mjs';
import sharp from 'sharp';
import {bounded} from '../copilot-runtime.mjs';
import {createSetupPortal} from '../setup-server.mjs';
import {inspectClaudeInstallation,parseClaudeVersion} from '../setup-status.mjs';
import {gatewayVisibility} from './visibility.mjs';

const publicErrors=new WeakSet();
function fail(message){
  const error=Object.assign(new Error(message),{publicMessage:message});publicErrors.add(error);return error;
}
export function safeLaunchMessage(error){
  return publicErrors.has(error)?error.publicMessage:'Claude launch failed. Review the local setup/routing guide; no provider fallback was attempted.';
}
function checkCancellation(signal){
  if(signal?.aborted)throw fail('Claude launch interrupted; no new client was started.');
}

export function assertDependencies(version=sharp.versions.sharp){
  const [major,minor,patch]=String(version).split('.').map(Number);
  if(!(major>0||major===0&&(minor>35||minor===35&&patch>=5)))
    throw new Error('The Claude preview requires patched sharp >=0.35.5. Run npm ci in a fresh checkout, not underneath an active relay.');
}

// Opt-in, process-scoped routing. No settings/profile/login file is rewritten.
// Claude Code retains all its tool permission checks; we supply inference only.
export function clientEnvironment(gateway, token, original=process.env) {
  const available=catalog(gateway.models).map(model=>model.id);
  const choose=(family,preferred)=>available.includes(preferred)?preferred:available.find(id=>id.startsWith('claude-'+family+'-'));
  const opus=choose('opus','claude-opus-5-5'),sonnet=choose('sonnet','claude-sonnet-5-5'),haiku=choose('haiku','claude-haiku-4-5');
  if(!opus)throw new Error('This account does not expose an Opus model. No silent model fallback.');
  const env={...original};
  for(const key of ['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_AWS','ANTHROPIC_BETAS','CLAUDE_CODE_EXTRA_BODY'])delete env[key];
  Object.assign(env,{ANTHROPIC_BASE_URL:`http://127.0.0.1:${gateway.server.address().port}`,
    ANTHROPIC_AUTH_TOKEN:token,ANTHROPIC_MODEL:opus,ANTHROPIC_DEFAULT_OPUS_MODEL:opus,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1',CLAUDE_CODE_GATEWAY_HINT_HEADERS:'1'});
  if(sonnet)env.ANTHROPIC_DEFAULT_SONNET_MODEL=sonnet;else delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  if(haiku)env.ANTHROPIC_DEFAULT_HAIKU_MODEL=haiku;else delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  return env;
}
export function clientArguments(args,gateway){
  const parsed=parseClientArguments(args);const forwarded=parsed.forwarded;let settings=parsed.settings;
  settings={...settings,permissions:{defaultMode:'default',...settings.permissions},
    modelPicker:{replaceBuiltInOptions:true,options:catalog(gateway.models).map(model=>({
      model:model.id,label:model.display_name+' · Copilot',description:model.description}))}};
  return ['--settings',JSON.stringify(settings),...forwarded];
}
export function parseLaunchArguments(args){
  const separator=args.indexOf('--');const own=separator<0?[]:args.slice(0,separator);
  const clientArgs=separator<0?args:args.slice(separator+1);let port=4246,setupPort=0,openSetup=false;const seen=new Set();
  for(let i=0;i<own.length;i++){
    if(seen.has(own[i]))throw fail('Repeated Claude launcher option. Nothing was started.');
    seen.add(own[i]);
    if(own[i]==='--no-setup'){setupPort=null;continue;}
    if(own[i]==='--open-setup'){openSetup=true;continue;}
    if(!['--port','--setup-port'].includes(own[i])||!/^\d+$/.test(own[i+1]??''))throw new Error('Invalid launcher option before --.');
    const flag=own[i],value=Number(own[++i]);if(flag==='--port')port=value;else setupPort=value;
  }
  if(!Number.isInteger(port)||port<1024||port>65535||port===4144)throw new Error('Choose an isolated port from 1024 to 65535, excluding 4144.');
  if(setupPort!==null&&(!Number.isInteger(setupPort)||setupPort<0||setupPort>65535||setupPort>0&&setupPort<1024||setupPort===4144||setupPort===port))
    throw new Error('Choose a separate setup port, or 0 for an available loopback port.');
  if(seen.has('--no-setup')&&(seen.has('--setup-port')||openSetup))throw fail('--no-setup cannot be combined with --setup-port or --open-setup.');
  return {port,setupPort,openSetup,clientArgs};
}
export async function startClientGateway(clientArgs,options,start=startSdkGateway,{
  preflightSettings=preflightClientSettings,inspectClient=inspectClaudeInstallation,
  executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude'),environment=process.env,signal}={}){
  checkCancellation(signal);
  await preflightSettings(clientArgs);checkCancellation(signal);
  const installation=await inspectClient({executable,env:environment,signal});checkCancellation(signal);
  if(installation?.installed!==true||!parseClaudeVersion(installation.version??''))
    throw fail('Stock Claude Code was not found or its bounded version check failed. Install it separately or set CLAUDE_EXECUTABLE to its stock executable. No SDK worker was started.');
  return start(options);
}
// API-only injection points for deterministic lifecycle tests, not environment
// switches for bypassing real installation/settings/authentication checks.
export async function launch(args=process.argv.slice(2),options={}) {
  (options.checkDependencies??assertDependencies)();
  const {port,setupPort,openSetup,clientArgs}=parseLaunchArguments(args);
  const environment=options.environment??process.env,signals=options.signals??process,log=options.log??console.error;
  const executable=environment.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude');
  const preflightSettings=options.preflightSettings??preflightClientSettings;
  const inspectClient=options.inspectClient??inspectClaudeInstallation,spawnClient=options.spawnClient??spawn;
  const token=randomBytes(32).toString('hex'),cancellation=new AbortController();
  let gateway,portal,child,installation,interrupted=false;
  const interrupt=()=>{if(interrupted)return;interrupted=true;cancellation.abort();try{child?.kill('SIGTERM');}catch{log('The owned client interrupt could not be confirmed.');}};
  signals.on('SIGINT',interrupt);signals.on('SIGTERM',interrupt);
  const closePortal=async()=>{
    if(!portal)return;
    try{await portal.close();portal=null;}catch{log('Observer shutdown could not be confirmed; owned inference cleanup still runs.');}
  };
  try {
    gateway=await startClientGateway(clientArgs,{token,port},options.startGateway??startSdkGateway,{
      executable,environment,signal:cancellation.signal,preflightSettings,
      inspectClient:async config=>installation=await inspectClient(config)});
    if(interrupted)return 130;
    // Recheck after worker discovery; changes during startup must fail closed.
    await preflightSettings(clientArgs);if(interrupted)return 130;
    gateway.ledger.onChange=(type,row)=>{
      if(type==='usage')log(`[Copilot SDK] ${row.actualModels.join(',')} input=${row.inputTokens} output=${row.outputTokens} AI-credits=${row.totalNanoAiu===null?'unreported':(row.totalNanoAiu/1e9).toFixed(5)+(row.creditReportedCalls<row.sdkApiCalls?' (partial)':'')}`);
      else log(`[Claude → Copilot] ${type} ${row.requestClass??'request'} ${row.requestedModel??'unknown'} → ${row.selectedModel??'not routed'}`);
    };
    log(`Stock Claude ${installation.version}; gateway preview ready at 127.0.0.1:${gateway.server.address().port}; inference: GitHub Copilot SDK.`);
    log('Manual tool permissions by default; actual upstream thinking/signatures preserved. Experimental API betas unsupported. No model/provider fallback.');
    log('Routing settings preflight passed. Do not change provider/auth settings or working directories during this preview session; policy reloads remain owned by stock Claude.');
    if(setupPort!==null){
      try{
        portal=await (options.createPortal??createSetupPortal)({port:setupPort,
          claude:async()=>({installation,gateway:gatewayVisibility(gateway)}),
          auth:async()=>{const client=await gateway.runtime.ready();const auth=await bounded(()=>client.getAuthStatus(),4000,'Copilot sign-in check');
            return {authenticated:auth.isAuthenticated===true,models:auth.isAuthenticated?gateway.models.filter(value=>value.policy?.state!=='disabled').map(value=>value.id).filter(id=>/^gpt-[a-z0-9.-]+$/.test(id)):[],
              claudeModels:auth.isAuthenticated?catalog(gateway.models).map(value=>value.id):[]};}});
        if(interrupted)return 130;
        const url=await portal.listen();if(interrupted)return 130;log('Read-only Codex + Claude connection center: '+url);
        if(openSetup){
          const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
          const browser=spawn(command,[url],{windowsHide:true,stdio:'ignore'});
          browser.on('error',()=>log('Open the connection-center URL above manually.'));
        }
      }catch{await closePortal();log('Connection center unavailable; inference gateway is unchanged. Choose a different --setup-port or use --no-setup.');}
    }
    if(interrupted)return 130;
    child=spawnClient(executable,clientArguments(clientArgs,gateway),{env:clientEnvironment(gateway,token,environment),stdio:options.clientStdio??'inherit',windowsHide:true});
    const outcome=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
    if(interrupted)child.kill('SIGTERM');
    const code=await outcome;return interrupted?130:code;
  }catch(error){if(interrupted)return 130;throw fail(safeLaunchMessage(error));}
  finally{
    try{
      await closePortal();
      try{await gateway?.close();}catch{throw fail('Owned Claude gateway shutdown failed. Inspect its processes/ownership receipt before reusing the history; saved configuration was not changed.');}
    }finally{signals.off('SIGINT',interrupt);signals.off('SIGTERM',interrupt);}
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
  launch().then(code=>{process.exitCode=code;}).catch(error=>{console.error(safeLaunchMessage(error));process.exitCode=1;});
