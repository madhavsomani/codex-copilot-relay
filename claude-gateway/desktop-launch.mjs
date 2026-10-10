// GUI attachment uses Claude's documented third-party inference form. This
// runner does not start/patch/restart the app or edit any client configuration.
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {assertDependencies} from './launch.mjs';
import {preflightClientSettings} from './client-settings.mjs';
import {startSdkGateway} from './server.mjs';
import {catalog} from './protocol.mjs';
import {gatewayVisibility} from './visibility.mjs';
import {createSetupPortal} from '../setup-server.mjs';
import {bounded} from '../copilot-runtime.mjs';

const publicErrors=new WeakSet();
function fail(message){const error=Object.assign(new Error(message),{publicMessage:message});publicErrors.add(error);return error;}
export function safeDesktopMessage(error){return publicErrors.has(error)?error.publicMessage:
  'Claude desktop gateway failed. Review its local setup guide; no app settings changed and no provider fallback was attempted.';}
export function parseDesktopLaunchArguments(args){
  let port=4261,setupPort=0,openSetup=false,check=false;const seen=new Set();
  for(let index=0;index<args.length;index++){
    const flag=args[index];if(seen.has(flag))throw fail('Repeated desktop gateway option. Nothing was started.');seen.add(flag);
    if(flag==='--no-setup'){setupPort=null;continue;}
    if(flag==='--open-setup'){openSetup=true;continue;}
    if(flag==='--check'){check=true;continue;}
    if(!['--port','--setup-port'].includes(flag)||!/^\d+$/.test(args[index+1]??''))throw fail('Unknown or invalid desktop gateway option. See docs/CLAUDE-DESKTOP.md.');
    const value=Number(args[++index]);if(flag==='--port')port=value;else setupPort=value;
  }
  if(!Number.isInteger(port)||port<1024||port>65535||[4144,4246].includes(port))throw fail('Choose an isolated desktop gateway port, excluding 4144 and 4246.');
  if(setupPort!==null&&(!Number.isInteger(setupPort)||setupPort<0||setupPort>65535||setupPort>0&&setupPort<1024||[4144,4246,port].includes(setupPort)))
    throw fail('Choose a separate available observer port, or 0.');
  if(seen.has('--no-setup')&&(seen.has('--setup-port')||openSetup)||check&&openSetup)
    throw fail('Conflicting desktop gateway options. Nothing was started.');
  return {port,setupPort,openSetup,check};
}
export function desktopConnection(gateway){
  return {inferenceProvider:'gateway',inferenceCredentialKind:'static',
    inferenceGatewayBaseUrl:`http://127.0.0.1:${gateway.server.address().port}`,inferenceGatewayAuthScheme:'bearer',
    inferenceModels:catalog(gateway.models).map(model=>({name:model.id})),
    isClaudeCodeForDesktopEnabled:true,toolSearchEnabled:false};
}
const modelName=value=>typeof value==='string'&&/^[\w.-]{1,100}$/.test(value)?value:'unreported';
export async function launch(args=[],options={}){
  const config=parseDesktopLaunchArguments(args),signals=options.signals??process,log=options.log??console.log;
  const reveal=options.reveal??console.log,token=options.token??randomBytes(32).toString('hex');
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw fail('Invalid local desktop gateway key. Nothing was started.');
  let gateway,portal,terminal,stopped=false,interrupted=false,resolveStop;
  const completion=new Promise(resolve=>{resolveStop=resolve;});
  const stop=(signal=false)=>{interrupted||=signal;stopped=true;resolveStop();};
  const interrupt=()=>stop(true);
  signals.on('SIGINT',interrupt);signals.on('SIGTERM',interrupt);
  const closePortal=async()=>{if(portal){try{await portal.close();}catch{log('Observer cleanup could not be confirmed; inference cleanup still runs.');}portal=null;}};
  try{
    (options.checkDependencies??assertDependencies)();
    // Conservative policy check, not a certificate for future desktop projects
    // or embedded-engine policy reloads. Stock Claude retains final precedence.
    await (options.preflightSettings??preflightClientSettings)([]);if(stopped)return 130;
    gateway=await (options.startGateway??startSdkGateway)({port:config.port,token});if(stopped)return 130;
    gateway.ledger.onChange=(type,row)=>{
      if(type==='usage')log(`[Copilot SDK] ${(row.actualModels??[]).map(modelName).join(',')} input=${row.inputTokens} output=${row.outputTokens} AI-credits=${row.totalNanoAiu===null?'unreported':(row.totalNanoAiu/1e9).toFixed(5)+(row.creditReportedCalls<row.sdkApiCalls?' (partial)':'')}`);
      else log(`[Claude Code gateway] ${type} ${modelName(row.requestedModel)} -> ${modelName(row.selectedModel)}`);
    };
    log('Claude desktop gateway ready. Provider: GitHub Copilot SDK. GUI connection not verified until a GUI prompt completes.');
    log('Enter these values in Developer > Configure Third-Party Inference:');
    log(JSON.stringify(desktopConnection(gateway),null,2));
    log('Existing Codex routing/dashboard, Claude login and saved settings were not changed. Cloud/Remote/voice and experimental tool search are not enabled.');
    if(config.setupPort!==null){
      try{
        portal=await (options.createPortal??createSetupPortal)({port:config.setupPort,
          claude:async()=>({installation:{checkFailed:true},gateway:gatewayVisibility(gateway)}),
          auth:async()=>{const auth=await bounded(async()=>(await gateway.runtime.ready()).getAuthStatus(),4000,'Copilot authentication metadata');
            return {authenticated:auth.isAuthenticated===true,models:[],claudeModels:auth.isAuthenticated?catalog(gateway.models).map(model=>model.id):[]};}});
        if(stopped)return 130;
        const url=await portal.listen();if(stopped)return 130;log('Read-only connection center: '+url);
        if(config.openSetup){
          const browser=spawn(process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open',[url],{windowsHide:true,stdio:'ignore'});
          browser.on('error',()=>log('Open the connection-center URL above manually.'));
        }
      }catch{await closePortal();log('Observer unavailable; inference routing is unchanged. Choose another --setup-port.');}
    }
    if(stopped)return 130;
    if(config.check){log('Metadata-only check complete; no Messages/inference request was sent.');return 0;}
    terminal=(options.createConsole??(()=>createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY===true})))();
    terminal.on('line',line=>{
      const command=typeof line==='string'&&line.length<=64?line.trim().toLowerCase():'';
      if(command==='key')reveal(token); // Explicit local-user action only; never browser/log metadata.
      else if(command==='quit'||command==='exit')stop();
      else if(command==='status')log(JSON.stringify(gatewayVisibility(gateway),null,2));
      else log('Commands: key (show local session key), status, quit.');
    });
    terminal.once('close',()=>stop());
    log('Commands: key (show the local key to paste into Gateway API key), status, quit. Leave this terminal open.');
    log('The key is session-scoped: each fresh launch needs a new key in the desktop form. No GitHub/Claude account token is displayed or copied.');
    await completion;return interrupted?130:0;
  }catch(error){if(interrupted)return 130;throw fail(safeDesktopMessage(error));}
  finally{
    try{terminal?.close();}catch{log('Console cleanup could not be confirmed; inference cleanup still runs.');}
    try{await closePortal();await gateway?.close();}
    catch{throw fail('Owned desktop gateway cleanup failed. Inspect its processes/ownership receipt before relaunching; do not delete its history.');}
    finally{signals.off('SIGINT',interrupt);signals.off('SIGTERM',interrupt);}
  }
}
