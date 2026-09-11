# Codex compatibility and context limits

The relay runs inference through GitHub Copilot. Codex owns tools, files, browser
control, connectors, approvals, skills, memory, and task orchestration. A working
tool transport does not establish that every third-party service is authenticated
or that every native OpenAI feature is available.

## Feature matrix

| Feature class | Support and verification |
| --- | --- |
| Text, Responses streaming, sequence numbers, terminal errors | Live stream and failure probes |
| System/developer messages, corrections, memory, historical tool results | Compatibility marker probe |
| Function/custom/namespace tools | Unit translation checks, live tool chains, real Codex CLI request-shape probe |
| Deferred tools and explicit tool choice | Live discovery and named-tool probes |
| Readable reasoning and commentary/final phases | Live phase probe; summaries depend on Copilot output |
| Agent-message transport and independent concurrent exchanges | Live payload and four-request concurrency probes |
| Long tool waits and progress-only recovery | Delayed continuation and premature-completion probes |
| Image inputs and live screenshot results | Initial image plus two consecutive tool-returned images; binary data is forwarded, never embedded as prompt text |
| Browser tools | Harness-executed function/custom tools; backend availability and browser policy still apply |
| Worker crash and session churn | Isolated fault and capacity probes; interrupted in-memory work still needs retry |
| Live hosted web search | Optional native Codex helper; actual search actions streamed as web_search_call, sources returned as URLs |
| Built-in image_gen tool | Optional native Codex helper serves Images generations/edits endpoints with GPT Image 2 |
| Hosted image_generation Responses declaration, file search, code interpreter, computer-use API | Optional authenticated public OpenAI transport; whole turn uses OpenAI, upstream model/access requirements apply |
| Realtime WebSocket / WebRTC signaling and public Audio API | Optional public transport; compatible client required, built-in desktop voice not certified |
| Third-party image/video generators | Ordinary connector/browser tools; service authentication and generation costs are separate |
| Stored Responses and JSON-schema output enforcement | Optional public OpenAI transport; not implemented inside Copilot |
| Conversations API and provider-specific controls on Copilot | Unsupported controls rejected explicitly |
| OpenAI encrypted reasoning, cache identity, model-specific serving behavior | Not transferable between providers |

## Why a 1M model showed 258,400 tokens

Codex 0.147.0's unknown-model fallback has both context_window and
max_context_window set to 272,000, with a 95% effective window: 258,400.
Its config override is clamped to max_context_window. Thus setting only
model_context_window = 1000000 does not resolve an unknown Astra model.

Enable/repair and the watchdog generate model_catalog_json metadata from the
healthy selected Copilot model, including max_context_window. The catalog keeps
the installed Codex version's original fallback instruction template, cached from
the matching official source tag. Since 1.3.16, Windows uses per-request routing:
Astra is the default and explicit child-model selections are honored. Each catalog
entry uses its own backend limits and reasoning levels; global context overrides
are removed reversibly so they cannot shadow those entries. An optional manual
routing lock intentionally assigns its selected backend's limits to aliases.
Configuration and catalog selection remain reversible through the protected backup
and line-level fallback restoration. See [agent routing](AGENT-ROUTING.md).

For the Astra account checked on September 9, 2026 UTC:

- Total context: 1,000,000 tokens.
- Advertised maximum input: 872,000 tokens; maximum output: 128,000.
- Codex effective input display: 870,000 (integer 87% of the total).
- Automatic Codex compaction: 780,000, allowing room before the input ceiling.
- Relay history target and SDK background compaction: 90% of the prompt budget.
- SDK exhaustion buffer: 95%; explicit truncation=disabled disables both relay
  history compaction and SDK automatic compaction.
- Vision: one image per prompt, at most 3 MiB decoded / 4 MiB base64 on this route.

Since 1.3.22, bounded recent images can be packed into a labelled overview to
fit that one native slot. This does not increase the provider's actual limit
or guarantee OCR accuracy. Single in-budget images remain byte-identical;
new tool screenshots outrank older uploaded references during history rebuild.
See [hybrid setup](HYBRID-SETUP.md) for exact native multi-image routing and
separate credentials, billing, endpoint, and desktop voice limitations.

A live synthetic request measured 836,528 input tokens and recovered exact random
checkpoints from the beginning, middle, and end without compaction. This proves
large-context admission and retrieval, not perfect reasoning over arbitrary large
repositories. A fresh real Codex run separately verified the 870,000-token window.

## Reproduce

See [native tools](NATIVE-TOOLS.md) for opt-in, billing boundaries, restrictions,
and a live probe. Native tools require a separately installed, signed-in Codex
engine; they are not capabilities supplied by the GitHub Copilot SDK.

Run npm test and powershell -File proxy-config.test.ps1 for local regressions.
Run npm run probe:suite -- --model gpt-6-astra --long-context true for an isolated
SDK-backed suite. The long-context probe consumes Copilot allowance. The suite
starts and stops only its own loopback server and leaves a JSON report in runtime.
The separate probe:sdk-recovery and probe:session-churn commands test destructive
faults only in their own isolated SDK processes.

For a fresh Codex metadata check, run probe:codex-context with --catalog pointing
to runtime/codex-copilot-models.json. This uses an isolated Codex home and a harmless
marker request. Existing desktop tasks may retain old metadata until reopened;
restart Codex if reopening does not reload the selected catalog.

Sources: [official Codex configuration reference](https://developers.openai.com/codex/config-reference/),
[versioned model override implementation](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/models-manager/src/model_info.rs),
and authenticated Copilot SDK model capability responses. The cached Codex prompt
is upstream Apache-2.0 source; it is not part of the relay's MIT-authored code.
