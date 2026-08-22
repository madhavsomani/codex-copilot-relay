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
- Aggregate history is compacted into a bounded continuity ledger before it can
  overflow the configured model-context guard
- Streaming failures end with a standard `response.failed` event instead of a silent disconnect
- Loopback-only listener on `127.0.0.1`
- Local dashboard with sanitized request, replay, latency, and tool metadata
- Visible Windows Terminal event stream
- Watchdog recovery for both the relay and visible terminal
- Two-click enable/restore workflow for Codex `config.toml`
- SHA-256-verified, current-user-only full-config backup

## Requirements

- [Node.js](https://nodejs.org/en/download) 20.19+ or 22.12+ (Node 22 LTS is recommended)
- Git
- A GitHub account with a Copilot plan; organization-managed accounts also need
  the Copilot CLI policy enabled
- A GPT model exposed to that account by GitHub Copilot
- Codex desktop or CLI with custom Responses-provider support

The durable shortcuts, watchdog, automatic `config.toml` backup, and exact
restore are Windows 10/11 features. The Node relay itself can be started
manually on macOS or Linux; see [Manual cross-platform setup](#manual-cross-platform-setup).

## Windows: complete setup

### 1. Install and authenticate GitHub Copilot CLI

GitHub's current cross-platform installation requires Node.js 22 or later:

```powershell
npm install -g @github/copilot
copilot login
copilot --version
```

Follow the browser device-login flow. The OAuth credential is stored by
Copilot CLI in Windows Credential Manager; this project does not copy it into
the relay folder. GitHub CLI authentication (`gh auth login`) is also supported
as a lower-priority fallback.

Official references:

- [Install and start GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started)
- [Authenticate GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli)
- [How Copilot SDK authentication works](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)

### 2. Clone and install the relay

```powershell
git clone https://github.com/madhavsomani/codex-copilot-relay.git
cd codex-copilot-relay
npm ci
```

The official Node SDK bundles its compatible Copilot CLI runtime. Installing the
global CLI above gives users the supported login command and writes the shared
signed-in identity that the SDK uses.

### 3. Verify authentication and model access

```powershell
npm run probe -- --model gpt-5.6-sol
```

The command prints model metadata and exits successfully when the signed-in
account exposes that model. If it reports a list of other GPT models, use one
of those model IDs consistently in the commands below.

### 4. Enable the durable gateway

Open PowerShell in the cloned folder. Administrator privileges are not needed.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
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

The managed provider includes these reliability controls:

```toml
request_max_retries = 0
stream_max_retries = 3
stream_idle_timeout_ms = 900000
```

The relay emits a valid sequenced `response.in_progress` SSE event every 15
seconds during quiet model work. The 15-minute Codex idle timeout is a safety
net, not the normal keepalive mechanism. Bounded stream retries handle a
dropped loopback stream without creating an unbounded retry loop.

### 5. Reopen Codex and verify routing

Close and reopen the Codex task after switching providers so the app server
reloads `config.toml`, then run:

```powershell
Invoke-RestMethod http://127.0.0.1:4144/health
npm run probe:stream -- --url http://127.0.0.1:4144/v1 --model gpt-5.6-sol
npm run probe:concurrency -- --url http://127.0.0.1:4144/v1 --count 4 --model gpt-5.6-sol
```

Open <http://127.0.0.1:4144/dashboard> to inspect sanitized local request and
tool-call activity. A healthy relay reports `sseHeartbeatFormat` as
`response.in_progress` and accepts concurrent exchanges.

### Local-only and mobile access

Both the relay and dashboard bind to `127.0.0.1`, so they are reachable only
from the Windows computer running the bridge. A phone cannot open that
localhost address, and ordinary mobile Chat/Work does not read the desktop
Codex `config.toml` custom-provider setting.

If the ChatGPT mobile app shows **Remote** and this Windows Codex host is paired,
you can steer a [supported desktop Codex task](https://help.openai.com/en/articles/20001275/)
from the phone while the computer stays awake, online, and running Codex. The
task still executes on the Windows host, where this local relay and provider
configuration remain in effect. This is indirect remote control, not direct
mobile access to the relay or dashboard.

Do not port-forward the persistent relay: it intentionally has no bearer token
in local-only mode. The source repository can be viewed from a phone after it
is made public, but that alone does not route mobile ChatGPT through Copilot.

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

The Start/Repair shortcut can enable the relay again later. Closing only the
visible terminal does not disable it: the watchdog reopens the terminal and
keeps the relay available. The Restore shortcut is the intentional off switch.

## Manual cross-platform setup

Windows users should prefer the automated flow above. On macOS or Linux, or
when you do not want the Windows watchdog, use this manual flow.

1. Install/authenticate Copilot CLI, clone the repository, run `npm ci`, and
   verify the selected model with `npm run probe -- --model MODEL_ID`.
2. Back up `~/.codex/config.toml` somewhere private.
3. Start the relay and keep that terminal open:

   ```bash
   BRIDGE_PORT=4144 BRIDGE_DEFAULT_MODEL=gpt-5.6-sol node server.mjs
   ```

4. Update the existing top-level `model` and `model_provider` values in
   `~/.codex/config.toml`, then add the provider block once:

   ```toml
   model = "gpt-5.6-sol"
   model_provider = "github_copilot_bridge"

   [model_providers.github_copilot_bridge]
   name = "GitHub Copilot local bridge"
   base_url = "http://127.0.0.1:4144/v1"
   wire_api = "responses"
   requires_openai_auth = false
   request_max_retries = 0
   stream_max_retries = 3
   stream_idle_timeout_ms = 900000
   ```

5. Reopen the Codex task and run the health and streaming probes shown above.
6. To stop, terminate `node server.mjs` and restore the private config backup.

The provider fields are defined by Codex's official
[configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).
The manual flow has no crash watchdog and cannot restore configuration
automatically.

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
npm run probe:codex-heartbeat
npm run probe:client-disconnect -- --url http://127.0.0.1:4144 --model gpt-5.6-sol
npm run probe:stream -- --url http://127.0.0.1:4144/v1
npm run probe:concurrency -- --url http://127.0.0.1:4144/v1 --count 4 --model gpt-5.6-sol
npm run probe:tools-relay -- --url http://127.0.0.1:4144/v1 --steps 6 --model gpt-5.6-sol
npm run probe:premature-recovery -- --url http://127.0.0.1:4144/v1
npm run probe:delayed-tool -- --url http://127.0.0.1:4144/v1 --delay-ms 31000
npm run probe:failure-stream -- --url http://127.0.0.1:4144/v1
```

The live probes consume Copilot allowance. Unit, configuration, and
`probe:codex-heartbeat` tests do not make Copilot model calls. The heartbeat
probe runs a real Codex client against a deterministic local Responses server:
Codex has a 1-second idle timeout, receives no model text for 4 seconds, and
must remain connected through parsed heartbeat events. Together, the probes
verify ordered streaming, abandoned-client cleanup, parallel requests, a
multi-turn tool chain, progress-only recovery, delayed outer-tool continuation,
and a well-formed terminal failure.

The default 13-hour outer-tool result window lets a single Codex exchange wait
through a 12-hour local render, browser operation, or child-agent task. It does
not create artificial follow-up turns after Codex has genuinely completed a
task, and it cannot override GitHub account limits, model limits, outages, or
service policy. Override it with `BRIDGE_TOOL_RESULT_TIMEOUT_MS` if a different
local ceiling is required.

The watchdog recovers the gateway for new calls after a process or terminal
failure. In-memory exchanges cannot survive a relay process crash, machine
sleep/network loss, an upstream Copilot outage, quota exhaustion, or a model
context limit. Long-running work should still produce checkpoints and durable
artifacts so Codex can resume safely after any external interruption.

The context guard keeps up to 12 historical image attachments (16 MiB of
base64 data in total) and limits each historical text tool result to 64 KiB.
When instructions, tool schemas, and accumulated history approach 90% of the
configured serialized-text ceiling, the relay preserves every outer instruction,
the latest user request, and the newest tool chain while replacing older history
with a bounded continuity ledger. Image attachments referenced only by omitted
history are dropped. The selected dashboard record exposes retained/omitted
entry and character counts, and the terminal reports `CONTEXT OK` when this
compaction occurs.

The hard rejection remains as a last resort when fixed instructions/tool schemas
or the mandatory current request and newest tool chain cannot fit under the
ceiling. Raising the limit does not increase the upstream model's context window.

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

## Author

Created by [Madhav Somani](https://www.linkedin.com/in/madhavsomani).

## License

Codex Copilot Relay is released under the [MIT License](LICENSE).
