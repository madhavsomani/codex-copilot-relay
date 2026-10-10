// Read-only onboarding diagnostics. Never opens auth.json or returns account IDs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {inspectPortableInstallation} from './codex-setup-status.mjs';

export function sameOriginLocal(request, port) {
  const host = request.headers.host;
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(host)
    && request.headers['sec-fetch-site'] !== 'cross-site'
    && (!request.headers.origin || request.headers.origin === `http://${host}`);
}

export function connectionStates({installation = {}, copilot = {}, relay, now = Date.now()}) {
  const lastSeenAt = relay?.lastCodexRequestAt ?? null;
  const age = lastSeenAt ? now - Date.parse(lastSeenAt) : Infinity;
  return {
    copilot: copilot.authenticated && (copilot.models?.length||copilot.claudeModels?.length) ? 'ready'
      : copilot.authenticated ? 'no-models' : copilot.unavailable ? 'unavailable' : 'sign-in',
    codex: installation.checkFailed ? 'unknown' : !installation.installed ? 'not-found'
      : !installation.configured ? 'not-configured' : !relay?.ok ? 'relay-offline'
        : age >= 0 && age < 120000 ? 'traffic-observed' : 'configured',
    lastSeenAt,
  };
}

export function claudeConnectionState({installation={},gateway,now=Date.now()}={}){
  if(gateway?.listening){
    if(gateway.sdkState!=='ready')return 'worker-unavailable';
    const age=gateway.lastRequestAt?now-Date.parse(gateway.lastRequestAt):Infinity;
    return age>=0&&age<120000?'traffic-observed':'listening';
  }
  return installation.checkFailed?'unknown':!installation.installed?'not-found':'not-attached';
}
export function parseClaudeVersion(text){
  return /^\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?: \(Claude Code\))?\s*$/.exec(text)?.[1]??null;
}
export async function inspectClaudeInstallation({executable=process.env.CLAUDE_EXECUTABLE??(process.platform==='win32'?'claude.exe':'claude'),
  env=process.env,signal,timeoutMs=8000,spawnProbe=spawn}={}){
  if(signal?.aborted)return {checkFailed:true,cancelled:true};
  return new Promise(resolve=>{
    let child,text='',bytes=0,settled=false,timer;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);};
    const terminate=value=>{try{child?.kill('SIGKILL');}catch{}finish(value);};
    const abort=()=>terminate({checkFailed:true,cancelled:true});
    try{child=spawnProbe(executable,['--version'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch(error){finish(error.code==='ENOENT'?{installed:false}:{checkFailed:true});return;}
    timer=setTimeout(()=>terminate({checkFailed:true}),timeoutMs);
    const collect=(value,stdout)=>{
      if(settled)return;bytes+=Buffer.byteLength(value);
      if(bytes>4096){terminate({checkFailed:true});return;}
      if(stdout)text+=value.toString();
    };
    child.stdout.on('data',value=>collect(value,true));child.stderr.on('data',value=>collect(value,false));
    child.once('error',error=>finish(error.code==='ENOENT'?{installed:false}:{checkFailed:true}));
    child.once('close',code=>{const version=parseClaudeVersion(text);finish(code===0&&version?{installed:true,version}:{checkFailed:true});});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

export function captureJson(executable, args, {cwd, timeoutMs = 15000, env = process.env} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, env, windowsHide:true, stdio:['ignore','pipe','pipe']});
    let text = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', chunk => {text += chunk; if (text.length > 65536) child.kill();});
    child.stderr.on('data', () => {});
    child.once('error', () => {clearTimeout(timer); reject(new Error('Diagnostic unavailable'));});
    child.once('close', code => {
      clearTimeout(timer);
      try {if (code !== 0) throw new Error(); resolve(JSON.parse(text.replace(/^\uFEFF/,'')));}
      catch {reject(new Error('Diagnostic unavailable'));}
    });
  });
}

export async function inspectInstallation({root, port, env = process.env, platform = process.platform, codexProbe}) {
  if (platform === 'linux' || platform === 'darwin') return inspectPortableInstallation({port,env,probe:codexProbe});
  if (platform !== 'win32') return {checkFailed:true,configured:false,unsupportedPlatform:true};
  // A Node child can inherit PowerShell 7's module path, breaking built-in
  // Windows PowerShell commands such as Get-FileHash. Let that shell rebuild it.
  const shellEnv=Object.fromEntries(Object.entries(env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  return captureJson('powershell.exe',['-NoProfile','-File',path.join(root,'Inspect-RelaySetup.ps1'),'-Port',String(port)],{cwd:root,env:shellEnv});
}

export function createSetupStatus({root, port, inspect, auth, relay, claude, now = Date.now} = {}) {
  let cached, expires = 0, pending;
  return async function readStatus() {
    if (pending) return pending;
    if (cached && now() < expires) return cached;
    pending = (async () => {
      const dependencies = await fs.access(path.join(root,'node_modules/@github/copilot-sdk/dist/index.js')).then(()=>true,()=>false);
      const installation = await (inspect ? inspect() : inspectInstallation({root,port})).catch(()=>({checkFailed:true}));
      const runtime = await relay().catch(()=>null);
      const copilot = dependencies ? await auth(runtime).catch(()=>({unavailable:true,authenticated:false,models:[]})) : {authenticated:false,models:[]};
      const previewAvailable=await fs.access(path.join(root,'claude-gateway/launch.mjs')).then(()=>true,()=>false);
      const claudeStatus=await (claude?claude():previewAvailable?inspectClaudeInstallation().then(installation=>({installation,gateway:null})):Promise.resolve({installation:{installed:false},gateway:null}))
        .catch(()=>({installation:{checkFailed:true},gateway:null}));
      cached = {sampledAt:new Date(now()).toISOString(),dependencies,installation,copilot,
        relay:runtime ? {ok:runtime.ok,version:runtime.version,model:runtime.model,activeExchanges:runtime.activeExchanges} : null,
        states:{...connectionStates({installation,copilot,relay:runtime,now:now()}),claude:claudeConnectionState({...claudeStatus,now:now()})},
        claude:{...claudeStatus,previewAvailable},port,
        platform:process.platform,setupMode:'guided-read-only',codexBinaryModified:false};
      expires=now()+30000;return cached;
    })().finally(()=>{pending=null;});
    return pending;
  };
}
