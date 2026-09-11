// Read-only onboarding diagnostics. Never opens auth.json or returns account IDs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

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
    copilot: copilot.authenticated && copilot.models?.length ? 'ready'
      : copilot.authenticated ? 'no-models' : copilot.unavailable ? 'unavailable' : 'sign-in',
    codex: installation.checkFailed ? 'unknown' : !installation.installed ? 'not-found'
      : !installation.configured ? 'not-configured' : !relay?.ok ? 'relay-offline'
        : age >= 0 && age < 120000 ? 'traffic-observed' : 'configured',
    lastSeenAt,
  };
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

export async function inspectInstallation({root, port, env = process.env, platform = process.platform}) {
  if (platform !== 'win32') return {installed:false,configured:false,unsupportedPlatform:true};
  // A Node child can inherit PowerShell 7's module path, breaking built-in
  // Windows PowerShell commands such as Get-FileHash. Let that shell rebuild it.
  const shellEnv=Object.fromEntries(Object.entries(env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  return captureJson('powershell.exe',['-NoProfile','-File',path.join(root,'Inspect-RelaySetup.ps1'),'-Port',String(port)],{cwd:root,env:shellEnv});
}

export function createSetupStatus({root, port, inspect, auth, relay, now = Date.now} = {}) {
  let cached, expires = 0, pending;
  return async function readStatus() {
    if (pending) return pending;
    if (cached && now() < expires) return cached;
    pending = (async () => {
      const dependencies = await fs.access(path.join(root,'node_modules/@github/copilot-sdk/dist/index.js')).then(()=>true,()=>false);
      const installation = await (inspect ? inspect() : inspectInstallation({root,port})).catch(()=>({checkFailed:true}));
      const runtime = await relay().catch(()=>null);
      const copilot = dependencies ? await auth(runtime).catch(()=>({unavailable:true,authenticated:false,models:[]})) : {authenticated:false,models:[]};
      cached = {sampledAt:new Date(now()).toISOString(),dependencies,installation,copilot,
        relay:runtime ? {ok:runtime.ok,version:runtime.version,model:runtime.model,activeExchanges:runtime.activeExchanges} : null,
        states:connectionStates({installation,copilot,relay:runtime,now:now()}),port,
        platform:process.platform,setupMode:'guided-read-only',codexBinaryModified:false};
      expires=now()+30000;return cached;
    })().finally(()=>{pending=null;});
    return pending;
  };
}
