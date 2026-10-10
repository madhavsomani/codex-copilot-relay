export const CONNECTION_STYLE = `
.connection-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 18px}
.connection-card{display:block;border:1px solid #263958;border-radius:12px;padding:15px 17px;color:#eef5ff;background:#111a2d;text-decoration:none;min-width:0}
.connection-card:hover{border-color:#69b7ff}.connection-card strong{display:block;font-size:17px;margin:6px 0;overflow-wrap:anywhere}.connection-card small{color:#91a5c4;display:block;line-height:1.6}
.connection-card[data-state=good]{border-left:3px solid #6ddd9a}.connection-card[data-state=warn]{border-left:3px solid #ffd27a}.connection-card[data-state=error]{border-left:3px solid #ff8398}
@media(max-width:760px){.connection-grid{grid-template-columns:1fr}}
`;
export const CONNECTION_HTML = `
<section class="connection-grid" aria-label="Connections">
<a class="connection-card" id="connection-copilot" href="/dashboard/setup#copilot"><small>GITHUB COPILOT</small><strong id="copilot-connection-label">Checking sign-in…</strong><small id="copilot-connection-detail">SDK authentication and model access · details →</small></a>
<a class="connection-card" id="connection-codex" href="/dashboard/setup#codex"><small>CODEX</small><strong id="codex-connection-label">Checking configuration…</strong><small id="codex-connection-detail">Configuration and observed traffic · details →</small></a>
<a class="connection-card" id="connection-restore" href="/dashboard/setup#restore"><small>RESTORE & SETUP</small><strong id="restore-connection-label">Checking backup…</strong><small id="connection-checked">Unmodified Codex · reversible provider configuration</small></a>
</section>`;
export const CONNECTION_SCRIPT = `
(function(){
const labels={ready:'Connected · models available','no-models':'Signed in · no GPT access','sign-in':'Sign-in required',unavailable:'Check unavailable',unknown:'Check unavailable','not-found':'Installation not found','not-configured':'Not configured','relay-offline':'Configured · relay offline',configured:'Configured · awaiting traffic','traffic-observed':'Recent Codex traffic'};
const text=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
let inFlight=false;
async function check(){if(inFlight)return;inFlight=true;try{
const response=await fetch('/dashboard/setup/status',{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();
text('copilot-connection-label',labels[data.states.copilot]||'Unknown');
text('codex-connection-label',labels[data.states.codex]||'Unknown');
text('copilot-connection-detail',data.dependencies?(data.copilot.models||[]).length+' available GPT models · inspect setup →':'Install dependencies using the setup guide →');
text('codex-connection-detail',data.states.lastSeenAt?'Last request '+new Date(data.states.lastSeenAt).toLocaleTimeString()+' · observed, not a persistent connection':'Reopen a Codex task and send a prompt to verify routing →');
text('restore-connection-label',({verified:'Original config protected',invalid:'Backup needs attention','not-created':'Ready for first setup'})[data.installation.backup]||'Backup not verified');
text('connection-checked','Checked '+new Date(data.sampledAt).toLocaleTimeString()+' · status cache up to 30 seconds');
for(const name of ['copilot','codex']){const node=document.getElementById('connection-'+name);if(node)node.dataset.state=['ready','traffic-observed'].includes(data.states[name])?'good':'warn';}
const restore=document.getElementById('connection-restore');if(restore)restore.dataset.state=data.installation.backup==='verified'?'good':data.installation.backup==='invalid'?'error':'warn';
text('setup-relay-state',data.relay?.ok?'Relay running · v'+data.relay.version+' · '+data.relay.model:'Relay is not ready yet. Follow the steps below.');
text('setup-models',(data.copilot.models||[]).join(', ')||'Models appear after sign-in.');
text('setup-config-state',data.installation.customHome?'Using your CODEX_HOME override.':'Using the current user’s .codex directory.');
document.dispatchEvent(new CustomEvent('relay-setup-status',{detail:data}));
}catch{text('copilot-connection-label','Status unavailable');text('codex-connection-label','Status unavailable');text('connection-checked','Run npm run setup to open diagnostics.');document.dispatchEvent(new CustomEvent('relay-setup-status',{detail:null}));}finally{inFlight=false;}}
check();setInterval(()=>{if(!document.hidden)check();},5000);
})();`;

export const CLAUDE_SETUP_SCRIPT = `
(function(){
const text=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
const number=value=>Number.isFinite(value)?value.toLocaleString():'Unreported';
const credit=value=>value.aiCredits===null||value.aiCredits===undefined?'Unreported':value.aiCredits.toLocaleString(undefined,{maximumFractionDigits:6})+(value.creditReporting==='partial'?' (partial)':'');
function table(id,rows){const body=document.getElementById(id);if(!body)return;body.replaceChildren();
 for(const values of rows){const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}body.append(row);}}
document.addEventListener('relay-setup-status',event=>{
 const data=event.detail,view=data?.claude?.gateway;
 const labels={'traffic-observed':'Recent Claude request observed',listening:'Gateway listening · awaiting traffic','not-attached':'Installed · launch the preview','not-found':'Claude Code not found',unknown:'Installation check unavailable','worker-unavailable':'Gateway up · SDK worker unavailable'};
 text('claude-connection-label',data?labels[data.states.claude]||'Check unavailable':'Status unavailable');
 const status=document.getElementById('claude-status');if(status)status.dataset.state=data&&data.states.claude==='traffic-observed'?'good':'warn';
 text('claude-connection-detail',view?.listening?'Adapter v'+view.version+' · port '+view.port+' · GitHub Copilot SDK':data?.claude?.installation?.version?'Stock Claude '+data.claude.installation.version+' · this portal is not attached to a gateway':'Only the Claude wrapper’s own connection center can observe its live gateway.');
 text('claude-models',view?.models?.join(', ')||'Model discovery runs inside the wrapper using your authenticated SDK catalog.');
 text('claude-received',view?number(view.received):'—');text('claude-completed',view?number(view.completed):'—');text('claude-failed',view?number(view.failed):'—');
 text('claude-sdk-calls',view?number(view.sdkApiCalls):'—');text('claude-input',view?number(view.inputTokens):'—');text('claude-output',view?number(view.outputTokens):'—');text('claude-credits',view?credit(view):'Unreported');
 text('claude-reporting',view?'Credit reporting: '+number(view.creditReportedCalls)+' / '+number(view.sdkApiCalls)+' usage receipts. Failed/unreported attempts may have additional usage.':'No active wrapper data. This page does not authenticate to the gateway or read account credentials.');
 text('claude-transport',view?'HTTP attempts '+number(view.transport.attempts)+' · HTTP errors '+number(view.transport.httpErrors)+' · network errors '+number(view.transport.networkErrors)+' · active requests '+number(view.activeRequests)+' · pending/session turns '+number(view.activeTurns):'');
 table('claude-model-usage',(view?.usage||[]).map(row=>[row.model,number(row.sdkApiCalls),number(row.inputTokens),number(row.outputTokens),credit(row)]));
 table('claude-recent',(view?.recent||[]).map(row=>[row.at?new Date(row.at).toLocaleTimeString():'Unknown',row.status+(row.httpStatus?' · '+row.httpStatus:''),row.requestedModel||'Unknown',row.selectedModel||'Not routed',row.actualModels.join(', ')||'Unreported',credit(row)]));
 if(data?.copilot?.claudeModels?.length){text('copilot-connection-label',data.copilot.authenticated?'Connected · model access reported':'Sign-in required');
 text('copilot-connection-detail',(data.copilot.models||[]).length+' GPT · '+data.copilot.claudeModels.length+' Claude models · SDK catalog');}
});
})();`;

export const LOCAL_USAGE_SCRIPT = `
(function(){
const text=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value.toLocaleString():'Unreported';
const names={'github-copilot-sdk':'GitHub Copilot SDK','openai-codex':'OpenAI · Codex helper','openai-platform':'OpenAI · Platform helper'};
const clients={'codex-desktop':'Desktop Codex','codex-cli':'Portable Codex','claude-code':'Claude Code'};
const label=value=>String(value??'Unreported').slice(0,240);
const credit=row=>row.creditReporting==='not-applicable'?'Not applicable':
 typeof row.aiCredits!=='number'||!Number.isFinite(row.aiCredits)?'Unreported':
 row.aiCredits.toLocaleString(undefined,{maximumFractionDigits:6})+' · '+(row.creditReporting==='reported'?'reported':'partial');
function table(id,rows,max){const body=document.getElementById(id);if(!body)return;body.replaceChildren();
 for(const values of rows.slice(0,max)){const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');
 cell.textContent=label(value);row.append(cell);}body.append(row);}}
const sourceName=row=>(clients[row.client]||'Local client')+(Number.isInteger(row.port)?' · port '+row.port:'');
function render(view){
 const sources=Array.isArray(view.sources)?view.sources.slice(0,32):[],providers=Array.isArray(view.providers)?view.providers.slice(0,3):[];
 const states={empty:'No saved local usage yet. A completed wrapper request creates its own ledger.',
  unavailable:'Unavailable · canonical local ledgers could not be read.',partial:'Partial scan · some ledgers were unreadable or omitted.',available:'Saved history · not a live connection'};
 text('local-usage-state',states[view.scanStatus]||'Unavailable · unknown metadata state');
 text('local-usage-scope',label(view.scope));
 text('local-usage-sampled',view.sampledAt?'Sampled '+new Date(view.sampledAt).toLocaleTimeString()+' · 10-second cache · '+sources.length+' ledger projections':'No sample available');
 table('local-usage-providers',providers.map(row=>[names[row.provider]||'Unrecognized provider',
  number(row.received)+' received · '+number(row.completed)+' completed · '+number(row.failed)+' failed',
  row.provider==='github-copilot-sdk'?number(row.sdkApiCalls)+' SDK receipts':number(row.usageReportedCalls)+' usage reports',
  number(row.inputTokens),number(row.outputTokens),credit(row),
  row.provider==='github-copilot-sdk'?number(row.creditReportedCalls)+' / '+number(row.sdkApiCalls)+' receipts report credits':'Separate OpenAI subtotal']),3);
 table('local-usage-sources',sources.map(row=>row.status!=='available'?[sourceName(row),'Unavailable','—','—','—','No totals included']:
  [sourceName(row),names[row.provider]||'Unrecognized provider',
   number(row.received)+' received · '+number(row.completed)+' completed · '+number(row.failed)+' failed',
   number(row.unfinishedRecorded)+' unfinished recorded · not live',
   credit(row),row.modelAttribution+(row.meteredRequestOutcomes!==null&&row.meteredRequestOutcomes!==undefined?
    ' · '+number(row.meteredRequestOutcomes)+' metered / '+number(row.unmeteredRequestOutcomes)+' unmetered outcomes':' · Request coverage unavailable')]),32);
 const models=[];for(const source of sources){if(source.status!=='available')continue;
  for(const row of (Array.isArray(source.models)?source.models:[]).slice(0,16))models.push([
   sourceName(source),label(row.model),number(row.sdkApiCalls),number(row.inputTokens),number(row.outputTokens),credit(row),source.modelAttribution]);}
 table('local-usage-models',models,512);
 text('local-usage-bounds',view.truncated?'Bounded scan: additional local sources may be omitted. Totals cover included sources only.':
  sources.some(row=>row.modelsTruncated)?'Some model lists are shortened to 16 buckets. Source totals still include their stored lifetime counters.':'Up to 32 source projections and 16 model buckets per source. No recursive backup discovery.');
}
let inFlight=false;
async function check(){if(inFlight)return;inFlight=true;try{
 const response=await fetch('/dashboard/setup/usage',{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error();render(await response.json());
}catch{for(const id of ['local-usage-providers','local-usage-sources','local-usage-models'])table(id,[],0);
 text('local-usage-state','Unavailable · local usage check failed. No zero totals or live connection inferred.');
 text('local-usage-sampled','No current usage sample');text('local-usage-bounds','');
}finally{inFlight=false;}}
check();setInterval(()=>{if(!document.hidden)return check();},10000);
})();`;

export const LOCAL_USAGE_HTML = `
<style>#local-usage table{min-width:860px}#local-usage th{white-space:nowrap}#local-usage-providers td:nth-child(4),#local-usage-providers td:nth-child(5),#local-usage-models td:nth-child(3),#local-usage-models td:nth-child(4),#local-usage-models td:nth-child(5){white-space:nowrap}#local-usage .table-scroll:focus-visible{outline:2px solid #69b7ff;outline-offset:3px}</style>
<article id="local-usage"><div class="tag">Read-only · multi-client history</div><h2>Saved local usage</h2>
<p id="local-usage-state" role="status">Loading saved counters…</p>
<p id="local-usage-scope">This checkout’s canonical local ledgers only. Not account-wide usage; copied histories may overlap.</p>
<p class="models" id="local-usage-sampled"></p>
<h3>Reported lifetime provider subtotals</h3><p class="models">Scroll tables horizontally on narrow screens. Each ledger has its own history start/reset; these totals do not share an account-wide time range.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Reported lifetime provider usage"><table><thead><tr><th>Provider</th><th>Requests</th><th>Usage evidence</th><th>Input tokens</th><th>Output tokens</th><th>AI credits</th><th>Credit coverage</th></tr></thead><tbody id="local-usage-providers"></tbody></table></div>
<p class="models">Tokens are stored receipt subtotals, not full request coverage. Several SDK receipts may belong to one request; attempts without receipts may consume additional usage. Stored SDK normalization may have written zero for absent token fields. Credits = reported totalNanoAiu / 1e9, not dollars or your remaining entitlement. OpenAI usage stays separate; no automatic inference fallback.</p>
<details><summary>Included client ledgers &amp; model attribution</summary><div class="table-scroll" tabindex="0" role="region" aria-label="Included client ledgers"><table><thead><tr><th>Client</th><th>Provider</th><th>Outcomes</th><th>Unfinished recorded</th><th>AI credits</th><th>Evidence boundary</th></tr></thead><tbody id="local-usage-sources"></tbody></table></div></details>
<details><summary>Saved model receipt buckets</summary><div class="table-scroll" tabindex="0" role="region" aria-label="Saved model receipt buckets"><table><thead><tr><th>Client</th><th>Stored model</th><th>SDK receipts</th><th>Input tokens</th><th>Output tokens</th><th>AI credits</th><th>Attribution</th></tr></thead><tbody id="local-usage-models"></tbody></table></div></details>
<p class="models" id="local-usage-bounds"></p><p class="note">Saved history is not a live connection. The separate Claude preview section below observes only the gateway owned by this page’s wrapper. This panel cannot prove another gateway is running.</p></article>`;

export const SETUP_HTML = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect · Codex Copilot Relay</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{margin:0;background:#080d19;color:#eef5ff;font:15px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:36px 22px 70px}h1{font-size:32px;letter-spacing:-.035em;margin:0}h2{font-size:20px;margin:0 0 10px}p{margin:8px 0 18px;color:#a8b8d0}a{color:#8bc8ff}code{overflow-wrap:anywhere;color:#b9e8db}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#080d19;padding:14px;border-radius:8px}article{background:#111a2d;border:1px solid #263958;padding:22px;border-radius:14px;margin:14px 0;scroll-margin-top:16px}.tag{font-size:12px;color:#69b7ff;text-transform:uppercase;letter-spacing:.12em}.primary{display:inline-block;background:#203c61;border:1px solid #4274ac;border-radius:8px;padding:10px 16px;color:#fff;text-decoration:none}.note{border-left:3px solid #ffd27a;padding-left:15px}.row{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:24px;flex-wrap:wrap}button{font:inherit;color:#fff;background:#203c61;border:1px solid #4274ac;padding:8px 14px;border-radius:8px;cursor:pointer}.models{font-size:12px;overflow-wrap:anywhere}${CONNECTION_STYLE}</style></head><body><main>
<div class="row"><div><div class="tag">Codex Copilot Relay · connection center</div><h1>Your subscription. Your workspace.</h1><p>GitHub Copilot inference in stock Codex. No patched app, no account-token copying.</p></div><a class="primary" href="__DASHBOARD_URL__">Open dashboard →</a></div>
${CONNECTION_HTML}
<p id="setup-relay-state" role="status">Checking the Codex relay…</p>
${LOCAL_USAGE_HTML}
<article id="claude"><div class="tag">Isolated Claude Code preview · stock client</div><h2 id="claude-connection-label" role="status">Checking Claude Code…</h2><p id="claude-connection-detail"></p>
<p class="note">A listening gateway is not a completed inference. Recent requests include rejections and failures; inspect the outcome and actual SDK model below. This wrapper routes inference only to GitHub Copilot. There is no automatic OpenAI or direct Anthropic fallback.</p>
<div class="claude-metrics" id="claude-status"><div><small>Messages received</small><strong id="claude-received">—</strong></div><div><small>Completed / failed</small><strong><span id="claude-completed">—</span> / <span id="claude-failed">—</span></strong></div><div><small>SDK usage receipts</small><strong id="claude-sdk-calls">—</strong></div><div><small>Input tokens</small><strong id="claude-input">—</strong></div><div><small>Output tokens</small><strong id="claude-output">—</strong></div><div><small>Reported AI credits</small><strong id="claude-credits">Unreported</strong></div></div>
<p class="models" id="claude-reporting"></p><p class="models" id="claude-transport"></p><p class="models" id="claude-models"></p>
<h3>Reported usage by actual SDK model</h3><div class="table-scroll"><table><thead><tr><th>SDK model</th><th>Receipts</th><th>Input</th><th>Output</th><th>AI credits</th></tr></thead><tbody id="claude-model-usage"></tbody></table></div>
<h3>Latest 20 request outcomes</h3><div class="table-scroll"><table><thead><tr><th>Received</th><th>Outcome</th><th>Requested</th><th>Selected</th><th>Actual SDK model</th><th>AI credits</th></tr></thead><tbody id="claude-recent"></tbody></table></div>
<p class="models">Input tokens include cache reads/writes. AI credits = SDK totalNanoAiu / 1e9, not a bill or remaining entitlement. Missing usage is unreported, not free. Status is cached for up to 30 seconds.</p>
<h3>Launch from your project directory</h3><p>Use a fresh preview checkout containing <code>claude-gateway/</code> with patched dependencies. On Windows:</p><pre>&amp; 'C:\relay\Start-Claude-With-Copilot.ps1' -OpenSetup</pre><p>On supported Node platforms (macOS/Linux acceptance remains pending):</p><pre>node /path/to/relay/claude-gateway/launch.mjs --open-setup -- --model claude-opus-5-5</pre><p>The wrapper prints its own connection-center URL on a separate available loopback port. <code>--setup-port 4247</code> selects a fixed port; <code>--no-setup</code> disables this observer. A standalone <code>npm run setup</code> page does not claim to observe another wrapper. No gateway credential is shared with the browser or saved to disk.</p><p>Exit the child/wrapper to close its observer and gateway. Then run plain <code>claude</code> from a fresh terminal to return to your normal setup. No global Claude settings, login files, or Codex TOML are rewritten.</p></article>
<article id="start"><div class="tag">01 · Start here</div><h2>Open setup before connecting</h2><p>Extract the repository to a folder you own. In that folder, open a terminal and run the command below. Keep it open during setup. This connection center runs even before the relay dependencies are installed or GitHub is signed in.</p>
<pre>npm run setup</pre><p class="note">This release provides guided, read-only setup—not a one-click installer. Click a status card to see its fix, then run the shown commands locally. Nothing on this page installs software or changes configuration.</p>
<p>First install <a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer">Node.js 22 LTS or newer</a>. Then install pinned dependencies in the repository folder:</p><pre>npm ci</pre><p>Do not reinstall dependencies while the relay is running. No global Copilot CLI install is required; the pinned dependency includes it.</p></article>
<article id="copilot"><div class="tag">02 · GitHub Copilot</div><h2>Sign in with GitHub</h2><p>Run the official Copilot CLI login command below and complete its browser/device authorization. The connection center then checks accessible models. A GitHub login alone does not guarantee model access: your Copilot plan, usage and organization policy still apply.</p><pre>node node_modules/@github/copilot/npm-loader.js login</pre><p>We never ask for your GitHub password or copy credentials into the relay. Finish active relay tasks before changing the GitHub login.</p><p><a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli" target="_blank" rel="noopener noreferrer">Official Copilot CLI setup</a> · <a href="https://github.com/settings/copilot" target="_blank" rel="noopener noreferrer">Copilot account settings</a></p><div class="models" id="setup-models"></div></article>
<article id="codex"><div class="tag">03 · Stock Codex</div><h2>Connect, then verify a real request</h2><p>Install and open the <a href="https://developers.openai.com/codex/app/" target="_blank" rel="noopener noreferrer">official Codex app</a>. Select a model listed above, then run the existing repair command below (replace the model ID if needed). It backs up the config, changes managed provider settings, creates recovery shortcuts, and opens the dashboard.</p><pre>powershell -NoProfile -ExecutionPolicy Bypass -File .\Repair-Codex-CopilotProxy.ps1 -Model gpt-6-astra</pre><p id="setup-config-state"></p><p>After connecting, reopen the task and send a short prompt. <strong>Configured</strong> means the TOML points here; <strong>Recent Codex traffic</strong> means this relay observed a Codex-labelled request within two minutes. Check its completed result in request history to verify inference.</p><p>Need to retry? Use <code>Start or Repair Codex Copilot Bridge</code> on your desktop. Active exchanges defer runtime updates instead of being killed.</p></article>
<article id="restore"><div class="tag">04 · Your exit path</div><h2>Restore Normal Codex</h2><p>Use the desktop <code>Restore Normal Codex (Disable Copilot Bridge)</code> shortcut. It stops relay recovery and restores the SHA-256-verified original TOML. Reopen Codex afterward. Your account, pairings and installed engine are not replaced.</p><p class="note">A full restore returns to the saved original config. Review unrelated TOML changes made after that backup. If the backup is invalid, do not delete it or overwrite it—repair the backup first.</p></article>
<article><div class="tag">Scope & limits</div><h2>Clear boundaries, no hidden fallback</h2><p>Guided setup and lifecycle controls target Windows 11. Manual Responses use on other systems is documented separately. Copilot runs supported inference; Codex owns tools, files, approvals and memory. Optional native image generation consumes separate OpenAI allowance and requires explicit opt-in. Native OpenAI search is removed.</p><p>Native app voice is unsupported with this provider in the tested stock engine. We do not patch Codex to add it. No 12-hour soak or phone-to-host round trip is implied by the setup checks.</p><a href="https://github.com/madhavsomani/codex-copilot-relay" target="_blank" rel="noopener noreferrer">Repository & complete setup guide</a></article>
<p>Created by <a href="https://www.linkedin.com/in/madhavsomani" target="_blank" rel="noopener noreferrer">Madhav Somani</a> · Unofficial compatibility relay · loopback only</p>
</main><style>.claude-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.claude-metrics>div{background:#080d19;border:1px solid #263958;padding:12px;border-radius:9px;min-width:0}.claude-metrics small{display:block;color:#91a5c4;font-size:12px}.claude-metrics strong{display:block;font-size:20px;overflow-wrap:anywhere}.table-scroll{overflow-x:auto;max-width:100%}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}th,td{padding:10px;border-bottom:1px solid #263958;max-width:200px;overflow-wrap:anywhere}th{color:#91a5c4;font-weight:500}h3{font-size:15px;margin:20px 0 8px}details{margin:16px 0;min-width:0}summary{cursor:pointer;color:#8bc8ff;padding:6px 0}#local-usage .table-scroll{margin-bottom:10px}@media(max-width:760px){.claude-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}article{padding:16px}main{padding:24px 14px}}</style><script>${LOCAL_USAGE_SCRIPT}</script><script>${CLAUDE_SETUP_SCRIPT}</script><script>${CONNECTION_SCRIPT}</script></body></html>`;
