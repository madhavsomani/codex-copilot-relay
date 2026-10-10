# Local multi-client usage visibility contract

Objective: show saved usage for desktop Codex, portable Codex CLI, Claude Code
and explicitly recorded OpenAI helpers in one read-only connection-center view.
This increment does not replace the original dashboard, attach external gateways,
install software, authenticate models, restart production or certify full parity.

Acceptance:

- Read only fixed numeric ledgers in this checkout's runtime root and canonical
  per-port directories. Never read transcripts, owner receipts, credentials,
  request bodies, arbitrary query paths or recursive candidate/backup directories.
- Bound directory discovery, file reads, source/model counts, total read bytes,
  rendered rows and response size. Reject symbolic-link/reparse paths, malformed
  files and unsupported schemas without overwriting or recovering them.
- Preserve Copilot credit receipt coverage, unknown token usage and explicit
  reported zero. Show OpenAI tokens separately without converting SDK credits
  into money or implying a remaining balance. Scope totals to selected local
  ledgers, never the whole account; imports/copies may overlap.
- Model attribution must disclose Codex's selected-model fallback where its
  stored schema does not prove actual SDK model identity. Claude model usage
  comes from SDK receipt buckets. Stored unfinished requests are not live-state
  proof. Same-process live status remains a separate existing view.
- The same-origin loopback endpoint is GET-only and dependency-free. UI uses
  text rendering, no remote resources, fixed bounded polling, partial labels,
  empty/error states and no page-level overflow at desktop/tablet/phone widths.
- Unit/HTTP/render regressions fail before implementation and pass afterward;
  root suite, restore/Remote fixtures, isolated Windows/Linux tests, protected
  config/server/dashboard hashes and reviewed backup preserve existing work.

No paid provider probe or active-outage injection is part of this contract.

## Using the saved view

Open the launcher-owned connection center, or run `npm run setup` in this
checkout. Its **Saved local usage** panel requests GET
`/dashboard/setup/usage`. The older live dashboard is not replaced. A standalone
connection center can read saved counters but cannot observe another Claude
wrapper's live gateway. Empty history does not mean no account usage.

Only these canonical files are included, when they exist:

```text
runtime/proxy-metrics.json
runtime/provider-telemetry.json
runtime/codex-cli/ports/<1024..65535>/proxy-metrics.json
runtime/codex-cli/ports/<1024..65535>/provider-telemetry.json
runtime/claude-preview/ledger.json
runtime/claude-preview/ports/<1024..65535>/ledger.json
```

The default Claude ledger belongs to port 4246. Custom runtime roots, snapshots,
backups and other checkouts are not recursively imported. Per-port sources can
overlap after manual copies; the provider subtotals are arithmetic over included
sources, not deduplicated account mileage. Unavailable sources contribute no
totals. `omittedSources` is a lower bound, not an exact directory census.

### Reading the numbers

- **Requests** are stored received/completed/failed counters. Unfinished recorded
  requests are historical counters, never live-connection proof.
- **SDK receipts** count usage events, not requests or transport attempts. A
  request may produce several receipts. `usageReporting` is `receipt-subtotal`
  or `unreported`; it never infers full request coverage from receipt counts.
- **Reported tokens** are the stored subtotal where receipts exist; no receipts
  means unknown, not zero. Existing producer normalization can write zero for
  missing SDK token fields, so this view cannot certify exact token completeness.
- **AI credits** use only receipts with an explicit credit-report count and
  `totalNanoAiu`, divided by 1e9. Reported zero is zero; absent credit reports are
  unknown even if an old ledger contains a positive total. Credit coverage is
  reported credit receipts / SDK receipts, not metered requests. Failed or
  unreported attempts may have additional cost.
- Codex's stored `meteredCalls` / `unmeteredCalls` describe finalized outcomes,
  separately from receipt counts. Codex model buckets can use selected-model
  fallback. Claude model buckets come from usage receipts. Shortening a displayed
  model list does not reduce source totals.
- OpenAI Codex-helper and Platform-helper totals stay separate from Copilot.
  Their SDK receipt count is not applicable. This view reads previously recorded
  helpers; it does not enable an adapter, infer current helper support, initiate
  a fallback, calculate dollars or discover a remaining subscription balance.

### Bounds and privacy

At most 32 source projections, 128 directory entries per per-port scan, 16 model
buckets displayed per source, 32 MiB total reserved reads and 256 KiB projected
response. Individual caps are 16 MiB (Codex metrics), 8 MiB (OpenAI telemetry),
4 MiB (Claude). Reads/cache are shared for 10 seconds; the visible UI polls every
10 seconds, with a timeout and one in-flight request, pausing in hidden tabs.

The reader rejects observed symbolic links/junctions, hard-linked ledgers,
changed-file snapshots, invalid numeric/schema fields and excessive files. It
rechecks descendant ancestors and opened-file identity. These checks are not an
OS-level race-proof sandbox against a malicious same-user process swapping
paths; Node does not supply portable descriptor-relative directory traversal.
Use a checkout/runtime owned by your user, not an untrusted writable tree.

No ledger constructors, automatic recovery writes, credentials, request bodies,
transcripts, arbitrary query paths, SDK authentication or provider inference are
used by the reader. UI values use text nodes, not HTML injection. The endpoint
retains the connection center's same-origin loopback/GET-only controls. A partial
or unavailable scan stays visibly partial/unavailable and never resets history.
