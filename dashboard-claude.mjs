export const CLAUDE_STYLE = `
  .claude-activity { margin: 0 0 16px; min-width: 0; }
  .claude-activity .panel-head { flex-wrap: wrap; gap: 8px; }
  .claude-activity .provider-values { grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
  .claude-activity .provider-values strong { overflow-wrap: anywhere; }
  .claude-activity .provider-content { padding: 12px 16px; }
  .claude-activity .table-wrap { max-height: 280px; }
  .claude-activity td { white-space: normal; overflow-wrap: anywhere; }
  .claude-activity a { color: var(--accent); }
  .claude-activity summary { cursor: pointer; padding: 12px 0; }
  .claude-activity :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  @media (max-width: 650px) { .claude-activity .provider-values { grid-template-columns: repeat(2,minmax(0,1fr)); } }
`;
export const CLAUDE_HTML = `
  <section class="panel claude-activity" id="claude-gateway-activity" aria-labelledby="claude-activity-title">
    <div class="panel-head"><div><h2 id="claude-activity-title">Claude Code gateway</h2><span class="tiny">Claude Code → same local relay → GitHub Copilot SDK → entitled Claude model</span></div><span class="pill" id="claude-live-status">Checking gateway…</span></div>
    <div class="provider-content">
      <div class="provider-values">
        <div><strong id="claude-outcomes">—</strong><small>received / completed / failed</small></div>
        <div><strong id="claude-tokens">not reported</strong><small>reported input / output tokens</small></div>
        <div><strong id="claude-sdk-calls">—</strong><small>SDK model steps · not requests</small></div>
        <div><strong id="claude-ai-credits">not reported</strong><small>reported Copilot AI credits · not dollars</small></div>
      </div>
      <p class="provider-note" id="claude-usage-coverage">Waiting for this gateway's metadata.</p>
      <p class="provider-note">Claude totals are separate from the Codex metrics below; older preview ledgers remain in <a href="/dashboard/setup">Connection setup</a>. GUI identity is not attested: match your app reply to a completed request here. No automatic provider fallback.</p>
      <details><summary>Recent Claude requests · newest 20</summary><div class="table-wrap" role="region" tabindex="0" aria-label="Recent Claude request metadata"><table><thead><tr><th>Time / request</th><th>Client</th><th>Requested → selected → SDK model</th><th>Outcome / latency</th><th>Input / output</th><th>SDK steps / AI credits</th></tr></thead><tbody id="claude-request-rows"></tbody></table></div></details>
    </div>
  </section>
`;
export const CLAUDE_SCRIPT = String.raw`
    function renderClaudeGateway(view) {
      const root = $("claude-request-rows"); root.replaceChildren();
      const reported = value => Number.isFinite(value) ? number(value) : "not reported";
      const credit = row => row.creditReportedCalls > 0 && Number.isFinite(row.aiCredits)
        ? reported(row.aiCredits) + (row.creditReporting === "partial" ? " · partial" : "") : "not reported";
      if (!view) {
        setText("claude-live-status", "Not enabled in this relay");
        for (const id of ["claude-outcomes", "claude-tokens", "claude-sdk-calls", "claude-ai-credits"]) setText(id, "—");
        setText("claude-usage-coverage", "Run Start Relay for the shared endpoint; type setup in its terminal for the one-time app instructions.");
        return;
      }
      const recent = Date.now() - Date.parse(view.lastRequestAt) < 60000;
      setText("claude-live-status", !view.listening ? "Not listening" : view.sdkState !== "ready" ? "SDK " + view.sdkState
        : view.activeTurns > 0 ? number(view.activeTurns) + " live SDK sessions" : recent ? "Recent request observed" : "Ready · waiting for requests");
      setText("claude-outcomes", [view.received, view.completed, view.failed].map(reported).join(" / "));
      setText("claude-tokens", view.sdkApiCalls ? reported(view.inputTokens) + " / " + reported(view.outputTokens) : "not reported");
      setText("claude-sdk-calls", reported(view.sdkApiCalls)); setText("claude-ai-credits", credit(view));
      setText("claude-usage-coverage", "This shared gateway only · " + reported(view.activeRequests) + " active HTTP requests · "
        + reported(view.creditReportedCalls) + "/" + reported(view.sdkApiCalls) + " SDK receipts report credits. Tokens are receipt subtotals; failed/unreported attempts may cost more.");
      for (const row of (view.recent || []).slice(0, 20)) {
        const tr = document.createElement("tr");
        const values = [time(row.at) + " · " + (row.id || "legacy ID unavailable"), "Claude Code",
          [row.requestedModel || "not reported", row.selectedModel || "not selected", (row.actualModels || []).join(", ") || "SDK not reported"].join(" → "),
          row.status + (row.httpStatus ? " · HTTP " + row.httpStatus : "") + " · " + duration(row.durationMs),
          row.sdkApiCalls ? reported(row.inputTokens) + " / " + reported(row.outputTokens) : "not reported",
          reported(row.sdkApiCalls) + " steps / " + credit(row)];
        for (const value of values) { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); }
        root.appendChild(tr);
      }
      if (!root.childElementCount) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 6; td.textContent = "No Claude Messages requests recorded in this gateway."; tr.appendChild(td); root.appendChild(tr); }
    }
`;
