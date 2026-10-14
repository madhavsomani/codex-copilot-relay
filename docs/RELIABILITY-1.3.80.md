# Startup and lifecycle repair, October 10, 2026

Relay 1.3.80, Claude adapter 0.1.24. Existing uncommitted continuation, image,
capacity and accounting work was preserved and retested.

## Why the relay stopped starting

The 1.3.78 Claude request hook rejected every request without an inference-session
binding. The real SDK sends model discovery through the same hook, including
`POST /models/session` and `GET /models`. Startup therefore failed with
`Request models.list failed ... SDK inference has no native request binding`.
The earlier suite mocked discovery and missed that real integration boundary.

The hook now passes those exact metadata method/path pairs unchanged. Requests
for inference still need an owned native binding. Released sessions remain
blocked. No credentials, destinations, model entitlement or client binaries changed.
Two local regression tests failed/passed as expected, and real SDK discovery
returned 27 models, including seven Claude models.

`npm run probe:startup` now provides a reusable release check using the actual
SDK and both adapters on an isolated port. It performs no model inference. It
also confirms automatic drain preserves unfinished uploads in both protocols,
then explicit cancellation closes them and releases the Claude ownership lease.
AGENTS.md requires this check for future SDK-hook/startup deployments.

## Desktop controls

- **Start Relay** disables recovery, stops the owned console/watchdog, cancels
  both adapters' current relay sessions, and loads the latest local package.
  It retains the managed config and persistent data. It does not download code.
- **Stop & Restore** disables recovery, cancels both adapters, confirms owned
  process exit and restores the protected original Codex TOML.
- **Repair**, internal Start and watchdog updates preserve active exchanges,
  tool continuations, native jobs and admitted uploads. Automatic promotion
  waits until work drains; only explicit desktop controls abandon work.
- Client transcripts persist. Relay shutdown does not close the Codex/Claude
  applications or terminate unrelated client-owned shell/browser jobs.

The desktop Start ordering and refusal after an unproven stop are covered by
an isolated PowerShell entrypoint test. Existing stop tests cover process
identity, descendant cleanup, stale commands and unrelated-process preservation.

## Browser resume defect

The live third-party Claude profile retained the exact browser MCP definition
after the recovery journal was marked restored, but the corresponding skill
was missing. Start refused this as a conflicting existing entry. Resume now
accepts exact components only from a verified prior opt-in and fills the missing
component. Anything already present is recorded as preexisting so subsequent
restore does not remove it. Changed entries/skills remain protected.

## Prior errors reviewed

Read the recent turns in "Github Copilot Relay Context" and the separate "hey"
audit chat. Checked the retained 1,000-row Claude ledger and the recent local
Claude session plus its two subagent transcripts; another recent root session
had no recorded API-error messages. This is scoped historical evidence, not
an assertion that every session on the computer was scanned.

- Prefix 409: stock Claude adds an omitted Edit default. The existing narrow
  schema-aware comparison passes the actual stock Read -> Edit -> Read test.
- Outstanding-result 409: split user-result batches, assistant chunks and
  interleaved delivery have maintained regressions; invalid batches still fail.
- Capacity 503: the old 16-slot ceiling is now 64 per adapter. Capacity tests
  exercise 64 retained tool sessions and release every slot.
- Signed-image 400: native image preservation passes stock screenshot-result
  continuation tests; images are not repacked inside signed history.
- Connection loss, SDK creation timeouts and interrupted upstream streams
  occurred historically. Recovery/cancellation tests cover them, but a local
  patch cannot guarantee that an external provider never times out.

## Comparison with other implementations

Sources were read on October 10, 2026; no peer package or credential helper was run.

| Primary source | Observed design | Implication here |
|---|---|---|
| [Anthropic gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol) | Streaming needs complete ordered terminal events and timely bytes; token counting is optional. | Preserve terminal-event validation and heartbeats. A 501 from exact token counting is a declared limitation, not evidence that inference is broken. |
| [ericc-ch/copilot-api handler](https://github.com/ericc-ch/copilot-api/blob/master/src/routes/messages/handler.ts) | Translates Messages to Chat Completions, with a per-response streaming translation state. | It avoids an SDK-owned pending-tool session. Our extra native-transcript/SDK-session synchronization needs actual-client boundary tests. |
| [claude-code-router execution plan](https://github.com/musistudio/claude-code-router/blob/main/packages/core/src/routing/execution-plan.ts) | Builds explicit off, bounded retry and model-fallback plans. | Keep routing separate from retry policy. Existing bounded retries and no silent model/provider fallback remain appropriate. |
| [CLIProxyAPI Claude executor](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/runtime/executor/claude_executor.go) | Has explicit request-scoped cancellation and signature-sanitization diagnostics. | Request-scoped failures and diagnostics help. Copying signature dropping/replacement would violate this relay's preservation contract. |
| [official Copilot SDK client](https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts) | Owns runtime/session lifecycle and request-handler integration. | Test against the installed real SDK as well as mocks; keep authentication and entitlement in the SDK. |

The main finding is a missing integration gate, not evidence that copying a
different proxy wholesale would preserve this relay's guarantees.

## Verification

- Maintained suite: 506 tests, 505 passed, one skipped, zero failures.
- Stock Claude Code 2.1.296: Read/Write/Read, Read/Edit/Read and image-read flows
  each completed four local scripted-provider requests without failures.
- Real SDK startup: both adapters, catalogs, wrong-key rejection, unchanged
  dashboard, busy drain and explicit cancellation passed on an isolated port.
- Actual desktop Stop/Start: two live incomplete requests cancelled with 503;
  old relay exited; original TOML restoration hash verified; Claude lease
  released; 1.3.80 started with adapter 0.1.24 ready. Stop took 4.67 seconds.
- Authentication file, DPAPI key and original backup hashes were unchanged.
- Actual Start-only restart while two requests were active also passed: both
  requests received 503 cancellation, the old process exited, and a fresh
  1.3.80 instance was ready in about 18 seconds with protected data unchanged.
- Browser connector and skill both report configured after the actual cycle.
- Real Copilot-backed API tool round trips passed for GPT-6.1 SOL and Claude
  Opus 5.5: a tool call, returned result and final marker for each. Four requests
  completed. One initial Claude probe requested disabled thinking and received
  a correct 400; its retry used the model's advertised required adaptive mode.
  The probe did not change the user's selected model or reasoning settings.
- Remote/account/policy, exact restoration and desktop shortcut fixtures pass.
- `npm audit --omit=dev`: zero known vulnerabilities. `git diff --check` passes.

GUI browser approval/navigation, phone Remote, arbitrary experimental Claude
features and long-running load are not certified by these tests. Hosted search,
exact Anthropic token counting and native app voice retain their documented
limitations. Historical incomplete usage receipts cannot establish zero token
waste or an exact amount of double billing.

The live model/tool probe receipt is saved in this task's output report. The
successful turns reported 1,318 input/38 output tokens for Codex and 902 input/73
output tokens for Claude. These are observed API usage, not a billing invoice.
Changes were deployed locally; they were not committed or pushed to GitHub.
