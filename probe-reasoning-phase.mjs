const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const marker = "REASONING_PHASE_RELAY_OK";
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: true,
    reasoning: { effort: "high", summary: "detailed", context: "all_turns" },
    text: { format: { type: "text" }, verbosity: "low" },
    parallel_tool_calls: false,
    store: false,
    include: ["reasoning.encrypted_content"],
    input: [{
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `Check that 19 * 23 equals 437, then reply with exactly ${marker}.`,
      }],
    }],
  }),
});

if (!response.ok || !response.body) {
  throw new Error(`Reasoning/phase probe returned HTTP ${response.status}.`);
}

const raw = await response.text();
const events = raw
  .split(/\r?\n\r?\n/)
  .map((block) => block.split(/\r?\n/).find((line) => line.startsWith("data: ")))
  .filter(Boolean)
  .map((line) => JSON.parse(line.slice(6)));
const terminal = events.findLast((event) => event.type === "response.completed");
const output = terminal?.response?.output ?? [];
const finalText = output
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const reasoning = output.filter((item) => item.type === "reasoning");
const phases = output
  .filter((item) => item.type === "message" && item.phase)
  .map((item) => item.phase);
const eventTypes = events.map((event) => event.type);
const reasoningTokens = Number(
  terminal?.response?.usage?.output_tokens_details?.reasoning_tokens ?? 0,
);
const readableReasoningEmitted = reasoning.length > 0
  && eventTypes.includes("response.reasoning_summary_text.delta")
  && eventTypes.includes("response.reasoning_summary_text.done");
const report = {
  ok: finalText === marker
    && phases.includes("final_answer"),
  model,
  finalText,
  reasoningRequested: { effort: "high", summary: "detailed" },
  reasoningTokens,
  readableReasoningEmitted,
  reasoningTransport: readableReasoningEmitted
    ? "responses_reasoning_summary_events"
    : "provider_did_not_emit_readable_summary",
  reasoningItems: reasoning.length,
  reasoningSummaryChars: reasoning.reduce((total, item) =>
    total + (item.summary ?? []).reduce((sum, part) => sum + String(part.text ?? "").length, 0), 0),
  phases,
  eventTypes,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
