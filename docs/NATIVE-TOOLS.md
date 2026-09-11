# Optional native images (OpenAI allowance)

The native adapter is **images-only**. Native OpenAI web search has been removed,
including legacy opt-ins. Ordinary reasoning and screenshot analysis remain on
GitHub Copilot; the Codex harness still owns browser and connector tools.

## Enable / disable

Use an existing, signed-in **stock Codex 0.153.4 or newer** installation:

```powershell
.\Enable-Codex-NativeTools.ps1
# To disable native image generation:
.\Enable-Codex-NativeTools.ps1 -Disable
```

The helper discovers the installed executable or accepts an explicit
`-CodexPath`. It never replaces the executable, reads login tokens or grants
an entitlement. Settings are local in ignored `runtime/native-tools.json`.
`imageEnabled` is independent of the removed `searchEnabled` flag. Repair
preserves the protected original-config backup and defers updates while busy.

## Where usage goes

A request to `/v1/images/generations` or `/v1/images/edits` launches an isolated
native OpenAI Codex helper turn that asks GPT Image 2 to generate exactly one
image. Both the helper turn and image service use OpenAI allowance. It is not
free local image generation, and helper launches are not underlying API-call
counts. Plugins, shell, subagents and hosted search are disabled in the helper.

The dashboard exposes images-enabled/search-removed state and keeps historical
search records intact. Available counters measure helper-turn input/output;
image-generation tokens may be missing. Missing is unknown, not zero. Old quota
signals are historical events, not a current account balance. No automatic
provider fallback or image retry is performed.

## Supported options

- Model: `gpt-image-2`; one image per request (`n=1`).
- Non-empty prompt up to 32,000 characters.
- Quality, size and background: `auto` only (or omit them).
- Edits: one to five embedded PNG/JPEG/WebP data-URL references, up to 32 MiB each.
- No remote/local URL fetching, masks, image batches or arbitrary output paths.
- The helper reads only its newly generated PNG, not a model-supplied path.
- Native app voice is unsupported; see [voice limitations](NATIVE-VOICE.md).

The optional [public Platform gateway](HYBRID-SETUP.md) is separate, disabled by
default, requires separate credentials and explicit routing, and has its own
billing. Enabling native images does not enable that gateway.

## Screenshot / image history is a different path

The relay prepares image inputs locally for Copilot. Exact byte duplicates share
one source with an explicit reference mapping. Every distinct image is retained
within the bounded collection. PNG is tried first; JPEG at bounded quality is
used only if supported, before reducing resolution. The note discloses loss and
panel mapping. Single fitting images retain their exact original bytes.

Packing never regenerates an image or edits source files. Copilot's advertised
limits remain enforced. For tiny text or exact comparisons, request an individual
image or crop; a contact sheet cannot preserve arbitrary detail from every page.

## Local verification (no OpenAI inference)

```powershell
node --test native-codex-tools.test.mjs vision-compatibility.test.mjs
powershell -NoProfile -File .\remote-compatibility.test.ps1
```

The old paid native-search probes no longer apply and are excluded from release
verification. Real image-generation tests consume allowance and need explicit
approval. Never regenerate existing assets just to test transport.
