// Shared, credential-free instructions. No installation or settings mutation.
export const CLAUDE_GUIDE_STYLE = `
.claude-setup-guide{margin:0 0 18px;border:1px solid #263958;border-radius:12px;background:#111a2d;color:#eef5ff;scroll-margin-top:18px;min-width:0}
.claude-setup-guide>summary{cursor:pointer;padding:16px 18px;font-size:15px;font-weight:650;color:#eef5ff}
.claude-setup-guide>summary small{font-weight:400;color:#91a5c4;margin-left:10px;font-size:12px}
.claude-guide-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:22px;padding:0 18px 18px;font:13px/1.65 system-ui,sans-serif}
.claude-guide-grid>*{min-width:0}.claude-guide-grid ol{margin:0;padding-left:22px}.claude-guide-grid li{padding:0 0 9px 4px}
.claude-guide-grid p{margin:6px 0 12px;color:#a8b8d0}.claude-guide-grid h3{font-size:14px;margin:0 0 8px}.claude-guide-grid code{color:#b9e8db;overflow-wrap:anywhere;font-size:12px}
.claude-guide-grid a{color:#8bc8ff}.claude-guide-fields{margin:7px 0;padding:9px 12px;border-left:2px solid #69b7ff;background:#080d19;border-radius:0 6px 6px 0;overflow-wrap:anywhere}
.claude-guide-grid aside{border-left:1px solid #263958;padding-left:20px}.claude-guide-grid details{margin-top:10px}.claude-guide-grid summary{cursor:pointer;color:#8bc8ff}
.claude-setup-guide :focus-visible{outline:2px solid #69b7ff;outline-offset:3px}
@media(max-width:760px){.claude-guide-grid{grid-template-columns:1fr;gap:12px}.claude-guide-grid aside{border-left:0;border-top:1px solid #263958;padding:14px 0 0}.claude-setup-guide>summary small{display:block;margin:5px 0 0}}
`;

export function renderClaudeSetupGuide(base='__CLAUDE_GATEWAY_BASE__') {
  if(base!=='__CLAUDE_GATEWAY_BASE__' && !/^http:\/\/127\.0\.0\.1:\d{4,5}\/claude$/.test(base))
    throw new Error('Expected a loopback Claude gateway URL.');
  return `<details class="claude-setup-guide" id="claude-setup-guide" open>
    <summary>Connect Claude Code <small>One-time desktop setup · same relay, no client patches</small></summary>
    <div class="claude-guide-grid"><div><ol>
      <li><strong>Start Relay, then open Claude Desktop.</strong> In its app menu choose <strong>Developer → Configure Third-Party Inference</strong> (not MCP settings). If needed: Help → Troubleshooting → Enable Developer Mode. If your organization disables the form, ask your administrator.</li>
      <li><strong>Enter the connection details.</strong><div class="claude-guide-fields">Provider: <strong>Gateway</strong><br>Gateway base URL: <code>${base}</code><br>Credential: <strong>Static API key</strong> · Auth scheme: <strong>Bearer</strong></div></li>
      <li><strong>Get your persistent local key.</strong> Type <code>key</code> and Enter in the relay terminal, then paste it into Claude yourself. The key stays in your terminal and Claude—not on this dashboard. It is Windows-user encrypted and reused after restart.</li>
      <li><strong>Apply and verify.</strong> Keep <strong>Allow Code</strong> on and experimental <strong>MCP tool search</strong> off. Save active work, choose Apply Changes → <strong>Save &amp; Restart</strong>, select third-party inference and open <strong>Code</strong>. Type <code>models</code> in the relay terminal for entitled model IDs. Send a small prompt and match its reply to a <strong>completed Claude Code</strong> request here.</li>
    </ol><p>Ready means the adapter can accept requests, not that your app is configured. Inference uses your Copilot allowance; tools can have their own service costs. No automatic provider fallback.</p>
    <a href="https://code.claude.com/docs/en/llm-gateway-connect#desktop-app" target="_blank" rel="noopener noreferrer">Official Claude Desktop gateway guide ↗</a> · <a href="/dashboard/setup#claude">Connection details &amp; usage →</a></div>
    <aside><h3>Two shortcuts. No EXE required.</h3><p><strong>Start Relay</strong> → PowerShell opens the terminal and dashboard, protects the original Codex TOML and enables routing for both adapters. Claude's form is the one-time manual step.</p>
    <p><strong>Stop &amp; Restore</strong> → disables recovery, waits for active work, stops both adapters and restores the SHA-256-verified Codex backup. Later TOML edits are archived. Return Claude to normal sign-in manually.</p>
    <details id="relay-recovery-guide"><summary>What happens if it crashes?</summary>
    <p>The watchdog checks about every <strong>10 seconds</strong>. It restarts a stopped relay or reopens a closed event terminal; the SDK supervisor handles backend recovery. A hidden per-user watchdog runs alongside the visible terminal—not a Windows service.</p>
    <p>With scheduled-task recovery installed, Windows retries watchdog failures up to 10 times at one-minute intervals and starts it at sign-in. The Startup-folder fallback only relaunches at sign-in if the watchdog itself dies. Use Start Relay for manual repair.</p>
    <p>History, the persistent key and the protected config backup stay on disk. An in-flight request or in-memory tool continuation can still be lost; retry in the client after recovery. Recovery cannot run while the computer is asleep or off.</p></details>
    <p>Closing the terminal is <strong>not</strong> Stop &amp; Restore: it will reopen. The terminal commands <code>setup</code> and <code>status</code> repeat guidance and show readiness.</p></aside></div>
  </details>`;
}
