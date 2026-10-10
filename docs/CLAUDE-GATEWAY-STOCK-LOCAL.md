# Local stock-client continuation proof

October 7, 2026; source 1.3.53 / Claude adapter 0.1.12. Isolated review candidate.
Existing Codex relay, dashboard, history and global client configs are preserved.

## Reproduction and contract

An unmodified Linux Claude Code 2.1.292 completed its first Read but then reported
a mid-response server error. Its actual requests appended a system message after
the result-bearing user message. The gateway inspected only the final message,
missed the result and created a fresh SDK turn. The scripted provider repeated
its first tool ID and the gateway correctly rejected that duplicate. The client
reached its six-turn limit instead of writing the result file.

Objective: continue the existing owned tool turn when stock system messages
follow its result-bearing user message, while retaining every native message,
prior-prefix integrity, controls, result uniqueness, context admission and
client permissions. Do not patch stock clients, rewrite system content,
relax ownership, use provider fallbacks or modify the production Codex service.

Three regressions failed before the change: result lookup returned no results,
a valid trailing-system roundtrip failed, and a changed-prefix request attempted
a new turn instead of receiving the required history-conflict rejection.

## Minimal runtime change

- `protocol.mjs` locates the final non-system message. Results are considered
  only if it is a user message; lookup never crosses another user/assistant turn.
- `server.mjs` checks the unchanged history before that result message, admits
  the complete native suffix, and continues the original pending SDK tools once.
  The suffix is retained in the request hook, cache refresh and image traversal.
- System text is not relabelled as a tool result or executed by the gateway.
  Native tool names are mapped as before. SDK auth/model/destination and
  stock-client permission defaults are unchanged.

This documents an observed stock-client dialect, not arbitrary public Anthropic
system-role support or successful provider inference for every such request.

## Actual checks and scope

`claude-gateway/probe-stock-local.mjs --local` uses the real HTTP gateway and
`ClaudeRequestHandler`, but a scripted loopback provider and fixture SDK events.
It never constructs a Copilot client. The actual stock Claude executable runs
Read(input.txt), Write(answer.txt), Read(answer.txt), then returns a fixed marker.

The probe creates a separate workspace and Claude state. It allows only Read and
Write, uses `acceptEdits` without permission bypass, disables updates, and limits
turns/time/output. No global configuration or account credentials are copied.
Reports retain metadata, message/block shapes and SHA-256 history hashes, not
full request bodies. The local generated client transcript is kept privately
under the ignored runtime directory, separately from source archives.

Both actual stock clients passed:

| Environment | Actual file output | Gateway result | Real SDK inference |
|---|---|---|---|
| Windows / Node 24.13.0 / Claude 2.1.292 | `SUM=42\n` | 4 completed, 0 failed | 0 receipts; not authenticated |
| Ubuntu 24.04 x64 WSL / Node 22.22.0 / Claude 2.1.292 | `SUM=42\n` | 4 completed, 0 failed | 0 receipts; not authenticated |

Six local tests cover explicit fixture opt-in, trailing-system lookup boundaries,
exact native history, prefix/owner/duplicate rejection with valid retry, inclusion
of trailing system text in context admission before result consumption, and a
standard tool roundtrip. The protected completed receipt remains unchanged.
Windows root and isolated suites pass 335/335; Linux passes 333/335 with two
Windows-only skips and no failures. Isolated dependency audits are clean.
Linux stock settings-routing/rejection/clean-endpoint proof also passed.

## Remaining work and rollback

This proves stock file tools and local protocol wiring, not Linux Copilot login,
the real SDK worker, paid inference, provider cache usage, sustained load, active
outage recovery, every Claude feature or Linux launcher cleanup. The latest full
paid stock-client regression remains Windows adapter 0.1.7. macOS is untested.
The paused active-outage method choice and provider/distribution gate remain open.

The opt-in wrapper still affects only its child environment. Exit it and use
plain `claude` in a fresh terminal to retain normal routing. Recover the previous
verified 0.1.11 source archive into a separate checkout for source rollback;
never overwrite active or dirty work. No production promotion or push occurred.
