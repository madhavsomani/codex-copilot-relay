# Stop & Restore 1.3.76 handoff

Explicit desktop Stop now cancels both protocols instead of waiting for tasks
to finish. Recovery is disabled first; streams/uploads and retained continuations
are cancelled; verified relay-owned workers exit; the original Codex TOML is
restored with a checksum check. Start then loads the latest local checkout.
Ordinary Start/Repair, automatic updates and crash recovery remain drain-safe.

## Verification on October 10, 2026

- Failure-first stop-control tests reproduced busy cancellation being ignored.
- `npm test`: 490 tests, 489 passed, one skipped, zero failures.
- `manual-stop.test.ps1`, `basic-revert.test.ps1`, `two-controls.test.ps1`
  and `remote-compatibility.test.ps1` passed. `git diff --check` passed.
- Metadata-only combined-server probe: two unfinished uploads, one per protocol,
  both received HTTP 503; shutdown took 983 ms; Claude's lease was released.
- Actual desktop Stop cancelled two retained exchanges on 1.3.74. Stop/restoration
  took 6,819 ms; the old server and its three direct children exited. Original TOML
  restoration was checksum-verified before Start. The full cycle took about 23 s.
- Start loaded relay 1.3.76 / Claude adapter 0.1.21, both ready, with
  `gpt-6.1-sol` / `xhigh`. One console and one watchdog were confirmed.
- Both desktop shortcuts point to the intended PowerShell scripts.
- Auth, persistent Claude key, protected original backup and native-image settings
  had identical hashes before Stop, after Stop and after Start. Telemetry was
  retained and backed up; no history was deliberately cleared.
- These lifecycle probes submitted zero paid inference requests.

Local evidence (ignored runtime, not distribution assets):
`runtime/manual-stop-176-deployment.json`,
`runtime/manual-stop-176-deployment.log`,
`runtime/manual-stop-176-tests.log`, and
`runtime/managed-metadata-ab0pXf/metadata-result.json`.

## Focused file impact

- `Stop-Relay.ps1`, `Disable-Codex-CopilotProxy.ps1`,
  `Stop-Codex-CopilotProxy.ps1`: explicit cancellation switch and transient cleanup.
- `Relay-Control.ps1`: owned-process/instance checks, cooperative cancel command,
  bounded cleanup and verified legacy-process termination.
- `relay-stop-control.mjs`, `server.mjs`: atomic admission stop, cancellation
  capability, structured failures and both-adapter cleanup.
- `relay-stop-control.test.mjs`, `manual-stop.test.ps1`,
  `basic-revert.test.ps1`, `claude-gateway.test.mjs`,
  `probe-managed-desktop.mjs`: cancellation and preservation evidence.
- `Install-RelayDesktopControls.ps1`: updated Stop shortcut description.
- `package.json`, `package-lock.json`: release 1.3.76.
- `AGENTS.md`, `README.md`, `docs/TWO-CONTROLS.md`,
  `docs/WINDOWS-LAUNCHER.md`, `docs/CLAUDE-IMAGES.md`, this document:
  explicit manual-stop exception and handoff.

Earlier authorized image/dashboard changes remain in the working tree; this
handoff is not a claim that all unrelated pending changes were newly audited.

## Risks, restoration and follow-up

Cancelled turns are not replayed automatically. Client-owned shell/browser jobs
are outside relay cancellation. Later TOML edits are archived before restoring
the protected original. History, keys, transcripts and backups are retained;
only transient control state is removed and stale ownership receipts are archived.

To return to normal Codex routing, use **Stop & Restore**, then reopen Codex tasks.
Claude's saved third-party profile remains user-controlled: select normal sign-in
in Claude yourself when no longer using the relay. To use the relay again, click
**Start Relay**. Stop is not an automatic download or source-code rollback.

Stock Claude CLI can use supported local base-URL configuration. Desktop Code
uses its supported Gateway form. The prior live browser/screenshot test passed,
but logged-in extension approval, full Desktop GUI acceptance and cryptographic
signed-history acceptance remain unverified; the separate GUI prefix 409 is not
declared fixed. See `docs/CLAUDE-IMAGES.md`. No full-native-parity claim is made.

This release was deployed locally; this lifecycle batch was not committed or
pushed to GitHub. No custom client engine or silent provider fallback was added.
