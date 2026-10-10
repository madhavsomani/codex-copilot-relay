# Mixed client-tool continuation contract

Later adapter 0.1.15 supports validated setting-change rebuilds. The original
same-signature continuation below is still used when settings do not change.
See [the combined gateway guide](UNIFIED-GATEWAY.md#what-the-409-repair-does) for
the new guards, receipt fields, evidence and remaining GUI limitation.

October 7, 2026; source 1.3.50 / Claude adapter 0.1.9. Local isolated candidate.
The original Codex relay/dashboard/history are not modified or replaced.

## Problem and official protocol

The preview rejected any non-tool-result content alongside outstanding client
tool results. A legitimate user follow-up could therefore receive HTTP 400
instead of reaching the model. Conversely, result-order errors were admitted.
Two regression tests reproduced both defects before the runtime fix.

The official [Handle tool calls guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
requires result blocks first in the user message and permits added text after
them when the assistant turn contains only client tools. Unresolved server tools
have stricter rules. This gateway still rejects hosted tools; their restrictions
are not bypassed by this change. Previous corresponding assistant/tool history
must remain unchanged. [Thinking preservation](https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks)
still applies; opaque signatures are not generated or rewritten.

```json
{
  "role": "user",
  "content": [
    {"type": "tool_result", "tool_use_id": "toolu_a", "content": "first result"},
    {"type": "tool_result", "tool_use_id": "toolu_b", "content": "second result", "is_error": true},
    {"type": "text", "text": "Explain the failed result, then stop."}
  ]
}
```

This is the last user message in the full Messages request, not a replacement
for the required assistant/tool-call history. Every outstanding result must be
provided exactly once. A permitted embedded image can also follow the results,
under the existing raster-image admission/packing rules. Text/images before a
result or between results reject; unsupported block types still reject explicitly.

## What changed

- `protocol.mjs` validates results-first order in live and saved Messages history.
  It also leaves plain-string tool-result content unchanged when traversing a new
  image elsewhere in that message. Native image packing behavior is otherwise unchanged.
- `claude-gateway/server.mjs` accepts the validated suffix on an owned pending
  client-tool turn. The full native last-user message is retained by `continue()`
  and passed to the existing documented SDK request hook.
- Only `tool_result` blocks resolve SDK pending tools. User instructions are not
  relabelled as tool output or executed by the relay. Client permissions remain
  in stock Claude. No model, destination, SDK auth or fallback rule changes.
- Both package manifests and the adapter version were incremented. The runtime
  remains isolated; source edits are not a live Codex deployment.

## Evidence and exact scope

Five new adapter tests pass, for a total of 325 repository tests:

1. Streaming/nonstreaming continuations retain the new user text/cache marker,
   unchanged signed prefix and actual tool-result error flag; one SDK session and
   exactly two pending-result deliveries. Previous completed ledger receipt stays
   unchanged. Fixture usage is not real model usage.
2. Results-first ordering is enforced in general validation, including saved history.
3. Invalid order, missing/duplicate results, modified signature and wrong agent
   ownership reject without consuming any pending result. A subsequent valid
   continuation succeeds on the original session. Ledger rows retain metadata
   only, not the test's private follow-up text.
4. A real `ClaudeRequestHandler.sendRequest` through a loopback mock native
   transport retains roles, original thinking/signature, nested/suffix image data,
   user text, cache marker and SDK credential. Only owned tool names are mapped;
   the flattened SDK bootstrap is not substituted for native history.
5. A valid tiny fixture image survives gateway admission outside the tool-result
   blocks. Its bytes and signed prefix remain unchanged. It is not sent as a
   binary tool result. This test caught/fixed plain-string-to-array rewriting in
   native image traversal; unsupported/nonfitting image limits still apply.

The image tests use artificial/local fixture pixels, not personal files. The
request-hook transport proof contains fixture-native image data and demonstrates
mapping only; the separate gateway image-admission test uses a valid raster.
There was no new paid inference or stock-client steering proof. Do not describe
these tests as live Copilot behavior, every-Claude-feature parity or a twelve-hour
workload certification. The earlier full 0.1.7 stock-client evidence stays separate.

## Remaining acceptance and rollback

The later **0.1.12** candidate also handles observed stock-client system reminders
after the result-bearing user message. Results-first ordering still applies
within that user message. The entire trailing system suffix stays native and
participates in context admission; the immutable prefix ends before the result
message, not before the final system reminder. Lookup does not cross a later
user/assistant turn. This is a stock-client dialect observation, not a claim
that the public Anthropic Messages specification permits arbitrary system-role
history. See [the local-stock proof and limits](CLAUDE-GATEWAY-STOCK-LOCAL.md).

The whole gateway goal remains active. Hosted/beta semantics, active-outage and
sustained-workload acceptance, macOS/Linux stock-client proof, unified opt-in
installation/history and provider/distribution clarification remain open. The
outage injection decision from the preceding handoff is still paused, unchanged.

This 0.1.9 cycle also discovered that live continuations did not rerun the
fresh-session context-token admission check. The follow-up **0.1.10** candidate
fixes that with a shared estimate and pending-state-preserving rejection; see
[the separate context-admission contract](CLAUDE-GATEWAY-CONTEXT.md). It is not
exact Anthropic counting or proof of twelve-hour workload reliability.

Exit the opt-in wrapper to close its gateway; use plain `claude` in a fresh terminal
for normal configuration. No saved client config or stock binary was changed.
For source rollback, recover the preserved 0.1.8 archive into a separate checkout,
not over active or dirty work. Keep ledger history and exclusive ownership intact.
