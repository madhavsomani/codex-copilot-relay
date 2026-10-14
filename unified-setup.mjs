import {SETUP_HTML} from './setup-ui.mjs';
import {CLAUDE_GUIDE_STYLE,renderClaudeSetupGuide} from './claude-setup-guide.mjs';
import {BROWSER_HTML} from './dashboard-browser.mjs';
// Reuse the existing lightweight page; never replace the production dashboard.
export function renderUnifiedSetupPage(port,{managedDesktop=false}={}){
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid gateway port.');
  const base=`http://127.0.0.1:${port}`;
  const html=SETUP_HTML.replaceAll('__DASHBOARD_URL__','#routes')
    .replace('Open dashboard →','Connection details ↓')
    .replace('GitHub Copilot inference in stock Codex.','GitHub Copilot inference in stock Codex and Claude Code.')
    .replace('Isolated Claude Code preview · stock client','Claude Messages adapter · shared listener')
    .replace('<p id="setup-relay-state"',`<article id="routes"><div class="tag">One listener · two protocols</div><h2>Combined gateway preview</h2>
      <p>Codex Responses: <code>${base}/v1</code><br>Claude Gateway base URL: <code>${base}/claude</code></p>
      <p class="note">The running service does not automatically switch either app. Use the guide in <code>docs/UNIFIED-GATEWAY.md</code>. Keys stay in the terminal; never enter them on this page. Older dashboards and histories remain separate.</p></article><p id="setup-relay-state"`)
    .replace(/<h3>Launch from your project directory<\/h3>[\s\S]*?<\/article>/,
      `<h3>Attach the stock Claude app</h3><p>In Developer → Configure Third-Party Inference, choose Gateway with base URL <code>${base}/claude</code>, Static API key, Bearer. Type <code>key</code> in this gateway terminal and paste the session key in the app. Then verify an actual Code-tab prompt/reply. No MCP configuration or client binary patch is needed.</p></article>`)
    .replace(/<article id="codex">[\s\S]*?<\/article>/,
      `<article id="codex"><div class="tag">Stock Codex</div><h2>Connect explicitly, preserve account settings</h2><p>Responses base URL: <code>${base}/v1</code>. Type <code>codex-key</code> in the terminal for its separate local bearer. Follow <code>docs/UNIFIED-GATEWAY.md</code> for a process-scoped CLI example.</p><p id="setup-config-state"></p><p>Desktop TOML migration is not automatic. Your existing Codex account, Remote pairing and desktop relay remain unchanged. A configured route is not proof of a completed GUI response.</p></article>`)
    .replace(/<article id="restore">[\s\S]*?<\/article>/,
      '<article id="restore"><div class="tag">Safe exit</div><h2>Stop only this gateway</h2><p>Finish both clients’ work before entering <code>quit</code>. It stops this launcher’s service, not older gateways. This preview does not edit saved client configuration and does not silently fall back.</p><p>Each launch generates new local keys. Reconnect the clients after restarting. To revert a saved Claude Gateway profile, select the normal sign-in option in Claude. Durable keys and unattended restart are not implemented in this combined preview.</p></article>');
  if(!managedDesktop)return html;
  return html.replace('Combined gateway preview','Copilot Relay · Codex + Claude')
    .replace('href="/dashboard/setup#claude"','href="#claude-setup-guide"')
    .replace('</head>',`<style>${CLAUDE_GUIDE_STYLE}</style></head>`)
    .replace('<article id="claude">',`${renderClaudeSetupGuide(base+'/claude')}${BROWSER_HTML}<p>For browser observations and model-family IDs, open the main dashboard. This setup page does not probe your browser.</p><article id="claude">`)
    .replace('Connection details ↓','Open dashboard →').replace('href="#routes"','href="/dashboard"')
    .replace('The running service does not automatically switch either app. Use the guide in <code>docs/UNIFIED-GATEWAY.md</code>. Keys stay in the terminal; never enter them on this page. Older dashboards and histories remain separate.',
      'Start Relay manages the backed-up Codex route. Claude needs its supported one-time desktop form. See <code>docs/TWO-CONTROLS.md</code>. Keys stay in the terminal, never on this page. Original dashboard and history remain at /dashboard; older preview ledgers remain separately labelled.')
    .replace('paste the session key','paste the persistent local key')
    .replace(/<article id="codex">[\s\S]*?<\/article>/,
      `<article id="codex"><div class="tag">Stock Codex</div><h2>Managed, reversible model routing</h2><p>Start Relay backs up and configures Codex for <code>${base}/v1</code>. Reopen tasks after a configuration change. Your account and Remote pairing remain unchanged.</p><p id="setup-config-state"></p><p>Configured routing and observed requests are different checks; send a prompt to verify.</p></article>`)
    .replace(/<article id="restore">[\s\S]*?<\/article>/,
      '<article id="restore"><div class="tag">Two desktop controls</div><h2>Stop &amp; Restore</h2><p>Stops the recovery watchdog, waits for active work, then stops both adapters and restores the verified Codex backup. The current TOML is archived first, preserving later edits.</p><p>Closing the event terminal is temporary: recovery reopens it. Use <strong>Stop &amp; Restore</strong> to stop intentionally. Claude retains its saved Gateway profile; select normal sign-in in Claude to return to its ordinary provider. No silent provider fallback.</p><p>The local Claude key is Windows-user encrypted and survives restarts. It is not a Copilot or Anthropic account key. Never commit runtime files.</p></article>');
}
