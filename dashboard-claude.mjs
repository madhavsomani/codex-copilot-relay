export const CLAUDE_STYLE = `
 .client-breakdown{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;font-size:11px;line-height:1.7}
 .client-breakdown strong{color:var(--text)}.client-breakdown a{color:var(--accent)}
 .session-leases{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.65 ui-monospace,monospace;max-height:240px;overflow:auto}
`;
export const CLAUDE_HTML = `
 <div class="client-breakdown" id="claude-gateway-activity">
  <strong>Client breakdown</strong><div id="codex-client-usage">Codex: checking…</div>
  <div id="claude-client-usage">Claude Code: checking…</div><div id="claude-live-status">Checking gateway…</div>
  <a href="#history">Both clients in Recent call history ↓</a> · <a href="#task-costs">Session checkpoints ↓</a>
  <div class="tiny">GUI identity is not attested; match an app reply to its completed request. No automatic provider fallback.</div>
  <details><summary>Retained sessions and capacity</summary><div id="relay-session-leases" class="session-leases">Checking sessions…</div>
   <div class="tiny">Waiting does not mean abandoned. To inspect or explicitly cancel one unwanted continuation, run Relay-Sessions.ps1 in the relay folder. Streaming work is protected; client tools remain client-owned.</div>
  </details>
 </div>`;
export const CLAUDE_SCRIPT = String.raw`
 function renderClaudeGateway(view, codex = {}) {
  setText('codex-client-usage','Codex: '+number(codex.received||0)+' received · '+number(codex.sdkApiCalls||0)+' SDK steps · '+creditsText(codex)+' AI credits');
  if(!view){setText('claude-client-usage','Claude Code: not enabled');setText('claude-live-status','Run Start Relay for both adapters.');return;}
  const credit=view.creditReportedCalls>0&&Number.isFinite(view.aiCredits)?number(view.aiCredits)+(view.creditReporting==='partial'?' · partial':''):'not reported';
  setText('claude-client-usage','Claude Code: '+number(view.received)+' received · '+number(view.completed)+' completed · '+number(view.failed)+' failed · '+number(view.sdkApiCalls)+' SDK steps · '+credit+' AI credits');
  const capacity=view.sessionCapacity;
  setText('claude-live-status',!view.listening?'Claude gateway not listening':view.sdkState!=='ready'?'Claude SDK '+view.sdkState:
    capacity?.limit>0&&!capacity.canAcceptNewSessions?'Claude capacity exhausted · '+number(view.turnStates?.waitingForTools||0)+' waiting for tools · resolve or explicitly cancel unwanted sessions':
    view.activeRequests>0?number(view.activeRequests)+' active Claude requests':'Claude gateway ready · '+number(view.activeTurns)+' retained SDK sessions');
 }
 function renderSessionLeases(control){
  if(!control?.sessions){setText('relay-session-leases','Session details unavailable in this live version.');return;}
  const rows=control.sessions;
  setText('relay-session-leases',rows.length?rows.map(row=>(row.client==='claude-code'?'Claude Code':'Codex')+' · '+row.model+' · '+row.state+
    '\n'+row.id+' · '+(row.taskId||'unattributed')+'\nAge '+Math.floor(row.ageMs/60000)+'m · waiting '+Math.floor(row.waitingMs/60000)+'m · '+row.pendingTools+' pending tools · expires '+new Date(row.expiresAt).toLocaleTimeString()).join('\n\n'):'No retained sessions.');
 }
`;
