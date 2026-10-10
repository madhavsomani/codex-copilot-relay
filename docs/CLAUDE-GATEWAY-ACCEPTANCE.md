# Claude gateway goal acceptance audit

October 7, 2026. The full goal remains **active**, not completed. This audit
records evidence and remaining gates; it does not redefine the goal as basic
inference only. The previous goal turn made implementation/test progress.

Current isolated source: **1.3.60 / Claude adapter 0.1.13**. The prior 1.3.58
Windows suite passed 392 tests with one skip; Ubuntu passed 391 with two skips
(393 total, zero failures on each OS). Actual unmodified Claude 2.1.292 passed
both the finite local non-retryable HTTP-error probe and Read -> Write -> Read
through the candidate on both platforms. These are scripted loopback proofs,
not new paid inference, Linux Copilot authentication or sustained-load acceptance.
The existing live Codex relay has not been restarted or promoted. Historical
real-provider results below retain their original source/adapter scope.

| Requirement | Authoritative evidence | State |
|---|---|---|
| Preserve existing Codex relay/dashboard | Live 4144 remains v1.3.41, source `server.mjs` hash still matches pre-feature snapshot; no restart/promotion | Preserved; recheck before deployment |
| Recoverable backup | Pre-feature source tar, verified Git bundle and private config backups outside repository | Local recovery verified; not off-device disaster recovery |
| Exclusive history ownership | Reproduced competing-ledger corruption; exclusive ownership before ledger/SDK startup, per-port storage and matching-owner release | Seven lifecycle tests and fresh 0.1.7 checkout pass; real wrapper ownership released on exit |
| Startup settings routing | Stock client sent a mock request to the settings endpoint instead of the launcher endpoint; two regressions failed before checks and passed after | 12 routing tests and zero-inference stock loopback proof; no protection claimed for mid-session config/directory or new remote policy changes |
| Isolated Claude launcher lifecycle | Six regressions failed before fix: duplicate/conflicting options, missing client, startup signals, observer cleanup, raw diagnostics and interrupted exit | Twelve focused tests now pass; bounded version preflight, early cancellation and independent cleanup, not abrupt-tree/watchdog or sustained-load certification |
| Isolated stock-Claude gateway | Independent loopback port/SDK worker; stock Claude 2.1.292; no client binary/settings patch | Implemented and live-tested |
| Authenticated Copilot Claude models | Official SDK sign-in, SDK catalog mapping, disabled-policy filtering, actual model usage receipts | Verified for tested account/models |
| Native tool workflows | File read/write/read, MCP, images, skills/hooks/context, mixed-model agents and session resume proof reports | Passed scoped live probes |
| Stock Auto-mode safety classification | `claude-live-proof-x01jjy`: four auxiliary classifier requests and both completed workers | Passed fixture; broader policy decisions unverified |
| Stop semantics and transport integrity | Native stop sequence regression, byte-identical UTF-8/CRLF observation, truncated stream/sentinel failures | Tested |
| Retry history fidelity | Failing 503 retry regression before fix, passing after fix | Fixed; no replay of partial output |
| Truthful provider and usage visibility | One terminal row per authenticated Messages request; bounded in-process connection-center projection with requested/selected/actual models, separate transport/usage counters and unknown/partial credits | 61 adapter and 9 visibility tests pass; live metadata-only UI proof; merging 4144 history remains |
| Guided dual-client connection center | Wrapper-owned loopback observer, read-only endpoints, scoped model/usage projection, no gateway credential in browser or files | Windows metadata-only live proof and 1440/768/390px visual checks pass; original 4144 dashboard preserved |
| Owned portable Codex observer | Fixed bounded owned-health projection, credential-free optional page; launch/usage/credit/liveness scopes distinct, conflict/exit cleanup tests | Implemented in 1.3.59; focused lifecycle and responsive synthetic browser proof; no cross-wrapper desktop attachment |
| Entitled model dropdown | Actual stock interactive `/model` menu, six SDK-entitled options labelled Copilot plus stock Default | Windows terminal UI verified |
| Reversible portable installation | Wrapper environment only; patched checkout and Windows launcher/observer help smoke test; isolated Linux stock installation/routing/file-tool loop; preserved config hashes | Windows scoped proof; Linux scripted-loopback proof only, authenticated Linux worker/macOS remain unverified |
| Stock signed-thinking fidelity | `claude-live-proof-Hr6yr0`: actual Haiku signed tool loop, identical client/upstream fingerprints, 4 completed requests / zero failures / 1.859135 reported AI credits | Scoped live proof; redactions fixture-only and binding-control betas unverified |
| Native continuation safety | Caller metadata comparison regression, per-owner duplicate-tool IDs, changed-signature rejection, cache-marker refresh | Before/after tests pass; no user-argument/signature normalization |
| Mixed client-tool continuations | Two regressions failed before fixes; text/image suffixes retain native position, malformed result order rejects, signatures/ownership/results stay bound | Five new adapter tests pass; fixture/native-hook evidence, not a new stock-client or paid-provider certification |
| Active continuation context admission | Oversized continuation regression accepted/consumed results before fix; shared prompt/output-budget estimate now includes retained native prefix and rejects before attachment | Two tests cover user input, tool output, model-side notes, output reservation, untouched pending state/receipt and successful smaller retry; not exact token counting |
| Current tool-cache annotations | Two regressions failed before fix: moved/removed markers and TTL changes stayed stale despite valid admission; current validated selection now reaches the native hook | Two tests pass with three-turn streaming/nonstreaming loopback mapping, original signatures/tools/auth, rejected-update recovery and owner isolation; not paid cache-hit/usage proof |
| Stock trailing system reminders | Linux stock Claude 2.1.292 executed Read, then continuations incorrectly became fresh SDK turns; three regressions failed before the fix | Fixed in 0.1.12; Linux and Windows actual stock Read/Write/Read both complete four local fixture requests without failures; native suffix/history, ownership and context guards tested |
| Exact tool controls | `claude-control-proof-T2yit4`: Opus 5 required/specific strict tool, 128-character original name, Opus 5.5 disabled-parallel continuations and none/catalog preservation | Scoped live proof; model restrictions enforced without substitution |
| Native structured outputs | Same probe: streamed Opus 5.5 schema output, native schema fingerprint retained; strict-tool inputs matched schema | Implemented/capability gated; full grammar validation delegated unchanged upstream |
| Native HTTP/SSE error fidelity | Native status/type retained; 0.1.13 preserves upstream retry decisions, whole-second/date delays and correlation headers; partial SSE errors never complete/replay | Six current retry tests and actual stock Windows/Linux non-retryable loopback proofs; broad live failure matrix remains |
| Versioned protocol controls | Stock baseline flags reach native request hook alongside SDK flags; malformed controls reject, controls are included in continuation signature | Fresh 0.1.7 full stock/mixed-model regression passed; not universal beta-body parity |
| Hosted/beta tool semantics | Versioned headers are upstream-validated; unsupported body fields/block types still reject explicitly | Remaining compatibility gate |
| Compaction | Actual stock `local_command: compact` via Copilot and post-compaction resume of `RESUME_CONTEXT_82941` | Live Windows proof |
| Worker/gateway recovery | `claude-live-proof-aGV1wp`: owned idle worker stopped/recovered, gateway restarted, context/ledger retained; 3 receipts / 3.36778 reported AI credits | Live idle recovery proof; active network outage and sustained soak remain |
| Legitimate authentication/policy | Official SDK/gateway interfaces; own account only, no identity spoofing/quota bypass; dated policy audit | Findings documented; explicit approval of this provider combination unresolved; no legal/ban guarantee |
| Release security | Patched sharp 0.35.5 checkout audit; source secret/profile-pattern scan | Scoped scan passed; not a comprehensive security certification |
| Merge/publish/deploy | Source candidate separate from active runtime; dirty pre-existing changes retained | Not performed; preserve isolation until acceptance gates pass |

Documented stock-client constraints also remain: Claude Remote Control/cloud
sessions/voice dictation cannot be made available simply by enabling a third-party
base URL. Do not patch clients or expose the relay to conceal those constraints.

Historical source 1.3.54 / adapter 0.1.12 evidence: the prior full seven-case regression
`claude-live-proof-MOeAuZ` passed file tools, MCP, image reading, skills/hooks,
saved-session resume and both mixed-model workers: 15 SDK receipts and 24.11848
reported AI credits. Windows repository tests at that checkpoint passed 349/349, including 61 adapter, 6 stock-local, 9 visibility, 7 runtime-ownership, 12 routing-settings and 14 portable diagnostic tests.

The new native-control probe passed six receipts / **2.0392 reported AI credits**;
three intentionally invalid capability combinations were rejected before
inference. Stock `--json-schema` returned the exact parsed fixture through
Copilot, but did not request native schema/strict-tool constraints on the wire.
Record that as stock-client output compatibility, not native grammar proof.
Four new regressions failed before implementation and passed after it. New
tests also protect control violations and untouched refusal/max-token outputs.

The later full regression `claude-live-proof-hmDFJ9` passed all seven stock-client
cases on adapter 0.1.3 with 17 receipts / **25.16756 reported AI credits**. This is
not a complete 0.1.4 mixed-model certification. The subsequently completed full
0.1.4 regression `claude-live-proof-cPRAhu` passed all seven stock-client cases,
including mixed-model workers, with 15 SDK receipts / **24.29012 reported AI credits**.
That is evidence for 0.1.4, not full real-client certification of accounting
candidate 0.1.5.

Five accounting regressions failed before the 0.1.5 fixes and passed afterward:
pre-session validation, SDK creation, byte admission, creation-time cancellation
and continuation conflicts. Additional checks cover upload aborts, binding
cleanup, concurrent rejection isolation, generic HTTP/ledger status agreement
and exactly one receipt per successful continuation. Missing usage stays null;
completed tool-turn receipts remain unchanged on later expiry. No new paid
inference was needed for these fixes, and historical missing rows are not rebuilt.

Adapter 0.1.6 adds a separate guided connection-center observer to the stock
Claude wrapper without exposing its credential, changing global config or
replacing the live Codex dashboard. Native SDK model discovery and one intentional
admission rejection were observed live with zero inference receipts. All three
browser widths (1440/768/390) had no horizontal overflow or console errors. Stock
wrapper `--help` exited and closed its listener; protected config hashes stayed
unchanged. Partial/unknown credit and route rendering have fixture evidence.
This is metadata/lifecycle UI proof, not a complete 0.1.6 inference regression.

Adapter 0.1.7 prevents a second gateway from recovering/replacing another active
gateway's ledger. Port 4246 retains its history; other stable ports have separate
directories. Ownership is acquired before reading history or starting the SDK.
Seven lifecycle checks cover competing writers, simultaneous gateways, matching
release, startup/listener failure and malformed-ledger preservation. Stale
ownership fails closed; crash recovery requires verifying all writers are
stopped before removing only the ownership receipt. Fresh packaging, installation
and latest stock-client regression were then verified as recorded below.

Fresh isolated checkout `runtime/claude-ownership-candidate-20261007` passed
`npm ci`, `npm test` (308/308) and `npm audit --omit=dev` (zero known
vulnerabilities); installed sharp is 0.35.5. Remote/basic-revert fixtures passed,
not a phone round trip. Actual stock wrapper `--help` exited 0 with its gateway
and observer ports closed and ownership receipt removed.

The adapter 0.1.7 stock regression `claude-live-proof-ermTM5` passed all seven
cases: file tools, MCP, image reading, skills/hooks, saved-session resume and
both mixed-model workers. Its ledger recorded 15 completed authenticated
requests, zero failures, 15 SDK usage receipts and **24.55808 reported AI
credits**. Actual SDK usage included Opus 5.5, Sonnet 5.5 and Haiku 4.5.
`claude-live-proof-5YC8rm` separately verified owned idle SDK recovery, gateway
restart/ownership reacquisition and context recall: three completed requests,
zero failures, three receipts / **3.68186 reported AI credits**. Protected
Codex and existing Claude settings hashes stayed unchanged. Total scoped live
probe usage is **28.23994 reported AI credits**, not an invoice or entitlement.
This was the preceding full paid stock-client regression, on adapter 0.1.7, not active-outage, long-duration,
macOS/Linux or every-Claude-feature certification.

The [policy audit](CLAUDE-GATEWAY-POLICY.md) separates documented interfaces from
commercial/distribution authorization. Claude's product-distribution guidance
does not explicitly name Copilot among its providers. No support confirmation
was requested or received; successful inference is not public-ready/no-ban
evidence. Keep this local per-user preview separate from a hosted, shared-token
or resold service.

Two active-outage experiments did not inject the intended text-frame failure:
the direct fixture returned signed thinking without text. The probe asserted
failure rather than claiming recovery. There is no live active-outage proof.
Further outage-test edits pause at the Agentic Coding two-attempt gate, pending
a choice of first-native-content-frame injection or isolated transport-level
injection. Idle recovery, partial-error fixtures and a physical network failure
are distinct checks; do not substitute one for another.

Adapter 0.1.8 adds conservative read-only startup checks for supplied settings,
selected user/project/local sources, repository-root local settings, cached remote
policy, system managed files/drop-ins and Windows registry policy. Invalid or
conflicting settings fail before SDK startup; a second check runs before launching
Claude to catch changes during SDK discovery. Safe permissions/hooks/MCP settings
are retained. Dynamic policy helpers and detected macOS managed profiles are
refused rather than executed/overridden. The host-managed routing flag is not set.
The actual local settings preflight passed without starting an SDK. Stock Claude
mock inference verified the original redirect, protected rejection, and a clean
request reaching the intended endpoint, with zero SDK inference receipts.
See [the routing contract and remaining limitations](CLAUDE-GATEWAY-ROUTING.md).

Fresh 0.1.8 Windows installation passed all 320 tests and the dependency audit
(sharp 0.35.5, zero known vulnerabilities). Stock wrapper pre-SDK rejection and
clean `--help` lifecycle checks passed with configs unchanged. A separate Ubuntu
24.04/Node 22.22.0 checkout passed 318 tests with two Windows-only skips and a
zero-vulnerability audit. No Linux Claude executable was installed; neither that
suite nor the Windows help check is full Linux/macOS stock-client certification.

Adapter 0.1.9 implements results-first user text/image suffixes on active client-tool
continuations. The gateway no longer rejects valid additional user instructions;
the native request hook preserves their position instead of folding them into
tool output. Streaming/nonstreaming fixtures retain signed history and resolve
each pending result once. Owner/signature/duplicate/missing/order rejection tests
leave the original tool turn usable. A new image exposed an unrelated plain-string
tool-output rewrite; native image traversal now leaves that string unchanged.
The five new checks use local fixtures/loopback transport, not paid inference or
actual stock-client steering. Hosted-tool continuation semantics remain unsupported.
See [the continuation contract](CLAUDE-GATEWAY-CONTINUATIONS.md).

Adapter 0.1.10 shares fresh and active-continuation context admission. Oversized
user text/tool output or retained model-side prefix notes reject before any SDK
tool result is consumed. The prompt+requested-output limit is exercised with a
prompt that fits by itself. Rejections have their own metadata-only receipt, no
invented provider usage, and leave the completed tool receipt/pending tools intact
for a smaller valid retry. This is local text-token estimation against advertised
limits, not exact image/token accounting or a live twelve-hour proof. See
[the context contract](CLAUDE-GATEWAY-CONTEXT.md).

Fresh 0.1.9 Windows verification passed all 325 tests, `npm ci`, the dependency
audit, stock loopback settings proof and Remote/basic-revert fixtures. That source
archive was independently hash-verified and backed up before the next contract.
Fresh 0.1.10 Windows verification then passed all 327 tests and the same gates,
plus real stock-wrapper help/exit ownership/port cleanup with configs unchanged.
A separate Ubuntu 24.04/Node 22.22.0 installation passed 325 tests with only the
two Windows registry/setup checks skipped, and a clean audit. Both installations
used sharp 0.35.5. The latest checks have no paid inference or Linux stock-client
certification; Linux Claude was not installed. The live 4144 relay was not restarted.

Adapter 0.1.11 fixes active tool continuations retaining the original validated
tool definitions after cache annotations changed. Cache markers are excluded
from the executable catalog signature, so moving/removing a marker or changing
its TTL is admitted; the native hook previously still used stale tool metadata.
Two regressions failed before the fix and pass after handing the newly validated
selection to the admitted owned continuation. Streaming/nonstreaming three-turn
loopback requests retain native signatures, strict schema/effort/tool controls,
original credentials and one-time results. Rejected changed schemas/signatures
or wrong owners do not mutate pending selections; another active owner stays
unchanged. This is local transport/fixture proof, not real cache hits or a new
paid stock-client regression. See [the cache contract](CLAUDE-GATEWAY-CACHE.md).

Adapter 0.1.12 fixes an observed stock-client continuation dialect: one or more
system messages can follow the result-bearing user message. Only those trailing
system messages are skipped for locating results; their native content remains
in history, cache refresh, image traversal and estimated context admission.
Lookup never crosses another assistant/user turn. The exact prior prefix,
owner, current catalog/control signature and every pending ID remain required.
Three regressions failed before this fix, then all six stock-local tests passed.

Actual unmodified Claude 2.1.292 on Windows and Ubuntu 24.04/Node 22.22.0 then
performed Read -> Write -> Read through the real gateway and request hook with
a scripted loopback provider/fixture SDK runtime: four completed requests,
zero failures, actual SUM=42 output and zero SDK inference receipts on each OS.
The Linux stock settings-routing proof also passed. Final Windows suites pass
335/335; Linux passes 333 with two Windows-only skips. Both isolated dependency
audits report zero known vulnerabilities. This is not real Linux Copilot login,
SDK-worker inference, cache billing, launcher lifecycle or a new paid-provider
certification. See [the exact local-stock contract](CLAUDE-GATEWAY-STOCK-LOCAL.md).

Next priorities are supported beta/native error semantics, active
outage and sustained-workload probes, cross-platform setup and unified connection
visibility. The user has not selected a narrower success target. The existing
live Codex relay remains unchanged; this candidate has not been promoted/pushed.

Source 1.3.54 adds portable, dependency-free read-only Codex CLI/user-file routing
diagnostics. Eight regressions failed before implementation and passed after it;
version/read limits, ambiguous forms, home selection and no-mutation guardrails
are covered. Windows inspection and Claude inference are unchanged. This is not
an automatic installer, effective managed/CLI/profile configuration resolver,
portable durable launcher/restore certification or an actual macOS host test.
See [the diagnostic contract](PORTABLE-SETUP-DIAGNOSTICS.md).

The current 1.3.54 / 0.1.12 fresh Windows candidate subsequently passed the finite
seven-case real-provider stock regression `claude-live-proof-TlkdnK`: file tools,
MCP, image reading, skills/hooks, saved-session recall, and both parallel
mixed-model workers. The ledger records 15 received/completed requests, zero
failures, 15 usage receipts and **25.691905 reported SDK AI credits**. Actual
models were Opus 5.5, Sonnet 5.5 and Haiku 4.5. Its exact runtime ownership receipt
was released, and protected Codex config/server/dashboard and Claude settings
hashes remain unchanged. This is current-candidate Windows regression evidence,
not every-feature, signed-thinking-specific, active-outage or sustained-load
certification. Prior case-specific proofs retain their original scope/version.

Fresh Windows tests pass 349/349; fresh Ubuntu passes 347 with only two
Windows-only skips. Both dependency audits report zero known vulnerabilities,
using sharp 0.35.5. All 183 source hashes match on both platforms. Actual Linux
Codex 0.147.0 read-only diagnosis passed with synthetic config/auth fixtures;
no inference was performed for that diagnostic. An independent actual Linux
Copilot SDK authentication check reports not signed in. Real Linux inference
requires that environment's own authorized login; Windows tokens were not
copied. macOS host acceptance remains unavailable.

Source 1.3.55 adds a portable process-scoped Codex launcher and one Node front
door selecting Codex or the existing Claude launcher. It preserves server/UI
source, saved account/configuration/pairing, stock client controls, and separate
history ownership. This CLI increment is not desktop attachment, an installer,
unified history UI, a watchdog/restore guarantee or completion of the full goal.
See [the exact launcher scope and lifecycle contract](PORTABLE-LAUNCH.md).

The 1.3.55 source and fresh Windows suites pass 364/364; fresh Ubuntu passes
362 with two Windows-only skips, zero failures, and a clean dependency audit
on both fresh platforms. The single front door also completed two finite real
Windows provider probes: stock Codex 0.147.0 -> actual GPT-6.1 Sol, and stock
Claude 2.1.292 -> actual Haiku 4.5. Each recorded one completed request, zero
failures, one SDK credit receipt and released runtime ownership. Reported SDK
credits were 3.475100 and 14.635375, respectively (18.110475 combined).
These are text-routing/lifecycle proofs, not a new all-feature or soak certificate.

Important actual-client gaps remain: Codex's pinned model catalog uses fallback
metadata for gpt-6.1-sol, and stock Claude disables claude.ai-hosted connectors
when gateway authentication takes precedence. Their warnings are preserved;
neither clients nor account/managed settings were patched to suppress them.
Real Linux inference still needs its own signed-in Copilot account. Existing
Codex server/dashboard/setup UI and protected user config/settings hashes are
unchanged. No production restart, commit, push or publication was performed.

Source 1.3.56 closes the isolated Codex launcher's unknown-model metadata gap
using the documented child-scoped startup catalog. Models come from authenticated
SDK discovery intersected with owned-relay effective limits, not copied stock
model claims. The generic stock prompt and upstream attribution are preserved;
other client versions require review. Claude adapter/inference remains 0.1.12.

Three contract checks failed before implementation. Root/isolated Windows pass
372/372; isolated Ubuntu passes 370 with two existing Windows-only skips and
zero failures. These snapshots reuse each platform's reviewed dependencies;
root/Ubuntu audits report zero known vulnerabilities. Actual unmodified stock
Codex loads the exact model/effort picker and completes a scripted local response
without the fallback warning on both OSes. The Windows authenticated metadata-only
front door lists 13 entitled GPT models and verifies selected GPT-6.1 Sol/xhigh,
400,000 effective context, 68 percent usable input and 244,800 compaction limit,
then releases its catalog/owner receipt. It requests no inference RPC; prior paid
proofs retain their dated versions/scope. Restore/Remote fixtures and protected
real user/source hashes remain unchanged. See [catalog contract](CODEX-MODEL-CATALOG.md).

No production restart, source commit/push/publication, new paid inference,
Linux credential transfer, client modification or paused outage injection was
performed. Remaining setup/soak/native/hosted/policy gates stay open; this finite
increment does not mark the broader compatibility goal complete.

Source 1.3.57 added the bounded read-only Saved local usage panel, separate from
live wrapper-owned Claude status. Its final Windows suites passed 386 tests with
one skip; Ubuntu passed 385 with two skips. All 201 source hashes matched on
root/isolated Windows/Ubuntu. The final reviewed archive and hash manifest were
verified in a separate same-disk backup directory. Saved/copied history can overlap
and never proves live traffic; absent usage stays unknown. The original live
dashboard remains unchanged. See [the saved-usage contract](LOCAL-USAGE-VISIBILITY.md).

Source 1.3.58 / adapter 0.1.13 fixes three reproduced retry-signal failures:
dropped `x-should-retry`, non-integer HTTP-date delay projection and a missing
correlation response header. Six regressions now pass, including HTTP-hook to
gateway propagation, invalid/private-header rejection, the optional unmetered
501 count endpoint and no fabricated success after partial SSE. Upstream response
bytes remain intact. Delays are not arbitrarily capped at 60 seconds and malformed
hints remain absent. See [the retry contract](CLAUDE-GATEWAY-RETRY-SIGNALS.md).

Root and isolated Windows suites pass 392 with one symlink-privilege skip;
isolated Ubuntu passes 391 with two Windows-only skips, all out of 393 tests with
zero failures. On each OS, stock Claude 2.1.292 stopped after exactly one synthetic
HTTP 500 carrying `x-should-retry:false`, released its owned session/binding and
reported the fixture error rather than success. Stock Read -> Write -> Read also
completed four requests with the actual SUM=42 file, zero failures and zero SDK
inference receipts. The first Linux probe attempted a nonexistent executable and
sent no requests; rerunning against the existing isolated stock installation
passed. Windows/Ubuntu dependency audits report zero known vulnerabilities.
Restore and Remote-preservation fixtures passed; no phone round trip is claimed.

The current finite retry proof does not clear paid active-outage/sustained-load,
macOS, Linux authenticated inference, durable desktop setup, hosted/beta semantics
or provider/licensing gates. Exact count-tokens remains an explicit 501, not an
estimate advertised as exact. Production remains isolated and unchanged; no
deployment, commit, push or publication is implied by these tests.

Source 1.3.59 adds the portable Codex wrapper's optional owned observer with
`--setup-port`, `--open-setup` and `--no-setup`. Five contract checks failed
before implementation. The focused suite passes 24 tests; root Windows passes
400 with one existing skip (401 total, zero failures). Large-counter synthetic
UI rendering passes 1440/768/390px overflow and console checks. Stock Codex and
owned HTTP/lifecycle fixture evidence remain distinct from real inference.
Original desktop source/UI and saved config hashes remain protected. Exact
platform snapshot verification follows in the scoped handoff. This closes a
portable Codex live-visibility gap, not durable setup, cross-wrapper attachment,
authenticated Linux/macOS, sustained provider work or the paused outage gate.
See [the observer contract](CODEX-OBSERVER.md).

Source 1.3.60 fixes the isolated Claude launcher's reproduced startup/cancellation/
cleanup/diagnostic defects. Root Windows verification passes 412 tests with one
existing skip (413 total, zero failures). Actual lifecycle tests call the real
launcher with API-only fixture dependencies; its production dependency guard
remains unchanged. The running root still has sharp 0.35.4 and therefore is not
a launchable reviewed Claude installation: install/reuse patched dependencies
only in a separate candidate, never underneath that active relay. The original
Codex relay/UI/configuration and the verified 1.3.59 backup remain preserved.
See [the exact lifecycle contract](CLAUDE-LAUNCHER-LIFECYCLE.md). No promotion,
commit, push, public release or new paid inference is implied by these checks.

The final isolated 1.3.60 Windows suite also passes 412 with one skip; Ubuntu
passes 411 with two Windows-only skips (413 total, zero failures). Both reviewed
dependency audits report zero vulnerabilities. Actual stock Claude 2.1.292
Read -> Write -> Read completes four local fixture requests on each OS with
zero failures/inference receipts. The Windows wrapper's real SDK-metadata-only
help lifecycle exits 0, closes both listeners and releases its ownership receipt
with zero Messages requests/SDK inference receipts. The missing-executable CLI
rejects before SDK startup with safe diagnostics. These are finite local/client/
metadata proofs, not a paid soak, active outage or Linux authentication claim.
