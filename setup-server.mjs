// Dependency-free, read-only setup portal. No install/login/config POST endpoints.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createSetupStatus,captureJson,sameOriginLocal} from './setup-status.mjs';
import {SETUP_HTML} from './setup-ui.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.RELAY_SETUP_PORT||4143),relayPort=Number(process.env.BRIDGE_PORT||4144);
if (![port,relayPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||port===relayPort) throw new Error('Invalid setup ports');
const status=createSetupStatus({root,port:relayPort,
  relay:async()=>{try{const response=await fetch(`http://127.0.0.1:${relayPort}/health`,{signal:AbortSignal.timeout(4000)});const data=await response.json();return data.provider==='github-copilot-sdk'?data:null;}catch{return null;}},
  auth:async()=>captureJson(process.execPath,[path.join(root,'probe-setup-auth.mjs')],{cwd:root,timeoutMs:25000})});
const server=http.createServer(async(request,response)=>{
  const reply=(code,type,body)=>{response.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});response.end(body);};
  if(!sameOriginLocal(request,port))return reply(403,'text/plain','Loopback same-origin requests only');
  if(request.method!=='GET')return reply(405,'text/plain','Read-only setup. Use documented local commands for changes.');
  const url=new URL(request.url,`http://127.0.0.1:${port}`);
  if(url.pathname==='/setup-health')return reply(200,'application/json',JSON.stringify({kind:'codex-copilot-setup',root,relayPort}));
  if(url.pathname==='/dashboard/setup/status'){try{return reply(200,'application/json',JSON.stringify(await status()));}catch{return reply(503,'application/json',JSON.stringify({error:'Setup check unavailable'}));}}
  if(['/','/dashboard','/dashboard/setup'].includes(url.pathname))return reply(200,'text/html; charset=utf-8',SETUP_HTML.replaceAll('__DASHBOARD_URL__',`http://127.0.0.1:${relayPort}/dashboard`));
  return reply(404,'text/plain','Not found');
});
server.listen(port,'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${port}/dashboard/setup`;
  console.log('Read-only connection center: '+url+' (Ctrl+C closes setup, not the relay)');
  if(process.argv.includes('--open')&&process.platform==='win32'){
    const browser=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
    browser.on('error',()=>console.log('Open the URL above in your browser.'));
  }
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Setup port is busy; reuse your open setup page or choose RELAY_SETUP_PORT.':'Setup server could not start.');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
