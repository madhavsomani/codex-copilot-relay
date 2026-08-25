const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-luna";
const marker = "TOOL_CHOICE_RELAY_OK";
const tools = ["selected_probe_tool", "distractor_probe_tool"].map((name) => ({
  type: "function",
  name,
  description: `Return the compatibility marker through ${name}.`,
  strict: true,
  parameters: {
    type: "object",
    properties: { marker: { type: "string", enum: [marker] } },
    required: ["marker"],
    additionalProperties: false,
  },
}));

const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    reasoning: { effort: "low" },
    tool_choice: { type: "function", name: "selected_probe_tool" },
    tools,
    input: "Call the required tool with the exact marker.",
  }),
});
const body = await response.json();
if (!response.ok || body.error) {
  throw new Error(body.error?.message ?? `Tool-choice probe returned HTTP ${response.status}.`);
}
const calls = (body.output ?? []).filter((item) => item.type === "function_call");
const selected = calls.find((item) => item.name === "selected_probe_tool");
const report = {
  ok: calls.length === 1
    && selected != null
    && JSON.parse(selected.arguments ?? "{}").marker === marker,
  model,
  calls: calls.map((item) => item.name),
  selectedArguments: selected ? JSON.parse(selected.arguments ?? "{}") : null,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
