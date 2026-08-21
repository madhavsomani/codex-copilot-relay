const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-luna";
const count = Math.max(2, Math.min(8, Number.parseInt(args.get("--count") ?? "2", 10)));

async function probe(index) {
  const expected = `PARALLEL_AGENT_${index + 1}_OK`;
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Reply with exactly ${expected}` }],
      }],
      reasoning: { effort: "minimal" },
      stream: false,
    }),
  });
  const body = await response.json();
  const output = (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .join("");
  return {
    expected,
    output,
    status: response.status,
    durationMs: Date.now() - startedAt,
    ok: response.ok && output === expected,
  };
}

const wallStartedAt = Date.now();
const results = await Promise.all(Array.from({ length: count }, (_, index) => probe(index)));
const report = {
  ok: results.every((result) => result.ok),
  count,
  wallMs: Date.now() - wallStartedAt,
  slowestRequestMs: Math.max(...results.map((result) => result.durationMs)),
  results,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
