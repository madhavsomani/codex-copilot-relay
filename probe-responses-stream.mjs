const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const marker = "STREAM_SEQUENCE_OK";
const startedAt = Date.now();
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: true,
    reasoning: { effort: "none" },
    input: [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: `Reply with exactly ${marker}` }],
    }],
  }),
});

if (!response.ok || !response.body) {
  throw new Error(`Streaming probe returned HTTP ${response.status}.`);
}

const raw = await response.text();
const events = raw
  .split(/\r?\n\r?\n/)
  .map((block) => block.split(/\r?\n/).find((line) => line.startsWith("data: ")))
  .filter(Boolean)
  .map((line) => JSON.parse(line.slice(6)));
const types = events.map((event) => event.type);
const sequenceNumbers = events.map((event) => event.sequence_number);
const terminal = events.findLast((event) => event.type === "response.completed");
const outputText = (terminal?.response?.output ?? [])
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const required = [
  "response.created",
  "response.in_progress",
  "response.output_item.added",
  "response.content_part.added",
  "response.output_text.delta",
  "response.output_text.done",
  "response.content_part.done",
  "response.output_item.done",
  "response.completed",
];
const contiguous = sequenceNumbers.every((value, index) => value === index);
const report = {
  ok: required.every((type) => types.includes(type))
    && contiguous
    && outputText === marker,
  wallMs: Date.now() - startedAt,
  eventCount: events.length,
  eventTypes: types,
  contiguousSequenceNumbers: contiguous,
  outputText,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
