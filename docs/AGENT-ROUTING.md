# Model and child-agent routing

Version 1.3.16 defaults to Astra xhigh and honors explicit model choices. Codex
creates child agents, loads their instructions, and runs tools. The relay creates
independent Copilot SDK sessions for their requests. Tools never execute in Copilot.

| Request | Upstream result |
| --- | --- |
| No model | Installation default (Astra for new installs) |
| Child inherits Astra | Astra, inherited effort |
| Explicit gpt-5.6-sol | Sol, requested supported effort (max supported on the tested account) |
| Explicit gpt-5.6-terra | Terra, requested supported effort |
| Astra Ultra/max | Astra xhigh, highest advertised effort; capped status recorded |
| Unknown model/effort | Explicit request error |

An already-open tool exchange retains its model and reasoning until it completes.
Changes apply to a fresh exchange. Existing threads explicitly selecting Sol/Terra
now run them; there is no reliable distinction between an old persisted selection
and a new explicit choice in the incoming Responses model field.

The old forced-Astra policy was a workaround for unknown-model fallback metadata.
The generated catalog now describes Astra directly and supplies each other model's
own limits, so that lock is no longer needed. A manual locked-default installation
still intentionally overrides requested models; inspect /health.routing to tell.

## Asking for models

Ask Codex to use Sol or Terra for a particular subtask when its tool exposes a
model override. Otherwise use a custom role configured for that model. A full-history
fork can require inheritance; use a fresh/limited-context child when the harness
requires it for model overrides. Model availability is account- and harness-specific.

Example config.toml additions (optional, not installed automatically):

~~~toml
[agents.sol_review]
description = "Code review with Sol"
config_file = "agents/sol_review.toml"

[agents.terra_scan]
description = "Quick read-only exploration with Terra"
config_file = "agents/terra_scan.toml"
~~~

agents/sol_review.toml:

~~~toml
model = "gpt-5.6-sol"
model_reasoning_effort = "max"
sandbox_mode = "read-only"
~~~

agents/terra_scan.toml:

~~~toml
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
~~~

Keep normal instructions/permissions in place. Changing model selection does not
change Codex approvals or third-party service access.

## Verified communication

Earlier bugs came from OpenAI-only encrypted schema hints and omitted agent_message
items. Those adapters remain covered: delegation text stays readable across the
local Codex boundary while provider-encrypted reasoning stays opaque. No manual
encoding or shared-file workaround is required for ordinary agent communication.

Run npm run probe:routing-agents against a per-request relay. The isolated suite
runs a real Astra parent with Sol max and Terra high children, collects both initial
replies and both followups, closes the children, and checks their session metadata
and selected upstream models. Run probe:parallel-tools to check two tool calls in
a single response. Independent-agent concurrency and parallel tools are distinct.

## Context and tool results

The catalog, rather than global overrides, controls context and compaction per model.
On the tested account Astra has 1M total/872K maximum input (870K effective in Codex),
while Sol/Terra advertise 1.05M total/922K input (913.5K effective). Limits can change;
read the live capabilities. The 64 KiB tool-result budget is deliberately bounded;
request focused ranges or read full local output artifacts for larger results.
Reopen the desktop task after a catalog change; restart the app if it still shows
stale metadata. The protected original config remains the Restore shortcut's baseline.

Sources: https://developers.openai.com/codex/multi-agent/ and authenticated Copilot
model metadata. This project cannot provide native OpenAI-hosted feature parity.
