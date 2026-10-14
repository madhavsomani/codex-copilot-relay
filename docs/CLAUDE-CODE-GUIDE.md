# Claude Code through the relay: complete user guide

Relay 1.3.84, Claude adapter 0.1.28. This guide covers everyday use of **stock
Claude Code** (the Claude desktop app's Code tab or the CLI) with model calls
served by your own **GitHub Copilot** entitlement through this local relay.

It is unofficial. You need your own Copilot plan with access to Claude models.
Copilot usage and its terms still apply; this does not make inference free.

---

## 1. How requests flow

```
Claude desktop (Code tab, third-party gateway profile)
        │  Anthropic Messages API, http://127.0.0.1:4144/claude
        ▼
Local relay (this repo, loopback only, private local key)
        │  official @github/copilot-sdk, your Copilot CLI login
        ▼
GitHub Copilot ──► Claude Opus / Sonnet / Haiku
```

- **Tools run locally.** Bash, file edits, MCP connectors and the browser all
  run on your machine, under Claude Code's own permissions. Only model calls go
  to Copilot.
- **Native format.** The relay forwards your conversation in its native Messages
  form: images, PDFs, signed thinking and tool calls. It never silently switches
  to another model or provider.
- **The terminal `claude` CLI is separate.**
  - Plain `claude` uses whatever login it has, for example a Claude Pro
    subscription. It does **not** go through the relay.
  - To run the CLI on Copilot, start it with `Start-Claude-With-Copilot.ps1`.

## 2. Requirements

- Windows 10/11, Node.js 22 LTS or newer.
- GitHub Copilot CLI installed and signed in (`copilot` → `/login`), with a
  plan that includes Claude models.
- The Claude desktop app with **third-party inference** available. Some
  organization policies disable it; don't override them.

## 3. Set up

1. **Install and start the relay.**
   - Clone the repo and run `npm ci`.
   - Run **Start Relay** (desktop shortcut or `Start-Relay.ps1`).
   - The terminal shows readiness. Type `key` to see your private local key and
     `models` to list the Claude models your Copilot account can use.
2. **Open the gateway form in Claude.** Go to **Developer › Configure
   Third-Party Inference**. Enable developer mode first if needed
   (Help › Troubleshooting).
3. **Fill in the connection.**
   - Gateway URL: `http://127.0.0.1:4144/claude`
   - Credential: **Static API key**, scheme **Bearer**. Paste the key from
     the relay terminal.
4. **Add one model per family**, using exact IDs from `models`. Opus is the
   main model:

   | Model ID | Family tier | Purpose |
   |---|---|---|
   | `claude-opus-5-5` | opus (default) | Main conversation |
   | `claude-sonnet-5-5` | sonnet | Subagents/agents that ask for Sonnet |
   | `claude-haiku-5-5` | haiku | Background work: titles, summaries, quick agents |

   > If only Opus is listed, every request for Sonnet or Haiku, including
   > Claude Code's own background calls, silently runs **and bills** as Opus.
5. **Turn on "Enable tool search"** (`toolSearchEnabled`) in the same form. See
   §4 for why this matters most.
6. **Restart Claude.** Then check that a reply in the app matches a completed
   request in the relay terminal or dashboard (`http://127.0.0.1:4144/dashboard`).

Optional: put the same switches in `%USERPROFILE%\.claude\settings.json` so the
CLI behaves the same way:

```json
{ "env": { "ENABLE_TOOL_SEARCH": "true", "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "0" } }
```

## 4. Token efficiency: what matters

**On-demand tool loading (tool search): the biggest saving.**
- Without it, every request sends the full schema of every MCP connector tool.
  Large connectors (video, voice or social-media APIs) easily add 150k+ tokens to
  *every* call.
- With it, Claude Code sends only tool names and loads a tool's definition when
  it needs it, which is how native Claude Code works.
- The relay supports this since 1.3.84: `defer_loading` tools, `tool_reference`
  results, and the `advanced-tool-use` beta. The `tool-search-tool-2025-10-19`
  alias is rewritten to the name Copilot accepts.
- Measured on one setup:

  | | Fresh request | Cost of a fresh start |
  |---|---|---|
  | Tool search off | ~193k tokens | ~95 credits |
  | Tool search on | ~25k tokens | ~12 credits |

- In the desktop app, tool search only takes effect when "Enable tool search" is
  on. Otherwise the app forces `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` and
  removes `ENABLE_TOOL_SEARCH` from every session it starts.

**Prompt cache.**
- Copilot honours 5-minute prompt caching only; a requested 1-hour TTL is
  stored as 5 minutes.
- A pause longer than 5 minutes means the next call rewrites the whole cached
  context. Smaller requests (tool search) make that much cheaper.

**Other habits.**
- Every call re-reads the whole conversation. Start a fresh session or
  `/compact` when a chat grows past a few hundred thousand tokens.
- Context editing (clearing old tool results) passes through when Claude Code
  enables it.

**Measured Copilot credit rates.** These are credits per million tokens,
reverse-engineered from Copilot's own usage receipts in October 2026. They
reproduced every receipt exactly, but they're observations, not a published
price list, and may change.

| Model | Fresh input | Cached input | Cache write | Output |
|---|---:|---:|---:|---:|
| Claude Haiku 5.5 | 10 | 0.5 | 12.5 | 50 |
| GPT-6.1 Sol (Codex) | 200 | 10 | 250 | 1,000 |
| Claude Opus 5.5 | 400 | 20 | 500 | 2,000 |
| GPT-6 Astra (Codex) | 1,000 | 100 | 1,250 | 5,000 |

## 5. Feature support

| Feature | Status |
|---|---|
| File tools, Bash, MCP connectors, skills, hooks, subagents, workflows | Supported |
| Opus / Sonnet / Haiku routing | Supported; list one model per family (§3) |
| Image input (screenshots, Read on images) | Supported, forwarded natively |
| PDF and plain-text documents (Read on a PDF) | Supported since 1.3.81 |
| Tool search, context editing | Supported since 1.3.84 |
| Adaptive/extended thinking, effort, structured outputs, strict tools | Supported where Copilot advertises them for the model |
| WebFetch | Supported; runs locally |
| **WebSearch (Anthropic hosted)** | **Not available.** Copilot rejects it. See §7. |
| Exact token counting (`count_tokens`) | Returns 501; Claude Code estimates instead |
| Server-side auto-mode classifier (`safeguards`) | Rejected once per session (HTTP 400). Claude Code then uses its built-in classifier. The relay never strips it silently. |
| 1-hour prompt cache | Not honoured by Copilot (5 minutes) |
| Remote Control, voice | Not provided by the relay |

## 6. Browser tools

Install the optional `relay_browser` MCP server (Microsoft Playwright MCP, pinned
version) and research skill:

```
node claude-browser-setup.mjs apply --profile=third-party
```

- **Install the extension.** Add Microsoft's **Playwright extension** to the
  browser profile you want Claude to use.
- **Pick the browser.** The extension is per browser, and Playwright looks in
  Chrome unless told otherwise. If yours is in **Edge**, run:

  ```
  node claude-browser-setup.mjs browser msedge
  ```

  Use `browser chrome` to switch back. Only the relay-owned entry is
  rewritten.
- **Restart and approve.** Restart Claude and approve the connection the first
  time it asks.
- **Check or undo.** `status` shows the state; `restore` removes only what
  setup added.

## 7. Web research without hosted search

Hosted WebSearch can't run through Copilot. Use these, in order:

1. **WebFetch on Brave Search, then the source pages.** Fast, no browser:
   `https://search.brave.com/search?q=<url-encoded query>`.
   - Tested sources that work this way: Brave results pages and most
     article/doc sites.
   - Built In job listings also work (builtin.com and city sites).
   - Don't work with plain fetches:
     - Bing (degraded page that matches only the first word)
     - Google ("trouble accessing" page)
     - DuckDuckGo (captcha)
     - Indeed (403)
     - Mojeek (403)
2. **The browser (§6)** for pages that need JavaScript, a login (LinkedIn,
   Indeed), clicking or screenshots. Slower.
3. **Optional:** if you also have an Anthropic subscription, a terminal
   `claude -p "..." --allowedTools WebSearch` uses that login's native search.
   From inside a relay session, unset `ANTHROPIC_BASE_URL` and
   `ANTHROPIC_AUTH_TOKEN` first, or the child process goes through the relay.

## 8. Day-to-day operation

- **Start Relay:** starts or reloads the latest local version. It **cancels
  in-flight requests**, so run it between tasks.
- **Stop & Restore:** stops both adapters and restores Codex's original config.
  Claude keeps its saved gateway profile; switch back to normal sign-in
  yourself.
- **Repair / watchdog:** after an update, `Repair-Codex-CopilotProxy.ps1`
  stages the new version and promotes it only when no requests are running.
  If you always have sessions busy, promotion waits; use **Start Relay** at a
  quiet moment.
- **Verify the running version** at `http://127.0.0.1:4144/health`: `version` is
  the relay, `claude.version` the adapter. Refreshing the dashboard alone
  doesn't prove an update.
- **Usage:** the dashboard shows per-request receipts: model, tokens, cache
  reads/writes and Copilot AI credits.

## 9. Troubleshooting

| Error in Claude | Meaning and fix |
|---|---|
| `Relay session capacity (N) reached` | Too many live sessions or pending tool calls. Finish or cancel idle tasks. The default limit is 64 (`BRIDGE_MAX_CLAUDE_SESSIONS`). |
| `Copilot returned an empty completion` | Before 1.3.82 this was Haiku refusing large prompts (context tier). Update the relay. |
| `prompt is too long for the selected Copilot context tier` | Compact the conversation. |
| `Copilot SDK did not finish the turn after the native stream ended` | The SDK stalled. The relay fails fast (60 s) so Claude retries instead of hanging for ~13 minutes. Retry. |
| `Server error mid-response` / `response stopped arriving` | An upstream interruption. Claude Code retries; nothing is replayed after partial output. |
| `Tool continuation history prefix changed` (409) | The client's history didn't match the pending tool call. Retry; if it repeats, start a new session. |
| `tool_result supports …` / `Unsupported content block` (400) | Your relay is older than the feature. Update. |
| `Anthropic hosted web search is unsupported by Copilot` | Expected; see §7. |
| Sonnet/Haiku subagents billed as Opus | The models aren't listed in the gateway profile; see §3. |
| Browser tool: `Playwright Extension not found` | The extension is in a different browser; run `browser msedge` or `browser chrome` (§6). |

## 10. Security and privacy

- **Loopback only.** The relay listens on `127.0.0.1` and rejects browser
  origins.
- **The local key.** Claude connects with a random key encrypted for your
  Windows user. It's never printed on the dashboard and never committed.
- **No credential handling.** Copilot authentication stays inside the official
  SDK and Copilot CLI. The relay doesn't read, store or forward your GitHub
  token.
- **Metadata-only ledgers.** The usage ledgers store counts and token totals,
  never prompts, tool arguments or results.
- **Nothing private in the repo.** Runtime data, logs and backups live in
  `runtime/` (git-ignored). Run a secret scan (for example gitleaks) before
  publishing a fork.
