# Owned portable Codex observer contract

October 7, 2026. Source 1.3.59, Claude adapter unchanged at 0.1.13.

Objective: make the portable Codex wrapper observable without changing stock
clients, saved routing, production, or the existing dashboard. Preserve the
larger portable dual-client goal; this observer does not complete its setup,
provider, sustained-workload or policy gates.

Acceptance:

- Separate wrapper-owned read-only loopback portal; no browser inference bearer,
  arbitrary port/path selectors, credential/account reads, SDK inference or writes.
- Fixed owned `/health`: 64 KiB/four-second cap, no redirects, one shared in-flight
  read, 10-second cache. Process exit invalidates cached live state. Invalid
  identity/counters return unavailable, never stale totals or invented zeros.
- Distinguish launch selection from actual-model attribution, receipt counts
  from requests/transport attempts, credit coverage from remaining entitlement,
  active sessions from request totals, and saved history from live observation.
- `--setup-port`, `--open-setup`, `--no-setup` before separator; reserve production
  and inference ports, reject repeated/conflicting options. Observer conflict
  cannot affect inference or terminate another listener. Graceful close releases
  only owned resources and leaves saved configuration/auth unchanged.
- Prove initial regression, focused and full suites, actual stock Codex loopback
  response, wrapper/observer lifecycle, restore/Remote fixtures, responsive
  browser rendering, exact snapshot and backup. No paid test is needed.

Five initial checks failed before implementation. The focused suite now passes
24 tests including existing portable routing and actual unmodified stock Codex
0.147.0 response tests. Root Windows passes 400 out of 401 with one existing
symlink-privilege skip and zero failures. Lifecycle checks hold an owned scripted
relay/client, read its real HTTP metadata, signal the wrapper and verify closed
listeners, released ownership and preserved synthetic config/auth. A separate
observer-port conflict leaves its unrelated listener running. Oversized/redirect/
invalid metadata and unreported/partial/reported-zero coverage are exercised.

The browser rendered synthetic metadata on the actual new page at 1440x1000,
768x1024 and 390x844: no page-level horizontal overflow or console messages.
The phone panel with large counters was visually inspected. Screenshots live in
ignored `output/playwright/codex-observer-1.3.59-*.png`. This is synthetic UI proof,
not account sign-in or new provider inference. The owned preview/browser closed.

The existing `server.mjs`, `dashboard.mjs`, `setup-ui.mjs` and real Codex/Claude
config hashes are protected. The new panel is injected only into an owned Codex
observer page; standalone/Claude markup remains unchanged. The setup server adds
an optional observer callback/GET route without exposing it on the inference
gateway. Authentication/catalog checks retain their launch-time scope; no
remaining entitlement, universal outage or OS race-proof sandbox is claimed.

Platform/source verification is recorded separately in the acceptance audit and
ignored handoff after final packaging. Linux authenticated inference, macOS,
durable desktop setup, unified cross-wrapper live attachment, supported hosted/
beta semantics and licensing clarification remain open. The paid active-outage
experiment remains paused at its existing two-attempt gate. No client patches,
shared tokens, hidden model/provider substitution, publication or deployment.
