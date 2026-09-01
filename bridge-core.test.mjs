import assert from "node:assert/strict";
import test from "node:test";
import { countModelTokens } from "./context-tokenizer.mjs";
import {
  assertSerializedContextWithinLimit,
  buildSessionInput,
  classifyResponseFailureCode,
  externalToolRequestToResponseItem,
  extractToolDeclarations,
  extractToolOutputs,
  makeAssistantMessageItem,
  makeFailedResponseObject,
  makeReasoningItem,
  normalizeReasoningEffort,
  normalizeReasoningSummary,
  normalizeToolOutput,
  resolveRequestCompatibility,
  resolveModelCompatibility,
} from "./bridge-core.mjs";

const sampleBody = {
  model: "gpt-5.6-sol",
  input: [
    {
      type: "additional_tools",
      role: "developer",
      tools: [
        {
          type: "namespace",
          name: "functions",
          tools: [
            {
              type: "custom",
              name: "exec",
              description: "Run orchestration code.",
              format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
            },
            {
              type: "function",
              name: "wait",
              description: "Wait for work.",
              parameters: {
                type: "object",
                properties: { cell_id: { type: "string" } },
                required: ["cell_id"],
              },
            },
          ],
        },
      ],
    },
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Developer rule." }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello." }],
    },
  ],
  reasoning: { effort: "ultra" },
};

test("extracts namespaced function and custom tools", () => {
  const declarations = extractToolDeclarations(sampleBody);
  assert.equal(declarations.sdkTools.length, 2);
  assert.equal(declarations.metadata[0].namespace, "functions");
  assert.equal(declarations.metadata[0].kind, "custom");
  assert.deepEqual(declarations.sdkTools[0].parameters.required, ["input"]);
  assert.match(declarations.sdkTools[0].name, /^codex__functions__exec__/);
  assert.equal(declarations.sdkTools[1].parameters.properties.cell_id.type, "string");
});

test("removes provider-specific encrypted tool arguments for child-agent portability", () => {
  const body = {
    tools: [{
      type: "namespace",
      name: "collaboration",
      tools: [{
        type: "function",
        name: "spawn_agent",
        parameters: {
          type: "object",
          properties: {
            task_name: { type: "string" },
            message: { type: "string", encrypted: true },
          },
          required: ["task_name", "message"],
        },
      }],
    }],
  };

  const declaration = extractToolDeclarations(body).sdkTools[0];
  assert.equal(declaration.parameters.properties.message.type, "string");
  assert.equal("encrypted" in declaration.parameters.properties.message, false);
});

test("preserves portable tool-loading and contract metadata", () => {
  const declaration = extractToolDeclarations({
    tools: [{
      type: "function",
      name: "lookup",
      description: "Look up a record.",
      strict: true,
      defer_loading: true,
      allowed_callers: ["direct"],
      output_schema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    }],
  }).sdkTools[0];

  assert.equal(declaration.defer, "auto");
  assert.equal(declaration.metadata["codex.outer.strict"], true);
  assert.deepEqual(declaration.metadata["codex.outer.allowed_callers"], ["direct"]);
  assert.deepEqual(
    declaration.metadata["codex.outer.output_schema"].required,
    ["value"],
  );
});

test("builds role-preserving session input", () => {
  const sessionInput = buildSessionInput(sampleBody, process.cwd());
  assert.match(sessionInput.systemContent, /Developer rule\./);
  assert.match(sessionInput.prompt, /"role":"user"/);
  assert.match(sessionInput.prompt, /Hello\./);
  assert.match(sessionInput.prompt, /Latest outer user request/);
  assert.match(sessionInput.prompt, /A progress update by itself is not completion/);
  assert.equal(sessionInput.requiresAction, false);
  assert.doesNotMatch(sessionInput.prompt, /Run orchestration code/);
});

test("accepts the Responses shorthand string input", () => {
  const sessionInput = buildSessionInput({
    input: "SHORTHAND_STRING_INPUT_MUST_SURVIVE",
  }, process.cwd());

  assert.match(sessionInput.prompt, /SHORTHAND_STRING_INPUT_MUST_SURVIVE/);
  assert.equal(sessionInput.latestUserText, "SHORTHAND_STRING_INPUT_MUST_SURVIVE");
});

test("preserves assistant phases and reasoning summaries in replayed history", () => {
  const sessionInput = buildSessionInput({
    input: [
      {
        type: "reasoning",
        id: "rs-prior",
        summary: [{ type: "summary_text", text: "Validated the prior state." }],
      },
      {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ type: "output_text", text: "I am checking the build." }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue." }],
      },
    ],
  }, process.cwd());

  assert.match(sessionInput.prompt, /"role":"assistant_reasoning"/);
  assert.match(sessionInput.prompt, /Validated the prior state\./);
  assert.match(sessionInput.prompt, /"phase":"commentary"/);
});

test("honors current-turn reasoning context by omitting prior reasoning summaries", () => {
  const sessionInput = buildSessionInput({
    input: [
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "PRIOR_REASONING_SHOULD_NOT_REPLAY" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "CURRENT_TURN_REQUEST" }],
      },
    ],
  }, process.cwd(), { reasoningContext: "current_turn" });

  assert.doesNotMatch(sessionInput.prompt, /PRIOR_REASONING_SHOULD_NOT_REPLAY/);
  assert.match(sessionInput.prompt, /CURRENT_TURN_REQUEST/);
});

test("marks continuation requests as requiring real tool progress", () => {
  const body = {
    tools: [
      {
        type: "function",
        name: "render_clip",
        description: "Render the selected clip.",
        parameters: { type: "object", properties: {} },
      },
    ],
    input: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "I will start rendering next." }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Yes, continue. Why are we stopping?" }],
      },
    ],
  };

  const sessionInput = buildSessionInput(body, process.cwd());
  assert.equal(sessionInput.requiresAction, true);
  assert.equal(sessionInput.latestUserText, "Yes, continue. Why are we stopping?");
  assert.match(sessionInput.prompt, /request the next necessary outer tool in this same turn/i);
});

test("preserves Codex collaboration payloads in local agent messages", () => {
  const cases = [
    ["NEW_TASK", "Reply exactly CHILD_NEW_TASK_OK."],
    ["MESSAGE", "Reply exactly CHILD_MESSAGE_OK."],
    ["FINAL_ANSWER", `FINAL_ANSWER_${"x".repeat(8_192)}`],
  ];

  for (const [messageType, payload] of cases) {
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Spawn two child agents." }],
        },
        {
          type: "agent_message",
          author: messageType === "FINAL_ANSWER" ? "/root/child_one" : "/root",
          recipient: messageType === "FINAL_ANSWER" ? "/root" : "/root/child_one",
          content: [
            { type: "input_text", text: `Message Type: ${messageType}\nPayload:\n` },
            { type: "encrypted_content", encrypted_content: payload },
          ],
        },
      ],
    };

    const sessionInput = buildSessionInput(body, process.cwd());
    assert.equal(
      sessionInput.latestUserText,
      `Message Type: ${messageType}\nPayload:\n\n${payload}`,
    );
    assert.match(sessionInput.prompt, /"source":"agent_message"/);
    assert.ok(sessionInput.prompt.includes(payload));
    assert.doesNotMatch(
      sessionInput.prompt,
      /Provider-encrypted content is unavailable to the Copilot relay/,
    );
  }
});

test("keeps provider-encrypted message content opaque outside local agent messages", () => {
  const providerCiphertext = "provider-ciphertext-must-not-be-forwarded";
  const body = {
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Visible request." },
          { type: "encrypted_content", encrypted_content: providerCiphertext },
        ],
      },
      {
        type: "reasoning",
        encrypted_content: providerCiphertext,
      },
    ],
  };

  const sessionInput = buildSessionInput(body, process.cwd());
  assert.equal(
    sessionInput.latestUserText,
    "Visible request.\n[Provider-encrypted content is unavailable to the Copilot relay.]",
  );
  assert.ok(!sessionInput.prompt.includes(providerCiphertext));
});

test("moves historical tool images out of the text prompt", () => {
  const imageData = Buffer.alloc(256 * 1024, 0x5a).toString("base64");
  const body = {
    input: [
      {
        type: "custom_tool_call_output",
        call_id: "call-image",
        output: [
          { type: "input_text", text: "Frame inspected." },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${imageData}`,
            detail: "original",
          },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue." }],
      },
    ],
  };

  const sessionInput = buildSessionInput(body, process.cwd());
  assert.equal(sessionInput.attachments.length, 1);
  assert.equal(sessionInput.attachments[0].mimeType, "image/png");
  assert.doesNotMatch(sessionInput.prompt, /data:image\/png;base64/);
  assert.match(sessionInput.prompt, /Image attached as codex-image-1/);
  assert.equal(sessionInput.contextStats.imageAttachments, 1);
  assert.equal(sessionInput.contextStats.omittedImageAttachments, 0);
});

test("retains image attachments referenced by outer instructions", () => {
  const body = {
    instructions: [
      {
        type: "message",
        content: [
          { type: "input_text", text: "Use this reference." },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${"a".repeat(1_024)}`,
          },
        ],
      },
    ],
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue." }],
      },
    ],
  };

  const sessionInput = buildSessionInput(body, process.cwd(), {
    maxSerializedTextChars: 100_000,
    toolDefinitionChars: 2,
  });
  assert.equal(sessionInput.attachments.length, 1);
  assert.match(sessionInput.systemContent, /Image attached as codex-image-1/);
  assert.equal(sessionInput.contextStats.omittedImageAttachments, 0);
});

test("prioritizes the newest retained image when the selected model accepts one image", () => {
  const olderImage = Buffer.from("older-history-image").toString("base64");
  const currentImage = Buffer.from("current-user-image").toString("base64");
  const body = {
    input: [
      {
        type: "message",
        role: "assistant",
        content: [{
          type: "input_image",
          image_url: `data:image/png;base64,${olderImage}`,
        }],
      },
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Inspect the current image." },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${currentImage}`,
          },
        ],
      },
    ],
  };

  const sessionInput = buildSessionInput(body, process.cwd(), {
    maxImageAttachments: 1,
    maxAttachmentBase64Chars: 1024,
  });

  assert.equal(sessionInput.attachments.length, 1);
  assert.equal(sessionInput.attachments[0].data, currentImage);
  assert.equal(sessionInput.contextStats.omittedImageAttachments, 1);
  assert.match(sessionInput.prompt, /current-user-image|codex-image-2/);
});

test("bounds oversized historical text tool outputs", () => {
  const body = {
    input: [
      {
        type: "function_call_output",
        call_id: "call-large-text",
        output: `BEGIN-${"x".repeat(160 * 1024)}-END`,
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue." }],
      },
    ],
  };

  const sessionInput = buildSessionInput(body, process.cwd());
  assert.ok(sessionInput.prompt.length < 70 * 1024);
  assert.match(sessionInput.prompt, /BEGIN-/);
  assert.match(sessionInput.prompt, /-END/);
  assert.equal(sessionInput.contextStats.truncatedToolOutputs, 1);
  assert.ok(sessionInput.contextStats.omittedToolOutputChars > 0);
});

test("compacts aggregate older history while preserving instructions and the newest tool chain", () => {
  const input = [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "DEV_POLICY_MUST_SURVIVE" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: "a".repeat(2_000) },
        {
          type: "input_image",
          image_url: `data:image/png;base64,${"a".repeat(1_024)}`,
        },
        { type: "output_text", text: "b".repeat(2_000) },
      ],
    },
  ];
  for (let index = 0; index < 27; index += 1) {
    input.push(
      {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: `older-user-${index}-${"u".repeat(2_000)}`,
        }],
      },
      {
        type: "custom_tool_call",
        call_id: `old-call-${index}`,
        namespace: "functions",
        name: "exec",
        input: `text('${"i".repeat(2_000)}')`,
      },
      {
        type: "custom_tool_call_output",
        call_id: `old-call-${index}`,
        output: `OLD_RESULT_${index}_BEGIN-${"x".repeat(70_000)}-OLD_RESULT_${index}_END`,
      },
    );
  }
  input.push(
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "LATEST_USER_MUST_SURVIVE" }],
    },
    {
      type: "custom_tool_call",
      call_id: "latest-call",
      namespace: "functions",
      name: "exec",
      input: "text('LATEST_TOOL_REQUEST_MUST_SURVIVE')",
    },
    {
      type: "custom_tool_call_output",
      call_id: "latest-call",
      output: "LATEST_TOOL_RESULT_MUST_SURVIVE",
    },
  );
  const body = {
    instructions: "ROOT_POLICY_MUST_SURVIVE",
    input,
  };
  const sdkTools = [{
    name: "codex__functions__exec",
    description: "tool-schema-".repeat(5_000),
  }];
  const toolDefinitionChars = JSON.stringify(sdkTools).length;
  const maxSerializedTextChars = 1_000_000;

  const unbounded = buildSessionInput(body, process.cwd());
  assert.equal(unbounded.attachments.length, 1);
  assert.throws(
    () => assertSerializedContextWithinLimit(
      unbounded,
      sdkTools,
      maxSerializedTextChars,
    ),
    /Bridge context guard rejected/,
  );

  const compacted = buildSessionInput(body, process.cwd(), {
    maxSerializedTextChars,
    toolDefinitionChars,
  });
  const measurement = assertSerializedContextWithinLimit(
    compacted,
    sdkTools,
    maxSerializedTextChars,
  );

  assert.ok(measurement.serializedTextChars <= maxSerializedTextChars * 0.9);
  assert.match(compacted.systemContent, /ROOT_POLICY_MUST_SURVIVE/);
  assert.match(compacted.systemContent, /DEV_POLICY_MUST_SURVIVE/);
  assert.match(compacted.prompt, /LATEST_USER_MUST_SURVIVE/);
  assert.match(compacted.prompt, /LATEST_TOOL_REQUEST_MUST_SURVIVE/);
  assert.match(compacted.prompt, /LATEST_TOOL_RESULT_MUST_SURVIVE/);
  assert.match(compacted.prompt, /bridge_context_compaction/);
  assert.match(compacted.prompt, /OLD_RESULT_0_BEGIN/);
  assert.doesNotMatch(compacted.prompt, /"output":"OLD_RESULT_0_BEGIN/);
  assert.equal(compacted.contextStats.historyCompacted, true);
  assert.equal(compacted.attachments.length, 0);
  assert.equal(compacted.contextStats.omittedImageAttachments, 1);
  assert.ok(compacted.contextStats.omittedHistoryEntries > 0);
  assert.ok(compacted.contextStats.omittedHistoryChars > 0);
  assert.ok(compacted.contextStats.retainedHistoryEntries >= 3);

  const transcriptJson = compacted.prompt.match(
    /conversation history as JSON\. Preserve the roles represented by each entry\.\n\n(\[[\s\S]*\])\n\nLatest outer user request/,
  )?.[1];
  assert.ok(transcriptJson);
  assert.doesNotThrow(() => JSON.parse(transcriptJson));
});

test("compaction ledger preserves mid-task user rules and useful tool-result excerpts", () => {
  const input = [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "INITIAL_STATE_" + "a".repeat(4_000) }],
    },
    {
      type: "function_call_output",
      call_id: "critical-artifact",
      success: true,
      output: `CRITICAL_ASSET_PATH=C:\\deliverables\\approved-final.mp4 ${"b".repeat(4_000)}`,
    },
  ];
  for (let index = 0; index < 20; index += 1) {
    input.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: `EARLY_${index}_${"c".repeat(4_000)}` }],
    });
  }
  input.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "MID_TASK_RULE_BUFFER_MUST_REMAIN_DRAFT_ONLY" }],
  });
  for (let index = 0; index < 100; index += 1) {
    input.push({
      type: "custom_tool_call_output",
      call_id: `later-${index}`,
      success: true,
      output: `LATER_RESULT_${index}_${"d".repeat(4_000)}`,
    });
  }
  input.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Continue from the saved state." }],
  });

  const sessionInput = buildSessionInput({ input }, process.cwd(), {
    maxSerializedTextChars: 100_000,
    toolDefinitionChars: 2,
  });

  assert.equal(sessionInput.contextStats.historyCompacted, true);
  assert.match(sessionInput.prompt, /MID_TASK_RULE_BUFFER_MUST_REMAIN_DRAFT_ONLY/);
  assert.match(sessionInput.prompt, /CRITICAL_ASSET_PATH=C:\\\\deliverables\\\\approved-final\.mp4/);
});

test("uses the model token budget instead of compacting at the legacy character guard", () => {
  const input = [];
  for (let index = 0; index < 10; index += 1) {
    input.push({
      type: "message",
      role: index % 2 ? "assistant" : "user",
      content: [{ type: index % 2 ? "output_text" : "input_text", text: "x".repeat(600) }],
    });
  }
  input.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "LATEST_TOKEN_AWARE_REQUEST" }],
  });

  const countTokens = (value) => Math.ceil(String(value).length / 4);
  const sessionInput = buildSessionInput({ input }, process.cwd(), {
    maxSerializedTextChars: 1_000,
    maxSerializedTextTokens: 5_000,
    serializedToolDefinitions: "[]",
    countTokens,
  });

  assert.equal(sessionInput.contextStats.historyCompacted, false);
  assert.ok(sessionInput.contextStats.serializedTextChars > 1_000);
  assert.ok(sessionInput.contextStats.serializedTextTokens < 5_000);
  assert.match(sessionInput.prompt, /LATEST_TOKEN_AWARE_REQUEST/);
});

test("accepts a megabyte-scale repetitive Codex history when it fits the advertised token window", () => {
  const sessionInput = buildSessionInput({
    input: [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "x".repeat(1_100_000) }],
    }],
  }, process.cwd(), {
    maxSerializedTextChars: 1_000_000,
    maxSerializedTextTokens: 922_000,
    serializedToolDefinitions: "[]",
    countTokens: countModelTokens,
  });

  assert.equal(sessionInput.contextStats.budgetMode, "tokens");
  assert.equal(sessionInput.contextStats.historyCompacted, false);
  assert.ok(sessionInput.contextStats.serializedTextChars > 1_000_000);
  assert.ok(sessionInput.contextStats.serializedTextTokens < 922_000 * 0.9);
});

test("maps custom and function requests back to Responses items", () => {
  const declarations = extractToolDeclarations(sampleBody);
  const custom = declarations.metadata.find((item) => item.kind === "custom");
  const functionTool = declarations.metadata.find((item) => item.kind === "function");

  const customItem = externalToolRequestToResponseItem(custom, {
    toolCallId: "call-custom",
    arguments: { input: "text('ok')" },
  });
  assert.equal(customItem.type, "custom_tool_call");
  assert.equal(customItem.namespace, "functions");
  assert.equal(customItem.input, "text('ok')");

  const functionItem = externalToolRequestToResponseItem(functionTool, {
    toolCallId: "call-function",
    arguments: { cell_id: "abc" },
  });
  assert.equal(functionItem.type, "function_call");
  assert.equal(functionItem.arguments, "{\"cell_id\":\"abc\"}");
});

test("extracts and normalizes tool outputs", () => {
  const body = {
    input: [
      { type: "custom_tool_call_output", call_id: "call-1", output: "ok" },
      {
        type: "function_call_output",
        call_id: "call-2",
        success: false,
        output: [{ type: "input_text", text: "failed" }],
      },
    ],
  };
  const outputs = extractToolOutputs(body);
  assert.equal(outputs.length, 2);
  assert.deepEqual(normalizeToolOutput(outputs[0]), { text: "ok", failed: false });
  assert.deepEqual(normalizeToolOutput(outputs[1]), { text: "failed", failed: true });
});

test("normalizes reasoning efforts for Copilot", () => {
  assert.equal(normalizeReasoningEffort("ultra"), "max");
  assert.equal(normalizeReasoningEffort("minimal"), "none");
  assert.equal(normalizeReasoningEffort("xhigh"), "xhigh");
  assert.equal(normalizeReasoningEffort("unknown"), "low");
});

test("normalizes Codex reasoning summaries for the Copilot SDK", () => {
  assert.equal(normalizeReasoningSummary({ effort: "max", summary: "auto" }), "concise");
  assert.equal(normalizeReasoningSummary({ effort: "high", generate_summary: "detailed" }), "detailed");
  assert.equal(normalizeReasoningSummary({ effort: "none" }), "none");
  assert.equal(normalizeReasoningSummary({ effort: "max" }), "concise");
});

test("accepts the real Codex request controls and rejects unsupported semantics", () => {
  const compatibility = resolveRequestCompatibility({
    reasoning: { effort: "max", summary: "auto", context: "all_turns" },
    text: { verbosity: "low" },
    parallel_tool_calls: false,
    tool_choice: "auto",
    prompt_cache_key: "thread-safe-key",
    include: ["reasoning.encrypted_content"],
    store: false,
  });

  assert.equal(compatibility.reasoningEffort, "max");
  assert.equal(compatibility.reasoningSummary, "concise");
  assert.equal(compatibility.parallelToolCalls, false);
  assert.equal(compatibility.textVerbosity, "low");
  assert.match(compatibility.systemInstructions.join("\n"), /at most one outer tool/i);
  assert.match(compatibility.systemInstructions.join("\n"), /low verbosity/i);

  assert.throws(
    () => resolveRequestCompatibility({ store: true }),
    (error) => error.code === "unsupported_parameter" && error.param === "store",
  );
  assert.throws(
    () => resolveRequestCompatibility({ text: { format: { type: "json_schema" } } }),
    (error) => error.code === "unsupported_parameter" && error.param === "text.format",
  );
  assert.throws(
    () => resolveRequestCompatibility({ temperature: 0.2 }),
    (error) => error.code === "unsupported_parameter" && error.param === "temperature",
  );
  assert.equal(resolveRequestCompatibility({ tool_choice: "required" }).toolChoice, "required");
  assert.deepEqual(
    resolveRequestCompatibility({
      tool_choice: { type: "function", name: "lookup", namespace: "records" },
    }).toolChoice,
    {
      mode: "specific",
      type: "function",
      name: "lookup",
      namespace: "records",
    },
  );
  assert.throws(
    () => resolveRequestCompatibility({ tools: [{ type: "web_search_preview" }] }),
    (error) => error.code === "unsupported_parameter" && error.param === "tools",
  );
});

test("adds phase-aware assistant and reasoning output items", () => {
  const commentary = makeAssistantMessageItem("Checking.", { phase: "commentary" });
  assert.equal(commentary.phase, "commentary");

  const reasoning = makeReasoningItem("Validated the inputs.");
  assert.equal(reasoning.type, "reasoning");
  assert.equal(reasoning.status, "completed");
  assert.deepEqual(reasoning.summary, [{
    type: "summary_text",
    text: "Validated the inputs.",
  }]);
});

test("derives long-context and image limits from Copilot model capabilities", () => {
  const compatibility = resolveModelCompatibility({
    capabilities: {
      limits: {
        max_context_window_tokens: 1_050_000,
        max_prompt_tokens: 922_000,
        vision: {
          max_prompt_image_size: 3_145_728,
          max_prompt_images: 1,
          supported_media_types: ["image/png"],
        },
      },
      supports: { vision: true },
    },
    billing: {
      tokenPrices: {
        maxPromptTokens: 272_000,
        longContext: { maxPromptTokens: 922_000 },
      },
    },
  });

  assert.equal(compatibility.contextTier, "long_context");
  assert.equal(compatibility.maxPromptTokens, 922_000);
  assert.equal(compatibility.maxImageAttachments, 1);
  assert.equal(compatibility.maxAttachmentBase64Chars, 4_194_304);
  assert.deepEqual(compatibility.supportedMediaTypes, ["image/png"]);
});

test("builds a terminal Responses failure object", () => {
  const response = makeFailedResponseObject({
    responseId: "resp-failed",
    model: "gpt-5.6-sol",
    code: "invalid_prompt",
    message: "Context is too large.",
  });

  assert.equal(response.id, "resp-failed");
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "invalid_prompt");
  assert.equal(response.error.message, "Context is too large.");
  assert.deepEqual(response.output, []);
});

test("rejects serialized model context above the configured guard", () => {
  const sessionInput = {
    systemContent: "system",
    prompt: "x".repeat(2_000),
  };

  assert.throws(
    () => assertSerializedContextWithinLimit(sessionInput, [], 1_000),
    /Bridge context guard rejected 2008 serialized text characters; limit is 1000/,
  );

  assert.deepEqual(
    assertSerializedContextWithinLimit(sessionInput, [], 3_000),
    {
      promptChars: 2_000,
      systemChars: 6,
      toolDefinitionChars: 2,
      serializedTextChars: 2_008,
      maxSerializedTextChars: 3_000,
    },
  );
});

test("prefers model token limits over the legacy fallback character limit", () => {
  const sessionInput = {
    systemContent: "system",
    prompt: "x".repeat(2_000),
  };
  const measurement = assertSerializedContextWithinLimit(sessionInput, [], {
    maxSerializedTextChars: 1_000,
    maxSerializedTextTokens: 1_000,
    countTokens: (value) => Math.ceil(String(value).length / 4),
  });

  assert.ok(measurement.serializedTextChars > measurement.maxSerializedTextChars);
  assert.ok(measurement.serializedTextTokens <= measurement.maxSerializedTextTokens);
  assert.equal(measurement.budgetMode, "tokens");
});

test("classifies context failures as invalid prompts", () => {
  assert.equal(
    classifyResponseFailureCode(
      "Bridge context guard rejected 1100940 serialized text characters; limit is 1000000.",
    ),
    "invalid_prompt",
  );
  assert.equal(classifyResponseFailureCode("Socket closed unexpectedly."), "server_error");
});
