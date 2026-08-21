const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const steps = Math.max(2, Math.min(10, Number.parseInt(args.get("--steps") ?? "4", 10)));
const finalMarker = "RELAY_LONG_TOOL_CHAIN_OK";
const tool = {
  type: "function",
  name: "relay_echo",
  description: "Return a deterministic result for one relay lifecycle test step.",
  parameters: {
    type: "object",
    properties: {
      step: { type: "integer" },
      previous: { type: "string" },
    },
    required: ["step", "previous"],
    additionalProperties: false,
  },
};

let input = [{
  type: "message",
  role: "user",
  content: [{
    type: "input_text",
    text: [
      `Complete a ${steps}-step tool workflow without stopping early.`,
      "Call relay_echo for step 1 with previous set to START.",
      `After each result, call the next step until step ${steps}.`,
      `After the step ${steps} result, reply with exactly ${finalMarker}.`,
    ].join(" "),
  }],
}];
let previousResponseId;
let toolCalls = 0;
let requests = 0;
let finalText = "";
const startedAt = Date.now();

for (let turn = 0; turn < steps * 3 + 6; turn += 1) {
  const requestBody = {
    model,
    stream: false,
    reasoning: { effort: "low" },
    tools: [tool],
    input,
  };
  if (previousResponseId) requestBody.previous_response_id = previousResponseId;

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const body = await response.json();
  requests += 1;
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `Relay returned HTTP ${response.status}.`);
  }

  const calls = (body.output ?? []).filter((item) => item.type === "function_call");
  if (calls.length > 0) {
    toolCalls += calls.length;
    input = calls.map((call) => {
      let parsed = {};
      try { parsed = JSON.parse(call.arguments ?? "{}"); } catch {}
      const step = Number.parseInt(parsed.step, 10);
      return {
        type: "function_call_output",
        call_id: call.call_id,
        success: true,
        output: `STEP_${Number.isFinite(step) ? step : "UNKNOWN"}_RESULT_OK`,
      };
    });
    previousResponseId = body.id;
    continue;
  }

  finalText = (body.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .join("");
  break;
}

const report = {
  ok: toolCalls >= steps && finalText === finalMarker,
  stepsRequested: steps,
  toolCalls,
  requests,
  wallMs: Date.now() - startedAt,
  finalText,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
