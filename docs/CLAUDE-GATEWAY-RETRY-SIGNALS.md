# Claude gateway retry-signal contract

October 7, 2026. Objective: preserve upstream retry decisions on failed HTTP
responses before SSE starts, while leaving stock-client retry policy, actual
credentials/destination, pending tools and production Codex unchanged.

Acceptance:

- Read only bounded upstream error metadata. Preserve `x-should-retry` values
  `true`/`false`; absent/invalid values stay absent. Never invent a provider retry
  decision or forward arbitrary/auth/plan-limit headers.
- Return `retry-after` as whole seconds, preserving integer delays including
  values greater than 60. Convert valid IMF-fixdate to nonnegative ceiling seconds
  relative to response observation; omit malformed/infinite/unsafe values.
- Retain validated upstream request ID in body and HTTP `request-id` header.
  Transport observation, error projection and HTTP sink must retain these
  controls together; do not modify the original SDK-facing response bytes.
- After SSE starts, preserve the failure event and terminate without replay,
  header rewriting, fabricated usage or `message_stop` success.
- Red/green unit and end-to-end loopback checks, full Windows/Linux suites,
  finite unmodified stock-client error proof and protected backup/hashes.
  No paid-provider or active-outage injection is included.

The official [gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol)
documents retry headers and integer seconds. It also explicitly makes token
counting optional: Claude falls back to a character-based context estimate.
The installed Copilot SDK exposes no inspected exact-count method. We retain
the honest 501 endpoint; no guessed Anthropic count or direct-provider fallback.

Full native parity, sustained provider load, Linux authentication, macOS and
provider/licensing clearance remain outside this finite retry proof. The local
Copilot/Claude model gateway is an unofficial per-user preview, not an account-
safety guarantee or a shared/resold service.

## Verification on source 1.3.58 / adapter 0.1.13

Three initial retry regressions failed before the fix; all six current focused
tests pass afterward. The full Windows suite passes 392 with one skip and Ubuntu
passes 391 with two skips (393 tests, zero failures on each platform). Dependency
audits report zero known vulnerabilities. Restore/Remote tests use synthetic
files and do not claim a phone round trip or production stop.

Unmodified Claude 2.1.292 on Windows/Node 24.13.0 and Ubuntu/Node 22.22.0 stops
after exactly one upstream HTTP 500 carrying `x-should-retry:false`, reports
`LOCAL_NON_RETRYABLE_FIXTURE`, and leaves zero owned sessions, bindings or pending
tools. This intentionally failed request is not a completion. The stock file-tool
proof also completes four Read -> Write -> Read requests on each OS, with an
actual SUM=42 file. Both probes use a scripted local provider, no Copilot login or
SDK inference receipts, and process-scoped client state. No paid-provider,
active-outage, long-duration or universal stock-retry-policy claim is made.

Reproduce the bounded local checks from an isolated installed checkout:

```sh
npm test
node claude-gateway/probe-retry-signals.mjs --local
node claude-gateway/probe-stock-local.mjs --local
```

Use `CLAUDE_EXECUTABLE` when the separately installed unmodified client is not
on PATH. The retry probe accepts only `--local`; no live/outage/fallback mode is
available. Reports are saved under ignored `runtime/` paths. Do not upload raw
client logs, private runtime ledgers or account/configuration files.
