# Claude image history: v1.3.75 / adapter 0.1.21

This fixes a relay image-translation defect, not every Claude/provider feature.
No client binary, account, default model, browser profile, or OpenAI helper changes
are required. Codex's separate Responses image preparation is unchanged.

## What changed

Previously the Claude adapter ran complete history through the generic image
packer. Deduplication, overviews and packing notes changed native blocks. A broad
signed-history guard then rejected even tiny duplicate images. Continuations
could also move screenshot pixels outside their original tool-result blocks.

Claude now sends the original images through the session-bound native request
handler, in their original message/tool-result positions. No deduplication,
resizing, re-encoding, signature removal or overview insertion takes place.
SDK bootstrap input establishes tool ownership; it does not send a second copy
of those images through the flattened attachment path. The SDK continues to own
authentication, destination, model selection, billing and tool execution gates.

Malformed/unsupported images are rejected before consuming pending tools. A
corrected request can continue those same tools. Model/owner/signature/prefix
checks remain enforced. Changed client settings can rebuild the native history
without rerunning already-completed client tools.

The adapter checks raster/base64 headers, model vision/media-type support and
the advertised per-image byte cap (3 MiB if absent). Local limits are 100 image
occurrences and 32 MiB of aggregate base64, within the existing HTTP body cap.
These are safety bounds, not an entitlement or guaranteed provider capacity.
The SDK catalog's attachment count is not used to rewrite a complete native
transcript; the native endpoint remains authoritative about its actual
image-count/context limits. Opus 5.5 accepted two original images in the live
probe although the catalog advertises one prompt image. That observation is
not a guarantee for every model, request size or future provider release.

If an original historical image itself exceeds the byte limit, it is not silently
shrunk. Keep the original chat and start a new one with a text handoff and smaller
source images. Old chats whose model-side history was already packed may still
need a fresh conversation; this release cannot reconstruct lost native prefixes.

## Browser screenshots: the important tool distinction

With the pinned `@playwright/mcp@0.0.83`:

- Call `browser_take_screenshot` **without `filename`** to receive image pixels
  inline. Playwright still saves the image under a generated filename.
- Supplying `filename` saves the file but returns no inline image. Claude must
  use its client-owned Read/image-viewing tool on that file to see the pixels.
- Use `browser_snapshot`/`browser_find` for interaction targets before clicking.
  File paths and accessibility snapshots are not proof of visual inspection.

The relay never fetches arbitrary local files or URLs mentioned in tool text.
The client must return a real embedded image; no browser permissions are bypassed.
Logged-in browser extension approval and GUI availability remain client-owned.
See [browser setup](CLAUDE-BROWSER.md).

## Verification on October 10, 2026

| Check | Evidence |
| --- | --- |
| Original regression | Three tests failed before the fix: signed duplicate replay, screenshot block movement, and malformed-image continuation admission |
| Maintained suite | 486 tests: 485 passed, one skipped, zero failed; `git diff --check` passed |
| Signed replay, duplicates, accumulated images | Local fixtures preserve original blocks, including 13 image occurrences |
| Changed-settings rebuild | Local signed/screenshot fixture retains history and does not reexecute client tools |
| Stock Claude Code 2.1.296 | Scripted local provider: actual Read -> Read -> Read -> final; three unchanged images, including a duplicate, with signed empty thinking blocks |
| Actual Copilot image reading | Opus 5.5 correctly read both random image codes from one native two-image request |
| Actual browser and vision | Stock Claude -> local Playwright/Edge -> Copilot Opus 5.5: navigate, snapshot, click, two inline screenshots and correct reading of a random canvas-only code; four completed requests, four transport attempts, zero transport errors and permission denials |
| Restoration | Basic restore and Remote/account-policy fixtures pass; protected live auth, Claude key, TOML backup and native-image configuration hashes unchanged across Repair |

The successful browser run reported 6.2454 SDK AI credits. All explicit live
probes in this batch reported **20.67592 SDK AI credits** in total, not USD and
not the cost of the surrounding coding session. No OpenAI inference was used
by these probes. An earlier browser attempt saved screenshots with explicit
filenames and therefore received no pixels; its six requests completed, but
its visual-reading acceptance check failed. The corrected inline form passed.

Live cryptographic signed-history acceptance is **not certified** by this batch:
the simple direct image probe emitted no thinking block; an adjusted reasoning
probe reached its 2,048-output-token cap. The successful browser run also emitted
no signed blocks. Signed preservation is verified by local fixtures, not a claim
that those live runs tested signatures. Neither probe failure triggered automatic
provider fallback or extra transport retries.

## Reproduce without spending

```powershell
npm test
node claude-gateway/probe-stock-local.mjs --local --images
```

Explicit paid verification, only when authorized:

```powershell
node claude-gateway/probe.mjs --live --case=browser
node claude-gateway/probe-native-images.mjs --live
```

The image probe sends at most two synthetic-image requests; it reports whether
upstream actually emitted signed thinking. The browser probe has an eight-turn
client limit and uses an isolated headless profile, not your logged-in browser.

## Boundaries and deployment

This does not implement Anthropic hosted search/advisor tools, exact token
counting, all experimental request fields, native voice or Remote Control.
Unsupported requests still fail explicitly. Client browser/connector tools
continue to run in the client; they are not hosted by Copilot.

The separate GUI history-prefix 409 is not declared fixed. No prefix, owner or
signature checks were relaxed to make a test green. The installed browser setup
is configured, but user-approved extension access and full Desktop GUI acceptance
remain unverified. Model-specific structured outputs and tool controls stay gated.

The image fix is included in `1.3.75` and the deployed `1.3.76`. Verify the live
`/health.version` matches the installed package. Normal Start/Repair still defers
while active exchanges remain. In `1.3.76`, explicitly clicking **Stop & Restore**
cancels active relay work, restores Codex, and lets the next Start load new local
code; see [the two-control contract](TWO-CONTROLS.md). Local pre-edit copies are in
the ignored runtime baseline directory; restoring code also requires the normal
versioned/deferred deployment process, not a live file overwrite.
