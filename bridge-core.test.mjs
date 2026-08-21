import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionInput,
  externalToolRequestToResponseItem,
  extractToolDeclarations,
  extractToolOutputs,
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
