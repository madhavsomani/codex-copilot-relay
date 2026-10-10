# Isolated Claude launcher lifecycle

Source candidate 1.3.60, October 7, 2026. Claude inference adapter remains
0.1.13. This increment does not deploy, publish or replace the live Codex relay.

## Contract and reproduced failures

Objective: make isolated stock-Claude startup/cancellation/cleanup predictable
without editing saved client/account configuration or starting unnecessary SDK
workers. Preserve terminal model/usage logs and the optional read-only observer.

The original launcher accepted duplicate ports and order-dependent setup
options, started the SDK before discovering a missing client, installed signal
handlers after startup, skipped gateway cleanup when observer close threw, and
printed raw CLI error messages. Six regression checks failed before the fix,
including the interrupted-client exit-code guardrail.

## Behavior

- Duplicate launcher flags and `--no-setup` combined with `--setup-port` or
  `--open-setup` reject in either order. Options before `--` are launcher
  options; arguments after it remain stock-client arguments. Legacy calls
  without a separator continue to forward their arguments to Claude.
- Settings/policy preflight and the installed client's `--version` check run
  before SDK startup. The version check drains both streams with a combined
  4 KiB bound and an eight-second deadline. Failure never prints its raw output.
  Abort, overflow or timeout terminates only the owned probe PID and settles
  without waiting indefinitely for its close event. This is not a certificate
  that arbitrary client versions or descendants are supported/reaped.
- SIGINT/SIGTERM handlers exist before the first asynchronous startup step.
  Cancellation before SDK startup prevents it; cancellation while startup is
  already in progress waits for its existing startup operation, then closes the
  returned gateway without launching a client. There is no new guarantee that
  a hung SDK factory can be aborted. Cancellation returns exit code 130.
- Settings/policy are rechecked after discovery. Normal/nonzero client exit,
  spawn failure and handled cancellation all run owned gateway cleanup.
  Observer close errors are separately reported without skipping inference
  cleanup. Failed gateway shutdown is an error, not success or proof that every
  worker has exited. Failed observer shutdown likewise remains unconfirmed.
- Only locally created, fixed launcher errors are public. Dependency messages,
  paths, parser output and even dependency-supplied `publicMessage` values do
  not pass through the direct CLI or shared front door. Terminal request and
  SDK usage logs retain their existing metadata-only behavior.
- The observer uses the validated launch-time installation/version snapshot;
  it does not repeatedly spawn version probes or continuously certify installed
  software/authentication. Live gateway metrics retain their distinct scope.

Lifecycle tests use API-only dependency injection, not environment flags or a
browser setting that bypasses real preflight/authentication. Ordinary launches
still reject installed sharp older than 0.35.5. Do not run `npm ci` beneath a
live relay: use a separate checkout with the reviewed dependency lockfile.

## Verification and limitations

The twelve focused tests cover the five reproduced defects, ordinary/nonzero
exit, real missing-executable rejection, settings changes during startup,
byte/deadline/abort behavior and the retained dependency guard. Fixture tests
start no Copilot SDK worker/inference. Root and isolated Windows suites pass
412 with one existing skip (413 total, zero failures); Ubuntu passes 411 with
two Windows-only skips. Both isolated dependency audits report zero known
vulnerabilities with reviewed sharp 0.35.5. Dependency installations are reused
from the independently reviewed prior candidates, not newly installed.

Actual stock Claude 2.1.292 Read -> Write -> Read passes on Windows and Linux
through scripted loopback transport: four completed requests, no failures and
zero SDK inference receipts per platform. A real Windows launcher `--help` run
performs authenticated SDK model discovery, exits 0, closes gateway/observer
ports and releases runtime ownership with zero Messages requests/SDK inference
receipts. Actual missing-executable CLI rejection also precedes SDK startup and
does not print the sentinel path. The first help-proof script incorrectly
expected a ledger file without any requests; its postcondition failed, then
the corrected direct counter check passed. That was not a gateway failure.

Basic-revert and Remote-preservation fixtures pass; no phone round trip is
claimed. These finite checks are not sustained provider, network-outage,
authenticated Linux inference or universal client parity certification.

Use the existing wrapper to start an installed stock client:

```sh
node launch.mjs claude --port 4257 --open-setup -- --model claude-haiku-4-5
```

Only use a model actually entitled for your own Copilot account. The terminal
shows routing/usage and the separately printed loopback observer URL. `/exit`
or a handled Ctrl+C closes the wrapper's gateway/observer. A fresh terminal
running plain `claude` uses unchanged saved configuration. Abrupt process-tree
termination, a persistent watchdog, cross-wrapper live attachment and unified
desktop deployment remain separate acceptance work.

## File impact and rollback

`claude-gateway/launch.mjs` owns strict parsing, preflight and cleanup;
`setup-status.mjs` owns bounded client-version diagnostics;
`claude-launch-lifecycle.test.mjs` owns regression/guardrail checks. Both source
manifests advance to 1.3.60. Protocol/inference, original dashboard/setup UI and
saved user configuration remain unchanged.

Preserve the verified 1.3.59 archive. Inspect/extract backups into a separate
directory first, never reset the dirty worktree or overwrite a running relay.
This increment can be reversed by restoring only its changed launcher/status/
manifest/document files and removing its new test/document files from a confirmed
inactive candidate. Same-disk source backup is not off-device disaster recovery.

See [portable scope](PORTABLE-LAUNCH.md) and the existing
[policy/release gates](CLAUDE-GATEWAY-POLICY.md). No client patch, credential
copying, quota bypass, silent fallback or account-safety guarantee is introduced.
