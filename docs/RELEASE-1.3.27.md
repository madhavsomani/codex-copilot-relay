# 1.3.27 - Image history repair and guided setup

## Fixed

- Exact duplicate image bytes no longer occupy separate visual panels. Source
  occurrence mappings and evidence remain explicit; distinct images are retained.
- Bounded packing tries PNG and supported JPEG encodings before reducing panel
  resolution. The note discloses lossy encoding and overview limitations.
- Image budget failures are classified as invalid prompts instead of generic
  server failures. This does not guarantee any particular client's retry policy.
- Native image status reads `imageEnabled`, not the retired search-enabled flag.
- Native search is removed, including legacy config/health opt-ins. Ordinary
  inference stays on Copilot; browser/connector searches remain Codex-owned.
- Image helper startup disables unrelated plugins, apps, shell and subagents.
- Setup command rendering preserves the PowerShell `./` equivalent backslash.
- Windows diagnostic subprocesses rebuild their own module path, avoiding a
  false backup warning when launched from Node under PowerShell 7.

## Guided first run

`npm run setup` opens a dependency-free, read-only connection center. Dashboard
cards distinguish SDK authentication/model access, configured routing, recent
Codex-labelled traffic and verified backup state. It is **not a one-click
installer**; installation, sign-in and repair remain explicit local commands.
See [the first-run guide](FIRST-RUN.md).

Only stock Codex is supported. No custom engine is included or activated.
Native desktop voice remains unsupported in the tested provider configuration.
Native images consume separate OpenAI allowance, including helper-turn overhead.
The optional public API gateway remains separately configured and explicit.

## Verification scope

- 160 local Node tests pass on Windows, including dependency-free setup, search
  blocking, exact-image retention, duplicate mapping and JPEG support checks.
- Windows config, Remote preservation, exact/repeatable rollback, hybrid config
  and dead-SDK guard fixtures pass without stopping the production relay.
- Dashboard/setup checked at 1440, 768 and 390 pixels: no page-level horizontal
  overflow or console errors. The diagram remains locally scrollable on phones.
- A previously failing six-entry history passes the real local request builder:
  four distinct panels, all six evidence entries, 2,522,036 base64 characters
  against a 4,194,304-character limit, JPEG quality 90. Originals are unchanged.
- No paid inference/image generation was used for release verification. No
  12-hour soak, live image generation or phone-to-host round trip is claimed.

Runtime promotion is deferred while active exchanges remain. A source version
or GitHub push alone does not prove deployment; check the production health
version. Existing request history and provider counters are preserved.
