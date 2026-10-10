# Two desktop controls — acceptance contract

Objective: one managed loopback relay for stock Codex and Claude Code, operated
by **Start Relay** and **Stop & Restore** on Windows.

Acceptance: idempotent Start; a visible, self-recovering event terminal; preserved
4144 dashboard/history; both protocol adapters ready; persistent user-protected
local Claude key; ownership-checked stop even when the PID file is missing;
no interruption of active exchanges; checksum-verified Codex restoration;
repeatable Stop; archived old controls and no unrelated desktop cleanup.

Non-goals: modifying client binaries, silently switching providers, bypassing
client permissions, changing accounts/pairing, certifying mobile or Claude GUI
inference from API fixtures, or replacing the existing dashboard design.

Claude's supported third-party form is a one-time user action. The relay does
not edit its internal settings. Stopping cannot switch that saved profile back.

## Use

Optional [Windows EXE launcher](WINDOWS-LAUNCHER.md): build `Copilot-Relay.exe`
and reinstall the controls to point both shortcuts at that executable. The
underlying recovery/restoration behavior below does not change. Source and
dependencies remain in the checkout; the EXE alone is not a portable install.

1. Double-click **Start Relay**. It repairs/stages the local service and opens
   the original dashboard at <http://127.0.0.1:4144/dashboard>. A single live
   terminal labels Codex and Claude requests. `status` shows actual readiness.
   Repeated Start does not create another server or event terminal. If work is
   active, promotion waits for its continuations to finish.
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
5. Double-click **Stop & Restore**. It disables recovery immediately and waits
   for active requests/continuations before stopping. No force-stop of active
   work is performed. It restores the protected original Codex TOML exactly;
   later edits are retained under `runtime/config-before-restore/`. Reopen Codex
   tasks to reload. For Claude, select normal sign-in in the app yourself.

Recovery uses a per-user scheduled task (or Startup-folder watchdog), not a
Windows service. Closing the event terminal is temporary: it reopens. Stop &
Restore removes recovery; use that control for intentional shutdown. It does
not kill unrelated Node/PowerShell processes, erase history, or disable accounts.

## Files and rollback

All source stays in the checkout. `Install-RelayDesktopControls.ps1` creates only
the two controls, archiving narrowly recognized legacy relay controls under
Desktop/Copilot Relay Backups. Other shortcuts and screenshots are untouched.
The isolated `node launch.mjs gateway` mode remains for developers; it is not
the desktop Start path and is not silently adopted. Historical preview ledgers
remain labelled separately rather than merged into lifetime mileage.

Native OpenAI images/account services retain their existing paths and billing.
This does not add voice support, bypass approvals, promise provider endorsement,
or certify hours-long/phone/GUI operation from local regression tests.
