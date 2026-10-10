# Stock Codex model-catalog contract

Objective: remove unknown-model fallback metadata in the isolated stock Codex
launcher using the supported startup `model_catalog_json` interface. The live
desktop relay, saved account/settings, Claude adapter and client binaries are
non-goals and must remain untouched.

Acceptance:

- Exact authenticated, non-disabled Copilot GPT discovery intersects the owned
  relay's advertised effective limits, efforts and image support. Unknown or
  contradictory selected-model metadata fails before inference.
- The owned startup catalog is passed only via child CLI configuration. It is
  regenerated for each launch; successful shutdown removes only that generated
  file, retaining history. Uncertain exits retain the catalog and owner receipt.
- Stock Codex 0.147.0 loads the catalog, lists the exact model/efforts, sends the
  requested model/effort and completes a local scripted response without the
  unknown-model/fallback warning. No paid inference is needed for this metadata
  contract; prior real-provider proof retains its original scope/version.
- The generic stock fallback prompt is preserved verbatim with its upstream
  license/attribution. This is client prompting, not upstream model metadata.
  No copied stock model capabilities, OpenAI account entitlement, unsupported
  service tiers, hosted search, or Responses Lite claims are introduced.
- Root suite, restore/Remote fixtures, source hash preservation and bounded
  cross-platform stock checks protect the existing system.

Sources: [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference),
stock Codex `rust-v0.147.0` model schema/manager source, and the authenticated
Copilot SDK ModelInfo/relay health. A local catalog is client configuration, not
an entitlement check or provider endorsement. Other stock versions require
their own schema/prompt review.

## Metadata boundaries

This is source 1.3.56 / Claude adapter 0.1.12. SDK names, GPT IDs and input
support are allowlisted without account identifiers, terms strings or credentials.
The context/prompt/effort/image fields use the owned relay's effective contract,
which may be lower than the SDK's raw upstream maximum. Codex's effective input
percentage is capped at the stock 95 percent default and at the advertised prompt
allowance; auto-compaction uses the smaller of 90 percent of window or prompt
allowance. These are local client budget policies, not newly discovered provider
limits. Fractional percentages round down. Unrepresentable or contradictory
metadata fails rather than inventing defaults.

The isolated route has no hosted search, service tiers, Responses Lite, original
image detail, or native reasoning-summary parameter claim. Parallel outer tools
are already implemented by the relay. Other tool/permission/prompt defaults
preserve the reviewed generic fallback profile rather than copying a different
stock model's experimental capabilities. `supported_in_api` is the stock
custom-provider picker field, not OpenAI plan or API entitlement.

## Upstream attribution

`codex-gateway/stock-client-0.147.0/prompt.md` is an unmodified LF copy of
[OpenAI Codex's generic stock prompt](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/models-manager/prompt.md).
SHA256: `ac8ae107a0d72fe3476b430afb161ea4e67da2e446d778aefc44828160559807`.
Its adjacent `LICENSE` and `NOTICE` retain upstream Apache-2.0 terms and OpenAI
attribution. No Ratatui code is included in this prompt copy. The relay's own
MIT license does not relicense this third-party file or grant provider access.
Runtime generation checks the prompt hash and requires stock Codex 0.147.0;
no startup network fetch or client patching is used.

## October 7 verification

- Three contract regressions failed before implementation; all final checks pass.
- Root and isolated Windows: 372/372. Isolated Ubuntu 24.04/Node 22.22.0:
  370 passed, two existing Windows-only skips, zero failures. The source
  snapshots reuse each platform's reviewed dependency installation; root/Ubuntu
  audits report zero known vulnerabilities.
- Actual stock Codex 0.147.0 consumes the catalog via `model/list` and completes
  the authenticated scripted local response with no fallback warning on both OSes.
- Windows authenticated metadata-only front door: 13 exact Copilot GPT models,
  selected GPT-6.1 Sol, efforts none/low/medium/high/xhigh, default xhigh;
  effective context 400,000, input 68 percent, compaction 244,800. No inference
  RPC was requested. Catalog and owner receipt were removed after graceful exit.
- Restore/Remote/account/policy fixtures pass. Protected server/dashboard/setup
  UI and real user config/settings SHA256 hashes are unchanged. No production
  restart, client/account modification, paid inference, commit or publication.

These checks close the isolated launcher's unknown-model metadata gap, not
desktop-picker integration, 1-million-token admission, every-model quality,
phone Remote, signed-in Linux inference or the full Claude compatibility goal.
