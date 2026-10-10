# Current tool-cache annotations on active continuations

October 7, 2026; source 1.3.52 / Claude adapter 0.1.11. Isolated review candidate.
Existing Codex runtime, original dashboard, history and global configs preserved.

## Reproduced defect and acceptance contract

The gateway validates each Messages request and permits cache annotations to
move without treating them as changes to executable client tools. But its active
turn kept the first request's validated selection. The native request hook reads
tool definitions from that selection, so an admitted continuation could keep the
old tool marker, lose the new marker and ignore an updated TTL. System/message
cache refresh did not fix this separately retained tool catalog.

Two regression tests failed on adapter 0.1.10: local outbound native tools had
the original marker instead of the client's moved marker, and a valid owned
continuation retained its original TTL instead of the updated metadata.

Objective: make the current validated tool annotations reach each admitted owned
tool continuation while preserving executable catalog, signed native history,
permissions, original SDK credential/model/destination, pending tools and receipts.
Acceptance requires exact local outbound metadata across three turns, no mutation
on invalid updates, no cross-owner changes and the unchanged full test baseline.
No provider swap, cache-hit inference, permission bypass or client modification.

## Implementation and ownership boundary

`claude-gateway/server.mjs` passes the newly validated selection into `continue()`.
That turn replaces its retained selection before binding the current native
request. Admission has already checked owner, unchanged model/system/executable
catalog/controls/signature, exact historical prefix, every unique pending result
and context budget. No invalid request can enter this update path.

Only metadata excluded by existing validation's signature can change without a
new session. This change does not relax the signature or normalize user input.
Current tool schemas, strict flags, names, ordering, choices, effort, sampling and
thinking controls remain bound exactly as before. Native message/system cache
annotations still use the existing body/history refresh. SDK-owned pending tool
names and executable IDs do not change; each result is delivered once.

## Before/after proof

The two added tests pass, with all 329 repository tests (61 adapter tests):

1. A three-request tool loop uses the real `ClaudeRequestHandler` and a local
   mock HTTP transport. For both streaming and nonstreaming final responses,
   markers start on Read, move to Write with a new TTL, and are then removed.
   Every outbound tools array equals that request's current definition with
   only SDK-owned name mapping. Native signed prefixes, original credential,
   strict schema, system/effort/tool-choice controls and source request objects
   remain unchanged. One fixture session delivers four results once, completes
   three rows and leaves no pending tool, turn or request binding.
2. Two concurrent owners receive the same fixture IDs. Changed executable
   schema, tampered signature and an unknown owner reject without a new binding,
   result delivery, selection mutation or change to the prior completed receipt.
   The valid owner's subsequent cache update reaches its native binding, while
   the other owner's original selection and pending results remain unchanged.

Native response content and SDK usage in these tests are fixture data. The mock
transport makes no remote provider request. These are not stock-client inference,
real cache-hit, expiry, TTL-support, billing, cross-platform-client or twelve-hour
acceptance proofs. Native upstream validation owns accepted cache options and
actual caching. Earlier 0.1.7 paid stock-client evidence stays labelled separately.

## Files, limits and rollback

- `claude-gateway/server.mjs`: current selection passed only after admission.
- `claude-gateway.test.mjs`: two regressions and isolation/transport guardrails.
- `claude-gateway/protocol.mjs`: adapter version 0.1.11.
- Both package manifests: source version 1.3.52; dependencies unchanged.
- Preview/acceptance docs and this contract: accurate version/evidence/limits.

This preserves request annotations, not guaranteed identical caching or token
accounting. Existing image packing can change cache placement; exact count stays
501. Report only actual SDK usage and cache receipts; unknown remains unknown.
No automatic cache tuning, synthesized hits, list-price savings claim or fallback.

Exit the wrapper and run plain `claude` in a fresh terminal for original routing.
No saved settings or client binary were changed. Recover preserved 0.1.10 source
into a separate checkout if needed; do not overwrite dirty or active work.
Preserve ledger/history and exclusive ownership. Source edits are not deployment.

The full gateway goal remains active: sustained and active-outage acceptance,
hosted/beta body semantics, actual Linux/macOS stock clients, unified opt-in
setup/history and provider/distribution clarification remain. The earlier outage
experiment stays paused pending the user's test-method decision. This change
does not imply native parity, public-release readiness or guaranteed account safety.
