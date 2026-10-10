# Claude desktop Code UI through Copilot (attachment preview)

Source **1.3.62**, Messages adapter **0.1.14**. This adds a gateway-only mode for
the **unmodified Claude desktop application's Code tab**, not another terminal
Claude session and not a replacement GUI. Desktop end-to-end inference still
requires an actual app prompt/receipt; CLI and loopback tests do not prove it.

## Contract

- Objective: let the real desktop Code UI attach using its documented third-party
  inference form while preserving the working Codex relay.
- Acceptance: exact entitled Claude model IDs, no model/provider fallback,
  private local key, credential-free read-only observer, owned shutdown, unchanged
  saved Codex/Claude settings until the user applies a profile in the app.
- Non-goals: client patches, machine/user policy injection, automatic app restart,
  production promotion, a unified 4144 dashboard, durable watchdog or native parity.
- The active Codex service at 4144 and the CLI preview at 4246 are reserved. The
  default desktop attachment endpoint is 4261; its optional observer is separate.

## Prerequisites

Use your own official Copilot CLI authentication and model entitlement. Install
locked dependencies with `npm ci` in a **fresh, inactive checkout**; patched
sharp >=0.35.5 is required. Do not install beneath an active relay. Install the
regular Claude desktop app separately; do not redistribute or modify it.
See [portable setup](PORTABLE-LAUNCH.md) and [provider/policy boundaries](CLAUDE-GATEWAY-POLICY.md).

The desktop app **does not read** the CLI's `ANTHROPIC_BASE_URL` or
`settings.json` as its gateway routing configuration. Anthropic documents a
separate [desktop gateway form](https://code.claude.com/docs/en/llm-gateway-connect#desktop-app).
The supported [single-machine setup](https://claude.com/docs/third-party/claude-desktop/installation#single-machine-setup)
uses the regular app; no binary patch or account-token extraction is needed.

## Start and configure

1. From the reviewed checkout, run:

   ```sh
   node launch.mjs claude-desktop --port 4261 --setup-port 4263 --open-setup
   ```

   On Windows, `Start-Claude-Desktop-With-Copilot.ps1` runs the same mode. Use
   `-RuntimeDirectory` to select a reviewed isolated checkout rather than the
   active source/dependency installation. Existing listeners are never adopted
   or terminated. The gateway uses exclusive per-port history ownership.

2. Leave that terminal open. Enter `key` there to show the **local session key**.
   It is randomly generated, not your Copilot/Claude account credential. The
   key is never written to a relay file, startup log, or browser projection.
   Explicitly showing it exposes it to anyone who can see/capture that terminal.

3. Save work in existing desktop sessions before any app restart. In Claude's
   application menu, open **Help > Troubleshooting > Enable Developer Mode**,
   then **Developer > Configure Third-Party Inference**. If a managed policy
   makes this form read-only, stop and ask your administrator; do not override it.

4. In **Connection**, enter:

   | Field | Value |
   |---|---|
   | Inference provider | Gateway |
   | Gateway base URL | `http://127.0.0.1:4261` |
   | Credential kind | Static API key |
   | Gateway auth scheme | Bearer |
   | Gateway API key | The local key from step 2 |

   Keep **Allow Code** enabled. Leave **MCP tool search** disabled: this adapter
   does not implement its experimental request shape. Model discovery uses
   `GET /v1/models` and returns only the authenticated SDK's allowed Claude IDs.
   The terminal also prints a non-secret `inferenceModels` list for explicit
   configuration if needed. Do not assert 1M support or relabel GPT as Claude.

5. Click **Apply Changes**, then **Save & Restart**. Choose the third-party
   inference option on the sign-in screen and open **Code**. Select a disposable
   project folder and an entitled model such as `claude-opus-5-5`.

Anthropic's form and configuration fields are documented in
[in-app configuration](https://claude.com/docs/third-party/claude-desktop/in-app-configuration)
and the [gateway reference](https://claude.com/docs/third-party/claude-desktop/gateway).
The relay does not write the app's internal config-library format or registry.

## Verify the actual GUI, not just readiness

The desktop connection check can request only one output token. A genuine
native `max_tokens` terminal may therefore have empty content. The adapter
finishes that response after the upstream terminal and SDK usage receipt,
then cancels the owned SDK session instead of waiting for its empty-response
retry loop. It preserves the requested token limit, actual content and measured
usage; it does not fake a health-check answer or extend the app's deadline.

First send this small Code-tab prompt. It consumes Copilot allowance:

```text
Reply exactly GUI_RELAY_OK. Do not run tools or change files.
```

Require both the actual GUI reply and a **completed request** in this gateway's
terminal/observer. Check the SDK receipt for the **actual model** and reported
AI credits. The connection page's `listening` state means only ready to accept
traffic; `traffic-observed` means a recent authenticated Messages request, not
proof that it came from the GUI or completed. Match the GUI timing with its
request's completed status and actual-model receipt. CLI/desktop request source
is not independently attested by this transport.

Then try a small file read/write/test in that disposable project, reviewing the
stock app's permissions and diff. Model requests go to Copilot; local tools run
in the stock client, and their own external services retain their own billing.
Usage is local SDK receipt coverage, not an invoice or remaining allowance.

An inference-free readiness check is available:

```sh
node launch.mjs claude-desktop --check --no-setup
```

It authenticates/discovers metadata, opens and closes the owned gateway, and sends
**no Messages/inference request**. It does not validate desktop GUI inference.

## Stop and revert

- Enter `quit` in the gateway terminal, or use handled Ctrl+C. Its owned gateway
  and observer close; the existing Codex service stays running. EOF also stops it.
- The displayed key is **session-scoped**. Relaunching produces a new key, so
  update the desktop form before the next session. Durable credential/setup
  management and watchdog restart are not implemented by this preview.
- The saved desktop profile stays selected until you change it in the app.
  Stopping the gateway **does not restore or retarget that saved profile** and
  does not silently fall back. Return to the sign-in screen and choose the
  ordinary Anthropic sign-in option to use standard Claude Desktop again.
- No Codex TOML was edited, so there is no Codex restoration step. If a crash
  retains `gateway.owner.json`, confirm every owned writer is stopped before
  removing only that receipt; preserve the ledger and never delete through a
  dependency junction.

Third-party mode uses a separate local profile/storage. Existing subscription
chats may not appear there; this launcher neither migrates nor deletes them.
The profile can affect Chat/Cowork as well as Code: this is not a Code-only
override. Do not treat those surfaces as certified here. Anthropic-hosted cloud,
Remote Control and voice have documented gateway restrictions. A loopback
gateway also cannot serve an SSH host by itself; do not expose it on the network.

## Evidence and release boundary

The new tests cover form projection, argument admission, startup interruption,
metadata-only exit, explicit-key disclosure, EOF/signal shutdown, independent
observer/console cleanup, safe errors and real local HTTP model/observer checks.
They add no paid inference or desktop automation. Actual desktop model choice,
embedded-engine request semantics, saved profile restart/return, sustained load
and concurrent desktop clients remain acceptance gates.

This is one source entry point with distinct transport modes, **not yet one
combined production service/dashboard**. The original Codex production/dashboard
remains untouched. Published interfaces permit an engineering prototype, not a
provider endorsement, a no-suspension guarantee or a resolved licensing opinion.
