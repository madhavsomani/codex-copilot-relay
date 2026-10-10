# Portable Codex connection checks

Source candidate **1.3.54**. The Claude adapter remains **0.1.12**; this increment
does not change Claude's inference/continuation code or deploy the candidate.

## Contract

- Objective: report CLI installation and user-file routing on Linux/macOS instead
  of declaring those systems unsupported without checking.
- Acceptance: reproduce the false missing-client states, retain Windows checks,
  distinguish routing from observed traffic, fail closed on ambiguous input, and
  leave configuration/login files and live processes unchanged.
- Non-goals: automatic installation, persistent Unix lifecycle management,
  desktop-binary discovery, effective managed/profile/CLI configuration evaluation,
  model inference, account authentication, phone access or dashboard redesign.

`setup-status.mjs` keeps the existing Windows PowerShell inspector. On Linux and
macOS it calls dependency-free `codex-setup-status.mjs`: the PATH `codex --version`
command (or an explicit `CODEX_EXECUTABLE`) and a bounded config read. Version
output is limited to 4 KiB and eight seconds; no shell or inference is launched.
A version string is reported CLI identity, not binary provenance certification.

The config is selected using `CODEX_HOME`, otherwise the current user's
`.codex/config.toml`. Absolute and `~/` overrides work; invalid relative overrides
return unknown rather than falling back to another profile. No credential file is
selected or returned. The diagnostic reads at most 1 MiB, rejects symlinks and
nonregular files, and does not emit config values, paths, headers or errors that
may contain personal data. It never creates a missing config or restore receipt.

## What the status means

| Status | Evidence |
|---|---|
| Not found | The configured/PATH executable could not be found |
| Unknown | Version/read failure, unsupported syntax or ambiguous routing |
| Not configured | CLI found; inspected user-file fields do not point at this relay |
| Configured | Inspected user-file provider/base URL match; no recent traffic implied |
| Configured / relay offline | Matching user-file fields but the independent relay check is not healthy |
| Recent Codex traffic | Matching routing plus a recent Codex-labelled request; not proof it succeeded |

The portable result explicitly carries `configurationScope: user-file-only` and
`effectiveConfigurationVerified: false`. `backup: not-managed` means this check
has not established any portable durable restore mechanism. The original Windows
backup/restore inspector is unchanged. No Unix restore shortcut is invented.

The narrow routing grammar accepts normal single-line literal/basic string keys,
dotted assignments and provider tables, with exact localhost/127.0.0.1 port and
Responses semantics. It is **not a complete TOML parser or config validator**.
Selected profiles, relevant inline maps, duplicate routing fields/tables,
multiline values and unsupported/ambiguous forms report unknown. An unknown
result does not mean the stock client cannot load that valid configuration.
Unrelated configuration is not validated or returned.

Codex also loads CLI overrides, profile files, system/workspace defaults and
managed requirements. These checks do not claim to resolve those layers or
prove account availability. See the official
[configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)
and [provider/profile reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Use an actual completed routed request and the SDK receipt to establish inference.

## Verification and recovery

Eight regressions failed before implementation and passed after the change.
Additional tests cover explicit/tilde home selection, quoted/comment decoys,
bounded/failing/stalled CLI output, symlink/nonregular files and unknown platforms.
The existing dependency-free, read-only setup-server fixture remains operational
before `npm ci`; HTTP mutation/origin protections are unchanged.

```sh
node --test codex-setup-status.test.mjs setup-status.test.mjs
npm test
git diff --check
```

Fresh Windows verification passes 349/349 tests; fresh Ubuntu 24.04/Node 22.22.0
passes 347 with two Windows-only skips. Both fresh audits are clean, using sharp
0.35.5, and all 183 source hashes match. The actual Linux Codex 0.147.0 CLI
detected a missing config without creating it, matched a synthetic user-file
route and reported a duplicate-routing conflict as unknown. Synthetic config,
auth and parent environment checks passed unchanged. This is zero-inference
diagnostic proof; the Linux SDK's separate read-only auth check reports not
signed in. No Windows credentials were copied. The macOS path has platform-selection
fixtures, **not an actual macOS host test**.

Source changes: the new inspector/test/contract, its import/dispatch in
`setup-status.mjs`, the new dependency-free module in the setup fixture's copy
list, and matching package/lock versions. Existing Codex server, dashboards,
launcher/config scripts and Claude inference code remain untouched in this cycle.

Recovery: use the preserved previous source archive in a separate checkout.
There is no global config change to reverse, no production process to stop, and
no source rollback requiring a reset of the dirty repository. Source backups on
the same disk are recoverable local storage, not off-device disaster recovery.
The wider [Claude gateway goal](CLAUDE-GATEWAY-ACCEPTANCE.md) remains active.
