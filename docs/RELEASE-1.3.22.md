# 1.3.22: opt-in hybrid protocols and visual-context repair

This release retains the 1.3 Control Room dashboard. It does not claim full
native parity, subscription access to general Platform APIs, or verified
Codex desktop voice integration.

## Changes

- Fix stale visual selection: a newer tool screenshot outranks an old upload.
- Preserve single-image bytes, log content hashes at the SDK handoff, and pack
  bounded recent image batches into labelled overviews where needed. New image
  batches that cannot fit fail explicitly instead of silently disappearing.
- Add an off-by-default, authenticated public OpenAI transport for hosted
  Responses tools, extended search/image options, multipart uploads, Files,
  vector stores, Containers, Audio, and Realtime/WebRTC signaling.
- Preserve streaming bytes, binary payloads, upstream errors and client
  cancellation. Record hashed response-provider affinity across restarts;
  reject unsafe cross-provider continuation instead of guessing.
- Keep client credentials separate from the upstream API key. Pin the upstream
  host and routes; reject redirects and browser-origin paid requests. Do not
  execute computer actions, bypass client approvals, or retry paid operations.
- Add a process-local hybrid launcher and reversible environment-header mapping.
  Its watchdog inherits credentials without persisting them in Task Scheduler.
- Publish [setup, billing, limitations and examples](HYBRID-SETUP.md).

## Verification on September 10, 2026

- 141 maintained unit/local-integration tests passed. Public API tests use local
  mock upstreams, including real WebSocket frame forwarding and cancellation.
- Windows config, hybrid header/restore/environment inheritance, legacy dead-SDK
  guards, telemetry-backup suites and PowerShell syntax checks passed.
- Real Codex idle-heartbeat fixture passed.
- Isolated Copilot suite: **16/17 passed**. Tools, parallel requests, child-model
  routing, delayed continuation, streaming and recovery checks passed.
- Normal-font parity: **7/7 image checks passed**, repeated in the full suite:
  three direct images, the same three tool-result images and a two-image overview.
- Original bitmap-font vision probe still failed. Examples included reading
  `278032` as `272632`. This remains an acknowledged reliability limitation,
  not a passing test or proof that all screenshot errors are fixed.
- The unchanged sign-in-based native search helper passed a real search probe.
  No extra paid image generation was run for this release.
- Gitleaks checked candidate source and all 32 pre-release commits with no
  detected leaks; dependency audit reported zero vulnerabilities. This is
  evidence of the scan, not a guarantee that every possible secret is detectable.

No Platform API key was configured on the verification host. Live public hosted
tools, Realtime audio, WebRTC media and API account eligibility therefore remain
**unverified**. No 12-hour soak was performed. See the setup guide to enable the
optional transport with your own credentials and limits.

## Updating without losing work

Install dependencies with `npm ci` only while the relay is stopped (or in an
isolated checkout). Run Repair after the update. It stages a fresh watchdog and
defers runtime replacement while the health endpoint reports active work.
Verify `/health.version` after all active exchanges finish; changing the source
or refreshing the dashboard alone does not deploy an in-memory server.

Rollback: after current work finishes, use Restore Normal Codex for the protected
original configuration. Keep a known-good checkout if you need to return to
1.3.21; do not reset a dirty worktree or interrupt active sessions.
