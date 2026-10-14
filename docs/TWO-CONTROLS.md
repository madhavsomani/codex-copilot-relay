# Two desktop controls — acceptance contract

Objective: one managed loopback relay for stock Codex and Claude Code, operated
by **Start Relay** and **Stop & Restore** on Windows.

Acceptance: explicit Start restarts the owned relay; a visible, self-recovering event terminal; preserved
4144 dashboard/history; both protocol adapters ready; persistent user-protected
local Claude key; ownership-checked stop even when the PID file is missing;
intentional cancellation on desktop Start/Stop only; checksum-verified Codex restoration;
repeatable Stop; archived old controls and no unrelated desktop cleanup.

Non-goals: modifying client binaries, silently switching providers, bypassing
client permissions, changing accounts/pairing, certifying mobile or Claude GUI
inference from API fixtures, or replacing the existing dashboard design.

Claude's supported third-party form is a one-time user action. The relay does
not edit its internal settings. Stopping cannot switch that saved profile back.

## Use

Both shortcuts target Windows PowerShell directly. No relay EXE or build step
is required. Reinstalling the controls migrates this checkout's old EXE shortcuts
back to scripts, even if the old EXE is still present. No settings/history are
changed by shortcut migration.

1. Double-click **Start Relay**. Since **1.3.79**, it pauses recovery, cancels
   existing relay sessions, starts the latest local package and opens
   the original dashboard at <http://127.0.0.1:4144/dashboard>. A single live
   terminal opens with setup instructions and labels Codex and Claude requests.
   `setup` repeats the guide, `models` lists the live Claude choices, `status`
   shows actual readiness, and `key` explicitly reveals the persistent local key.
   Repeated Start replaces the owned server and event terminal. Active requests
   are cancelled. Use the Repair script to stage an update while work finishes.
2. Codex uses `http://127.0.0.1:4144/v1`, default `gpt-6.1-sol` / `xhigh`.
   Explicit model selections remain honored. Reopen Codex tasks after routing
   changes; the relay does not restart the application or change account pairing.
3. Claude Desktop: use **Developer → Configure Third-Party Inference**, Gateway,
   base URL `http://127.0.0.1:4144/claude`, Static API key, Bearer. Type `key` then
   Enter in the live relay terminal and enter that local key in the app yourself.
   Do not put it in MCP settings. See [the supported form](CLAUDE-DESKTOP.md).
   The key is encrypted for the current Windows user in ignored runtime storage,
   not printed to logs, and persists across stop/start. Old preview session keys
   do not apply to this endpoint. A different computer needs its own new key.
4. Verify a real Code-tab prompt/reply and matching completed Claude request in
   the terminal or connection center. Ready/model discovery alone is not GUI proof.
5. Double-click **Stop & Restore**. Starting with **1.3.76**, it disables recovery
   and immediately cancels active Codex/Claude requests and retained continuations.
   It does **not** wait for model or tool work to finish. A bounded cleanup wait
   lets the server close streams, SDK workers and leases; an older or stuck server
   is stopped using revalidated process ownership. Interrupted turns must be
   retried in their client; they are not automatically replayed. It then restores
   the protected original Codex TOML exactly;
   later edits are retained under `runtime/config-before-restore/`. Reopen Codex
   tasks to reload. For Claude, select normal sign-in in the app yourself.
6. Click **Start Relay** again to load the current checkout version, including
   staged updates. Verify `/health.version` or the dashboard version. Stop is not
   a download/update command; it makes the next Start able to load new local code.

Only explicit desktop Start/Stop abandon active work. Internal Start, Repair and
automatic recovery wait for all exchanges to finish. Transient PID/stop files
are cleared; an orphaned Claude ownership receipt is archived only after proving
its owner and children have exited. No ledger, key, protected backup, transcript,
client-owned shell job or browser process is intentionally cleared.

Recovery uses a per-user scheduled task (or Startup-folder watchdog), not a
Windows service. Closing the event terminal is temporary: it reopens. Stop &
Restore removes recovery; use that control for intentional shutdown. It does
not kill unrelated Node/PowerShell processes, erase history, or disable accounts.

### Crash recovery limits

- The watchdog samples health about every 10 seconds; startup can take longer.
  It restores a stopped HTTP relay and a closed event terminal. The SDK
  supervisor separately owns backend recovery. Active healthy exchanges defer
  version updates rather than being killed.
- The scheduled task retries watchdog failures up to 10 times, one minute apart,
  and starts at user sign-in. The Startup-folder fallback has no same-session
  watchdog-failure retry: use Start Relay, or sign in again.
- History, the persistent local key and the protected TOML backup remain on disk.
  An in-flight request or in-memory tool continuation can be lost during a crash;
  retry from the client. This is service recovery, not durable task resumption.
- Sleep, shutdown, revoked credentials or exhausted provider allowance cannot be
  fixed by restarting the process. There is no silent provider switch.

## Files and rollback

All source stays in the checkout. `Install-RelayDesktopControls.ps1` creates only
the two controls, archiving narrowly recognized legacy relay controls under
`runtime/desktop-backups/` inside this same folder. Other shortcuts and
screenshots are untouched. Archived historical backups are not active launchers;
old rollback scripts can contain obsolete paths and need review before use.
The isolated `node launch.mjs gateway` mode remains for developers; it is not
the desktop Start path and is not silently adopted. Historical preview ledgers
remain labelled separately rather than merged into lifetime mileage.

Native OpenAI images/account services retain their existing paths and billing.
This does not add voice support, bypass approvals, promise provider endorsement,
or certify hours-long/phone/GUI operation from local regression tests.

## What is on your desktop

```text
Desktop/
  Codex Copilot Bridge/        one installation: scripts, source, docs, runtime, backups
  Start Relay.lnk              powershell.exe -> Start-Relay.ps1
  Stop & Restore.lnk           powershell.exe -> Stop-Relay.ps1
```

Codex's real `config.toml` stays in `CODEX_HOME`, or the current user's `.codex`
folder when that variable is unset. Only its protected backup lives here.
Claude's app and saved third-party profile stay in Claude's own storage.
Keep the folder intact; scripts need Node and the installed dependencies.

The dashboard's fabric shows both client branches and a shared **Tools** node.
Tool requests/results are handed back to their originating app. Claude's new
handoff counts are metadata, not execution-success or billing measurements;
older rows without counters stay unknown. Recent call history, per-session
checkpoints and provider receipt subtotals now include both clients; the ledgers
remain separate and legacy trend/KPI charts are explicitly Codex-only. No
fabricated history, fallback, or paid test traffic is added. See
[unified history and metering](UNIFIED-HISTORY.md).

For a busy relay, inspect the dashboard's **Retained sessions and capacity**
details or run `Relay-Sessions.ps1` from this folder. The optional diagnostic
script is not another desktop shortcut. On v1.3.74 or newer it can explicitly
abandon one waiting continuation after you save/stop its client work; it never
force-cancels streaming work or automatically evicts old sessions. See
[reliability and safe cancellation](CLAUDE-RELIABILITY.md).
