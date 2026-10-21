// Metadata-only proof for the canonical combined server. No model inference,
// client configuration edits or production process restart. --hold permits UI QA.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createInterface} from 'node:readline';
import {codexServerEnvironment} from './codex-gateway/launch.mjs';
const root=fileURLToPath(new URL('./',import.meta.url));
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port;await new Promise(r=>listener.close(r));
const directory=fs.mkdtempSync(path.join(root,'runtime','managed-metadata-'));
const codexKey=randomBytes(32).toString('hex'),claudeKey=randomBytes(32).toString('hex');
const env=codexServerEnvironment({port,model:'gpt-6.1-sol',runtimeDirectory:directory,cwd:root,token:codexKey},process.env);
env.BRIDGE_CLAUDE_TOKEN=claudeKey;env.BRIDGE_MANAGED_DESKTOP='1';
delete env.BRIDGE_AUTH_TOKEN; // Match the existing loopback-only desktop mode.
const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.resume();child.stderr.resume();let exited=false;child.once('exit',()=>{exited=true;});
let health,report;
const cancelActive=process.argv.includes('--cancel-active'),uploads=[];
try{
  const base=`http://127.0.0.1:${port}`,deadline=Date.now()+60000;
  while(Date.now()<deadline&&!exited){
    try{const response=await fetch(base+'/health',{signal:AbortSignal.timeout(1500)});health=await response.json();
      if(health.ok&&health.unified&&health.claude?.sdkState==='ready')break;}catch{}
    await delay(250);
  }
  if(!health?.ok||!health.unified||health.claude?.sdkState!=='ready')throw new Error('Metadata startup failed. No inference or client configuration change was requested.');
  const codex=await fetch(base+'/v1/models',{headers:{authorization:'Bearer '+codexKey}});
  const claude=await fetch(base+'/claude/v1/models',{headers:{authorization:'Bearer '+claudeKey}});
  const denied=await fetch(base+'/claude/v1/models',{headers:{authorization:'Bearer '+codexKey}});
  const openaiModels=await codex.json(),claudeModels=await claude.json();await denied.text();
  if(codex.status!==200||claude.status!==200||denied.status!==401)throw new Error('Catalog/authentication separation check failed.');
  report={version:health.version,port,serverPid:child.pid,unified:health.unified,managedDesktop:health.lifecycle?.managedDesktop,
    codexModels:health.models.length,claudeModels:claudeModels.data.length,wrongClaudeKeyStatus:denied.status,
    activeExchanges:health.activeExchanges,model:health.model,effort:health.compatibility.defaultReasoningEffort,
    claudeSessionCapacity:health.claude.sessionCapacity,codexSessionCapacity:health.sdk.maxSessions,
    inferenceRequests:0,dashboard:base+'/dashboard/setup',directory};
  const dashboard=await fetch(base+'/dashboard');const dashboardHtml=await dashboard.text();
  const original=(await import('./dashboard.mjs')).DASHBOARD_HTML.replaceAll('__CLAUDE_GATEWAY_BASE__',base+'/claude');
  if(dashboard.status!==200||dashboardHtml!==original)throw new Error('Original dashboard was not preserved.');
  report.originalDashboardPreserved=true;
  if(health.claude.sessionCapacity.limit!==128||health.claude.sessionCapacity.available!==128)
    throw new Error('Combined gateway did not apply the default Claude capacity.');
  if(cancelActive){
    if(health.lifecycle?.cancelActive!==true)throw new Error('Server does not advertise intentional cancellation.');
    // Deliberately incomplete uploads exercise real admission in both adapters,
    // without creating a session or spending model-inference credits.
    for(const [route,key] of [['/v1/responses',codexKey],['/claude/v1/messages',claudeKey]]){
      let resolve;
      const done=new Promise(r=>{resolve=r;});
      const req=http.request(base+route,{method:'POST',headers:{authorization:'Bearer '+key,
        'content-type':'application/json','anthropic-version':'2023-06-01','content-length':'1000000'}},res=>{
        res.resume();res.once('end',()=>resolve({route,status:res.statusCode}));
        res.once('error',error=>resolve({route,error:error.code}));
      });
      req.once('error',error=>resolve({route,error:error.code}));req.write('{');uploads.push({req,done});
    }
    const until=Date.now()+5000;
    do{
      health=await(await fetch(base+'/health')).json();
      if(health.lifecycle.admittedRequests>=2)break;
      await delay(50);
    }while(Date.now()<until);
    if(health.lifecycle.admittedRequests!==2)throw new Error('Both unfinished uploads were not admitted.');
    report.activeUploadsBeforeStop=health.lifecycle.admittedRequests;
    // An automatic update must wait even when uploads have no SDK session yet.
    fs.writeFileSync(path.join(directory,'relay-stop.json'),JSON.stringify({instanceId:health.lifecycle.instanceId,mode:'drain'}));
    await delay(1250);
    const busy=await(await fetch(base+'/health')).json();
    if(exited||busy.lifecycle.instanceId!==health.lifecycle.instanceId||busy.lifecycle.admittedRequests!==2)
      throw new Error('Drain-only update interrupted active uploads.');
    report.busyDrainPreservedBothAdapters=true;
  }
  fs.writeFileSync(path.join(directory,'metadata-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(process.argv.includes('--hold')){
    console.log('Holding metadata-only server for read-only UI QA. Enter quit to stop this owned test instance.');
    const terminal=createInterface({input:process.stdin,output:process.stdout});
    await new Promise(resolve=>{terminal.on('line',line=>{if(line==='quit')resolve();});terminal.once('close',resolve);});terminal.close();
  }
}finally{
  if(!exited&&health?.lifecycle?.instanceId){
    const started=Date.now();
    fs.writeFileSync(path.join(directory,'relay-stop.json'),JSON.stringify({instanceId:health.lifecycle.instanceId,...(cancelActive?{mode:'cancel-active'}:{})}));
    const until=Date.now()+20000;while(!exited&&Date.now()<until)await delay(100);
    if(report)report.stopElapsedMs=Date.now()-started;
  }
  if(!exited){child.kill('SIGTERM');throw new Error('Metadata test did not confirm graceful exit. No production process was targeted.');}
  if(fs.existsSync(path.join(directory,'claude','gateway.owner.json')))throw new Error('Claude ownership was not released.');
  if(uploads.length){
    const results=await Promise.race([Promise.all(uploads.map(upload=>upload.done)),delay(3000).then(()=>null)]);
    for(const upload of uploads)upload.req.destroy();
    if(!results||results.some(result=>result.status!==503&&result.error!=='ECONNRESET'))throw new Error('Incomplete upload cancellation failed: '+JSON.stringify(results));
    report.cancelledUploads=results;report.claudeLeaseReleased=true;
  }
  if(report){fs.writeFileSync(path.join(directory,'metadata-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
  console.log('METADATA_ONLY_BOTH_ADAPTERS_AND_GRACEFUL_OWNED_SHUTDOWN_OK');
}
