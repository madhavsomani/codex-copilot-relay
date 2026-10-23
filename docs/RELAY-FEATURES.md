# Optional relay features

The relay's core job is plain forwarding: Claude Code and Codex requests go to
GitHub Copilot through the official SDK, unchanged. On top of that it has a few
**optional additions**. Each can be switched on or off:

- **when you start the relay** (`Start-Relay.ps1 -EnableFeature … -DisableFeature …`),
- **live on the dashboard** (`http://127.0.0.1:4144/dashboard` → **Relay features**),
- or from a terminal (`node relay-features.mjs on <feature>` / `off <feature>`).

Choices are saved in `runtime/relay-features.json` (git-ignored) and survive
restarts. Dashboard switches apply immediately; terminal changes apply at the
next relay start.

## The features

| Feature (`id`) | Client | Default | What it does |
|---|---|---|---|
| Prompt-cache keep-warm (`cacheKeepWarm`) | Claude Code | **off** | Keeps a long chat's prompt cache from expiring while it is quiet. **Uses AI credits.** See below. |
| Haiku for Explore subagents (`haikuExplore`) | Claude Code | off | Runs the read-only **Explore** search subagent on Haiku. See below. |
| Deliver completed answers after SDK errors (`recoverCompletedAnswers`) | Claude Code | on | If Claude Code already received a complete, verified answer and the Copilot SDK then stalls or errors, the relay delivers that answer instead of failing the turn (a failure made Claude Code pay for a retry). |
| Trim old images in long chats (`imageHistoryTrim`) | Claude Code | on | Above about 24 MiB of image data per request, the oldest screenshots are left out (with a visible note) so screenshot-heavy chats stay under Copilot's request size limit. Your transcript is not changed. |
| Replace encrypted PDFs with a note (`encryptedPdfNote`) | Claude Code | on | Copilot rejects any request containing an encrypted PDF, which would break the whole chat. The PDF is replaced with a note asking for an unlocked copy. |
| Release idle tool slots when full (`idleToolEviction`) | Claude Code | on | When all session slots are in use, the tool call that has waited longest (over 5 minutes) is released. Its results later rebuild from the chat history. |
| Codex cost checkpoints (`codexCostCheckpoints`) | Codex | on | Adds an advisory note every 20 model steps or 500 AI credits per session (whole-session total), asking for a short progress and cost check. Never a hard cap. |

Switching a feature off restores plain forwarding for that case. For example,
with `encryptedPdfNote` off, a chat containing an encrypted PDF fails exactly as
Copilot reports it.

## Prompt-cache keep-warm (opt-in)

**Why.** Copilot keeps the prompt cache for 5 minutes only. When a long chat
waits longer than that, because a tool runs long, a loop checks back every
10 minutes, or you step away, the next call re-sends the whole chat at the
cache-write price. In October 2026 measurements this was **about 60% of all
Claude Code credits**: 31 calls cost 5,907 of 9,928 credits, between 100 and
400 credits each.

**What it does.**

- After each Claude Code request, the relay remembers that chat's exact request
  in memory (never on disk).
- If the chat stays quiet for **4.5 minutes**, the relay sends that identical
  request once more with `max_tokens: 1` and discards the 1-token answer. That
  reads the cached prefix, which refreshes the 5-minute timer.
- It repeats every 4.5 minutes for up to **20 minutes** of quiet, then stops.
  That's at most 4 pings per break.
- It only warms **main chats** of roughly **100k tokens or more**. Subagents,
  which never come back once finished, and small chats are not warmed.
- Chats using budgeted thinking (`thinking.type: enabled`) are skipped, because a
  1-token ping would have to change the request. Claude Code's default adaptive
  thinking is supported.
- A ping is never retried. Any failure, such as an expired sign-in or an HTTP
  error, stops warming for that chat.

**What it costs.** A ping is billed at the cached-read rate: about 1/25 of a
cache rewrite. For a 200k-token Opus chat that is roughly **4 credits per ping**
instead of about **100 credits for a rewrite**. The trade-off: if you don't
return to the chat within 20 minutes, those up to 4 pings (about 16 credits on
that example) are spent for nothing. If you often step away for longer than 20
minutes, keep it off.

**Where to see it.** The Relay features panel shows the number of pings, cached
tokens read and the estimated credits. Pings are tallied separately from your
requests (`claude.keepWarm` in `/dashboard/api`). The credit figure is an
estimate from measured Copilot rates (Opus 400/20/500/2,000 and Haiku
10/0.5/12.5/50 credits per million input, cached-read, cache-write and output
tokens). Copilot's own usage report remains authoritative.

**Privacy.** The remembered request, including the SDK's short-lived
authorization header, stays in relay memory. It is dropped after 20 quiet
minutes, when the chat's next request replaces it, or when the relay stops. It
is never written to disk or logs.

## Haiku for Explore subagents (opt-in)

Claude Code's built-in **Explore** subagent does read-only searching (finding
files and grepping code). Turning this on writes a user-level agent definition
to `%USERPROFILE%\.claude\agents\Explore.md` with `model: haiku`. A user agent
with the same name overrides the built-in one
([Claude Code subagents](https://code.claude.com/docs/en/sub-agents.md)).

- Haiku costs about **1/40 of Opus** per token. General-purpose subagents and
  your main chat keep their own model.
- The file contains a relay marker. Turning the feature off deletes only that
  marked file. If you already wrote your own `Explore.md`, the relay refuses to
  overwrite or remove it.
- The gateway profile must list a Haiku model (see the
  [guide](CLAUDE-CODE-GUIDE.md#3-set-up)). New Claude Code sessions pick up the
  change.

## Choosing at startup

```powershell
# Opt in to keep-warm and Haiku Explore, opt out of Codex checkpoints:
.\Start-Relay.ps1 -EnableFeature cacheKeepWarm,haikuExplore -DisableFeature codexCostCheckpoints
```

Start Relay prints the current state of every feature when it finishes. Other
ways to set them:

```powershell
node relay-features.mjs list
node relay-features.mjs on cacheKeepWarm
node relay-features.mjs off cacheKeepWarm
```

For developer launches, `BRIDGE_FEATURES="cacheKeepWarm=on,imageHistoryTrim=off"`
in the relay's environment applies, and saves, the listed choices at startup.

## API

- `GET /dashboard/api/features` lists every feature, its state and its source
  (`default`, `saved`, `startup` or `dashboard`).
- `POST /dashboard/features` with `{"id":"cacheKeepWarm","enabled":true}` switches
  one feature. It is same-origin loopback only and requires a JSON body, like
  every other dashboard action.
