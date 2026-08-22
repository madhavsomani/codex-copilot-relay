const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const markers = {
  root: "ROOT_INSTRUCTION_RELAY_OK",
  developer: "DEVELOPER_MEMORY_RELAY_OK",
  correction: "MID_TASK_CORRECTION_RELAY_OK",
  toolResult: "PRIOR_TOOL_RESULT_RELAY_OK",
  user: "LATEST_USER_RELAY_OK",
};
const finalMarker = "COPILOT_RELAY_COMPATIBILITY_OK";
const reportTool = {
  type: "function",
  name: "compatibility_report",
  description: "Report the exact compatibility markers visible in the outer Codex request.",
  parameters: {
    type: "object",
    properties: Object.fromEntries(Object.entries(markers).map(([name, marker]) => [
      name,
      { type: "string", enum: [marker] },
    ])),
    required: Object.keys(markers),
    additionalProperties: false,
  },
};

const initialResponse = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    reasoning: { effort: "max" },
    instructions: `Outer root policy marker: ${markers.root}. Follow the latest user request.`,
    tools: [reportTool],
    input: [
      {
        type: "message",
        role: "developer",
        content: [{
          type: "input_text",
          text: `Task memory marker: ${markers.developer}.`,
        }],
      },
      {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: `Mid-task correction marker: ${markers.correction}.`,
        }],
      },
      {
        type: "custom_tool_call",
        call_id: "prior_compatibility_call",
        namespace: "functions",
        name: "exec",
        input: "text('compatibility checkpoint')",
      },
      {
        type: "custom_tool_call_output",
        call_id: "prior_compatibility_call",
        success: true,
        output: markers.toolResult,
      },
      {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: `Latest request marker: ${markers.user}. Call compatibility_report now with all five exact markers.`,
        }],
      },
    ],
  }),
});
const initialBody = await initialResponse.json();
if (!initialResponse.ok || initialBody.error) {
  throw new Error(initialBody.error?.message
    ?? `Relay returned HTTP ${initialResponse.status}.`);
}
const call = (initialBody.output ?? []).find((item) =>
  item.type === "function_call" && item.name === reportTool.name);
if (!call) throw new Error("The relay did not return compatibility_report.");
const receivedMarkers = JSON.parse(call.arguments ?? "{}");
for (const [name, marker] of Object.entries(markers)) {
  if (receivedMarkers[name] !== marker) {
    throw new Error(`Compatibility marker ${name} was not preserved.`);
  }
}

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
      output: `All compatibility markers passed. Reply with exactly ${finalMarker}.`,
    }],
  }),
});
const continuationBody = await continuationResponse.json();
if (!continuationResponse.ok || continuationBody.error) {
  throw new Error(continuationBody.error?.message
    ?? `Relay continuation returned HTTP ${continuationResponse.status}.`);
}
const finalText = (continuationBody.output ?? [])
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const report = {
  ok: finalText === finalMarker,
  model,
  markers: receivedMarkers,
  toolCallContinuation: finalText,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
