// Fixed owned-loopback metadata only. Never accept a browser path/port selector,
// read account files, send an inference bearer, or expose the raw health object.
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const id=value=>typeof value==='string'&&/^[\w.-]{1,100}$/.test(value)?value:null;
const stamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
async function healthJson(port){
  const response=await fetch(`http://127.0.0.1:${port}/health`,{redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!response.ok){await response.body?.cancel();throw Error('health');}
  const reader=response.body?.getReader(),chunks=[];let bytes=0;
  if(!reader)throw Error('body');
  try{while(true){const {value,done}=await reader.read();if(done)break;
    bytes+=value.byteLength;if(bytes>65536)throw Error('bound');chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createCodexObserver({port,version,model,effort=null,clientVersion=null,isAlive,readHealth=()=>healthJson(port),now=Date.now}){
  if(!Number.isInteger(port)||port<1024||port>65535||!id(version)||!id(model)||typeof isAlive!=='function')throw Error('Invalid observer identity');
  const base={provider:'github-copilot-sdk',port,version,selectedModel:model,effort:id(effort),
    clientVersion:typeof clientVersion==='string'?clientVersion.slice(0,100):null,automaticFallback:false,
    scope:'Owned portable Codex wrapper only; not desktop attachment or account-wide usage',
    authenticationScope:'SDK authentication/model discovery checked at launch; not continuous entitlement certification',
    modelAttribution:'Launcher selection; not per-request actual SDK model',
    usageScope:'Stored lifetime finalized-outcome SDK receipt subtotals; active or failed attempts may have unreported usage'};
  let cached,pending,expires=0;
  const unavailable=state=>({...base,sampledAt:new Date(now()).toISOString(),state,listening:state==='not-live'?false:null});
  return async()=>{
    if(!isAlive())return unavailable('not-live');
    if(cached&&now()<expires)return cached;if(pending)return pending;
    pending=(async()=>{
      try{
        const health=await readHealth();if(!isAlive())return unavailable('not-live');
        if(health?.provider!=='github-copilot-sdk'||health.version!==version||health.model!==model)throw Error('identity');
        const summary=health.telemetry?.summary,fields={};
        for(const key of ['received','completed','failed','sdkApiCalls','creditMeteredApiCalls','totalNanoAiu','inputTokens','outputTokens']){
          fields[key]=count(summary?.[key]);if(fields[key]===null)throw Error('counter');}
        if(fields.completed+fields.failed>fields.received||fields.creditMeteredApiCalls>fields.sdkApiCalls||count(health.activeExchanges)===null)throw Error('coverage');
        const lastRequestAt=stamp(health.lastCodexRequestAt),age=lastRequestAt?now()-Date.parse(lastRequestAt):Infinity;
        const ready=health.ok===true&&health.sdk?.ok===true;
        return {...base,sampledAt:new Date(now()).toISOString(),listening:true,sdkReady:ready,
          state:!ready?'worker-unavailable':age>=0&&age<120000?'traffic-observed':'listening',lastRequestAt,
          received:fields.received,completed:fields.completed,failed:fields.failed,activeExchanges:health.activeExchanges,
          sdkApiCalls:fields.sdkApiCalls,inputTokens:fields.sdkApiCalls?fields.inputTokens:null,outputTokens:fields.sdkApiCalls?fields.outputTokens:null,
          creditReportedCalls:fields.creditMeteredApiCalls,
          aiCredits:fields.creditMeteredApiCalls?fields.totalNanoAiu/1e9:null,
          creditReporting:!fields.creditMeteredApiCalls?'unreported':fields.creditMeteredApiCalls<fields.sdkApiCalls?'partial':'reported'};
      }catch{return unavailable('unavailable');}
    })().then(value=>{cached=value;expires=now()+10000;return value;}).finally(()=>{pending=null;});return pending;
  };
}
export const CODEX_OBSERVER_SCRIPT=`
(function(){
const text=(id,value)=>{const element=document.getElementById(id);if(element)element.textContent=value;};
const number=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'Unreported';
const states={listening:'Owned gateway listening · awaiting traffic','traffic-observed':'Recent Codex-labelled request observed','worker-unavailable':'Gateway listening · SDK unavailable','not-live':'Wrapper gateway stopped',unavailable:'Live metadata unavailable'};
let inFlight=false,last=null;
function render(view){last=view;
 text('codex-live-state',states[view.state]||'Live metadata unavailable');
 text('codex-live-route','GitHub Copilot SDK · relay v'+(view.version||'Unknown')+' · port '+(view.port||'Unknown')+' · selected '+(view.selectedModel||'Unknown')+' · effort '+(view.effort||'Unspecified'));
 for(const [id,key] of [['received','received'],['completed','completed'],['failed','failed'],['receipts','sdkApiCalls'],['input','inputTokens'],['output','outputTokens'],['active','activeExchanges']])text('codex-live-'+id,number(view[key]));
 text('codex-live-credits',typeof view.aiCredits==='number'&&Number.isFinite(view.aiCredits)?view.aiCredits.toLocaleString(undefined,{maximumFractionDigits:6})+' · '+view.creditReporting:'Unreported');
 text('codex-live-reporting','Credit reports '+number(view.creditReportedCalls)+' / '+number(view.sdkApiCalls)+' receipts · cached up to 10 seconds · '+(view.sampledAt?'sampled '+new Date(view.sampledAt).toLocaleTimeString():'no current sample'));
 text('codex-connection-label',states[view.state]||'Live metadata unavailable');text('codex-connection-detail','Process-scoped stock CLI only · saved desktop routing unchanged');
 text('restore-connection-label','No saved routing to restore');text('setup-config-state','Child-only routing. Close this wrapper, then run plain codex with your unchanged saved configuration.');
 text('setup-relay-state','This page observes only its portable Codex wrapper, not the desktop relay.');
 text('copilot-connection-label',view.sdkReady?'SDK ready · launch sign-in checked':'SDK metadata unavailable');
 text('copilot-connection-detail','Authentication/catalog checked at launch; not a remaining entitlement check');
}
document.addEventListener('relay-setup-status',()=>{if(last)render(last);});
async function check(){if(inFlight)return;inFlight=true;try{
 const response=await fetch('/dashboard/setup/codex',{cache:'no-store',signal:AbortSignal.timeout(6000)});
 if(!response.ok)throw Error();render(await response.json());
}catch{render({state:'unavailable'});}finally{inFlight=false;}}
check();setInterval(()=>{if(!document.hidden)return check();},10000);
})();`;
const observerHtml=`<article id="codex-live"><div class="tag">Read-only · owned wrapper · stock CLI</div><h2>Live portable Codex</h2>
<p id="codex-live-state" role="status">Checking owned gateway…</p><p class="models" id="codex-live-route"></p>
<div class="claude-metrics"><div><small>Responses received</small><strong id="codex-live-received">Unreported</strong></div><div><small>Completed / failed</small><strong><span id="codex-live-completed">Unreported</span> / <span id="codex-live-failed">Unreported</span></strong></div><div><small>Active exchanges / sessions</small><strong id="codex-live-active">Unreported</strong></div><div><small>SDK usage receipts</small><strong id="codex-live-receipts">Unreported</strong></div><div><small>Input / output tokens</small><strong><span id="codex-live-input">Unreported</span> / <span id="codex-live-output">Unreported</span></strong></div><div><small>Reported AI credits</small><strong id="codex-live-credits">Unreported</strong></div></div>
<p class="models" id="codex-live-reporting"></p><p class="note">Recent traffic includes failed requests, not proof of a successful answer. Model above is launcher selection, not per-request actual SDK attribution. Receipt totals cover stored finalized outcomes, not all active or failed attempts. Normalized token fields may contain stored zeros for unreported fields. Unknown credits are not free calls. AI credits = reported totalNanoAiu / 1e9, not dollars, an invoice or remaining entitlement.</p>
<p>No inference bearer is shared with this page. No automatic provider fallback. Authentication/model discovery was checked at launch, not continuously certified. Saved usage below is separate history and may overlap these same counters; do not add the panels together.</p><p>Close the stock client/wrapper to close this observer and its owned gateway. Plain <code>codex</code> in a fresh terminal uses unchanged saved configuration. No TOML restoration is needed. This is not desktop, iPhone Remote or voice attachment.</p></article>`;
export function renderCodexObserverPage(html){
  return html.replace(/<a class="primary" href="[^"]*">Open dashboard →<\/a>/,'<a class="primary" href="#codex-live">Live wrapper usage →</a>')
    .replaceAll('href="/dashboard/setup#codex"','href="#codex-live"').replaceAll('href="/dashboard/setup#restore"','href="#codex-live"')
    .replace('<article id="local-usage">',observerHtml+'<article id="local-usage">')
    .replace('</body>','<style>#codex,#restore{display:none}</style><script>'+CODEX_OBSERVER_SCRIPT+'</script></body>');
}
