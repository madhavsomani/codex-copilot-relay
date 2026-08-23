const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const marker = "PREMATURE_RECOVERY_OK";
const tool = {
  type: "function",
  name: "relay_echo",
  description: "Return the supplied value for a deterministic bridge recovery test.",
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
        text: [
          "Continue this deterministic bridge recovery test.",
          "For your first response only, say exactly: I’m starting the requested test now.",
          "Do not call relay_echo until the bridge sends its recovery message.",
          "After that recovery message, call relay_echo once with value READY.",
          `After the tool result, reply with exactly ${marker}.`,
        ].join(" "),
      }],
    }],
  }),
});
const firstBody = await firstResponse.json();
if (!firstResponse.ok || firstBody.error) {
  throw new Error(firstBody.error?.message ?? `First recovery request returned HTTP ${firstResponse.status}.`);
}
const call = (firstBody.output ?? []).find((item) => item.type === "function_call");
if (!call) throw new Error("Bridge recovery test did not produce the required tool call.");

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
if (!continuationResponse.ok || continuationBody.error) {
  throw new Error(continuationBody.error?.message ?? `Recovery continuation returned HTTP ${continuationResponse.status}.`);
}
const finalText = (continuationBody.output ?? [])
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const normalizedFinalText = finalText.trim().replace(/[.!]+$/, "");

const dashboardUrl = baseUrl.replace(/\/v1\/?$/, "/dashboard/api");
const dashboard = await (await fetch(dashboardUrl)).json();
let record = null;
for (const index of dashboard.records ?? []) {
  if (Date.parse(index.receivedAt) + 5_000 < startedAt || !index.detailAvailable) continue;
  const detailResponse = await fetch(`${dashboardUrl}/records/${encodeURIComponent(index.id)}`);
  if (!detailResponse.ok) continue;
  const detail = (await detailResponse.json()).record;
  if (detail?.output?.id === firstBody.id) {
    record = detail;
    break;
  }
}
const recoveryReplay = (record?.copilotReplays ?? [])
  .some((item) => item.phase === "premature_completion_retry");
const report = {
  ok: recoveryReplay && normalizedFinalText === marker,
  wallMs: Date.now() - startedAt,
  recoveryReplay,
  firstResponseItems: (firstBody.output ?? []).map((item) => item.type),
  finalText,
  normalizedFinalText,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
