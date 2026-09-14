# 1.3.29 - Independent Copilot instructions-field budget

## Failure and fix

A request fit the selected model's 872,000-token prompt budget but Copilot still
rejected its 1,106,142-character `instructions` string. The provider's reported
field maximum was 1,048,576 characters. HTTP admission, total model tokens and
this individual string limit are separate constraints.

`instruction-budget.mjs` checks the instruction envelope before SDK session
creation. Only when that envelope exceeds the cap, it replaces older exact
duplicates of complete standalone skill inventories with explicit numbered
pointers to the latest unchanged copy. An independent final guard includes
subsequently added image-reference annotations. UTF-16 length conservatively
bounds supplementary Unicode characters.

## Preservation and residual limits

- Comparison is exact text plus source role. Root, system and developer groups
  are not deduplicated against each other; no whitespace or fuzzy matching runs.
- Different catalog versions, intervening policies and ordinary repeated rules
  stay intact. The latest identical snapshot keeps its original position.
- Partial, quoted, nested and sibling-bearing skill blocks are ineligible.
  Image-resize notices are preserved at every occurrence.
- User/tool history, tool definitions and the original request are not modified
  by this pass. Existing token and image-history policies still apply separately.
- Unique instructions over the cap fail locally with HTTP 400, or a terminal
  `response.failed` / `invalid_prompt` in an established stream. The error explains
  how to continue from saved files or reduce instructions; no SDK session is
  allocated. No unique instruction is truncated or demoted into user text.
- `/health` exposes `reliability.maxInstructionsChars`. Context diagnostics
  record the original length, duplicate count, characters saved and field limit.
- No Codex binary, authentication, routing policy, provider fallback, native
  image settings or protected restoration backup changes are part of this fix.

## Verification

All 193 Node tests pass, including 13 focused instruction-budget regressions.
Six Windows configuration/restoration/Remote/backup/dead-worker fixtures pass.
Syntax checks pass for 82 root JavaScript modules and 22 PowerShell scripts.

An instruction-only reconstruction of a real long-running task shrank from
1,151,310 to 657,981 characters by replacing six exact repeated catalogs.
All 22 distinct instruction texts survived. This reconstruction is not the exact
failed request; it ran locally without sending private task history to a model.

An isolated real Astra probe accepted a synthetic 1,137,278-character envelope
after reducing 43 repeated catalogs to 37,123 characters. Four unique instruction
codewords across separated rules survived into an outer tool call, and its tool
result continued to the expected final reply. A separate unique oversized input
returned a terminal invalid-prompt error without allocating an SDK session.
Run this bounded live check with:

```powershell
node probe-suite.mjs --only probe-instructions.mjs
```

The fixture uses Copilot inference, not OpenAI image generation. It does not
certify unlimited history, perfect instruction following or an iPhone round trip.

## Activation

Run Start/Repair after updating, refreshing the managed watchdog. Verify that
`http://127.0.0.1:4144/health` actually reports version `1.3.29` and the new field
limit. Promotion must remain deferred while active exchanges exist. A source
version bump, successful push or dashboard refresh does not activate the fix.
