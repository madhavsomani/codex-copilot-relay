# 1.3.23: visible providers, no automatic fallback

- Ordinary model work remains GitHub Copilot. Unsupported tools, advanced
  search options, and structured-output requests no longer automatically move
  the whole conversation to OpenAI. Explicit OpenAI requests and their existing
  continuations remain available; basic native search/images keep their own path.
- The Control Room adds three provider cards and a filterable metadata ledger.
  Select a call for model, feature, submitted state, outcome, parent call,
  input/output tokens and reported cached/reasoning/audio/image subsets.
- OpenAI telemetry is isolated from existing Copilot mileage/AI credits. Totals
  persist across restarts with 1,000 retained metadata rows and an 8 MiB cap.
  Missing usage stays unknown. The ledger imports retained legacy native logs
  once, clearly labelled; it cannot recover logs already rotated away.
- Streaming parsing extracts usage after large image payloads without retaining
  those payloads. Realtime observes usage and rate-limit events. Native images
  may expose only helper-model tokens; WebRTC media outside the relay remains
  unmetered. These counters are not account balances or invoices.
- Native OpenAI search failures return structured feature-error data to Copilot,
  allowing independent work to continue without automatic retries or rerouting.
  An unavailable image/voice feature still requires its own service allowance.
  App-level account gates outside the relay cannot be overridden.

Verification: 149 local tests passed, covering isolation, persisted usage, duplicate Realtime
events, large JSON/SSE payloads, missing token fields and history import. A live
Copilot probe continued the same exchange after a simulated OpenAI quota error,
then completed a new request. Desktop/tablet/phone UI checks covered overflow,
provider filtering and browser console errors. Public API usage tests use mock
upstreams; no public API key or new paid image generation is required. A real
native search recorded 63,138 input, 225 output and 36,224 cached-input tokens
against its parent Copilot request, in a separate provider ledger.

Setup and billing: [HYBRID-SETUP.md](HYBRID-SETUP.md). Protocol source:
[OpenAI Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events).

Upgrade through Repair; active exchanges defer promotion. Verify the running
`/health.version` before assuming the on-disk version is live.
