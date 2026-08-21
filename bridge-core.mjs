import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_HISTORY_TOOL_OUTPUT_CHARS = 64 * 1024;
const MAX_IMAGE_ATTACHMENTS = 12;
const MAX_ATTACHMENT_BASE64_CHARS = 16 * 1024 * 1024;
const DEFAULT_REASONING_EFFORT = "low";
const SUPPORTED_REASONING_EFFORTS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const bridgeContextDefaults = Object.freeze({
  historyToolOutputChars: MAX_HISTORY_TOOL_OUTPUT_CHARS,
  imageAttachments: MAX_IMAGE_ATTACHMENTS,
  attachmentBase64Chars: MAX_ATTACHMENT_BASE64_CHARS,
});

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function sanitizeNamePart(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool";
}

function makeInternalToolName(namespace, name, kind) {
  const key = `${namespace ?? "root"}\u0000${name}\u0000${kind}`;
  const readable = ["codex", namespace, name]
    .filter(Boolean)
    .map(sanitizeNamePart)
    .join("__");
  const suffix = `__${shortHash(key)}`;
  const available = Math.max(1, MAX_TOOL_NAME_LENGTH - suffix.length);
  return `${readable.slice(0, available)}${suffix}`;
}

function customToolSchema(tool) {
  const format = tool.format
    ? ` The outer tool format is: ${JSON.stringify(tool.format)}.`
    : "";
  return {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: `The complete raw input for this free-form outer tool.${format}`,
      },
    },
    required: ["input"],
    additionalProperties: false,
  };
}

function describeOuterTool(tool, namespace) {
  const qualifiedName = namespace ? `${namespace}.${tool.name}` : tool.name;
  const prefix = tool.type === "custom"
    ? `Outer Codex free-form tool \`${qualifiedName}\`. Put its entire raw input in the \`input\` string; the bridge unwraps it before returning the call to Codex.`
    : `Outer Codex function tool \`${qualifiedName}\`. The bridge returns this call to Codex for execution and approval.`;
  return [prefix, tool.description ?? ""].filter(Boolean).join("\n\n");
}

function visitTool(tool, namespace, declarations) {
  if (!tool || typeof tool !== "object") return;

  if (tool.type === "namespace") {
    const nextNamespace = typeof tool.name === "string" && tool.name
      ? tool.name
      : namespace;
    for (const child of Array.isArray(tool.tools) ? tool.tools : []) {
      visitTool(child, nextNamespace, declarations);
    }
    return;
  }

  if (!new Set(["function", "custom"]).has(tool.type)) return;
  if (typeof tool.name !== "string" || !tool.name) return;

  const metadata = {
    kind: tool.type,
    namespace: namespace ?? null,
    name: tool.name,
    format: tool.format ?? null,
  };
  metadata.internalName = makeInternalToolName(
    metadata.namespace,
    metadata.name,
    metadata.kind,
  );

  declarations.push({
    metadata,
    sdkTool: {
      name: metadata.internalName,
      description: describeOuterTool(tool, metadata.namespace),
      parameters: tool.type === "custom"
        ? customToolSchema(tool)
        : tool.parameters ?? { type: "object", properties: {} },
      overridesBuiltInTool: true,
      // These declarations never execute inside Copilot. Codex remains the
      // approval and execution boundary, so a duplicate Copilot prompt is not useful.
      skipPermission: true,
      defer: "never",
    },
  });
}

export function extractToolDeclarations(body) {
  const declarations = [];

  for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
    visitTool(tool, null, declarations);
  }

  for (const item of Array.isArray(body?.input) ? body.input : []) {
    if (item?.type !== "additional_tools") continue;
    for (const tool of Array.isArray(item.tools) ? item.tools : []) {
      visitTool(tool, null, declarations);
    }
  }

  const unique = new Map();
  for (const declaration of declarations) {
    const key = [
      declaration.metadata.namespace ?? "",
      declaration.metadata.name,
      declaration.metadata.kind,
    ].join("\u0000");
    unique.set(key, declaration);
  }

  const values = [...unique.values()];
  return {
    sdkTools: values.map((value) => value.sdkTool),
    byInternalName: new Map(values.map((value) => [
      value.metadata.internalName,
      value.metadata,
    ])),
    metadata: values.map((value) => value.metadata),
  };
}

function attachDataImage(imageUrl, attachments, contextStats) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(imageUrl);
  if (!match) return null;

  const dataChars = match[2].length;
  const overCount = attachments.length >= MAX_IMAGE_ATTACHMENTS;
  const overBytes = contextStats.attachmentBase64Chars + dataChars
    > MAX_ATTACHMENT_BASE64_CHARS;
  if (overCount || overBytes) {
    contextStats.omittedImageAttachments += 1;
    return "[Image omitted by the bridge context guard.]";
  }

  const displayName = `codex-image-${attachments.length + 1}`;
  attachments.push({
    type: "blob",
    mimeType: match[1],
    data: match[2],
    displayName,
  });
  contextStats.imageAttachments += 1;
  contextStats.attachmentBase64Chars += dataChars;
  return `[Image attached as ${displayName}]`;
}

function stringifyContentPiece(piece, attachments, contextStats) {
  if (typeof piece === "string") return piece;
  if (!piece || typeof piece !== "object") return String(piece ?? "");

  if (["input_text", "output_text", "summary_text", "reasoning_text"].includes(piece.type)) {
    return String(piece.text ?? "");
  }
  if (piece.type === "refusal") return String(piece.refusal ?? "");

  if (piece.type === "input_image") {
    const imageUrl = piece.image_url;
    if (typeof imageUrl === "string") {
      const attached = attachDataImage(imageUrl, attachments, contextStats);
      if (attached) return attached;
      return `[Image URL: ${imageUrl}]`;
    }
    return `[Image reference: ${piece.file_id ?? "unknown"}]`;
  }

  if (piece.type === "input_file") {
    return `[File input: ${piece.filename ?? piece.file_id ?? "embedded file"}]`;
  }

  return JSON.stringify(piece);
}

function stringifyMessageContent(content, attachments, contextStats) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    return stringifyContentPiece(content, attachments, contextStats);
  }
  return content
    .map((piece) => stringifyContentPiece(piece, attachments, contextStats))
    .filter(Boolean)
    .join("\n");
}

function stringifyInstructions(instructions, attachments, contextStats) {
  if (typeof instructions === "string") return instructions;
  if (!Array.isArray(instructions)) return "";
  return instructions
    .map((item) => {
      if (item?.type === "message") {
        return stringifyMessageContent(item.content, attachments, contextStats);
      }
      return stringifyContentPiece(item, attachments, contextStats);
    })
    .filter(Boolean)
    .join("\n");
}

function compactHistoryToolOutput(text, contextStats) {
  if (text.length <= MAX_HISTORY_TOOL_OUTPUT_CHARS) return text;

  const omitted = text.length - MAX_HISTORY_TOOL_OUTPUT_CHARS;
  const marker = `\n...[bridge omitted ${omitted} chars from oversized historical tool output]...\n`;
  const available = Math.max(0, MAX_HISTORY_TOOL_OUTPUT_CHARS - marker.length);
  const headChars = Math.ceil(available * 0.75);
  const tailChars = available - headChars;
  contextStats.truncatedToolOutputs += 1;
  contextStats.omittedToolOutputChars += omitted;
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function historyEntry(item, attachments, contextStats) {
  if (!item || typeof item !== "object") return null;

  if (item.type === "message") {
    return {
      role: item.role ?? "unknown",
      content: stringifyMessageContent(item.content, attachments, contextStats),
    };
  }

  if (item.type === "function_call") {
    return {
      role: "assistant_tool_call",
      tool_type: item.type,
      namespace: item.namespace ?? null,
      name: item.name,
      call_id: item.call_id,
      arguments: item.arguments,
    };
  }

  if (item.type === "custom_tool_call") {
    return {
      role: "assistant_tool_call",
      tool_type: item.type,
      namespace: item.namespace ?? null,
      name: item.name,
      call_id: item.call_id,
      input: item.input,
    };
  }

  if (["function_call_output", "custom_tool_call_output"].includes(item.type)) {
    return {
      role: "tool",
      tool_type: item.type,
      call_id: item.call_id,
      output: compactHistoryToolOutput(
        contentOutputToText(item.output, attachments, contextStats),
        contextStats,
      ),
      success: item.success,
    };
  }

  return null;
}

function validWorkingDirectory(candidate) {
  if (typeof candidate !== "string" || !candidate || !path.isAbsolute(candidate)) return null;
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function decodeBasicXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

export function buildSessionInput(body, fallbackWorkingDirectory = process.cwd()) {
  const attachments = [];
  const contextStats = {
    imageAttachments: 0,
    omittedImageAttachments: 0,
    attachmentBase64Chars: 0,
    truncatedToolOutputs: 0,
    omittedToolOutputChars: 0,
    promptChars: 0,
    systemChars: 0,
  };
  const developerInstructions = [];
  const transcript = [];

  const rootInstructions = stringifyInstructions(
    body?.instructions,
    attachments,
    contextStats,
  );
  if (rootInstructions) developerInstructions.push(rootInstructions);

  for (const item of Array.isArray(body?.input) ? body.input : []) {
    if (item?.type === "additional_tools") continue;
    const entry = historyEntry(item, attachments, contextStats);
    if (!entry) continue;
    if (["developer", "system"].includes(entry.role)) {
      developerInstructions.push(entry.content);
    } else {
      transcript.push(entry);
    }
  }

  const allVisibleText = [
    ...developerInstructions,
    ...transcript.map((entry) => typeof entry.content === "string"
      ? entry.content
      : JSON.stringify(entry)),
  ].join("\n");
  const cwdMatches = [...allVisibleText.matchAll(/<cwd>([\s\S]*?)<\/cwd>/g)];
  const cwdFromRequest = cwdMatches.length
    ? validWorkingDirectory(decodeBasicXml(cwdMatches.at(-1)[1].trim()))
    : null;
  const workingDirectory = cwdFromRequest
    ?? validWorkingDirectory(fallbackWorkingDirectory)
    ?? process.cwd();

  const bridgeInstructions = [
    "You are the language model inside an outer Codex coding harness.",
    "The outer Codex harness owns all tool execution, permission checks, filesystem access, and user approvals.",
    "Only request tools through the custom declarations supplied to this session. Never claim a tool ran before its result is returned.",
    "Tool names beginning with codex__ are bridge aliases. Their descriptions identify the exact outer namespace and tool name.",
    "For an outer free-form/custom tool, pass an object with one string field named input; put the complete raw tool input in that string.",
    "Follow the outer developer instructions below, subject to GitHub Copilot service policies and the SDK safety rules that remain enabled.",
  ].join("\n");

  const systemContent = [
    bridgeInstructions,
    ...developerInstructions.map((instruction, index) =>
      `\n--- Outer developer instruction ${index + 1} ---\n${instruction}`),
  ].join("\n");

  const prompt = [
    "The outer harness supplied the following conversation history as JSON. Preserve the roles represented by each entry.",
    JSON.stringify(transcript),
    "Continue the conversation as the assistant. Do not reproduce the JSON wrapper or role labels.",
  ].join("\n\n");
  contextStats.promptChars = prompt.length;
  contextStats.systemChars = systemContent.length;

  return {
    systemContent,
    prompt,
    attachments,
    contextStats,
    workingDirectory,
  };
}

export function assertSerializedContextWithinLimit(
  sessionInput,
  sdkTools,
  maxSerializedTextChars,
) {
  const measurement = {
    promptChars: String(sessionInput?.prompt ?? "").length,
    systemChars: String(sessionInput?.systemContent ?? "").length,
    toolDefinitionChars: JSON.stringify(Array.isArray(sdkTools) ? sdkTools : []).length,
    serializedTextChars: 0,
    maxSerializedTextChars,
  };
  measurement.serializedTextChars = measurement.promptChars
    + measurement.systemChars
    + measurement.toolDefinitionChars;

  if (measurement.serializedTextChars > maxSerializedTextChars) {
    throw new Error(
      `Bridge context guard rejected ${measurement.serializedTextChars} serialized text characters; limit is ${maxSerializedTextChars}. `
      + "Start a fresh Codex task or remove unusually large text/tool history.",
    );
  }
  return measurement;
}

export function normalizeReasoningEffort(value) {
  const requested = String(value ?? DEFAULT_REASONING_EFFORT).toLowerCase();
  if (requested === "ultra") return "max";
  if (["minimal", "minimal_reasoning"].includes(requested)) return "none";
  return SUPPORTED_REASONING_EFFORTS.has(requested)
    ? requested
    : DEFAULT_REASONING_EFFORT;
}

function collectToolOutputs(value, results) {
  if (Array.isArray(value)) {
    for (const child of value) collectToolOutputs(child, results);
    return;
  }
  if (!value || typeof value !== "object") return;

  if (["function_call_output", "custom_tool_call_output"].includes(value.type)
    && typeof value.call_id === "string") {
    results.push(value);
    return;
  }

  // Tool outputs can occur in a top-level input list or nested message content.
  if (Array.isArray(value.content)) collectToolOutputs(value.content, results);
}

export function extractToolOutputs(body) {
  const outputs = [];
  collectToolOutputs(body?.input, outputs);
  return outputs;
}

function contentOutputToText(output, attachments = null, contextStats = null) {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return JSON.stringify(output ?? null);
  return output.map((piece) => {
    if (typeof piece === "string") return piece;
    if (!piece || typeof piece !== "object") return String(piece ?? "");
    if (["input_text", "output_text"].includes(piece.type)) return String(piece.text ?? "");
    if (piece.type === "input_image") {
      if (attachments && contextStats) {
        return stringifyContentPiece(piece, attachments, contextStats);
      }
      return "[Tool returned an image to the outer harness.]";
    }
    if (piece.type === "input_file") return "[Tool returned a file to the outer harness.]";
    return JSON.stringify(piece);
  }).join("\n");
}

export function normalizeToolOutput(item) {
  const text = contentOutputToText(item?.output);
  const failed = item?.success === false
    || item?.status === "failed"
    || item?.status === "error";
  return { text, failed };
}

function argumentsAsJson(argumentsValue) {
  if (typeof argumentsValue === "string") {
    try {
      JSON.parse(argumentsValue);
      return argumentsValue;
    } catch {
      return JSON.stringify({ input: argumentsValue });
    }
  }
  return JSON.stringify(argumentsValue ?? {});
}

export function externalToolRequestToResponseItem(metadata, eventData) {
  if (!metadata) {
    throw new Error(`Copilot requested an unknown bridge tool: ${eventData?.toolName ?? "unknown"}`);
  }

  const callId = eventData.toolCallId ?? `call_${randomUUID().replaceAll("-", "")}`;
  const base = {
    id: `item_${randomUUID().replaceAll("-", "")}`,
    call_id: callId,
    name: metadata.name,
    status: "completed",
  };
  if (metadata.namespace) base.namespace = metadata.namespace;

  if (metadata.kind === "custom") {
    const rawArguments = eventData.arguments;
    const input = typeof rawArguments === "string"
      ? rawArguments
      : typeof rawArguments?.input === "string"
        ? rawArguments.input
        : JSON.stringify(rawArguments ?? "");
    return { ...base, type: "custom_tool_call", input };
  }

  return {
    ...base,
    type: "function_call",
    arguments: argumentsAsJson(eventData.arguments),
  };
}

export function makeAssistantMessageItem(text) {
  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: String(text ?? ""), annotations: [] }],
  };
}

export function makeResponseObject({ responseId, model, output, usage }) {
  const normalizedUsage = usage ?? {
    input_tokens: 0,
    input_tokens_details: null,
    output_tokens: 0,
    output_tokens_details: null,
    total_tokens: 0,
  };
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    error: null,
    incomplete_details: null,
    model,
    output,
    usage: normalizedUsage,
  };
}

export function makeFailedResponseObject({ responseId, model, code, message }) {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "failed",
    error: {
      code: String(code ?? "server_error"),
      message: String(message ?? "The bridge could not complete the response."),
    },
    incomplete_details: null,
    model,
    output: [],
    usage: null,
  };
}

export function classifyResponseFailureCode(message) {
  return /prompt token count|context.*(?:limit|large)|too many tokens/i
    .test(String(message ?? ""))
    ? "invalid_prompt"
    : "server_error";
}

export function makeResponseId() {
  return `resp_${randomUUID().replaceAll("-", "")}`;
}
