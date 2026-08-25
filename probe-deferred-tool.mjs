const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const finalMarker = "DEFERRED_TOOL_RELAY_OK";
const tools = [
  {
    type: "function",
    name: "deferred_compatibility_check",
    description: "Run the requested deferred-tool compatibility check.",
    defer_loading: true,
    strict: true,
    parameters: {
      type: "object",
      properties: { marker: { type: "string", enum: [finalMarker] } },
      required: ["marker"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "unrelated_deferred_tool",
    description: "A distractor used only to prove lazy tool search can select the requested tool.",
    defer_loading: true,
    strict: true,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

const initialResponse = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    reasoning: { effort: "low", summary: "auto" },
    tools,
    input: [{
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `Find and call deferred_compatibility_check with marker ${finalMarker}.`,
      }],
    }],
  }),
});
const initialBody = await initialResponse.json();
if (!initialResponse.ok || initialBody.error) {
  throw new Error(initialBody.error?.message
    ?? `Deferred-tool probe returned HTTP ${initialResponse.status}.`);
}
const call = (initialBody.output ?? []).find((item) =>
  item.type === "function_call" && item.name === "deferred_compatibility_check");
if (!call) throw new Error("Copilot did not discover the requested deferred outer tool.");

const continuationResponse = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    previous_response_id: initialBody.id,
    input: [{
      type: "function_call_output",
      call_id: call.call_id,
      success: true,
      output: `The lazy tool executed. Reply with exactly ${finalMarker}.`,
    }],
  }),
});
const continuationBody = await continuationResponse.json();
if (!continuationResponse.ok || continuationBody.error) {
  throw new Error(continuationBody.error?.message
    ?? `Deferred-tool continuation returned HTTP ${continuationResponse.status}.`);
}
const finalText = (continuationBody.output ?? [])
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const report = {
  ok: finalText === finalMarker,
  model,
  selectedTool: call.name,
  callArguments: JSON.parse(call.arguments ?? "{}"),
  finalText,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
