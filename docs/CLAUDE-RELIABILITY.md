# Relay reliability

Latest release notes: [1.3.83 Claude compaction recovery](CLAUDE-COMPACTION.md).
Earlier lifecycle repair: [1.3.80 startup and controls](RELIABILITY-1.3.80.md).
SDK metadata discovery starts correctly; explicit desktop Start/Stop cancel
owned work, while Repair/watchdog updates wait for exchanges to finish.

Continuation fixes: [v1.3.78 / Claude adapter 0.1.23](RELIABILITY-1.3.78.md) causally
reproduces and fixes the stock Edit-default prefix mismatch, split result
batches, chunked assistant tool batches and interleaved delivery. It also
supports explicit entitled model changes by rebuilding a validated continuation.
The historical observations below are not current release certification.

## Historical v1.3.74 / Claude adapter 0.1.20

Current update: [1.3.77 capacity fix](CLAUDE-CAPACITY.md) raises Claude's default
local session budget from 16 to 64, with a validated 2-128 launch-environment
override. The original release notes below describe the earlier 1.3.74 behavior.
Explicit Stop & Restore now cancels active work (1.3.76+); normal Start/Repair
and automatic updates still wait for it. See [desktop controls](TWO-CONTROLS.md).

This release is a focused reliability change, not a claim of native parity.
Browser/connector actions remain client-owned. No model, account, entitlement,
credential, or provider fallback changes are included.

## Changes

- Pre-stream failures now forward sanitized retry/correlation headers.
  Deterministic local 409 errors and session-capacity 503 errors say
  `x-should-retry: false`; unchanged automatic retries cannot repair them.
- The native request hook permits at most two attempts before output starts.
  Once a native response starts, or a terminal non-retryable error arrives,
  another SDK transport attempt for that request is refused. This does not
  promise that a client will never issue its own new HTTP retry.
- Late transport observations retain their original request row instead of
  being attributed to the next tool-result request.
- Usage receipts are deduplicated using provider call/event identity, not equal
  token counts. Only bounded in-memory hashes are retained. This does not
  retroactively repair historical receipts or make missing usage known.
- Codex and Claude use the same bounded receipt-identity gate. For retained
  exchanges, provider completion IDs bind late usage to its original HTTP turn.
  Late receipts correct request, model/lifetime and original-day task totals;
  they do not count another completed request. Expired task buckets stay expired.
  Identity-less receipts cannot be reliably deduplicated. No promise is made
  about receipts lost after SDK teardown or historical account reconciliation.
- When custom Claude session headers are absent, validated metadata session IDs
  now scope both continuation ownership and cost attribution. This closes a
  reproduced isolation gap; it is not a fix for the distinct GUI history 409.
- One reserved replacement slot allows a validated continuation to rebuild at
  full session capacity after legitimate setting/catalog changes. The original
  session stays owned until replacement succeeds. Ordinary new tasks cannot use
  that reserved slot; existing pending turns are never evicted automatically.
- Health exposes separate streaming, waiting-for-tools, rebuilding and capacity
  counts. SDK readiness alone is not evidence of available session capacity.
- Dashboard details and `/health.sessionControl` expose per-session age, waiting
  duration, model, task identity, pending-tool count and lease expiry. The
  dashboard remains read-only. `Relay-Sessions.ps1` supports explicit, single
  waiting-continuation cancellation through a local file command. Instance and
  revision checks refuse stale commands, streaming work and rebuilding work.
  There is no automatic age-based eviction or bulk cancellation.
- Strict history mismatches retain payload-free structural diagnostics in the
  private ledger: message/block positions, counts and mismatch category. They
  never record text, tool contents, signatures, or content hashes. The history,
  ownership and pending-tool executable checks remain enforced.
- Browser setup can explicitly target the Windows third-party Desktop profile.
  Start/Restore follows the selected profile's recovery journal. See
  [browser setup](CLAUDE-BROWSER.md).

## Verification

The maintained suite reports **480 tests: 479 passed, 1 skipped, 0 failed**.
Restore, Remote/account-policy preservation, desktop controls and whitespace
checks pass. New bug regressions failed before their fixes and pass afterward.

Stock Claude Code 2.1.296 completed a local Read -> Write -> Read -> final reply
using a scripted loopback provider, including consecutive empty signed thinking
blocks. Stock-client synthetic admission tests stopped after one 409 and one
503 respectively, with zero provider requests. These are actual client tests,
but **not real Copilot inference or Desktop GUI acceptance**.

The stock-client nonretryable upstream-error probe also stopped after one
request. Accounting regression tests exercise the actual Codex Exchange class,
Claude continuation events, duplicate receipts, late usage across midnight,
expired/overflow rollups and persistence. Candidate dashboard validation at
1440, 820 and 390 pixels found no page-level overflow or console errors. Restore,
Remote-policy and two-controls tests use isolated fixtures, not live shutdowns.

## Remaining gates

The observed Desktop history-prefix 409 is not yet causally reproduced. The
empty-signed-block case passes locally; do not remove prefix checks or call that
incident fixed. A reproduction must identify the exact safe client transformation
before admission is changed. Compaction that changes a retained prefix remains
unsupported rather than silently discarding or reconstructing signed content.

The GUI's `[1m]` display suffix was observed in diagnostics, while retained
gateway model rows use the base ID. No speculative alias or entitlement change
is introduced. Use only SDK-advertised model IDs and context budgets.

A live deployment must match `/health.version`, then pass GUI -> client tool ->
result -> continued model response. Never force-restart retained exchanges to
deploy this release. Deferred promotion is not a successful live deployment.
Browser extension approval and an app restart remain user-controlled gates.

An old live release without `sessionControl` cannot accept the new cancellation
command. Run Start/Repair to stage the candidate, allow its existing work or
13-hour tool leases to finish, and inspect `/health` for the new version. Do not
claim that the new command can clear old in-memory continuations, or force-stop
the older release. Save/stop unwanted work in its originating client first.

## Inspect and cancel one unwanted waiting continuation

From the relay installation folder, run `./Relay-Sessions.ps1` to list sessions.
After saving/stopping the selected client work, explicitly run:

```powershell
.\Relay-Sessions.ps1 -Cancel lease_REPLACE_WITH_THE_LISTED_ID -ConfirmCancel
```

This abandons only that retained relay continuation. It does not terminate a
client-owned shell/browser job, erase the transcript or restore client config.
Use the existing **Stop & Restore** control for normal provider restoration.
If the command says work resumed, inspect again; do not blindly retry.

## Credit-efficiency boundary

The GPT-6.1-Sol/xhigh default and explicit model choices are unchanged. Use the
per-session context/credit evidence to split large jobs at clean checkpoints
and choose cheaper workers deliberately. Do not silently shorten signed Claude
history, drop required instructions, switch model families or add OpenAI
fallback to lower the displayed cost. Cheaper GUI worker mappings and full GUI
browser/tool acceptance still require real client verification.

## Credit interpretation

SDK AI credits are not dollars. Input-token totals already include cache-read and
cache-write tokens; do not add them again. An HTTP attempt is not necessarily a
billable inference, and an absent usage receipt does not establish zero cost.
Historical late-event misattribution means old per-request retry counts are not
sufficient evidence for a defensible "wasted credits" total.
