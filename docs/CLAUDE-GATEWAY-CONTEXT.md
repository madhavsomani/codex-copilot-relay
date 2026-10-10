# Active continuation context admission

October 7, 2026; source 1.3.51 / adapter 0.1.10. Isolated review candidate;
no live Codex restart, config change or dashboard/history replacement.

## Reproduced gap

Fresh Messages requests applied a prompt/context estimate, but the active
pending-tool branch returned before that check. A valid tool-result message with
oversized new user text was accepted with HTTP 200 and resolved both pending
results. The regression expected a pre-inference 400 and failed before the fix.
This could turn oversized history into an avoidable upstream failure on a long
task. Raising a byte limit does not make more model context available.

## Shared admission contract

`claude-gateway/server.mjs` now uses the same `admitContext` helper for fresh
and active-continuation requests. It enforces:

- System instructions at most 1,000,000 serialized text characters, matching
  the existing upstream character guard.
- Local estimated text tokens at or below the authenticated model's advertised
  `max_prompt_tokens`, or the existing conservative default when absent.
- Estimated prompt tokens **plus requested `max_tokens`** at or below its
  advertised `max_context_window_tokens`, or the existing default when absent.

The estimate includes rendered system/full message text, client tool definitions
and output-format controls. On an active continuation it uses the **retained
native prefix** plus the new last user message, not just the client prefix. This
counts existing relay-generated overview notes that may be absent from the client
transcript. All incoming tool results and any permitted user suffix count.
Fresh requests retain their post-image-packing note check and context-tier choice.

Owner, model/system/catalog, original history and complete/unique tool results
are still validated first. Budget rejection occurs before attaching a new sink,
changing the tool-turn deadline or consuming any pending result. No new SDK
session/inference is created for the rejection. A smaller retry with the same
valid history can continue the original owned SDK session. The completed tool
receipt is not overwritten by the rejected request's separate ledger row.

This does not silently compact, truncate, split or replay tool output. The relay
never calls another provider or invents usage to recover an oversized request.
Signed history cannot be edited to fit; use stock compaction/restart boundaries
appropriately instead of deleting history from a live signed continuation.

## Proof and limits

Two new adapter tests pass (327 total repository tests, 59 adapter tests):

1. Prompt-limit rejection and prompt-plus-output rejection, the latter with a
   prompt proven to fit the window by itself. Pending results remain undelivered,
   the original receipt remains unchanged, rejection usage/transport stays
   unreported/zero, and a smaller valid retry succeeds on the same session.
2. Oversized tool-result content and oversized retained-native notes absent from
   client history reject early, including a streaming request returning ordinary
   error JSON before SSE begins. Corrected input resumes once. Private test text
   is absent from the metadata ledger. Retained notes use an isolated native-prefix
   fixture, not an actual provider-packed-image measurement.

These tests use local fixture sessions and artificial advertised limits. They
are not paid provider inference, actual stock-client large-context acceptance,
or a long-duration soak. The earlier full stock-client evidence remains labelled
as 0.1.7, not universally recertified by these checks.

`countModelTokens` is a local estimator, **not** Anthropic's exact tokenizer.
Native protocol/thinking/image overhead and any newly created image-packing
notes may differ from the pre-continuation estimate. Separate image and HTTP
byte guards still apply; missing capability limits use conservative defaults.
Upstream owns final admission. The explicit 501 exact-count endpoint is unchanged;
cache accounting, actual usage receipts and AI-credit reporting are unchanged.
This closes the skipped local text-budget check, not every possible upstream
context rejection or compaction/active-outage failure.

Fresh 0.1.10 Windows installation passed `npm ci`, all 327 tests, and a
zero-known-vulnerability `npm audit --omit=dev` with sharp 0.35.5. The stock
wrapper refused conflicting settings before SDK runtime creation; clean `--help`
exited 0, closed its owned port and released ownership with existing client configs
unchanged and no inference receipt logged. Basic-revert and Remote/account
preservation fixtures passed; they are not an iPhone round trip.

Separate Ubuntu 24.04/Node 22.22.0 installation passed 325 tests, with the two
Windows-only registry/setup checks skipped, and a zero-vulnerability audit.
Linux sharp was 0.35.5; no Windows dependencies or account credentials were copied.
Linux test/install/audit logs were copied to the ignored Windows candidate runtime
for review. No Linux Claude executable was installed, so this does not prove
Linux stock-client acceptance. macOS acceptance and new paid-provider proof remain open.

## Rollback and remaining goal

Recover 0.1.9 into a separate checkout if reviewing without this guard. Do not
overwrite active/dirty work or remove ledger history. Exit the opt-in wrapper
and use plain `claude` in a fresh terminal for original configuration; no saved
settings, account credentials or stock binaries were changed.

The full goal remains active: hosted/beta semantics, sustained and active-outage
acceptance, cross-platform stock-client proof, unified opt-in setup/history,
and provider/distribution clarification remain. This source is not deployed,
committed, pushed, or a universal native-parity/account-safety certification.
