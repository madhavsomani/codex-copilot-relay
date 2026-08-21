const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const delayMs = Math.max(0, Number.parseInt(args.get("--delay-ms") ?? "35000", 10));
const marker = "DELAYED_OUTER_TOOL_OK";
const tool = {
  type: "function",
  name: "relay_echo",
  description: "Return a deterministic result after the harness delays its response.",
  parameters: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};
const startedAt = Date.now();
const firstResponse = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    reasoning: { effort: "low" },
    tools: [tool],
    input: [{
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `Call relay_echo once with value READY. After its delayed result, reply exactly ${marker}.`,
      }],
    }],
  }),
});
const firstBody = await firstResponse.json();
if (!firstResponse.ok || firstBody.error) {
  throw new Error(firstBody.error?.message ?? `Initial delayed-tool request returned HTTP ${firstResponse.status}.`);
}
const call = (firstBody.output ?? []).find((item) => item.type === "function_call");
if (!call) throw new Error("Delayed-tool probe did not receive a tool call.");

await new Promise((resolve) => setTimeout(resolve, delayMs));

const continuationResponse = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    previous_response_id: firstBody.id,
    input: [{
      type: "function_call_output",
      call_id: call.call_id,
      success: true,
      output: "READY",
    }],
  }),
});
const continuationBody = await continuationResponse.json();
const finalText = (continuationBody.output ?? [])
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const normalizedFinalText = finalText.trim().replace(/[.!]+$/, "");
const report = {
  ok: continuationResponse.ok && normalizedFinalText === marker,
  configuredDelayMs: delayMs,
  wallMs: Date.now() - startedAt,
  continuationStatus: continuationResponse.status,
  finalText,
  normalizedFinalText,
  error: continuationBody.error?.message ?? null,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
