# Unified request history and session costs

Contract: keep the existing Control Room and source ledgers, while presenting
Codex and Claude Code calls together. No client patch, routing change, provider
fallback, credential disclosure or transcript import.

## What you see

- **Recent call history:** newest first across up to 1,000 retained calls per
  client; All clients / Codex / Claude Code filter. Each row shows client,
  session name, model route, applied effort, SDK tokens, credits, outcome and
  available transport/tool counters. Click any row for its metadata. A Claude
  `claude-opus-5-5` -> `claude-opus-5.5` translation is ID formatting, not fallback.
- **Where calls actually go:** both clients in the Copilot subtotal and request
  list, with native OpenAI helper calls separately attributed. Direct native
  image_gen calls outside the relay remain outside its ledger. Copilot AI
  credits are `totalNanoAiu / 1e9`, not dollars; actual dollar charge is unreported.
- **Per-task cost checkpoints:** session names and explicit client labels, one
  row per client/session/Pacific day. Names are display labels, never identity
  keys; different sessions with the same title are not merged. Codex's existing
  advisory prompts are unchanged. Claude checkpoint status is dashboard-only.

## Names and privacy

The loopback server reads `CODEX_HOME/session_index.jsonl` (default `~/.codex`)
and title metadata under `CLAUDE_CONFIG_DIR/projects` (default `~/.claude`).
Claude's `sessions-index.json` summaries and per-session `custom-title.json`
are supported. It does not read transcripts, credential files, internal app
databases or the network for names. Metadata reads are cached for 30 seconds
and bounded to 4 MiB per refresh, 128 project folders and 1,024 session title
files. Oversize or unavailable indexes give an explicit title-unavailable label.

Claude headers are one-way hashed for session grouping, as before. A validated
session UUID in structured `metadata.user_id` is also usable when no session
header exists; raw user metadata is never saved. Titles are resolved only in
memory and served to the local dashboard. They are not persisted in telemetry
or published. Screen captures can include private session titles: review before
sharing. No title is derived from prompt text.

## Metering and retention

The existing source ledgers are not concatenated, cleared or rewritten by a
dashboard read. The view merges sanitized projections, preventing duplicated
usage. Lifetime Copilot receipt subtotals sum the two independent ledgers; their
start dates need not match. Legacy trend and KPI charts remain Codex-only.

Claude session/day counters retain 31 observed Pacific dates, with a 2,048
attributed-bucket bound plus daily overflow buckets. Excess attribution rolls
into a labelled unattributed bucket; totals are not silently discarded. They
survive recent-request rotation and restart within that date window, under the
existing 4 MiB Claude ledger guard. Initialization recovers finalized retained
rows once, labelled partial; evicted history cannot be reconstructed. Missing
session IDs, reasoning, dollar costs and transport bytes stay unknown.

SDK usage receipts are not full coverage: attempts without receipts may cost
more. Older Claude normalization sometimes stored zero for missing token fields;
the UI discloses that limitation. Credits display reporting coverage, including
real reported zero. Cache reads are already part of input, never added twice.
No paid inference is required to validate these projection/UI changes.

Clear detailed history still clears Codex detail only (explicit confirmation);
it does not silently remove Claude history or either client's daily mileage.
Desktop controls, persistent key and exact TOML restoration remain unchanged.
