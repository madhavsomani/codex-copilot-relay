import { CopilotClient } from "@github/copilot-sdk";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const requestedModel = args.get("--model") ?? "gpt-5.6-sol";

const client = new CopilotClient({
  mode: "copilot-cli",
  logLevel: "error",
  useLoggedInUser: true,
  workingDirectory: process.cwd(),
});

try {
  await client.start();
  const models = await client.listModels();
  const selected = models.find((model) => model.id === requestedModel);
  if (!selected) {
    const available = models.map((model) => model.id).filter((id) => id.startsWith("gpt-")).sort();
    throw new Error(`The authenticated Copilot account does not expose ${requestedModel}. Available GPT models: ${available.join(", ") || "none"}.`);
  }

  process.stdout.write(`${JSON.stringify({
    id: selected.id,
    name: selected.name,
    supportedReasoningEfforts: selected.supportedReasoningEfforts,
    defaultReasoningEffort: selected.defaultReasoningEffort,
    billing: selected.billing,
  }, null, 2)}\n`);
} finally {
  await client.stop();
}
