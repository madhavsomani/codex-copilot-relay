# Claude capacity: relay 1.3.77 / adapter 0.1.22

## Cause and change

The Claude adapter hard-coded `maxSessions: 16`, while Codex used a separate
64-session budget. The October 10 incident showed all 16 Claude slots occupied:
13 waiting for client tools and three streaming, with zero available slots.
The SDK was healthy. Capacity rejections had zero SDK transport attempts: those
requests were refused locally, not by a GitHub quota or a paid inference call.

Claude now defaults to **64 slots**, independently of Codex. Invalid overrides
fail before runtime ownership, SDK startup or inference. The existing atomic
admission counter, capacity rejection (`503`, `x-should-retry: false`), reserved
continuation-rebuild slot and session cleanup remain in place. More slots do not
preallocate SDK sessions, change models, spend credits by themselves or enable
provider fallback. Actual work may of course consume more memory and credits.

For developer launchers, set `BRIDGE_MAX_CLAUDE_SESSIONS` in the environment
inherited by the relay process. Unset/empty means 128 (since 1.3.94; 64 before); the accepted range is 2-256.
`startSdkGateway({maxSessions: 32, ...})` also supports an explicit per-instance
budget. The environment override applies to both the combined and isolated
Claude adapters. Existing processes do not hot-reload it; use an intentional
Stop & Restore followed by Start in the configured environment. A watchdog
inherits its launch environment, so ensure it gets the same override. No override
is required for the new default, including the installed desktop shortcuts.

The dashboard already displays actual Claude capacity from
`/health.claude.sessionCapacity`; this fix does not redesign the dashboard.
SDK readiness alone does not imply free slots. Codex capacity remains separately
visible under `/health.sdk` and uses `BRIDGE_MAX_COPILOT_SESSIONS` as before.

## Acceptance and scope

The Agentic Coding acceptance contract is to remove the premature 16-slot ceiling,
exercise over-16 concurrent tool loops and slot release, and preserve valid
continuations, explicit models, credentials, history and Stop/Restore behavior.
It is not permission to evict old/anonymous/parallel tasks automatically.

- Failure-first tests caught missing production budget configuration and ignored
  explicit overrides before the change.
- The real gateway and CopilotRuntime, using a scripted SDK with no paid model,
  accept 64 concurrent tool sessions. A 65th is rejected before session allocation.
  Existing continuation completion frees a slot; new work can then use it. All
  65 admitted sessions finish with one result each and no retained slots/tools.
- Three additional waves of 32 parallel sessions enforce a configured 32-slot
  limit and release all slots after each wave. Same-parent parallel work is not
  collapsed or auto-cancelled.
- Existing replacement-at-capacity, late-allocation cleanup, repeated shutdown,
  owned-process cancellation, key preservation and exact TOML-restore tests apply.
- A separate live metadata-only combined instance advertises 64 Claude slots,
  keeps the original dashboard and isolates model catalogs/credentials. Its two
  incomplete uploads are cancelled without inference; its Claude lease is released.

Reproduce local regression checks:

```powershell
node --test claude-capacity.test.mjs copilot-runtime.test.mjs claude-lifecycle.test.mjs
npm test
```

The metadata probe `node probe-managed-desktop.mjs --cancel-active` starts a
separate temporary relay using SDK authentication/catalog metadata, but submits
no model prompt and does not stop the production relay.

Focused files: `claude-gateway/server.mjs` (validated budget/startup),
`claude-capacity.test.mjs` (production-path/concurrency regressions),
`claude-gateway/protocol.mjs`, `package.json`, `package-lock.json` (versions),
`probe-managed-desktop.mjs` (capacity readback), this guide, `README.md` and
`docs/CLAUDE-RELIABILITY.md` (operating guidance). Existing unrelated edits are
preserved; no client engine, account, model, native-image helper or binary changed.

## Verified deployment on October 10, 2026

- `npm test`: 494 tests, 493 passed, one skipped, zero failed.
- Basic restoration, Remote-policy preservation, manual-stop and two-controls
  PowerShell tests passed; `git diff --check` passed.
- The authorized desktop restart replaced 1.3.76 (Claude 16/16 occupied) with
  relay 1.3.77 / adapter 0.1.22. Both adapters reported ready. Claude advertised
  64 slots with 59 available after startup; the subsequent live check showed 58
  available. Codex retained its independent 64-slot limit.
- Stop/restoration took 9.0 seconds. All 17 pre-restart exchanges were abandoned
  intentionally; the prior server and its three direct children exited. Original
  TOML restoration was checksum-verified. Authentication, persistent Claude key,
  protected TOML backup and native-image settings were unchanged across the cycle.
- One console and one watchdog were confirmed. History was retained. The default
  remains GPT-6.1 SOL / xhigh. No paid inference probes were submitted.
- Local deployment evidence: `runtime/capacity-177-deployment.json` and
  `runtime/capacity-177-tests.log`. This batch is not committed/pushed to GitHub.

## Limits and rollback

64 is still finite. Waiting continuations are legitimate state, not proven leaks
just because they share a parent session ID. These tests do not prove every live
GUI/SDK branch releases correctly or certify unlimited hours of operation. If
capacity fills again, inspect `/health.sessionControl` and investigate the actual
retained sessions; do not repeatedly retry a deterministic capacity rejection.
Use `Relay-Sessions.ps1` for an explicitly selected unwanted waiting continuation,
or Stop & Restore to intentionally abandon all in-flight relay work.

Normal Start/Repair and automatic updates retain drain-safe behavior. The user
authorized Stop & Restore -> Start path deploys this update even while busy;
interrupted client turns may need to be retried. Client-owned tools/jobs are not
terminated. Stop & Restore returns the protected original Codex TOML; keys,
history and backups survive. For a smaller budget set the launch override and
restart intentionally. No code rollback or GitHub publication is automatic.
