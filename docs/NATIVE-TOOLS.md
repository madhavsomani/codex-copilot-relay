# Optional native search and images

For full hosted tool protocols, advanced search/image options, and Realtime,
see [hybrid setup](HYBRID-SETUP.md). Version 1.3.22 adds a separately authenticated
public OpenAI API path. The restrictions below describe only the original
subscription-based Codex helper, not that optional public transport.

The conversation continues through GitHub Copilot. When explicitly enabled, the
relay uses the installed native Codex engine for web search and GPT Image 2.
This is a hybrid adapter, not Copilot-hosted search/image generation. It consumes
the native account's OpenAI/ChatGPT allowance in addition to Copilot allowance.
Native helper usage is logged separately and is excluded from dashboard Copilot
credits and dollar estimates. Each invocation includes a separate native model
turn, so it adds latency and native input/output usage.

## Enable

Install current Codex desktop/CLI and sign in through its normal login flow.
Codex 0.153.4 is the tested minimum. Then run:

    powershell -NoProfile -File .\Enable-Codex-NativeTools.ps1

Pass -CodexPath with the absolute executable path when automatic desktop discovery
is unavailable. The script writes only ignored runtime/native-tools.json and
uses the normal Repair path. Active relay exchanges are preserved. Native search
is advertised only when health confirms the adapter is enabled. Reopen the task
after config/catalog changes so Codex loads the live search declaration.

To opt out:

    powershell -NoProfile -File .\Enable-Codex-NativeTools.ps1 -Disable

Running v1.3.19+ reads the setting on each request. A helper already running may
finish; new invocations fail explicitly after disabling. Restore Normal Codex
still restores the protected prior configuration, which may be a different
custom provider if that was the configuration backed up originally.

## Execution and limits

- Search: supports live web_search/web_search_preview, default medium context,
  and an explicit hosted search tool choice. Real native search actions are
  emitted as Responses web_search_call items; the helper returns explicit source
  URLs for the Copilot answer. OpenAI's opaque citation IDs do not transfer into
  Copilot's context, so native citation-marker identity is not preserved.
- Domain filters, requested user location, cached-only search, nondefault search
  context sizes and max_tool_calls are rejected rather than silently ignored.
- Images: the built-in image_gen tool calls /v1/images/generations or
  /v1/images/edits. Both are implemented for gpt-image-2, one result, automatic
  quality/size/background. Edits accept 1-5 PNG/JPEG/WebP data-URL references.
  Multipart uploads, remote reference URLs, masks and explicit output settings
  are not supported by this subscription-based helper. The gateway routes
  neither unsupported requests nor quota failures automatically. Select the
  explicit `/v1/openai/...` endpoint or `openai/<model>` for public API work.
- At most two native helpers run concurrently. Each has a ten-minute deadline,
  a bounded JSONL output buffer, and cancellation when its caller disconnects.
  Search is bounded to five observed native web operations.
- Native helpers run ephemeral, with user config ignored, a read-only shell
  sandbox, shell tools disabled, apps disabled and subagents disabled. They
  receive the requested query or image prompt/references, not the parent chat.
  Native Codex still supplies its own system and installed skill context.
- The relay never opens the authentication store or copies/refreshes account
  tokens. Native Codex handles authentication. API-key and endpoint override
  environment variables are excluded, preventing recursion back into the relay.
- For generated images, the relay reads only the new native thread's PNG output,
  verifies its path/type/size, and returns it to the original Codex image tool.
  Temporary edit references are removed after the request. Native generated
  artifacts remain in the account's Codex generated_images directory.

## Verification

    node --test native-codex-tools.test.mjs
    node probe-native-tools.mjs --image

The live probe starts its own loopback relay on a random port, verifies a real
search/source URL and a generated PNG, and writes evidence under ignored runtime.
It consumes both Copilot and native OpenAI/ChatGPT allowance. Omit --image for a
search-only probe. Production is not restarted by this probe.

Relevant upstream implementation:
[image tool](https://github.com/openai/codex/blob/196964ef10db326047c3e71fc568693cbd7c58a8/codex-rs/ext/image-generation/src/tool.rs),
[image provider selection](https://github.com/openai/codex/blob/196964ef10db326047c3e71fc568693cbd7c58a8/codex-rs/ext/image-generation/src/backend.rs),
[official configuration reference](https://developers.openai.com/codex/config-reference/).
