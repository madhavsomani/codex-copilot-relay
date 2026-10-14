# Reliability and peer audit: 1.3.78

Claude adapter: 0.1.23. Audited October 10, 2026. Supports unmodified clients;
no client binary, account, entitlement, signature or provider-fallback changes.

## What caused the continuation failures

- Stock Claude Code can replay an omitted Edit `replace_all` argument as false.
  Comparison now recognizes that equivalence only when the original Edit schema
  declares that optional boolean's default as false. Native input stays unchanged.
  Other arguments, required fields, signatures and ownership stay strict.
- Adjacent result-bearing user messages, including intervening system reminders,
  form one result batch. Original message boundaries and steering are preserved.
- SDK assistant chunks are accumulated before handing off the entire tool batch.
  Duplicate chunk/tool IDs and native-versus-SDK batch mismatches remain errors.
- All pending result ownership is claimed before RPC awaits. Interleaved SDK
  events cannot mix the old batch with the next one. No result is synthesized.
- An explicit entitled model change rebuilds the SDK session from validated
  history after all outstanding results arrive. Tools are not executed twice.
  Pending executable schemas must still match. Upstream rejection of signed
  history across models is surfaced, not repaired by rewriting signatures.

Invalid/missing/duplicate results and genuinely changed history still fail before
consuming pending tools. Restart cancellation intentionally abandons in-memory
ownership; the client retains its transcript and can rebuild on its next request.

## Which model actually runs

The dashboard's installation default is not an override in `per-request` mode.
Inspect a request's requested model, selected model, effort and SDK-reported model.
Changing global TOML does not change a running chat's selection. The next client
request must contain the desired model. A running request is not hot-swapped.
An unsupported model is rejected, never silently mapped to another family.

## Token and retry efficiency

The native hook replaces SDK bootstrap messages/system/tools with the validated
client transcript; it does not append both histories. Images are passed once in
their native positions, not again as SDK attachments. SDK-owned routing/auth
headers remain untouched. Other SDK envelope fields are retained for compatibility;
they are not evidence of duplicate prompt tokens.

Unbound inference now fails closed before any transport. Bound native requests
allow at most two transport attempts before output, and no replay after native
output or a nonretryable error. Invalid effort metadata fails before launching
the portable Codex backend, with the owned backend still validating readiness.

HTTP transport attempts and SDK usage receipts are separate counters. A second
HTTP 200 without a second usage receipt is an unresolved metering/SDK behavior,
not proof of either a free request or double billing. Usage is deduplicated by
receipt identity; late usage belongs to the initiating request. Missing usage is
unknown. Input totals already include cache tokens: never add them a second time.
SDK AI credits are `totalNanoAiu / 1e9`, not USD. Account-billing reconciliation
and paid-provider refunds are outside this local audit.

## Peer source comparison

Reviewed source only; no third-party package, server or credential helper was run.

| Project and pinned commit | Relevant design | Lesson for this relay |
| --- | --- | --- |
| [powercord3/claude-proxy](https://github.com/powercord3/claude-proxy/tree/6c21df813cd0cb327ff697543b27ad645d0a2e57) | `adapters/providers/anthropic-pass.ts` passes native Messages/SSE to compatible upstreams without SDK pending-tool state. | Native pass-through reduces translation, but is not evidence of Copilot entitlement or our SDK continuation guarantees. |
| [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api/tree/0ea08febdd7e3e055b03dd298bf57e669500b5c1) | `src/routes/messages/handler.ts` and `non-stream-translation.ts` translate Messages to Chat Completions; model aliases are normalized. | Simpler stateless translation avoids dual tool bookkeeping; signed native history is a different contract. Do not copy silent family remapping. |
| [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router/tree/057abaa1f95519ab8faf999e1ccef2b80ccdeb9e) | `packages/core/src/routing/execution-plan.ts` builds explicit off/retry/model-fallback plans. | Separate retry policy from routing and make attempts visible. Model/provider fallback stays disabled here. |
| [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/3de4e248f6bb12fc7dfafb183404f3b248578922) | `internal/runtime/executor/claude_executor.go` includes signature-sanitization diagnostics and provider normalization. | Diagnostic visibility is useful. Dropping/replacing signed blocks would violate this relay's preservation contract. |
| [github/copilot-sdk](https://github.com/github/copilot-sdk/tree/6be623b01b194a61466385e3f708639ec98ce8ac) | Documented request-handler extension and session-owned external-tool RPC. Installed SDK remains pinned to 1.0.11. | Keep the official SDK responsible for authentication/entitlement; test native and SDK state boundaries independently. |

Our main extra risk is dual state: client-native transcript plus SDK pending tools.
Boundary tests, strict ownership and metadata diagnostics address that risk;
copying permissive signature normalization would hide it rather than establish parity.

## Verification and remaining gates

- Maintained suite: 501 tests, 500 passed, one skipped, zero failures.
- Actual stock Claude Code 2.1.296: local Read -> Edit -> Read -> final, including
  consecutive empty signed blocks, four completed requests and no failed request.
  Provider is scripted loopback, not paid Copilot or Desktop GUI certification.
- Basic revert and Remote compatibility pass in isolated fixtures: exact original
  TOML plus untouched account, pairing, policy and stock engine sentinels.
- Live deployment must match both health versions. Live model acceptance should
  be checked using real ingress and SDK usage, not model self-identification.
- GUI browser approval/logged-in navigation, phone-to-host Remote, hosted search,
  native voice and every cross-model signed-history combination are not certified.
  Browser tools remain client-owned; OpenAI helpers remain images-only.

For an intentional package update, save work and use **Stop & Restore**, then
**Start Relay**. This cancels active requests. Ordinary Start/Repair and watchdog
promotion still protect active work. Keys, original backup and telemetry stay local.
