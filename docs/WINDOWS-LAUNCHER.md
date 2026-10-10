# One Windows executable entry point

Contract: `Copilot-Relay.exe` is the single **launcher** used by both desktop
controls. It delegates to the existing managed lifecycle, preserving the
dashboard, history, persistent key, stock clients, model selection, and exact
Codex TOML restoration. It does not create another relay, recovery mechanism,
account, installer, or provider fallback.

This is **not a self-contained distribution**: keep the EXE in the relay checkout,
beside its scripts and installed dependencies. Copying only the EXE to another
computer is insufficient. Node, GitHub Copilot authentication/entitlement, and
the supported unmodified client applications are still prerequisites. No Node,
Copilot CLI, SDK binary, account credential, or runtime history is embedded.

## Build and use

After the [normal Windows installation](../README.md#windows-complete-setup),
including `npm ci`, run in the checkout using Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-RelayLauncher.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-RelayDesktopControls.ps1
```

The build uses the Windows .NET Framework 4 compiler; no .NET SDK or additional
compiler download is required. The small EXE is unsigned. Review/build the
source locally; don't disable Windows security features to run an unknown build.
The script reports a SHA-256 hash. Compiler timestamps mean builds are not
promised to be byte-identical. Generated binaries are Git-ignored.

- **Start Relay** points to `Copilot-Relay.exe start`. Double-clicking the EXE
  itself also starts it. The existing live event terminal shows both clients.
- **Stop & Restore** points to `Copilot-Relay.exe stop`. It waits for active work,
  stops owned recovery/adapters, and restores Codex's protected TOML backup.
  The result stays visible until Enter is pressed in an interactive console.
- `Copilot-Relay.exe status` checks loopback health without changing settings.
  Readiness is not proof that either client has completed a prompt/reply.
- `Copilot-Relay.exe --version` reports the **launcher build**. `status` reports
  the **running server** version; they can differ while a busy server awaits promotion.

Optional start arguments are `--port`, `--model`, and `--no-dashboard`.
`--no-pause` is available for scripted start/stop/status calls. Stop gets its port
and restore target from managed state, never from a command-line override.
Failed subprocesses retain their nonzero exit code. Stop does not require Node
or a working SDK to dispatch the existing restoration path.

## Closing windows and restoration

Closing the live event terminal **does not stop routing**: the existing per-user
watchdog reopens it. Recovery remains a scheduled task/Startup helper, not a
Windows service. The EXE is a control entry point, not the long-lived server
process. Use **Stop & Restore** for intentional shutdown.

Claude's manually saved Gateway profile is not edited or restored. Select normal
sign-in in Claude yourself after stopping. See [two-control setup](TWO-CONTROLS.md).
No client binaries, account pairing, inference routing, approval policies, or
OpenAI billing behavior are changed by this launcher.

## Rollback and verification

To return the two controls to their PowerShell targets without stopping work:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-RelayDesktopControls.ps1 -UsePowerShell
```

If the EXE is absent, the installer defaults to PowerShell. It validates both
existing shortcut owners before rewriting either; unrelated targets are refused.
The original scripts remain callable even if the binary is missing or damaged.
Build updates retain the previous known EXE under ignored `runtime/launcher-backups`.

Planned dedicated launcher tests (not yet implemented): compiled EXE dispatch in paths with spaces/non-ASCII and
an unrelated working directory; default and explicit models; repeated controls;
argument rejection; child failure exit codes; missing-install failure; no
embedded resources; shortcut migration and rollback; offline/read-only status;
and the existing exact-restoration, key-stability, busy-stop and ownership suites.
The harness blocked adding the dedicated launcher fixture files in this change;
these planned checks must not be read as completed test evidence.

Verified for 1.3.68 on Windows: the EXE builds, reports its version/help, rejects
invalid ports/models/stop overrides, has zero embedded resources, reads the live
health endpoint, and successfully invokes Start while an active exchange defers
promotion. Both installed desktop controls target this EXE. The existing suite
reported 445 passing tests, one skip and zero failures (446 total); the separate
basic-revert, Remote-compatibility and proxy-config suites also passed, along
with PowerShell parsing and whitespace checks. Live Stop was not invoked against
active work. Fixture tests do not certify Claude GUI, phone access, an hours-long
soak, or terminal-crash recovery through the new launcher.
