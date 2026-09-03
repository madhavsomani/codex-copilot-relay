# Codex Copilot Relay agent instructions

## Deployment invariant

- Every runtime or dashboard change intended for the live relay must increment
  the version in both `package.json` and `package-lock.json`.
- After the version bump, run Start or Repair so a fresh watchdog is staged. The
  watchdog reads `expectedVersion` once at startup. Arbitrary file edits and an
  unchanged version do not hot-reload or deploy automatically.
- Never force-restart while `/health` reports `activeExchanges` above zero. Start
  or Repair uses deferred promotion so in-memory tool continuations can finish.
- The sole legacy recovery exception is `Start-Codex-CopilotProxy.ps1
  -RecoverDeadBackend`: it must prove, across repeated samples, an owned listener,
  a fatal CLI heap crash after startup, and no remaining Copilot worker. Those
  stale exchanges are already lost. Supervised releases recover the SDK in-process
  and must never use this legacy exception to terminate a healthy worker.
- Verify deployment by reading `http://127.0.0.1:4144/health` and matching its
  `version` to `package.json`. Refreshing the dashboard alone is not proof.

## Required verification

- Run `npm test` and `git diff --check` for every code change.
- For dashboard work, inspect the live page at desktop, tablet, and phone widths
  and confirm there is no page-level horizontal overflow or browser console error.
