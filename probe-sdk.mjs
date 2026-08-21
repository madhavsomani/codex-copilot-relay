import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  mode: "copilot-cli",
  logLevel: "error",
  useLoggedInUser: true,
  workingDirectory: process.cwd(),
});

try {
  await client.start();
  const models = await client.listModels();
  const sol = models.find((model) => model.id === "gpt-5.6-sol");
  if (!sol) {
    throw new Error("The authenticated Copilot account does not expose gpt-5.6-sol.");
  }

  process.stdout.write(`${JSON.stringify({
    id: sol.id,
    name: sol.name,
    supportedReasoningEfforts: sol.supportedReasoningEfforts,
    defaultReasoningEffort: sol.defaultReasoningEffort,
    billing: sol.billing,
  }, null, 2)}\n`);
} finally {
  await client.stop();
}
