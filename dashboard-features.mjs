// "Relay features" panel: switch the relay's optional additions on or off.
// Changes apply live and persist (POST /dashboard/features, same-origin only).
export const FEATURES_STYLE = `
 .relay-features{margin:14px 0}.relay-features .feature-list{display:grid;gap:8px;margin-top:8px}
 .relay-features .feature{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
 .relay-features .feature input{width:18px;height:18px;margin-top:2px;cursor:pointer}
 .relay-features .feature label{font-weight:650;cursor:pointer}
 .relay-features .feature .meta{grid-column:2;color:var(--muted);font-size:12px}
 .relay-features .feature .tag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 7px;margin-left:6px;font-size:11px;font-weight:500;color:var(--muted)}
 .relay-features .feature .tag.spends{color:var(--warn);border-color:var(--warn)}
 .relay-features .warm-stats{margin-top:8px;font-size:12px;color:var(--muted)}
 .relay-features .feature-error{color:var(--bad);font-size:12px;margin-top:6px}
`;
export const FEATURES_HTML = `
 <section class="panel relay-features" id="relay-features" aria-labelledby="relay-features-heading">
  <div class="panel-head"><div><h2 id="relay-features-heading">Relay features</h2>
   <span class="tiny">Optional relay additions. Switches apply immediately and are remembered; you can also choose them when starting the relay (see docs/RELAY-FEATURES.md).</span></div></div>
  <div class="feature-list" id="relay-feature-list"><span class="tiny">Loading features…</span></div>
  <div class="warm-stats" id="keep-warm-stats"></div>
  <div class="feature-error" id="relay-feature-error" role="alert"></div>
 </section>`;
export const FEATURES_SCRIPT = String.raw`
 let featureBusy=false;
 function keepWarmText(stats){
  if(!stats||!(stats.pings||stats.failed))return 'Keep-warm: no pings sent yet.';
  const credits=new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(stats.estimatedAiCredits||0);
  return 'Keep-warm so far: '+stats.pings.toLocaleString()+' pings, about '+credits+' AI credits (estimated from measured rates)'+
   (stats.failed?' · '+stats.failed+' failed (warming stops for that chat)':'')+' · cached tokens read: '+(stats.cacheReadTokens||0).toLocaleString()+'.';
 }
 function renderFeatures(data){
  const list=document.getElementById('relay-feature-list');if(!list||featureBusy)return;
  const features=data.features||[];
  if(!features.length){list.textContent='Feature switches are unavailable on this relay version.';return;}
  const signature=JSON.stringify(features.map(item=>[item.id,item.enabled]));
  if(list.dataset.signature!==signature){
   list.dataset.signature=signature;
   list.replaceChildren(...features.map(item=>{
    const row=document.createElement('div');row.className='feature';
    const input=document.createElement('input');input.type='checkbox';input.id='feature-'+item.id;input.checked=item.enabled;
    input.addEventListener('change',()=>toggleFeature(item.id,input.checked,input));
    const label=document.createElement('label');label.htmlFor=input.id;label.textContent=item.label;
    const client=document.createElement('span');client.className='tag';client.textContent=item.client;label.append(client);
    if(item.spends){const spends=document.createElement('span');spends.className='tag spends';spends.textContent='uses AI credits';label.append(spends);}
    const meta=document.createElement('div');meta.className='meta';
    meta.textContent=item.description+' Default: '+(item.default?'on':'off')+'.';
    row.append(input,label,meta);return row;}));
  }
  document.getElementById('keep-warm-stats').textContent=keepWarmText(data.claude?.keepWarm);
 }
 async function toggleFeature(id,enabled,input){
  featureBusy=true;input.disabled=true;const error=document.getElementById('relay-feature-error');error.textContent='';
  try{
   const response=await fetch('/dashboard/features',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,enabled})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error?.message||('HTTP '+response.status));
   document.getElementById('relay-feature-list').dataset.signature='';featureBusy=false;renderFeatures({features:result.features});
  }catch(failure){input.checked=!enabled;error.textContent='Could not change this feature: '+failure.message;}
  finally{featureBusy=false;input.disabled=false;}
 }
`;
