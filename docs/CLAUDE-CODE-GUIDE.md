# Claude Code through the relay: complete user guide

Relay 1.3.95, Claude adapter 0.1.32. This guide covers everyday use of **stock
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

Optional: for the CLI, put this in `%USERPROFILE%\.claude\settings.json`:

```json
{ "env": { "ENABLE_TOOL_SEARCH": "force" } }
```

Use `force`, not `true`. `force` turns on tool search even while the desktop
app keeps other experimental features off. A user-level `true` overrides the
app's own `force` and silently turns tool search back off in desktop sessions.

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
| PDF and plain-text documents (Read on a PDF) | Supported since 1.3.81. Encrypted PDFs are replaced with a note asking for an unlocked copy (1.3.85), instead of breaking the chat. |
| Tool search, context editing | Supported since 1.3.84 |
| Adaptive/extended thinking, effort, structured outputs, strict tools | Supported where Copilot advertises them for the model |
| WebFetch | Supported; runs locally |
| Image generation (native Codex, gpt-image-2) | Optional MCP adapter; uses your OpenAI/ChatGPT allowance, not Copilot credits. See [CLAUDE-IMAGE-MCP.md](CLAUDE-IMAGE-MCP.md). |
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
- **Session totals:** the **Per-task cost checkpoints** table defaults to each
  session's total across all retained days with a per-day split (both clients).
  For scripts: `curl -s http://127.0.0.1:4144/dashboard/api/sessions`.
- **Usage:** the **Models and AI credits** panel at the top of the dashboard
  (`http://127.0.0.1:4144/dashboard`) shows which model each client is using
  now, and per model: calls and credits today, credits over 7 days, and the
  average credits per call. Per-request receipts (model, tokens, cache
  reads/writes, credits) are in the call history further down.

## 9. Efficiency guidelines

These come from measuring real usage through this relay (October 2026).

1. **Start new chats for new work.** Every call re-sends the whole conversation,
   so a 700k-token chat costs about 15–20 credits per step while a fresh one
   costs about 1–2. When a chat gets long, ask for a short handoff summary,
   then paste it into a new chat.
2. **Brand-new chats get on-demand tool loading; resumed chats don't.** Claude
   Code keeps a resumed chat's original tool list. New chats start around 25k
   tokens instead of about 190k with large MCP connectors.
3. **Avoid pauses longer than 5 minutes in long chats.** Copilot keeps the
   prompt cache for 5 minutes only. The next call after a longer pause rewrites
   the cache, which costs about 25× a cached read for the same tokens.
4. **Use the cheapest model that fits.**

   | Model | Relative cost per token |
   |---|---|
   | Haiku 5.5 | 1/40 of Opus |
   | GPT-6.1 Sol (Codex) | 1/2 of Opus |
   | Opus 5.5 | 1× |
   | GPT-6 Astra (Codex) | 2.5× Opus |

   - Use Haiku for searches, file lookups and quick subagents. Set
     `CLAUDE_CODE_SUBAGENT_MODEL` if you want all subagents cheaper.
   - Keep Opus for hard reasoning.
   - Avoid Astra in Codex unless you need it.
5. **Compact deliberately.** Run `/compact` at a natural break instead of
   letting a chat grow past a few hundred thousand tokens.
6. **Keep heavy connectors out of projects that don't use them.** With tool
   search they cost little, but scoping them to the projects that need them
   keeps even resumed chats lean.
7. **Do research with WebFetch on Brave Search** (§7) rather than the browser.
   Browser snapshots and screenshots are large.
8. **Watch the dashboard panel.** If one model or client dominates "credits
   today", that's where to change habits.

## 10. Troubleshooting

| Error in Claude | Meaning and fix |
|---|---|
| `Relay session capacity (N) reached` | All 128 slots (`BRIDGE_MAX_CLAUDE_SESSIONS`, 2-256; 64 before 1.3.94) are in active use. Since 1.3.89 a tool call idle for more than 5 minutes is released automatically to make room, and its results later rebuild from history. Waiting tool calls expire after 1 hour. |
| `Copilot returned an empty completion` | Before 1.3.82 this was Haiku refusing large prompts (context tier). Update the relay. |
| `prompt is too long for the selected Copilot context tier` | Compact the conversation. |
| `Copilot SDK did not finish the turn after the native stream ended` | The SDK stalled before the answer was complete. Retry. Since 1.3.89, if the answer was already complete, the relay delivers it instead of failing. |
| `Server error mid-response` / `response stopped arriving` | An upstream interruption. Claude Code retries; nothing is replayed after partial output. Since 1.3.92 overlapping SDK attempts on long tool turns no longer cause this. |
| `409 Provide every outstanding tool result exactly once` (also during `/compact`) | Before 1.3.95 an SDK-only tool call could block a chat. Update; results that match the tool calls you were shown now rebuild from history. |
| `Tool continuation history changed a signed thinking block` (409) | The chat's history altered a signed thinking block, which never happens normally. Start a new session. Other history differences rebuild automatically since 1.3.89. |
| `tool_result supports …` / `Unsupported content block` (400) | Your relay is older than the feature. Update. |
| `Anthropic hosted web search is unsupported by Copilot` | Expected; see §7. |
| Sonnet/Haiku subagents billed as Opus | The models aren't listed in the gateway profile; see §3. |
| Browser tool: `Playwright Extension not found` | The extension is in a different browser; run `browser msedge` or `browser chrome` (§6). |

## 11. Security and privacy

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
