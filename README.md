# Codex Copilot Relay

An unofficial, loopback-only compatibility relay that lets Codex use the
official GitHub Copilot SDK as a custom model provider.

```text
Codex desktop / CLI
        |
        | OpenAI Responses-compatible HTTP
        v
Codex Copilot Relay (127.0.0.1 only)
        |
        | GitHub Copilot SDK + Copilot CLI JSON-RPC
        v
GitHub Copilot model entitlement
```

The relay translates request, response, streaming-event, and tool-call
envelopes. At the OpenAI Responses protocol boundary, it is designed to be a
transparent Codex provider: the desktop app and CLI keep their normal tool,
approval, multi-agent, and continuation behavior while the model inference is
served by GitHub Copilot. Codex keeps ownership of local tool execution,
sandboxing, and approvals. When a model asks for a tool, the relay returns that
request to Codex; Codex runs the tool locally and sends the result back through
the same open exchange.

> [!IMPORTANT]
> This is not an unlimited-token route, an authentication bypass, or an
> official Codex/GitHub integration. Every model call uses the signed-in user's
> GitHub Copilot entitlement and remains subject to GitHub quota, billing,
> acceptable-use, and product terms.

## Why it exists

Codex supports custom providers that speak the OpenAI Responses protocol. The
GitHub Copilot SDK provides a supported way to build applications on top of the
Copilot agent runtime. Codex Copilot Relay adapts those two interfaces locally.

This combination is experimental. The Copilot SDK is currently in public
preview, and neither GitHub nor OpenAI documents this exact cross-product setup.
Protocol or product changes can require updates to the relay.

## Features

- OpenAI Responses-compatible `/v1/responses` endpoint
- Official `@github/copilot-sdk` backend
- Independent SDK session per request for overlapping Codex agents
- Codex child-agent delegation adapter, including OpenAI-only encrypted-schema hints
- Tool-call and tool-result continuation
- Full streaming Responses lifecycle with ordered sequence numbers and terminal
  `response.completed` or `response.failed` events
- Automatic recovery from empty Copilot completions with a bounded per-turn retry limit
- Automatic recovery when a model emits only a future-tense progress update
  instead of taking the next available tool action
- Separate sliding model timeout and 13-hour outer-tool result window, plus SSE
  heartbeats, for all-day Codex runs
- Copilot SDK session idling disabled and automatic context compaction enabled
- Historical tool images travel as image attachments instead of base64 prompt text
- Oversized historical text tool results are bounded with head and tail context preserved
- Streaming failures end with a standard `response.failed` event instead of a silent disconnect
- Loopback-only listener on `127.0.0.1`
- Local dashboard with sanitized request, replay, latency, and tool metadata
- Visible Windows Terminal event stream
- Watchdog recovery for both the relay and visible terminal
- Two-click enable/restore workflow for Codex `config.toml`
- SHA-256-verified, current-user-only full-config backup

## Requirements

- Windows 10 or 11
- Node.js 20.19+ or 22.12+
- A GitHub account with an active Copilot entitlement
- A model made available to that account by GitHub Copilot
- Codex desktop or CLI with custom Responses-provider support

## Install

Clone the repository and install the pinned dependencies:

```powershell
git clone https://github.com/madhavsomani/codex-copilot-relay.git
cd codex-copilot-relay
npm ci
```

Authenticate GitHub Copilot CLI if the SDK cannot find an existing sign-in.
The Node.js SDK bundles the Copilot CLI runtime, but a valid Copilot identity is
still required.

## Persistent desktop setup

From PowerShell:

```powershell
.\Repair-Codex-CopilotProxy.ps1 -Port 4144 -Model gpt-5.6-sol
```

This command:

1. Saves the complete normal Codex configuration to a protected local backup.
2. Adds a managed `github_copilot_bridge` custom-provider block.
3. Starts the loopback relay and validates health.
4. Installs a per-user Scheduled Task watchdog.
5. Starts a visible Windows Terminal event stream.
6. Installs **Start or Repair Codex Copilot Bridge** and
   **Restore Normal Codex (Disable Copilot Bridge)** on the Desktop.

Reopen the Codex task after switching providers so the app server reloads
`config.toml`.

## Restore normal Codex

Use the Restore Desktop shortcut or run:

```powershell
.\Disable-Codex-CopilotProxy.ps1
```

Restore removes auto-recovery first, stops the watchdog, terminal, and relay,
verifies the saved backup hash, and restores the complete pre-enable
`config.toml` byte-for-byte.

Because restoration is exact, deliberate changes made to `config.toml` while
the relay is enabled are replaced by the saved baseline.

## Dashboard and health

With the persistent relay running:

- Dashboard: <http://127.0.0.1:4144/dashboard>
- Health: <http://127.0.0.1:4144/health>

The dashboard keeps a bounded, sanitized local history. It redacts common
credential fields and token patterns, but you should still treat `runtime/` as
private. The entire directory is excluded from Git.

## One-shot isolated launcher

The one-shot launcher does not modify the user's normal Codex configuration:

```powershell
.\codex-copilot.cmd exec --ephemeral --skip-git-repo-check "Reply with exactly RELAY_OK"
```

It starts an authenticated temporary loopback relay, launches the bundled Codex
CLI with provider overrides, and stops the relay when Codex exits.

## Concurrency and tests

Each initial Responses request receives a separate Copilot SDK session, so
independent Codex agents can overlap instead of sharing a single serialized
session.

```powershell
npm test
.\proxy-config.test.ps1
npm run probe:stream -- --url http://127.0.0.1:4144/v1
npm run probe:concurrency -- --url http://127.0.0.1:4144/v1 --count 4 --model gpt-5.6-sol
npm run probe:tools-relay -- --url http://127.0.0.1:4144/v1 --steps 6 --model gpt-5.6-sol
npm run probe:premature-recovery -- --url http://127.0.0.1:4144/v1
npm run probe:delayed-tool -- --url http://127.0.0.1:4144/v1 --delay-ms 31000
npm run probe:failure-stream -- --url http://127.0.0.1:4144/v1
```

The live probes consume Copilot allowance. Unit and configuration tests do not
make model calls. Together, the probes verify ordered Responses streaming,
parallel requests, a multi-turn tool chain, progress-only recovery, delayed
outer-tool continuation, and a well-formed terminal failure.

The default 13-hour outer-tool result window lets a single Codex exchange wait
through a 12-hour local render, browser operation, or child-agent task. It does
not create artificial follow-up turns after Codex has genuinely completed a
task, and it cannot override GitHub account limits, model limits, outages, or
service policy. Override it with `BRIDGE_TOOL_RESULT_TIMEOUT_MS` if a different
local ceiling is required.

The context guard keeps up to 12 historical image attachments (16 MiB of
base64 data in total), limits each historical text tool result to 64 KiB, and
rejects more than 1,000,000 serialized text characters before an upstream model
retry loop. The dashboard and terminal report `CONTEXT OK` whenever image
conversion or clipping is applied.

## Security model

- The persistent HTTP listener is hard-coded to `127.0.0.1`.
- Copilot OAuth credentials are not copied into this repository or runtime
  state.
- Persistent mode intentionally has no bearer token because it is local-only.
- Any local process running as the user may submit a request while the relay is
  enabled and consume Copilot allowance.
- For child-agent compatibility, the relay removes the OpenAI-provider-specific
  `encrypted` annotation from the tool schema sent to Copilot and transports
  the delegation message as ordinary text on loopback. Do not expose the relay
  outside the local machine.
- `runtime/`, `node_modules/`, logs, PIDs, event history, and config backups are
  ignored and must never be committed.
- Disable the relay when it is not needed.

## Terms and project status

The [GitHub Copilot SDK](https://github.com/github/copilot-sdk) is MIT-licensed
and GitHub documents it as a programmable SDK for building Copilot-powered
applications. SDK usage requires an entitlement unless BYOK is configured, and
prompts count against the applicable Copilot quota.

Users are responsible for complying with the
[GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service),
[additional product terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features),
and [acceptable-use policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies).

This project is not affiliated with, endorsed by, or supported by GitHub,
Microsoft, or OpenAI. GitHub, GitHub Copilot, OpenAI, and Codex are trademarks
of their respective owners.

## License

Codex Copilot Relay is released under the [MIT License](LICENSE).
