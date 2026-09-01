import { randomUUID } from "node:crypto";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = args.get("--url") ?? "http://127.0.0.1:4144/v1";
const model = args.get("--model") ?? "gpt-5.6-sol";
const marker = `AGENT_MESSAGE_OK_${randomUUID()}`;
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    stream: true,
    reasoning: { effort: "none" },
    input: [{
      type: "agent_message",
      author: "/root",
      recipient: "/root/live_probe",
      content: [
        {
          type: "input_text",
          text: "Message Type: NEW_TASK\nAuthor: /root\nRecipient: /root/live_probe\nPayload:\n",
        },
        {
          type: "encrypted_content",
          encrypted_content: `Reply with exactly ${marker}`,
        },
      ],
    }],
  }),
});

if (!response.ok || !response.body) {
  throw new Error(`Agent-message probe returned HTTP ${response.status}: ${await response.text()}`);
}

const raw = await response.text();
const events = raw
  .split(/\r?\n\r?\n/)
  .map((block) => block.split(/\r?\n/).find((line) => line.startsWith("data: ")))
  .filter(Boolean)
  .map((line) => JSON.parse(line.slice(6)));
const terminal = events.findLast((event) => event.type === "response.completed");
const failure = events.findLast((event) => event.type === "response.failed");
const outputText = (terminal?.response?.output ?? [])
  .filter((item) => item.type === "message")
  .flatMap((item) => item.content ?? [])
  .map((item) => item.text ?? "")
  .join("");
const report = {
  ok: Boolean(terminal) && !failure && outputText === marker,
  model,
  eventCount: events.length,
  outputText,
  expected: marker,
  failure: failure?.response?.error ?? null,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
