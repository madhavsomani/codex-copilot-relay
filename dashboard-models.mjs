// "Models and AI credits" panel: which model each client uses right now, and
// what each model spent today and over 7 days (Pacific days, both clients).
export const MODELS_STYLE = `
 .model-credits{margin:14px 0}.model-credits .now{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
 .model-credits .now span{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px}
 .model-credits .now strong{color:var(--text)}
 .model-credits .scroll{overflow-x:auto}.model-credits table{width:100%;border-collapse:collapse;font-size:12px;min-width:520px}
 .model-credits th,.model-credits td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
 .model-credits th:first-child,.model-credits td:first-child,.model-credits th:nth-child(2),.model-credits td:nth-child(2){text-align:left}
 .model-credits tfoot td{font-weight:600;color:var(--text)}
`;
export const MODELS_HTML = `
 <section class="panel model-credits" id="model-credits" aria-labelledby="model-credits-heading">
  <div class="panel-head"><div><h2 id="model-credits-heading">Models and AI credits</h2>
   <span class="tiny">Copilot AI credits from SDK usage receipts · Pacific days · native ChatGPT images are not Copilot credits</span></div></div>
  <div class="now" id="model-credits-now"><span>Checking current models…</span></div>
  <div class="scroll"><table><thead><tr><th>Model</th><th>Client</th><th>Calls today</th><th>Credits today</th><th>Credits 7 days</th><th>Avg credits/call</th></tr></thead>
   <tbody id="model-credits-rows"><tr><td colspan="6">Waiting for data…</td></tr></tbody><tfoot><tr id="model-credits-total"></tr></tfoot></table></div>
 </section>`;
export const MODELS_SCRIPT = String.raw`
 function pacificDayOf(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
 function modelCreditRows(data){
  const today=pacificDayOf(new Date()),week=new Set(Array.from({length:7},(_,i)=>pacificDayOf(new Date(Date.now()-i*86400000))));
  const rows=new Map();
  const add=(client,row,credits)=>{if(!week.has(row.day))return;const key=client+'|'+row.model;
   const item=rows.get(key)??{model:row.model,client,todayCalls:0,todayCredits:0,weekCredits:0,weekCalls:0};
   if(row.day===today){item.todayCalls+=row.sdkApiCalls||0;item.todayCredits+=credits;}
   item.weekCalls+=row.sdkApiCalls||0;item.weekCredits+=credits;rows.set(key,item);};
  for(const row of data.claude?.modelDaily||[])add('Claude Code',row,row.aiCredits||0);
  for(const row of data.analytics?.modelDaily||[])add('Codex',row,(row.totalNanoAiu||0)/1e9);
  return [...rows.values()].sort((a,b)=>b.todayCredits-a.todayCredits||b.weekCredits-a.weekCredits);
 }
 function latestModel(records,client){
  const record=(records||[]).filter(item=>(item.client==='claude-code')===(client==='claude-code')).sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)))[0];
  if(!record)return null;
  const actual=record.usage?.models?.map(item=>item.model).filter(Boolean)||[];
  return actual.at(-1)||record.selectedModel||record.requestedModel||null;
 }
 function renderModelCredits(data){
  const now=document.getElementById('model-credits-now');if(!now)return;
  now.replaceChildren(...[['Claude Code','claude-code'],['Codex','codex']].map(([label,client])=>{
   const span=document.createElement('span'),model=latestModel(data.records,client);
   span.append(label+' now: ');const strong=document.createElement('strong');strong.textContent=model||'no recent calls';span.append(strong);return span;}));
  const rows=modelCreditRows(data),body=document.getElementById('model-credits-rows'),cell=(text)=>{const td=document.createElement('td');td.textContent=text;return td;};
  const fixed=value=>value>=100?Math.round(value).toLocaleString():value.toFixed(value>=1?1:2);
  body.replaceChildren(...(rows.length?rows.map(item=>{const tr=document.createElement('tr');
   tr.append(cell(item.model),cell(item.client),cell(item.todayCalls.toLocaleString()),cell(fixed(item.todayCredits)),cell(fixed(item.weekCredits)),
    cell(item.weekCalls?fixed(item.weekCredits/item.weekCalls):'—'));return tr;}):[(()=>{const tr=document.createElement('tr');const td=cell('No metered calls in the last 7 days.');td.colSpan=6;tr.append(td);return tr;})()]));
  const total=rows.reduce((sum,item)=>({calls:sum.calls+item.todayCalls,today:sum.today+item.todayCredits,week:sum.week+item.weekCredits}),{calls:0,today:0,week:0});
  document.getElementById('model-credits-total').replaceChildren(cell('All models'),cell(''),cell(total.calls.toLocaleString()),cell(fixed(total.today)),cell(fixed(total.week)),cell(''));
 }
`;
