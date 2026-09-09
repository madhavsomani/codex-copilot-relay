# 1.3.16: explicit model routing and compatibility fixes

Includes the previously local 1.3.15 context/catalog and binary tool-image fixes.

- Default Astra xhigh; explicitly selected Sol/Terra models run as requested.
- Model-specific limits and reasoning defaults populate the Codex catalog. Global
  context overrides no longer shadow it. Parallel tool calls are enabled and tool
  results have a bounded 64 KiB budget. Skill/plugin/app instruction metadata stays enabled.
- Ultra/max maps to the highest advertised effort when necessary and reports the
  effective effort, including on tool continuations. Existing exchanges retain settings.
- Same-thread overlaps return HTTP 409 relay_task_busy before SSE starts; the original
  stream stays alive. Disconnect cleanup permits a new request without killing a worker.
- Lightweight error messages and codes survive indexing, repeated compaction and restart.
- Copilot SDK large-output offloading is disabled for these already-bounded tool
  results, preventing a private SDK temp-file pointer from replacing useful text.
  Oversized text gets an explicit bounded head/tail result and a narrower-range hint.
- Astra's September 9 public API pricing is included, with cache-write and long-context
  rates. Arbitrary unknown variants are unpriced. The dashboard labels unpriced and
  legacy coverage; historical totals are not silently recalculated from incomplete data.
- The watchdog refreshes the catalog after deferred version promotion. Config restoration
  also restores removed overrides and preserves the protected full-file backup.

## Verified September 9, 2026

- 108 automated tests, configuration/rollback, telemetry backup and recovery guards passed.
- All 16 live probes passed on an isolated v1.3.16 service.
- Real Codex parent: Astra xhigh. Children: Sol max and Terra high, including four
  initial/follow-up replies. Their actual contexts and selected backends were verified.
- A roughly 50 KiB shell result retained its random middle verification code.
- Two calls in one tool response, same-thread HTTP 409 and retry after disconnect passed.
- Eighty history replacements preserved a separate waiting tool for about 183 seconds,
  then recycled once with zero sessions remaining.
- Isolated SDK crash recovery preserved the relay parent, cleared failed sessions,
  terminated the failed stream correctly, and passed subsequent stream/tools/concurrency.
- Dashboard checked at desktop, tablet and phone sizes; no horizontal overflow or
  captured console errors. Dependency audit reported zero vulnerabilities and the
  publishable-file scan found no credential/profile-path matches.

## Reproduce

npm test and proxy-config.test.ps1 cover source regressions and reversible config.
probe:suite starts its own isolated loopback service and includes real Codex child
agents, their follow-up messages, multi-tool calls, vision, deferred tools, streaming,
reconnects, and instruction/history transport. probe:session-churn tests 80 repeated
history replacements while retaining a second slow tool. probe:sdk-recovery crashes
only its isolated SDK worker. All generated test data remains outside tracked source.

These tests do not claim an uninterrupted 12-hour production run, perfect vision,
or native OpenAI-hosted feature parity. Already-lost historical error text is not
reconstructed, and old unpriced lifetime costs remain explicitly incomplete.
