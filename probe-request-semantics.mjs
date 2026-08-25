const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const cases = [
  {
    name: "stored_response",
    body: { model: "gpt-5.6-sol", store: true, input: "test" },
    expectedParam: "store",
  },
  {
    name: "structured_output",
    body: {
      model: "gpt-5.6-sol",
      text: { format: { type: "json_schema", name: "result", schema: { type: "object" } } },
      input: "test",
    },
    expectedParam: "text.format",
  },
  {
    name: "sampling_temperature",
    body: { model: "gpt-5.6-sol", temperature: 0.2, input: "test" },
    expectedParam: "temperature",
  },
  {
    name: "unknown_model",
    body: { model: "definitely-not-a-copilot-model", input: "test" },
    expectedParam: "model",
  },
];

const results = [];
for (const item of cases) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item.body),
  });
  const body = await response.json();
  results.push({
    name: item.name,
    ok: response.status === 400
      && body.error?.code === "unsupported_parameter"
      && body.error?.param === item.expectedParam,
    status: response.status,
    code: body.error?.code ?? null,
    param: body.error?.param ?? null,
  });
}

const report = { ok: results.every((result) => result.ok), results };
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
