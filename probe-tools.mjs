import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  mode: "copilot-cli",
  logLevel: "error",
  useLoggedInUser: true,
  workingDirectory: process.cwd(),
});

await client.start();

const session = await client.createSession({
  clientName: "codex-copilot-bridge-probe",
  model: "gpt-5.6-sol",
  reasoningEffort: "none",
  streaming: true,
  workingDirectory: process.cwd(),
  enableConfigDiscovery: false,
  skipCustomInstructions: true,
  skillDirectories: [],
  pluginDirectories: [],
  instructionDirectories: [],
  availableTools: ["custom:*"],
  systemMessage: {
    mode: "customize",
    content: [
      "You are being used as the language model inside a separate coding harness.",
      "Use only the custom tools provided for this session.",
      "When asked to call a tool, call it and then use its returned result.",
    ].join("\n"),
  },
  tools: [
    {
      name: "bridge_echo",
      description: "Return the supplied text through the outer harness.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      overridesBuiltInTool: true,
      skipPermission: true,
      defer: "never",
    },
  ],
});

session.on(async (event) => {
  if (event.type === "assistant.message_delta") {
    process.stdout.write(JSON.stringify({
      type: event.type,
      deltaContent: event.data.deltaContent,
    }) + "\n");
    return;
  }

  if (event.type === "external_tool.requested") {
    process.stdout.write(JSON.stringify({ type: event.type, data: event.data }) + "\n");
    await session.rpc.tools.handlePendingToolCall({
      requestId: event.data.requestId,
      result: `ECHO_OK:${event.data.arguments?.text ?? ""}`,
    });
    return;
  }

  if (["assistant.message", "session.idle", "session.error"].includes(event.type)) {
    process.stdout.write(JSON.stringify({ type: event.type, data: event.data }) + "\n");
  }
});

try {
  const result = await session.sendAndWait({
    prompt: "Call bridge_echo exactly once with text set to hello. Then reply with exactly the returned result.",
  }, 120_000);
  process.stdout.write(JSON.stringify({
    type: "probe.result",
    content: result?.data?.content ?? null,
  }) + "\n");
} finally {
  await session.disconnect();
  await client.stop();
}
