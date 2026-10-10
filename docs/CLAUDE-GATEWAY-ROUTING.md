# Claude startup routing contract

October 7, 2026; source 1.3.49 / adapter 0.1.8. Local isolated preview only.

## Reproduced failure

Stock Claude Code 2.1.292 applied `--settings` `env.ANTHROPIC_BASE_URL`
over the wrapper's child environment. A local mock reproduction recorded one
Messages request at the settings endpoint and none at the intended endpoint.
No SDK, provider credential or paid inference was involved. Simply exporting
a gateway URL is not proof that every Claude request uses it.

The official [environment precedence documentation](https://code.claude.com/docs/en/env-vars#precedence)
describes this behavior. [Settings precedence](https://code.claude.com/docs/en/settings#settings-precedence)
also puts managed policy above command-line settings. The documented host-managed
provider flag changes that model-policy precedence, so this wrapper does **not**
enable it or override organization model pins.

## Implemented startup checks

Before SDK creation, the wrapper validates:

- Every supplied `--settings` JSON/file occurrence and fallback-model flag.
- User settings in `CLAUDE_CONFIG_DIR` (otherwise the current user's `.claude`),
  project settings in the starting directory, legacy local settings there and
  repository-root local settings. Selected `--setting-sources` are honored.
- Cached `remote-settings.json` regardless of selected ordinary sources.
- Documented OS system `managed-settings.json` and sorted non-hidden JSON
  drop-ins in `managed-settings.d`. The legacy Windows ProgramData path is not used.
- Windows HKLM/HKCU policy in both registry views, read-only. Detected macOS
  managed-profile files refuse startup because their effective policy is not resolved.

The [managed policy guide](https://code.claude.com/docs/en/managed-settings)
documents these local delivery mechanisms; the
[server-managed guide](https://code.claude.com/docs/en/server-managed-settings)
documents the cache. The preview checks all present local documents conservatively,
not only the policy document stock Claude would select. A stale or lower-priority
conflicting document can therefore block launch. Ask the administrator rather than
editing managed policy or bypassing it to make the wrapper work.

Admission rejects any `ANTHROPIC_*` env entry and provider/auth/gateway/body/beta
controls from settings, credential/policy helpers, forced login, fallback or model
rewrites, and managed model/picker pins. This is deliberately conservative, not
a claim that every rejected value is unsafe. Empty routing overrides also reject;
settings cannot safely unset shell credentials. Existing ordinary `model` settings
remain unchanged; the opt-in child model environment owns the default. Stock
managed model allowlists and permission enforcement are not removed.

Unreadable, malformed, non-object and over-1-MiB settings refuse startup. Error
messages name source categories and keys, never values, contents, parser snippets
or helper commands. No helper command is executed. The source files, registry,
parent environment and stock binaries remain unchanged. Successful preflight is
checked again after SDK discovery, before the stock client starts; an error there
closes the owned startup resources. The in-memory bearer is not added to settings
files or command-line JSON.

## Evidence

Two regressions failed before implementation and passed afterward. Twelve
deterministic tests protect source selection, nested local files, managed policy,
registry failures, credential-safe errors, no writes, permission/hook/MCP retention
and rejection before the SDK factory starts. All 320 repository tests pass on
Windows, along with basic-revert and Remote/account-preservation fixtures.

Fresh Windows installation passed `npm ci`, all 320 tests, and
`npm audit --omit=dev` with zero known vulnerabilities; installed sharp is 0.35.5.
The real wrapper rejected conflicting settings before SDK runtime creation.
Clean stock `--help` exited 0, closed the gateway port and released ownership;
existing client config hashes were unchanged. No SDK inference receipt was logged.

A separate Ubuntu 24.04 WSL installation with Node 22.22.0 passed `npm ci`,
318 tests with two Windows-only checks skipped, and a zero-vulnerability audit.
No Windows dependencies or account credentials were copied. This is Linux
deterministic/dependency evidence, **not** Linux stock-client acceptance: Claude
was not installed there. macOS stock-client acceptance also remains open.

The stock-client loopback probe now proves the original settings redirect,
preflight rejection with no additional Messages requests, and clean settings
reaching the intended endpoint:

```sh
node claude-gateway/probe-settings.mjs
```

Fixture token counts are mock wire data, not provider usage measurements.
This does not recertify the preceding 0.1.7 full paid inference workflow.

## Limits and rollback

These are **startup checks, not a network sandbox**. They do not freeze settings,
prevent hook/tool subprocesses from changing files, or resolve newly fetched
remote/MDM policy. Stock Claude can reload policy, and `/cd` can load different
project files. Do not change provider/auth settings or working directories during
this preview session. Exit and rerun the wrapper to recheck configuration.
Background/supervisor routing under such changes remains unverified. Nonstandard
Git environment/root overrides and every MDM/WSL inheritance deployment are not
certified. Policy helpers and explicit Windows-policy inheritance are refused.
The checks do not claim to be a complete organizational policy resolver.

If the preflight blocks your configuration, plain `claude` in a fresh terminal
still uses the original configuration. Use a separate opt-in configuration or
obtain your administrator's approved gateway configuration; do not erase login,
permission, helper or managed settings. The preview is not auto-enabled globally.
For source rollback, recover the preserved 0.1.7 archive into another checkout,
not over active work. The existing Codex relay/dashboard/history were not changed,
and this 0.1.8 source has not been committed, pushed or promoted.

Still-open goal gates: sustained and active-outage acceptance, hosted/beta
semantics, macOS/Linux stock-client acceptance, unified history/install UX and
provider/distribution clarification. No full-parity or account-safety promise.
