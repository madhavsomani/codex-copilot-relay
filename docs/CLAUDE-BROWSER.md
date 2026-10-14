# Browser and research: stock Claude, Copilot inference

The relay supplies inference, not browser permission. The optional integration
uses Microsoft's pinned `@playwright/mcp@0.0.83` as a local stdio server and its
user-approved Chrome/Edge extension. No Claude/Codex binaries are modified.

## Setup in the actual Desktop Code GUI

1. First check **Settings > Claude Code > Browser tools**. Availability depends on
   the installed app and provider mode. Do not modify internal flags or policies.
   The browser pane is separate from Claude's Chrome extension, which has direct
   Anthropic authentication restrictions.
2. In **Settings > Developer > Edit config**, check the folder opened by the app.
   The Windows third-party Gateway profile uses `%LOCALAPPDATA%\Claude-3p`,
   separate from the standard `%APPDATA%\Claude` profile.
   In this relay folder, for the Gateway GUI run
   `node claude-browser-setup.mjs apply --profile=third-party`.
   For the standard Desktop profile use `--profile=standard`.
   If you already installed in the other profile, run
   `node claude-browser-setup.mjs restore` first, then apply to the selected profile.
   Start and Stop remember that selection through the recovery journal; merely
   finding another profile directory never redirects setup automatically.
   Node/npm must be installed. The pinned npm package is downloaded by npx when
   first used. This adds `relay_browser` to the supported Desktop
   selected `claude_desktop_config.json` and installs `relay-browser-research` under your
   Claude skills directory. Local Code sessions use their active Desktop profile;
   standalone CLI does not read the Desktop config. Existing connectors,
   model selection, authentication and permissions are left unchanged.
3. Install [Microsoft Playwright extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
   in the browser/profile you want to use. Keep the normal connection approval.
   This setup never creates an approval-bypass token, copies a profile or cookies,
   disables the sandbox, or opens a debugging port on your default profile.
4. Save active Claude work and restart Claude yourself. In a fresh **Code** session,
   check that `relay_browser` tools and the research skill are present. Approve the
   browser connection and select the tab. Managed policies may prevent this;
   consult the administrator rather than overriding them.
5. Test from that GUI: open a harmless page, read its title, click a test button,
   verify its new text and take a screenshot. Match the actual GUI reply to the
   relay's completed Claude request and SDK model receipt. CLI or mock tests alone
   are not GUI proof. Do not infer a model from its self-description.

## Research and costs

The research skill searches via a public search engine in the approved browser,
then opens sources and cites their URLs. No separate search API/subscription is
added. This is **not native Anthropic search**. Hosted `web_search_*` requests are
still rejected with actionable guidance and no provider fallback. The skill is
guidance, not a guarantee that a model never selects the unsupported tool.

Browser actions execute locally; page contents returned to the model can consume
Copilot credits. External sites retain their own policies, subscriptions and
permissions. Never send private data as search queries. Image generation is a
different service, not the same thing as taking a browser screenshot.

## Models

The dashboard's browser/setup panel and terminal `models` command show the entitled
catalog. In Claude's supported model configuration use the exact IDs for each
family, e.g. `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5` only if
advertised. The CLI launcher already supplies family mappings; the GUI's saved
fields require applying in the supported app form. This helper does not overwrite
explicit model choices or change a user's default model.

## Status and rollback

`node claude-browser-setup.mjs status` checks configuration only. The dashboard
separates configured, offered in the client tool catalog, and client-reported
successful/error results. Retained observations do not establish current browser
liveness or distinguish Desktop from CLI. Full GUI proof remains a manual gate.
The read-only dashboard cannot install software or grant browser permissions.

`node claude-browser-setup.mjs restore` removes only the exact additions owned by
this setup. It preserves other connectors and later unrelated changes; edited
owned entries cause a conflict instead of being overwritten. JSON whitespace can
change, but unrelated settings values are preserved. A local recovery journal
under ignored `runtime/` stores only our additions and paths, not copies of other
credentials. An interrupted apply can be undone with the same restore command.

**Stop & Restore** also undoes these additions after draining model work. On the
next **Start Relay**, a previously opted-in setup is re-applied; without a journal,
Start does not install it. The extension stays installed and user-owned. Reopen
Claude to reload changed MCP configuration. Claude's saved gateway profile still
requires selecting normal sign-in manually. Codex TOML restoration is unchanged.

## Bounded developer verification

`node claude-gateway/probe.mjs --live --case=browser` tests stock CLI, real local
Playwright MCP navigation/click/screenshot and Copilot model receipts in an
isolated headless profile. It consumes Copilot allowance. It never controls your
logged-in browser and does **not** certify extension approval or the Desktop GUI.
`--case=agents` separately tests actual Sonnet/Haiku child routing by SDK receipts.

References: [Claude Desktop MCP support](https://code.claude.com/docs/en/desktop#mcp-servers-from-the-claude-desktop-chat-app),
[Playwright extension](https://github.com/microsoft/playwright/tree/main/packages/extension#readme),
[Claude Chrome restrictions](https://code.claude.com/docs/en/chrome).
