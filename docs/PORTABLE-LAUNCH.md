# One installation, two stock CLI clients (isolated preview)

Source 1.3.61 also adds a **gateway-only Claude desktop attachment preview**.
It uses the app's documented third-party inference form, not CLI environment
inheritance. See [the GUI setup and revert guide](CLAUDE-DESKTOP.md). Its GUI
round trip remains unverified; the existing desktop relay/dashboard is untouched.

The CLI launcher implementation preserved from **1.3.60** includes `node launch.mjs codex ...` or `node launch.mjs claude ...`, with a child-scoped authenticated Codex model catalog, owned credential-free observers and hardened isolated Claude launcher lifecycle. Source **1.3.61** adds the separate GUI attachment mode linked above. It does not change the running desktop relay or make the broader compatibility goal complete. Claude adapter is **0.1.13**; historical inference proofs retain their tested versions. See [Claude lifecycle scope](CLAUDE-LAUNCHER-LIFECYCLE.md).

## Setup

1. Use a separate checkout with Node.js 22 or later. Install its reviewed dependencies with `npm ci`. Do not install dependencies beneath a running relay. No dependency installation is performed by the launcher.
2. Sign in using the official, bundled [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started):

   ```sh
   node node_modules/@github/copilot/npm-loader.js login
   ```

   Each system and user needs its own eligible account and authentication. Do not copy another system's tokens or use a shared credential service.
3. Codex uses the bundled, unmodified `@openai/codex` **0.147.0** CLI, or an absolute `CODEX_EXECUTABLE` path to that reviewed stock version. Other client versions fail closed until their schema/prompt is reviewed. Claude must already be installed and use an absolute `CLAUDE_EXECUTABLE` path when necessary. See [Claude preview setup](CLAUDE-GATEWAY-PREVIEW.md).
4. Put launcher port/setup options **before** the separator and ordinary client prompts/tool/approval/sandbox options **after** it. Codex model/effort are validated launcher options before `--`; Claude model/effort remain stock client options after `--`:

   ```sh
   node launch.mjs codex --model gpt-6.1-sol --effort high --
   node launch.mjs codex --port 4151 --model gpt-6.1-sol --effort xhigh -- exec --sandbox read-only "Explain this repository."
   node launch.mjs codex --open-setup --model gpt-6.1-sol --effort xhigh --
   node launch.mjs codex --port 4151 --setup-port 4153 --model gpt-6.1-sol -- exec --sandbox read-only "Explain this repository."
   node launch.mjs claude -- --model claude-opus-5-5 --effort high
   node launch.mjs claude --port 4257 --no-setup -- --model claude-haiku-4-5 --print "Explain this repository."
   node launch.mjs --help
   ```

   Model IDs are examples, not a promise of account entitlement. Codex's preflight requires the exact requested GPT ID in the authenticated SDK's non-disabled catalog; Claude uses its existing entitled Claude picker and native control checks. Efforts must be advertised for the selected model; the Codex launcher rejects unsupported `max` rather than silently capping it. If effort is omitted, Codex uses the relay's advertised model default (currently xhigh for entitled GPT-6.1 Sol) and prints the selection; Claude retains its existing launcher semantics.

## What changes and what does not

- The front door delegates Claude to its existing portable launcher. The new Codex launcher creates its own authenticated loopback server and runs stock Codex with child-only `-c` overrides and a random provider ID/bearer.
- It builds a fresh `model_catalog_json` from authenticated SDK GPT discovery intersected with the owned relay's effective limits/efforts. Stock Codex lists those exact model names and reasoning choices instead of using unknown-model fallback metadata. The packaged generic stock prompt is preserved; no other model's capabilities or OpenAI plan entitlement are copied. See [the catalog contract and attribution](CODEX-MODEL-CATALOG.md).
- Default Codex port is **4141**; **4144** and **4246** are reserved. Existing listeners are not adopted, restarted, or killed. Readiness requires an IPC signal from the owned child, matching relay version/model/routing/SDK health, and a successful bearer-protected endpoint check.
- Saved Codex TOML, account/login files, Claude settings, device pairing, and managed Remote policy are not edited. The CLI route uses `requires_openai_auth=false` plus a process environment key; it is **not** the paired desktop-auth/Remote configuration. Stock clients remain responsible for tools, approvals, sandbox enforcement, hooks, memory, sessions, and agents.
- Client model/provider/profile overrides are rejected. Set model/effort with launcher options. Ordinary stock tool/approval/sandbox options are forwarded without weakening them. Managed policy is not overridden or bypassed; a stock client's policy rejection remains a rejection.
- The bundled stock Codex 0.147.0 also rejects obsolete saved `profile="..."` / `[profiles.name]` syntax itself. Its rejection is preserved, without rewriting that configuration or starting inference; this launcher does not convert profiles or bypass client validation.
- Server routing/optional Platform-adapter environment values are not inherited. The Platform adapter is disabled and no provider fallback occurs. Explicit source-root native **image-only** opt-ins remain a separate service/account path; this launcher does not enable them. Search is not a native helper.
- Stock Codex can still create its normal session/history files and execute user-authorized tools. "No saved configuration/auth edits" does not mean the stock client makes no filesystem writes.
- This is a **CLI opt-in**, not a desktop installer, automatic desktop attachment, iPhone Remote acceptance, cross-wrapper live attachment, shared model picker, or every-feature/native-API parity certification. The original dashboard is untouched; the authenticated inference gateway intentionally has **no browser dashboard**. Its separate read-only connection center receives no inference bearer. Saved local usage is separate history, not account-wide usage.

## Owned Codex connection center

The launcher prints a read-only URL on a separate available loopback port by
default. Use `--open-setup` to open it, `--setup-port 4153` for a fixed observer
port, or `--no-setup` to omit it. Put these options before `--`. Ports 4144/4246
and the inference port are rejected; an occupied observer port is never adopted
or terminated, and its failure does not change inference routing.

The page shows the owned gateway/version, launch model/effort, recent labelled
request observation, lifetime received/completed/failed outcomes, active
exchanges/sessions, finalized SDK receipt/token subtotals and credit-report
coverage. Missing credits stay unreported; explicit reported zero stays zero.
Stored token normalization may have written zeros for absent fields. Counters
are not an invoice, remaining entitlement or a count of every HTTP attempt.
The selected model is not per-request actual model attribution. Failed/active
attempts may have additional unreported usage. Authentication/discovery was
checked at launch, not continuously certified.

Metadata comes from a fixed owned-loopback `/health` response, capped at 64 KiB
and four seconds, with a shared 10-second cache and one in-flight read. The
browser gets only an allowlisted projection. Changed version/model/provider,
invalid counts or failed reads produce unavailable status, not fabricated zero
totals. Exited wrapper ownership invalidates the cached sample. No arbitrary
browser port/path selectors, account reads, bearer sharing, write endpoints,
redirects, SDK inference, automatic installer or provider fallback are added.

Observer and owned gateway close with the wrapper. Saved configuration remains
unchanged, so there is no TOML restoration step. The page does not attach to an
unrelated desktop or Claude gateway. Its saved-history panel may contain these
same counters; do not add saved and live panels together. See
[the observer acceptance contract](CODEX-OBSERVER.md).

## History, shutdown, and restore

Codex uses a separate `runtime/codex-cli/ports/<port>` directory, including the existing bounded relay recorder. Its history cap is 64 MiB and event-log cap is 8 MiB; other bounded recorder/telemetry files are additional. These are per-instance limits, not a global combined one-gigabyte guarantee for arbitrarily many ports or existing legacy logs. Restarting the same cleanly closed port retains that history. Claude keeps its separate existing history.

An exclusive `gateway.owner.json` receipt records the launcher and server PIDs. A stale or uncertain receipt fails closed: verify the launcher, server, and any Copilot child writers are stopped before manually removing **only that receipt**, never the retained history. There is no automatic uncertain-owner reclamation.

Each launch also creates an exclusive `models-<random-id>.json` inside its owned runtime. Confirmed graceful exit deletes that generated catalog only; uncertain exit retains it alongside the owner receipt for inspection. Every clean relaunch refreshes authentication/model metadata. This file contains model/client metadata, not tokens or request bodies.

Normal/nonzero client exit and launcher SIGINT/SIGTERM request graceful IPC shutdown of the owned server, which runs the existing SDK/exchange cleanup. A server crash stops its stock client without fallback and retains the receipt for inspection. If the shutdown deadline expires, only the owned server PID is terminated and the receipt remains; orphan-worker absence is **not** asserted. Abrupt machine/terminal/process-tree termination is not yet universally certified. This launcher does not implement durable watchdog restart.

There is no TOML restoration step because no saved routing was applied. When it exits, new ordinary clients use their unchanged saved configuration. It does not close or retarget unrelated desktops/CLIs, nor replace the existing Windows desktop Start/Restore shortcuts.

## Evidence and remaining gates

The acceptance tests exercise normal/nonzero exit, retained history, authentication/entitlement rejection, port conflicts, uncertain ownership, wrong bearer, unsupported effort, owned-child readiness, bounded metadata, shutdown signals, and owned-server failure. A stock Codex 0.147.0 response through the scripted loopback fixture is a real-client/local-transport check, **not** real Copilot inference.

On October 7, 2026, the fresh 1.3.55 Windows candidate also completed finite **real-provider** front-door probes: one stock Codex 0.147.0 request on port 4155 using actual GPT-6.1 Sol, and one stock Claude 2.1.292 request on port 4257 using actual Haiku 4.5. Each returned its exact marker, recorded one completed request / zero failures / one SDK credit receipt, and released its ownership receipt. The ledgers report **3.475100** and **14.635375 SDK AI credits**, respectively: **18.110475 total** for these two probes, not a balance/invoice or the whole chat's cost. No further paid probe is required for this increment.

The 1.3.55 real-provider probe observed unknown-model fallback metadata for `gpt-6.1-sol`. Source 1.3.56 addresses that launcher-specific gap with the supported child startup catalog; actual stock `model/list` and local-response tests verify the exact picker and absence of the fallback warning without new paid inference. This does not change the existing desktop model picker or recertify inference for every model. The earlier fresh isolated `CODEX_HOME` also produced an unauthenticated featured-plugin lookup and a Windows long-path warning during plugin synchronization; neither was repaired by editing client/account configuration. Stock Claude warns that **claude.ai-hosted connectors are disabled when gateway authentication takes precedence**; ordinary tested MCP/local tools are a different feature. Its JSON `provider: firstParty` and dollar estimate are client labels/list-price estimates, not proof of the upstream provider or an invoice. The gateway SDK receipts report the actual model/provider/credits.

Source 1.3.56 root and isolated Windows suites pass **372/372**. Isolated Ubuntu 24.04/Node 22.22.0 passes **370**, with two Windows-only skips and zero failures. These new source snapshots reuse each platform's independently reviewed 1.3.55 dependency installation; they are not new dependency installs. Root/Ubuntu dependency audits report zero known vulnerabilities. The Windows authenticated, inference-free launcher check exposes 13 exact Copilot GPT models in actual stock `model/list`, with GPT-6.1 Sol/xhigh selected, no fallback warning, and clean catalog/ownership release. SDK raw maxima are not advertised as the relay's effective budget: selected context is 400,000, effective input 68 percent, compaction threshold 244,800. No new paid model inference was requested for this increment.

Actual Linux stock-client loopback routing passes, but Linux's independent Copilot authentication probe remains not signed in; no Windows credentials were copied and no real Linux inference is claimed. macOS host acceptance, sustained load, active outages, wider native semantics, durable desktop setup and unified visibility remain open.

See [full acceptance gates](CLAUDE-GATEWAY-ACCEPTANCE.md) and [policy boundaries](CLAUDE-GATEWAY-POLICY.md). Successful SDK access does not establish provider endorsement, permission for all redistribution/use cases, a no-suspension guarantee, or native compatibility for unsupported endpoints. No client binaries, tokens, quotas, or account services are modified to obtain access.

Rollback of this increment is limited to its new launcher/test/fixture/document files and source manifest version. Do not reset the larger in-progress Claude implementation or alter the live desktop relay. Nothing in this document authorizes promotion, publication, paid soak tests, or the separately paused outage experiment.
