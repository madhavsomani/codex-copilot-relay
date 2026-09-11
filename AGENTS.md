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

- Preserve OpenAI desktop identity, native account/Remote services, device
  pairings and managed Remote policies when changing model routing. Never
  expose the loopback relay to make mobile access work. Keep the paired
  desktop-auth flag and nonsecret model bearer override together.
- For config/lifecycle changes, run `remote-compatibility.test.ps1`; after a
  Codex engine upgrade rerun `probe-desktop-auth.mjs` against that installed
  engine. Do not claim iPhone Remote is verified without a phone-to-host
  prompt/reply round trip. See `docs/IPHONE-REMOTE.md`.
- Support unmodified stock Codex only. Do not ship or install custom engines.
  Native app voice is unsupported on the tested engine; never weaken model
  credential isolation to enable it. See `docs/NATIVE-VOICE.md`.
- Native OpenAI helpers are images-only. Search is removed, including legacy
  opt-ins. Browser and connector tools are separate, harness-owned capabilities.
- Run `basic-revert.test.ps1` for lifecycle work. Connection status must
  distinguish configured routing from observed traffic and authentication.
- The connection center is guided/read-only, not an automatic installer.

- Run `npm test` and `git diff --check` for every code change.
- For dashboard work, inspect the live page at desktop, tablet, and phone widths
  and confirm there is no page-level horizontal overflow or browser console error.
