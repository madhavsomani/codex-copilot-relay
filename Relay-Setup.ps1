# Display-only onboarding. No keys, client configuration writes, or inference.
function Get-RelaySetupInstructions {
    param([ValidateRange(1024,65535)][int]$Port=4144,[psobject]$Health,[bool]$CodexConfigured=$false)
    $version=if ([string]$Health.version -match '^\d+\.\d+\.\d+$') { $Health.version } else { 'not yet reported' }
    $model=if ([string]$Health.model -match '^[\w.-]{1,100}$') { $Health.model } else { 'not yet reported' }
    $effort=if ([string]$Health.compatibility.defaultReasoningEffort -match '^[a-z]{1,12}$') { $Health.compatibility.defaultReasoningEffort } else { 'not yet reported' }
    $route=if ($CodexConfigured) { 'CONFIGURED - TOML routes to this relay' } else { 'NOT VERIFIED - run Start Relay; check Connection setup' }
    $claude=if ($Health.unified -and $Health.claude.sdkState -eq 'ready') { 'READY - one-time app setup below' } else { 'NOT READY - check status before connecting' }
    $models=@($Health.claude.models | Where-Object { $_ -is [string] -and $_ -match '^claude-[\w.-]{1,90}$' } | Select-Object -First 20) -join ', '
    if (-not $models) { $models='not yet reported; type models after the gateway is ready' }
    return @"
CODEX + CLAUDE CODE | ONE COPILOT RELAY | live v$version
Dashboard: http://127.0.0.1:$Port/dashboard

CODEX: $route
Start Relay backs up config.toml, enables this provider and opens this terminal.
Reopen existing Codex tasks to reload routing. Default: $model / $effort.
Explicit task model choices still apply. Account sign-in/pairing stays unchanged.

CLAUDE CODE GATEWAY: $claude
1. In Claude Desktop: Developer > Configure Third-Party Inference (NOT MCP).
   If needed: Help > Troubleshooting > Enable Developer Mode.
2. Provider: Gateway | URL: http://127.0.0.1:$Port/claude
3. Credential: Static API key | Auth scheme: Bearer
   Key: hidden. Type key then Enter HERE; paste it in Claude yourself.
   The local key persists across restarts. Do not share it or capture it.
4. Keep Allow Code enabled; leave experimental MCP tool search off.
   Save your work, Apply Changes > Save & Restart, choose third-party inference.
5. Open Code; choose an available Claude model (no GPT-to-Claude relabeling):
   $models
6. Send a small prompt, then match its reply with [Claude Code] completed below.
   Readiness/model discovery is not proof of a completed app request.

Both clients use this terminal and dashboard; tools execute in their own app.
Browser/research setup: docs\CLAUDE-BROWSER.md (pinned Playwright MCP + extension).
Run node claude-browser-setup.mjs apply once, then approve the browser connection.
Hosted Anthropic web search is unsupported; the research skill uses browser sources.
Setup is manual for Claude; this terminal does not edit Claude's saved profile.
Stop & Restore drains work and restores Codex. Return Claude to normal sign-in
yourself. Closing this event window triggers recovery, not restoration.
Commands: setup (this guide), models, status, key (explicit local reveal).
Guide: docs\TWO-CONTROLS.md | http://127.0.0.1:$Port/dashboard/setup
"@
}
