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

The relay translates request, response, and tool-call envelopes. Codex keeps
ownership of local tool execution, sandboxing, and approvals. When a model asks
for a tool, the relay returns that request to Codex; Codex runs the tool locally
and sends the result back through the relay.

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
- Tool-call and tool-result continuation
- Streaming and non-streaming Responses output
- Automatic recovery from empty Copilot completions with a bounded per-turn retry limit
- Sliding activity timeout and SSE heartbeat for long-running tasks
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
npm run probe:concurrency -- --count 3 --model gpt-5.6-sol
npm run probe:tools-relay -- --steps 4 --model gpt-5.6-sol
```

The two live probes consume Copilot allowance. Unit and configuration tests do
not make model calls. The tool-relay probe verifies a multi-turn tool chain and
fails if the relay returns an empty final answer.

## Security model

- The persistent HTTP listener is hard-coded to `127.0.0.1`.
- Copilot OAuth credentials are not copied into this repository or runtime
  state.
- Persistent mode intentionally has no bearer token because it is local-only.
- Any local process running as the user may submit a request while the relay is
  enabled and consume Copilot allowance.
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
