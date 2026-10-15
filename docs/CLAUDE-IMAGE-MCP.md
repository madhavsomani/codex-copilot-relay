# Native Codex image generation in Claude Code (MCP)

Ask for images directly in the Claude desktop **Code** tab (or the Claude Code
CLI). A small local MCP adapter, `claude-image-mcp.mjs`, exposes two tools and
forwards each call to the relay's existing native image endpoints. Those run
your own signed-in **stock Codex** app (`native-codex-tools.mjs`).

> **Billing:** native images use your separate **OpenAI/ChatGPT image
> allowance** through Codex. They are **not** paid with GitHub Copilot credits,
> and they are not counted in the relay's Copilot usage.

## How a request flows

```
Claude Code ──stdio MCP──► claude-image-mcp.mjs ──HTTP, loopback only──► relay 127.0.0.1:4144
                                                   /v1/images/generations or /v1/images/edits
                                                                  │
                                                                  ▼
                                    stock Codex (your ChatGPT sign-in) ──► gpt-image-2
```

- The adapter talks to the relay over stdio only and opens no network port.
- It refuses any relay URL that is not `http://127.0.0.1`, `localhost` or `[::1]`.
- The relay endpoints, the native Codex contract and their limits are reused
  unchanged. The removed `codex mcp-server` command is not used.

## Tools

| Tool | Input | Relay endpoint |
|---|---|---|
| `generate_image` | `prompt` (1–32,000 chars); optional `background` (`auto` or `opaque`) and `filename` | `/v1/images/generations` |
| `edit_image` | `prompt`, `reference_paths` (1–5 absolute local PNG/JPEG/WebP files, each ≤ 20 MB); optional `background`, `filename` | `/v1/images/edits` |

Each successful call returns:
- **A full-resolution PNG**, saved to `%USERPROFILE%\Pictures\Codex Images`
  (or `RELAY_IMAGES_DIR`). Files get a unique name and are never overwritten.
- **Its path and dimensions**, as text and as `structuredContent`.
- **A bounded preview** (JPEG, at most 1024 px on the long edge and 1 MB), so
  the model can look at the result within vision limits. Use the saved PNG for
  the real image.

Native Codex also keeps its own copy under `~\.codex\generated_images\`.

## Safety behaviour

- **Approval on every generation.** Before calling the relay, the adapter asks
  for confirmation with an MCP form prompt (*elicitation*). The prompt shows the
  wording, the billing notice and the names of any reference files.
  - It appears even in bypass-permissions mode.
  - Declining, or a client that can't show the prompt, means nothing is sent
    and nothing is charged.
  - Optional: `RELAY_IMAGES_APPROVAL=permission` relies on Claude Code's own
    per-tool permission prompt instead. That prompt does **not** appear in
    bypass-permissions mode.
- **Reference images.**
  - Only regular local files the model names explicitly are read: no network
    (UNC) paths, folders or links.
  - File contents are checked to be PNG, JPEG or WebP, whatever the extension.
  - They are sent to OpenAI through your Codex app. Originals are never modified.
- **One request per call.** No retries, no other model, no fallback to the paid
  OpenAI API or to Copilot.
- **Errors explained, not hidden:**
  - images disabled
  - Codex not signed in or image limit used up
  - both native slots busy
  - relay not running
  - invalid result
- **Time limit and cancellation.**
  - The adapter waits up to 11 minutes (`RELAY_IMAGES_TIMEOUT_MS`), just beyond
    the relay's own 10-minute native limit.
  - It sends progress updates every 15 s when the client asks for them.
  - Cancelling in Claude Code aborts the HTTP request, and the relay then stops
    the native Codex job.
- **No secrets.**
  - The adapter never logs prompts, image bytes or file contents.
  - The desktop registration has no credentials, token or environment block.
  - In managed-desktop mode the relay's local routes need no bearer. If you run
    the relay with `BRIDGE_AUTH_TOKEN`, set `RELAY_IMAGES_BEARER` in the
    adapter's environment; it is sent only to the loopback relay.

## Setup

1. **Turn on native images** (once). Run `Enable-Codex-NativeTools.ps1`.
   - Requires stock Codex 0.153.4 or newer, signed in.
   - Check with `http://127.0.0.1:4144/health` → `nativeTools.imageEnabled: true`.
2. **Register the adapter** for the third-party Claude desktop profile:

   ```
   node claude-image-mcp-setup.mjs apply
   ```

   - This adds one `relay_images` entry to
     `%LOCALAPPDATA%\Claude-3p\claude_desktop_config.json`.
   - Every other MCP server and setting is preserved, and it refuses to
     overwrite an existing `relay_images` entry.
   - For the standard profile, add `--profile=standard`.
3. **Restart Claude desktop yourself** when convenient. Running chats keep the
   tools they started with.
4. **Use it.** In a new Code chat, ask for an image, then approve the
   confirmation prompt.

Check or undo the registration:

```
node claude-image-mcp-setup.mjs status
node claude-image-mcp-setup.mjs restore
```

`restore` removes only the entry this script added, and only if it is unchanged.

## Model note

Earlier relay versions numbered their internal tool names by position, and in
one test Haiku 5.5 mixed up `edit_image` and `generate_image`. Since 1.3.89 the
internal names follow the tool's own name only. The same Haiku test now calls
`generate_image` correctly.

## Verification status

| Check | Status |
|---|---|
| Unit tests (`claude-image-mcp.test.mjs`): mock relay, synthetic images | Passing |
| Stock Claude Code CLI 2.1.295 → adapter → **mock** relay → saved PNG and preview seen by Opus 5.5 | Verified |
| Default approval with a client that can't answer: declined, relay never called | Verified |
| Claude Code advertises `elicitation: {form, url}` to MCP servers | Verified |
| Registered in the third-party desktop profile | Configured; needs a Claude restart |
| Approval dialog in the desktop GUI | Not yet observed |
| **Live generation:** adapter (stdio) → live relay 1.3.87 → native Codex → ChatGPT `gpt-image-2` | **Verified 2026-10-14:** one 1536x1024 PNG in 29 s, saved and previewed. The relay logged `native_tool.started/completed` (`openai-codex`). |
| Same, started from a desktop GUI chat, including the approval dialog | Not yet observed |
