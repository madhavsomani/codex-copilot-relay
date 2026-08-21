import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSerializedContextWithinLimit,
  buildSessionInput,
  classifyResponseFailureCode,
  externalToolRequestToResponseItem,
  extractToolDeclarations,
  extractToolOutputs,
  makeFailedResponseObject,
  normalizeReasoningEffort,
  normalizeToolOutput,
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

test("builds role-preserving session input", () => {
  const sessionInput = buildSessionInput(sampleBody, process.cwd());
  assert.match(sessionInput.systemContent, /Developer rule\./);
  assert.match(sessionInput.prompt, /"role":"user"/);
  assert.match(sessionInput.prompt, /Hello\./);
  assert.doesNotMatch(sessionInput.prompt, /Run orchestration code/);
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

test("classifies context failures as invalid prompts", () => {
  assert.equal(
    classifyResponseFailureCode(
      "Bridge context guard rejected 1100940 serialized text characters; limit is 1000000.",
    ),
    "invalid_prompt",
  );
  assert.equal(classifyResponseFailureCode("Socket closed unexpectedly."), "server_error");
});
