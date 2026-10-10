// Dependency-free, read-only setup portal. Also embeds in the Claude launcher;
// callbacks project metadata in-process rather than leaking its bearer token.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createSetupStatus,captureJson,sameOriginLocal} from './setup-status.mjs';
import {SETUP_HTML} from './setup-ui.mjs';
import {createLocalUsageReader} from './local-usage-history.mjs';
const defaultRoot=path.dirname(fileURLToPath(import.meta.url));
export async function createSetupPortal({root=defaultRoot,port=4143,relayPort=4144,claude,inspect,auth,relay,codexObserver}={}){
  if(!Number.isInteger(port)||port<0||port>65535||port>0&&port<1024||!Number.isInteger(relayPort)||relayPort<1024||relayPort>65535||port===relayPort)
    throw new Error('Invalid setup ports');
  const usage=createLocalUsageReader({root});
  // Loaded only for an owned Codex wrapper. Dependency-free standalone setup
  // and the existing desktop/Claude pages retain their original source/markup.
  const codexPage=codexObserver?(await import('./codex-gateway/observer.mjs')).renderCodexObserverPage:null;
  const status=createSetupStatus({root,port:relayPort,claude,inspect,
    relay:relay??(async()=>{try{const response=await fetch(`http://127.0.0.1:${relayPort}/health`,{signal:AbortSignal.timeout(4000)});
      const data=await response.json();return data.provider==='github-copilot-sdk'?data:null;}catch{return null;}}),
    auth:auth??(async()=>captureJson(process.execPath,[path.join(root,'probe-setup-auth.mjs')],{cwd:root,timeoutMs:25000}))});
  const server=http.createServer(async(request,response)=>{
    const boundPort=server.address().port;
    const reply=(code,type,body)=>{response.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',
      'content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});response.end(body);};
    if(!sameOriginLocal(request,boundPort))return reply(403,'text/plain','Loopback same-origin requests only');
    if(request.method!=='GET')return reply(405,'text/plain','Read-only setup. Use documented local commands for changes.');
    const url=new URL(request.url,`http://127.0.0.1:${boundPort}`);
    if(url.pathname==='/setup-health')return reply(200,'application/json',JSON.stringify({kind:'codex-copilot-setup',root,relayPort}));
    if(url.pathname==='/dashboard/setup/codex'&&codexObserver){
      if(url.search)return reply(400,'application/json',JSON.stringify({error:'No selectors or query options accepted'}));
      try{return reply(200,'application/json',JSON.stringify(await codexObserver()));}
      catch{return reply(503,'application/json',JSON.stringify({error:'Owned Codex metadata unavailable'}));}
    }
    if(url.pathname==='/dashboard/setup/usage'){
      if(url.search)return reply(400,'application/json',JSON.stringify({error:'No path selectors or query options are accepted'}));
      try{return reply(200,'application/json',JSON.stringify(await usage()));}
      catch{return reply(503,'application/json',JSON.stringify({error:'Local usage metadata unavailable'}));}
    }
    if(url.pathname==='/dashboard/setup/status'){try{return reply(200,'application/json',JSON.stringify(await status()));}
      catch{return reply(503,'application/json',JSON.stringify({error:'Setup check unavailable'}));}}
    if(['/','/dashboard','/dashboard/setup'].includes(url.pathname)){
      const html=SETUP_HTML.replaceAll('__DASHBOARD_URL__',`http://127.0.0.1:${relayPort}/dashboard`);
      return reply(200,'text/html; charset=utf-8',codexPage?codexPage(html):html);
    }
    return reply(404,'text/plain','Not found');
  });
  return {server,status,
    listen:()=>new Promise((resolve,reject)=>{const failed=error=>reject(error);server.once('error',failed);
      server.listen(port,'127.0.0.1',()=>{server.off('error',failed);resolve(`http://127.0.0.1:${server.address().port}/dashboard/setup`);});}),
    close:async()=>{if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}};
}
export async function run(){
  const portal=await createSetupPortal({port:Number(process.env.RELAY_SETUP_PORT||4143),relayPort:Number(process.env.BRIDGE_PORT||4144)});
  const url=await portal.listen();console.log('Read-only connection center: '+url+' (Ctrl+C closes setup, not the relay)');
  if(process.argv.includes('--open')&&process.platform==='win32'){
    const browser=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});browser.on('error',()=>console.log('Open the URL above in your browser.'));
  }
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void portal.close().then(()=>process.exit(0)));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
  run().catch(error=>{console.error(error.code==='EADDRINUSE'?'Setup port is busy; reuse your open setup page or choose RELAY_SETUP_PORT.':'Setup server could not start.');process.exitCode=1;});
