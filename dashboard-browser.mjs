export const BROWSER_HTML=`<details class="claude-setup-guide" id="claude-browser-guide">
<summary>Browser &amp; research tools <small>Separate from model routing · user-approved connection</small></summary>
<div class="claude-guide-grid"><div><h3>Connect your logged-in browser</h3><ol>
<li>First check <strong>Settings → Claude Code → Browser tools</strong> in Claude. A browser pane and the Claude Chrome extension are different features; availability depends on your app/provider mode.</li>
<li>In this relay folder run <code>node claude-browser-setup.mjs apply</code>. This adds only the pinned <code>relay_browser</code> MCP entry and a research skill. Existing model settings, permissions and connectors are retained.</li>
<li>Install the <a href="https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm" target="_blank" rel="noopener noreferrer">Microsoft Playwright extension</a> in Edge/Chrome. Save your work, restart Claude and approve the extension connection and tab selection. No profile copy, debugging port or approval-bypass token.</li>
<li>Ask Claude to use <code>relay_browser</code> to open a harmless page, read its title, click a test button, and take a screenshot. Match the GUI reply to a completed Claude request. CLI proof alone is not GUI proof.</li>
</ol><p>Research uses the approved browser to search, open sources and cite URLs. It is <strong>not Anthropic hosted search</strong>. No search API subscription or silent provider fallback is added. Browser page content may enter model context and consume Copilot allowance.</p>
<p><a href="https://github.com/microsoft/playwright/tree/main/packages/extension#readme" target="_blank" rel="noopener noreferrer">Official extension setup ↗</a> · <a href="https://code.claude.com/docs/en/desktop#mcp-servers-from-the-claude-desktop-chat-app" target="_blank" rel="noopener noreferrer">Claude Desktop MCP support ↗</a></p></div>
<aside><h3>Evidence, not assumptions</h3><p id="browser-config-status">Local configuration: not checked</p><p id="browser-tool-status">Client tool catalog: not observed</p><p id="browser-result-status">Browser result: not observed</p><p>GUI verification: requires your actual Code-tab round trip. Tool results are client reports, not independent browser or GUI attestations. Observations below cover retained history, not current browser liveness.</p>
<h3>Model family choices</h3><p id="claude-family-models">Waiting for the entitled model catalog.</p><p>Use these explicit IDs in Claude's supported model settings for Opus, Sonnet and Haiku. A parent/agent saying its own model name is not proof; inspect SDK receipts.</p>
<h3>Undo</h3><p><code>node claude-browser-setup.mjs restore</code> removes only unchanged relay additions. Stop &amp; Restore does this too; Start Relay re-applies a previously opted-in setup. Edited entries are preserved with a conflict warning. The browser extension stays installed and user-owned.</p></aside></div></details>`;

export const BROWSER_SCRIPT=`function renderBrowserSetup(data) {
  const set=(id,text)=>{const node=document.getElementById(id);if(node)node.textContent=text;};
  const config=data.browserSetup,stats=data.claude?.browser;
  set('browser-config-status','Local MCP: '+(config?.configuration||'unavailable on this running version')+' · research skill: '+(config?.researchSkill||'unknown'));
  set('browser-tool-status','Client tool catalog: '+(stats?.offered?'relay_browser offered (retained history)':'not observed'));
  set('browser-result-status',stats?'Client-reported browser results: '+(stats.results||0)+' successful / '+(stats.errors||0)+' errors'+(stats.lastObservedAt?' · last offered '+new Date(stats.lastObservedAt).toLocaleString():''):'Browser telemetry: unavailable on this running version');
  const models=data.claude?.models||[];
  set('claude-family-models',['opus','sonnet','haiku'].map(family=>{
    const preferred={opus:'claude-opus-5-5',sonnet:'claude-sonnet-5-5',haiku:'claude-haiku-4-5'}[family];
    const id=models.includes(preferred)?preferred:models.find(id=>id.startsWith('claude-'+family+'-'));
    return family+': '+(id||'not advertised');
  }).join(' · '));
}`;
