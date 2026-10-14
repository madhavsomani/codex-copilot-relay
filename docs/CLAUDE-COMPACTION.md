# Claude compaction recovery (1.3.83 / adapter 0.1.27)

The relay previously rejected oversized requests with `Prompt exceeds the
selected model's advertised context budget. Compact in Claude Code`. That
message also rejected `/compact` itself, but did not match the stock client's
prompt-too-long recovery path.

## What changed

- Admission now returns a nonretryable HTTP 400 `invalid_request_error` with
  `prompt is too long: N tokens > L maximum`. Stock Claude recognizes the
  condition and can reduce its compaction input, summarize, and continue.
- The error explicitly labels N as a **local text estimate**. L is the smaller
  of the advertised prompt limit and context window minus requested output.
  No larger window, smaller output reservation, or compaction exemption is
  invented. Output reserve and model choice remain client-owned.
- Opaque thinking signatures and redacted data no longer become natural-language
  text in the SDK bootstrap/token estimate. Visible reasoning is still counted.
  The native request hook retains the original signed blocks, bytes, roles,
  images, tool IDs and tool results. This is not a rewrite of signed history.
- The private request ledger and sanitized request visibility include
  `contextBudget`: estimate type, estimated input, output reservation, limits
  and admission reason. No transcript content or signature is logged.

The relay never silently truncates history, fabricates a summary, substitutes a
model, routes compaction to OpenAI, or exempts a request just because its text
mentions compaction. Claude owns its normal compaction and any history reduction.
Existing pending-tool ownership and prefix checks still apply; an unrelated or
rewritten live tool prefix remains rejected before results are consumed.

## Verification

Before the change, unmodified stock Claude Code 2.1.296 reproduced the exact
manual `/compact` error and failed its next ordinary request, using a local
scripted provider. With the fix, both these commands pass:

```powershell
node claude-gateway/probe-stock-compaction.mjs --local --manual
node claude-gateway/probe-stock-compaction.mjs --local --auto
```

Each probe creates a fresh isolated client configuration and synthetic session,
seeds four exchanges, then reduces the fixture's advertised prompt ceiling to
force rejection. It checks stock-authored `compact_boundary` events with reduced
token estimates, completed compaction requests, a successful subsequent answer,
unchanged selected model, and zero SDK inference/transport receipts. The fixture
does not authenticate to Copilot, alter global settings, or resume user sessions.
The ceiling reduction is test-only, not a production model change.

Release checks:

- `npm test`: 514 tests, 513 passed, one skipped, zero failures.
- Native signature/image and pending-tool admission regressions pass, including
  a large opaque-history regression and oversized result rejection/retry.
- Stock local image Read and Read/Edit/Read probes pass, including signed replay.
- `npm run probe:startup`: real SDK discovery, both adapters, separate credentials,
  unchanged dashboard, busy drain, explicit upload cancellation and owned cleanup
  pass. No model inference was performed by that probe.
- Basic revert, Remote/account-policy preservation and desktop-control fixture
  tests pass. These are not phone-to-host Remote acceptance tests.

## Limits and operation

Once `/health.version` reports 1.3.83 and `claude.version` reports 0.1.27, retry
`/compact` in the affected session, then continue normally. A failed prior
command is not resumed merely by restarting the relay.

This verifies stock-client recovery against a local scripted provider, **not a
paid live Copilot compaction of a particular user conversation or Desktop GUI
acceptance**. The SDK does not expose exact Anthropic token counting. Media and
opaque provider context can differ from the text estimate; upstream limits still
apply. A single irreducible exchange or oversized system/tool definition can
remain too large even for compaction. No claim of unlimited context or complete
native parity is made.

Use the normal **Start Relay** control to load this release. It intentionally
cancels current relay requests; automatic updates remain drain-safe.
**Stop & Restore** retains its protected-TOML restoration behavior. No lifecycle,
credential, client binary, or config format change is part of this fix.
