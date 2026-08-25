const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const tokenDenseUnits = Math.max(
  1,
  Number.parseInt(args.get("--token-dense-units") ?? "400000", 10),
);
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: true,
    input: [{
      type: "message",
      role: "user",
      // Each unit is three o200k tokens. This intentionally exceeds Sol's
      // advertised prompt-token limit without relying on the retired char guard.
      content: [{ type: "input_text", text: "🧪".repeat(tokenDenseUnits) }],
    }],
  }),
});
const raw = await response.text();
const events = raw
  .split(/\r?\n\r?\n/)
  .map((block) => block.split(/\r?\n/).find((line) => line.startsWith("data: ")))
  .filter(Boolean)
  .map((line) => JSON.parse(line.slice(6)));
const terminal = events.at(-1);
const contiguous = events.every((event, index) => event.sequence_number === index);
const report = {
  ok: response.ok
    && contiguous
    && terminal?.type === "response.failed"
    && terminal?.response?.status === "failed"
    && terminal?.response?.error?.code === "invalid_prompt",
  httpStatus: response.status,
  eventTypes: events.map((event) => event.type),
  contiguousSequenceNumbers: contiguous,
  terminalStatus: terminal?.response?.status ?? null,
  terminalErrorCode: terminal?.response?.error?.code ?? null,
  terminalMessage: terminal?.response?.error?.message ?? null,
  tokenDenseUnits,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
