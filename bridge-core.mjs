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
const ACTION_REQUEST = /\b(?:cont\w*|resume|proceed|keep\s+(?:going|working)|finish|complete|fix|debug|investigate|test|run|execute|create|build|make|edit|render|generate|open|check|verify|deploy|implement|cut|produce|restore|start|take|use|show|do\s+it|go\s+ahead)\b/i;
const MAX_LATEST_USER_ECHO_CHARS = 16 * 1024;
const HISTORY_COMPACTION_TARGET_RATIO = 0.9;
const MAX_HISTORY_COMPACTION_LEDGER_CHARS = 48 * 1024;
const MIN_RECENT_HISTORY_ENTRIES = 3;

export const bridgeContextDefaults = Object.freeze({
  historyToolOutputChars: MAX_HISTORY_TOOL_OUTPUT_CHARS,
  imageAttachments: MAX_IMAGE_ATTACHMENTS,
  attachmentBase64Chars: MAX_ATTACHMENT_BASE64_CHARS,
  aggregateTargetRatio: HISTORY_COMPACTION_TARGET_RATIO,
  compactionLedgerChars: MAX_HISTORY_COMPACTION_LEDGER_CHARS,
  minimumRecentEntries: MIN_RECENT_HISTORY_ENTRIES,
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

function portableToolMetadata(tool) {
  const metadata = {
    "codex.outer.strict": tool.strict === true,
    "codex.outer.defer_loading": tool.defer_loading === true,
  };
  if (Array.isArray(tool.allowed_callers)) {
    metadata["codex.outer.allowed_callers"] = [...tool.allowed_callers];
  }
  if (tool.output_schema && typeof tool.output_schema === "object") {
    metadata["codex.outer.output_schema"] = portableToolSchema(tool.output_schema);
  }
  return metadata;
}

function portableToolSchema(value) {
  if (Array.isArray(value)) return value.map((item) => portableToolSchema(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    // `encrypted: true` is an OpenAI-provider extension used for opaque
    // inter-agent payloads. Copilot can create the ciphertext but a later
    // Copilot-backed child request cannot decrypt OpenAI's provider envelope.
    // Keep the local Codex tool boundary and carry the task as ordinary text.
    if (key === "encrypted") continue;
    result[key] = portableToolSchema(item);
  }
  return result;
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
        : portableToolSchema(tool.parameters ?? { type: "object", properties: {} }),
      overridesBuiltInTool: true,
      // These declarations never execute inside Copilot. Codex remains the
      // approval and execution boundary, so a duplicate Copilot prompt is not useful.
      skipPermission: true,
      defer: tool.defer_loading === true ? "auto" : "never",
      metadata: portableToolMetadata(tool),
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

function attachDataImage(imageUrl, attachments, attachmentContext = {}) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(imageUrl);
  if (!match) return null;

  const displayName = `codex-image-${attachments.length + 1}`;
  attachments.push({
    type: "blob",
    mimeType: match[1],
    data: match[2],
    displayName,
    _bridgeSourceRole: attachmentContext.role ?? "unknown",
    _bridgeSourceIndex: Number.isFinite(attachmentContext.sourceIndex)
      ? attachmentContext.sourceIndex
      : -1,
    _bridgeInstruction: Boolean(attachmentContext.instruction),
    _bridgeCandidateIndex: attachments.length,
  });
  return `[Image attached as ${displayName}]`;
}

function stringifyContentPiece(piece, attachments, contextStats, attachmentContext = {}) {
  if (typeof piece === "string") return piece;
  if (!piece || typeof piece !== "object") return String(piece ?? "");

  if (["input_text", "output_text", "summary_text", "reasoning_text"].includes(piece.type)) {
    return String(piece.text ?? "");
  }
  if (piece.type === "encrypted_content") {
    // Codex uses this field name for plaintext parent/child collaboration payloads.
    // The outer agent_message item is the trust boundary; provider reasoning and
    // ordinary message ciphertext must continue to use the opaque fallback below.
    if (
      attachmentContext.localAgentMessage
      && typeof piece.encrypted_content === "string"
      && piece.encrypted_content.length > 0
    ) {
      return piece.encrypted_content;
    }
    return "[Provider-encrypted content is unavailable to the Copilot relay.]";
  }
  if (piece.type === "refusal") return String(piece.refusal ?? "");

  if (piece.type === "input_image") {
    const imageUrl = piece.image_url;
    if (typeof imageUrl === "string") {
      const attached = attachDataImage(imageUrl, attachments, attachmentContext);
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

function stringifyMessageContent(content, attachments, contextStats, attachmentContext = {}) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    return stringifyContentPiece(content, attachments, contextStats, attachmentContext);
  }
  return content
    .map((piece) => stringifyContentPiece(
      piece,
      attachments,
      contextStats,
      attachmentContext,
    ))
    .filter(Boolean)
    .join("\n");
}

function stringifyInstructions(instructions, attachments, contextStats) {
  if (typeof instructions === "string") return instructions;
  if (!Array.isArray(instructions)) return "";
  return instructions
    .map((item) => {
      if (item?.type === "message") {
        return stringifyMessageContent(item.content, attachments, contextStats, {
          role: item.role ?? "developer",
          sourceIndex: -1,
          instruction: true,
        });
      }
      return stringifyContentPiece(item, attachments, contextStats, {
        role: "developer",
        sourceIndex: -1,
        instruction: true,
      });
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

function historyEntry(item, attachments, contextStats, sourceIndex = -1) {
  if (!item || typeof item !== "object") return null;

  if (item.type === "message") {
    const entry = {
      role: item.role ?? "unknown",
      content: stringifyMessageContent(item.content, attachments, contextStats, {
        role: item.role ?? "unknown",
        sourceIndex,
        instruction: ["developer", "system"].includes(item.role),
      }),
    };
    if (entry.role === "assistant" && typeof item.phase === "string" && item.phase) {
      entry.phase = item.phase;
    }
    return entry;
  }

  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary
        .filter((part) => part?.type === "summary_text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
      : "";
    const readableContent = Array.isArray(item.content)
      ? item.content
        .filter((part) => ["reasoning_text", "summary_text"].includes(part?.type))
        .map((part) => String(part.text ?? ""))
        .filter(Boolean)
        .join("\n")
      : "";
    const visibleReasoning = summary || readableContent;
    if (!visibleReasoning) return null;
    return {
      role: "assistant_reasoning",
      id: item.id ?? null,
      content: visibleReasoning,
    };
  }

  if (item.type === "agent_message") {
    return {
      role: "user",
      source: "agent_message",
      author: item.author ?? null,
      recipient: item.recipient ?? null,
      content: stringifyMessageContent(item.content, attachments, contextStats, {
        role: "user",
        sourceIndex,
        localAgentMessage: true,
      }),
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
        contentOutputToText(item.output, attachments, contextStats, {
          role: "tool",
          sourceIndex,
        }),
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

function compactLedgerText(value, maxChars = 768) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= maxChars) return text;
  const marker = `...[${text.length - maxChars} chars omitted]...`;
  const available = Math.max(0, maxChars - marker.length);
  const headChars = Math.ceil(available * 0.7);
  const tailChars = available - headChars;
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

function summarizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (["user", "assistant"].includes(entry.role) && typeof entry.content === "string") {
    return {
      role: entry.role,
      content: compactLedgerText(entry.content),
    };
  }
  if (entry.role === "assistant_tool_call") {
    const summary = {
      role: entry.role,
      namespace: entry.namespace ?? null,
      name: entry.name ?? null,
      call_id: entry.call_id ?? null,
    };
    if (entry.arguments !== undefined) {
      summary.arguments_excerpt = compactLedgerText(entry.arguments, 512);
    }
    if (entry.input !== undefined) {
      summary.input_excerpt = compactLedgerText(entry.input, 512);
    }
    return summary;
  }
  if (entry.role === "tool") {
    return {
      role: entry.role,
      call_id: entry.call_id ?? null,
      success: entry.success ?? null,
      output_chars: String(entry.output ?? "").length,
      output_excerpt: compactLedgerText(entry.output, 768),
    };
  }
  return null;
}

function makeHistoryCompactionEntry(omittedEntries, maxChars) {
  const serializedLengths = omittedEntries.map((entry) => JSON.stringify(entry).length);
  const base = {
    role: "system",
    source: "bridge_context_compaction",
    omitted_entries: omittedEntries.length,
    omitted_chars: serializedLengths.reduce((total, value) => total + value, 0),
    content: "The bridge compacted older transport history to stay within the model context ceiling. Preserve the latest user request and retained recent tool chain. Inspect durable artifacts or request focused evidence before repeating omitted work.",
    milestones: [],
  };
  const summaries = omittedEntries
    .map((entry, index) => ({ index, summary: summarizeHistoryEntry(entry) }))
    .filter((item) => item.summary);
  const priorityCandidates = [];
  const queuedIndices = new Set();
  const queue = (items) => {
    for (const item of items) {
      if (queuedIndices.has(item.index)) continue;
      queuedIndices.add(item.index);
      priorityCandidates.push(item);
    }
  };

  // User corrections and constraints carry more continuity value than a long
  // tail of routine successful tool results. Queue every omitted user turn
  // first, followed by failures, the opening state, the recent tail, and a few
  // evenly spaced checkpoints from the middle of a long run.
  queue(summaries.filter((item) => item.summary.role === "user"));
  queue(summaries.filter((item) =>
    item.summary.role === "tool" && item.summary.success === false));
  queue(summaries.slice(0, 4));
  queue(summaries.slice(-24));
  if (summaries.length > 0) {
    const sampleCount = Math.min(16, summaries.length);
    const sampled = [];
    for (let index = 0; index < sampleCount; index += 1) {
      sampled.push(summaries[Math.floor(index * (summaries.length - 1)
        / Math.max(1, sampleCount - 1))]);
    }
    queue(sampled);
  }

  for (const item of priorityCandidates) {
    const milestone = { original_index: item.index, ...item.summary };
    const milestones = [...base.milestones, milestone]
      .sort((left, right) => left.original_index - right.original_index);
    const candidate = {
      ...base,
      milestones,
    };
    if (JSON.stringify(candidate).length > maxChars) continue;
    base.milestones = milestones;
  }
  return base;
}

function finalizeImageAttachments({
  attachments,
  systemContent,
  prompt,
  contextStats,
  maxImageAttachments,
  maxAttachmentBase64Chars,
  maxSingleAttachmentBase64Chars,
}) {
  const serializedContext = `${systemContent}\n${prompt}`;
  const referenced = attachments.filter((attachment) =>
    serializedContext.includes(`[Image attached as ${attachment.displayName}]`));
  const latestUserImageSource = referenced
    .filter((attachment) => attachment._bridgeSourceRole === "user")
    .reduce((latest, attachment) => Math.max(latest, attachment._bridgeSourceIndex), -1);
  const priority = (attachment) => {
    if (attachment._bridgeSourceRole === "user"
      && attachment._bridgeSourceIndex === latestUserImageSource) return 4;
    if (attachment._bridgeInstruction) return 3;
    if (attachment._bridgeSourceRole === "user") return 2;
    return 1;
  };
  const ranked = [...referenced].sort((left, right) =>
    priority(right) - priority(left)
      || right._bridgeSourceIndex - left._bridgeSourceIndex
      || right._bridgeCandidateIndex - left._bridgeCandidateIndex);
  const selected = [];
  let base64Chars = 0;
  for (const attachment of ranked) {
    if (selected.length >= maxImageAttachments) continue;
    const dataChars = String(attachment.data ?? "").length;
    if (dataChars > maxSingleAttachmentBase64Chars) continue;
    if (base64Chars + dataChars > maxAttachmentBase64Chars) continue;
    selected.push(attachment);
    base64Chars += dataChars;
  }
  selected.sort((left, right) => left._bridgeCandidateIndex - right._bridgeCandidateIndex);
  const selectedNames = new Set(selected.map((attachment) => attachment.displayName));
  const omitted = attachments.filter((attachment) => !selectedNames.has(attachment.displayName));
  const omissionReason = maxImageAttachments > 0
    ? `[Image omitted by bridge compatibility policy; the selected model accepts at most ${maxImageAttachments} prompt image(s).]`
    : "[Image omitted because the selected model does not accept prompt images.]";
  let adjustedSystemContent = systemContent;
  let adjustedPrompt = prompt;
  for (const attachment of omitted) {
    const marker = `[Image attached as ${attachment.displayName}]`;
    adjustedSystemContent = adjustedSystemContent.replaceAll(marker, omissionReason);
    adjustedPrompt = adjustedPrompt.replaceAll(marker, omissionReason);
  }
  const portableSelected = selected.map((attachment) => ({
    type: attachment.type,
    mimeType: attachment.mimeType,
    data: attachment.data,
    displayName: attachment.displayName,
  }));
  attachments.splice(0, attachments.length, ...portableSelected);
  contextStats.imageAttachments = portableSelected.length;
  contextStats.omittedImageAttachments = omitted.length;
  contextStats.attachmentBase64Chars = base64Chars;
  contextStats.maxImageAttachments = maxImageAttachments;
  contextStats.maxAttachmentBase64Chars = maxAttachmentBase64Chars;
  contextStats.maxSingleAttachmentBase64Chars = maxSingleAttachmentBase64Chars;
  return { systemContent: adjustedSystemContent, prompt: adjustedPrompt };
}

function buildConversationPrompt(transcript, latestUserEcho) {
  return [
    "The outer harness supplied the following conversation history as JSON. Preserve the roles represented by each entry.",
    JSON.stringify(transcript),
    `Latest outer user request (repeat for salience):\n${latestUserEcho || "[No plain-text user message was supplied.]"}`,
    [
      "Continue the conversation as the assistant. Do not reproduce the JSON wrapper or role labels.",
      "A progress update by itself is not completion when requested work remains.",
      "If the latest request asks you to perform, resume, or continue work and an outer tool can advance it, include any concise progress note and request the next necessary outer tool in this same turn.",
      "Return text without a tool request only when the requested work is actually complete, the question is fully answered, or progress genuinely requires user input or approval.",
    ].join("\n"),
  ].join("\n\n");
}

function normalizedPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function serializedContextMeasurement({
  systemContent,
  prompt,
  serializedToolDefinitions = "[]",
  toolDefinitionChars = null,
  maxSerializedTextChars = null,
  maxSerializedTextTokens = null,
  countTokens = null,
}) {
  const normalizedSystem = String(systemContent ?? "");
  const normalizedPrompt = String(prompt ?? "");
  const normalizedTools = String(serializedToolDefinitions ?? "[]");
  const measuredToolChars = normalizedPositiveNumber(toolDefinitionChars);
  const measurement = {
    promptChars: normalizedPrompt.length,
    systemChars: normalizedSystem.length,
    toolDefinitionChars: measuredToolChars ?? normalizedTools.length,
    serializedTextChars: 0,
    maxSerializedTextChars: normalizedPositiveNumber(maxSerializedTextChars),
  };
  measurement.serializedTextChars = measurement.promptChars
    + measurement.systemChars
    + measurement.toolDefinitionChars;

  const tokenLimit = normalizedPositiveNumber(maxSerializedTextTokens);
  if (tokenLimit && typeof countTokens === "function") {
    const serializedTextTokens = Number(countTokens(
      [normalizedSystem, normalizedPrompt, normalizedTools].join("\n"),
    ));
    if (Number.isFinite(serializedTextTokens) && serializedTextTokens >= 0) {
      measurement.serializedTextTokens = Math.ceil(serializedTextTokens);
      measurement.maxSerializedTextTokens = tokenLimit;
      measurement.budgetMode = "tokens";
      return measurement;
    }
  }

  measurement.budgetMode = "characters";
  return measurement;
}

function measurementFitsBudget(measurement, targetRatio = 1) {
  if (measurement.budgetMode === "tokens") {
    return measurement.serializedTextTokens
      <= Math.floor(measurement.maxSerializedTextTokens * targetRatio);
  }
  if (!measurement.maxSerializedTextChars) return true;
  return measurement.serializedTextChars
    <= Math.floor(measurement.maxSerializedTextChars * targetRatio);
}

function compactTranscriptWithinBudget({
  transcript,
  latestUserEcho,
  systemContent,
  contextStats,
  maxSerializedTextChars,
  maxSerializedTextTokens,
  countTokens,
  serializedToolDefinitions,
  toolDefinitionChars,
  useHistoryCompaction = true,
}) {
  const fullPrompt = buildConversationPrompt(transcript, latestUserEcho);
  contextStats.retainedHistoryEntries = transcript.length;
  const measurementFor = (prompt) => serializedContextMeasurement({
    systemContent,
    prompt,
    serializedToolDefinitions,
    toolDefinitionChars,
    maxSerializedTextChars,
    maxSerializedTextTokens,
    countTokens,
  });
  const fullMeasurement = measurementFor(fullPrompt);
  contextStats.preCompactionPromptChars = fullPrompt.length;
  contextStats.preCompactionSerializedTextChars = fullMeasurement.serializedTextChars;
  contextStats.budgetMode = fullMeasurement.budgetMode;
  if (fullMeasurement.budgetMode === "tokens") {
    contextStats.preCompactionSerializedTextTokens = fullMeasurement.serializedTextTokens;
    contextStats.targetSerializedTextTokens = Math.floor(
      fullMeasurement.maxSerializedTextTokens * HISTORY_COMPACTION_TARGET_RATIO,
    );
  } else if (fullMeasurement.maxSerializedTextChars) {
    contextStats.targetSerializedTextChars = Math.floor(
      fullMeasurement.maxSerializedTextChars * HISTORY_COMPACTION_TARGET_RATIO,
    );
  }
  if (!useHistoryCompaction
    || measurementFitsBudget(fullMeasurement, HISTORY_COMPACTION_TARGET_RATIO)) {
    return fullPrompt;
  }
  if (transcript.length === 0) {
    contextStats.compactionBlockedReason = "fixed_overhead";
    return fullPrompt;
  }

  const mandatoryIndices = new Set();
  const latestUserIndex = transcript.findLastIndex((entry) =>
    entry.role === "user" && typeof entry.content === "string");
  if (latestUserIndex >= 0) mandatoryIndices.add(latestUserIndex);
  for (
    let index = Math.max(0, transcript.length - MIN_RECENT_HISTORY_ENTRIES);
    index < transcript.length;
    index += 1
  ) {
    mandatoryIndices.add(index);
  }

  let ledgerLimit = Math.min(
    MAX_HISTORY_COMPACTION_LEDGER_CHARS,
    Math.max(2_048, Math.floor(fullPrompt.length * 0.08)),
  );
  const makeCandidate = (retainedIndices) => {
    const retained = [];
    const omitted = [];
    for (let index = 0; index < transcript.length; index += 1) {
      (retainedIndices.has(index) ? retained : omitted).push(transcript[index]);
    }
    const ledger = omitted.length
      ? makeHistoryCompactionEntry(omitted, ledgerLimit)
      : null;
    const candidateTranscript = ledger ? [ledger, ...retained] : retained;
    const prompt = buildConversationPrompt(candidateTranscript, latestUserEcho);
    return {
      ledger,
      measurement: measurementFor(prompt),
      omitted,
      prompt,
      retained,
    };
  };

  let retainedIndices = new Set(mandatoryIndices);
  let candidate = makeCandidate(retainedIndices);
  while (!measurementFitsBudget(candidate.measurement, HISTORY_COMPACTION_TARGET_RATIO)
    && ledgerLimit > 2_048) {
    ledgerLimit = Math.max(2_048, Math.floor(ledgerLimit / 2));
    candidate = makeCandidate(retainedIndices);
  }

  if (measurementFitsBudget(candidate.measurement, HISTORY_COMPACTION_TARGET_RATIO)) {
    // Retain the largest recent contiguous window that fits. Binary search
    // bounds tokenizer work for very long Codex tasks instead of repeatedly
    // encoding nearly identical multi-megabyte prompts.
    let low = 0;
    let high = transcript.length;
    while (low < high) {
      const startIndex = Math.floor((low + high) / 2);
      const trialIndices = new Set(mandatoryIndices);
      for (let index = startIndex; index < transcript.length; index += 1) {
        trialIndices.add(index);
      }
      const trial = makeCandidate(trialIndices);
      if (measurementFitsBudget(trial.measurement, HISTORY_COMPACTION_TARGET_RATIO)) {
        high = startIndex;
        retainedIndices = trialIndices;
        candidate = trial;
      } else {
        low = startIndex + 1;
      }
    }
  }

  if (candidate.omitted.length === 0) return fullPrompt;
  contextStats.historyCompacted = true;
  contextStats.omittedHistoryEntries = candidate.omitted.length;
  contextStats.omittedHistoryChars = candidate.omitted
    .reduce((total, entry) => total + JSON.stringify(entry).length, 0);
  contextStats.retainedHistoryEntries = candidate.retained.length;
  contextStats.compactionLedgerChars = JSON.stringify(candidate.ledger).length;
  if (!measurementFitsBudget(candidate.measurement, HISTORY_COMPACTION_TARGET_RATIO)) {
    contextStats.compactionBlockedReason = "mandatory_recent_history";
  }
  return candidate.prompt;
}

export function buildSessionInput(
  body,
  fallbackWorkingDirectory = process.cwd(),
  contextBudget = {},
) {
  const attachments = [];
  const contextStats = {
    imageAttachments: 0,
    omittedImageAttachments: 0,
    attachmentBase64Chars: 0,
    truncatedToolOutputs: 0,
    omittedToolOutputChars: 0,
    historyCompacted: false,
    omittedHistoryEntries: 0,
    omittedHistoryChars: 0,
    retainedHistoryEntries: 0,
    compactionLedgerChars: 0,
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

  const inputItems = typeof body?.input === "string"
    ? [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: body.input }],
    }]
    : (Array.isArray(body?.input) ? body.input : []);
  for (let sourceIndex = 0; sourceIndex < inputItems.length; sourceIndex += 1) {
    const item = inputItems[sourceIndex];
    if (item?.type === "additional_tools") continue;
    if (item?.type === "reasoning" && contextBudget.reasoningContext === "current_turn") {
      continue;
    }
    const entry = historyEntry(item, attachments, contextStats, sourceIndex);
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
  const latestUserEntry = [...transcript]
    .reverse()
    .find((entry) => entry.role === "user" && typeof entry.content === "string");
  const latestUserText = latestUserEntry?.content ?? "";
  const latestUserEcho = latestUserText.length <= MAX_LATEST_USER_ECHO_CHARS
    ? latestUserText
    : `${latestUserText.slice(0, MAX_LATEST_USER_ECHO_CHARS)}\n...[latest user request clipped by bridge]`;
  const toolCount = extractToolDeclarations(body).sdkTools.length;
  const requiresAction = toolCount > 0 && ACTION_REQUEST.test(latestUserText);

  const bridgeInstructions = [
    "You are the language model inside an outer Codex coding harness.",
    "The outer Codex harness owns all tool execution, permission checks, filesystem access, and user approvals.",
    "Only request tools through the custom declarations supplied to this session. Never claim a tool ran before its result is returned.",
    "Tool names beginning with codex__ are bridge aliases. Their descriptions identify the exact outer namespace and tool name.",
    "For an outer free-form/custom tool, pass an object with one string field named input; put the complete raw tool input in that string.",
    "Follow the outer developer instructions below, subject to GitHub Copilot service policies and the SDK safety rules that remain enabled.",
    ...(Array.isArray(contextBudget.systemInstructions)
      ? contextBudget.systemInstructions.filter((instruction) =>
        typeof instruction === "string" && instruction.trim())
      : []),
  ].join("\n");

  let systemContent = [
    bridgeInstructions,
    ...developerInstructions.map((instruction, index) =>
      `\n--- Outer developer instruction ${index + 1} ---\n${instruction}`),
  ].join("\n");

  let prompt = compactTranscriptWithinBudget({
    transcript,
    latestUserEcho,
    systemContent,
    contextStats,
    maxSerializedTextChars: contextBudget.maxSerializedTextChars,
    maxSerializedTextTokens: contextBudget.maxSerializedTextTokens,
    countTokens: contextBudget.countTokens,
    serializedToolDefinitions: contextBudget.serializedToolDefinitions,
    toolDefinitionChars: contextBudget.toolDefinitionChars,
    useHistoryCompaction: contextBudget.useHistoryCompaction !== false,
  });
  const maxImageAttachments = Math.max(0, Number.isFinite(Number(
    contextBudget.maxImageAttachments,
  )) ? Number(contextBudget.maxImageAttachments) : MAX_IMAGE_ATTACHMENTS);
  const maxAttachmentBase64Chars = Math.max(0, Number.isFinite(Number(
    contextBudget.maxAttachmentBase64Chars,
  )) ? Number(contextBudget.maxAttachmentBase64Chars) : MAX_ATTACHMENT_BASE64_CHARS);
  const maxSingleAttachmentBase64Chars = Math.max(0, Number.isFinite(Number(
    contextBudget.maxSingleAttachmentBase64Chars,
  ))
    ? Number(contextBudget.maxSingleAttachmentBase64Chars)
    : maxAttachmentBase64Chars);
  ({ systemContent, prompt } = finalizeImageAttachments({
    attachments,
    systemContent,
    prompt,
    contextStats,
    maxImageAttachments,
    maxAttachmentBase64Chars,
    maxSingleAttachmentBase64Chars,
  }));
  contextStats.promptChars = prompt.length;
  contextStats.systemChars = systemContent.length;
  Object.assign(contextStats, serializedContextMeasurement({
    systemContent,
    prompt,
    serializedToolDefinitions: contextBudget.serializedToolDefinitions,
    toolDefinitionChars: contextBudget.toolDefinitionChars,
    maxSerializedTextChars: contextBudget.maxSerializedTextChars,
    maxSerializedTextTokens: contextBudget.maxSerializedTextTokens,
    countTokens: contextBudget.countTokens,
  }));

  return {
    systemContent,
    prompt,
    attachments,
    contextStats,
    workingDirectory,
    latestUserText,
    requiresAction,
  };
}

export function assertSerializedContextWithinLimit(
  sessionInput,
  sdkTools,
  contextBudget,
) {
  const legacySignature = typeof contextBudget === "number";
  const normalizedBudget = legacySignature
    ? { maxSerializedTextChars: contextBudget }
    : (contextBudget ?? {});
  const serializedToolDefinitions = JSON.stringify(Array.isArray(sdkTools) ? sdkTools : []);
  const measurement = serializedContextMeasurement({
    systemContent: sessionInput?.systemContent,
    prompt: sessionInput?.prompt,
    serializedToolDefinitions,
    maxSerializedTextChars: normalizedBudget.maxSerializedTextChars,
    maxSerializedTextTokens: normalizedBudget.maxSerializedTextTokens,
    countTokens: normalizedBudget.countTokens,
  });

  if (measurement.budgetMode === "tokens"
    && measurement.serializedTextTokens > measurement.maxSerializedTextTokens) {
    throw new Error(
      `Bridge token context guard rejected ${measurement.serializedTextTokens} serialized text tokens; limit is ${measurement.maxSerializedTextTokens}. `
      + "Start a fresh Codex task or remove unusually large text/tool history.",
    );
  }
  if (measurement.budgetMode !== "tokens"
    && measurement.maxSerializedTextChars
    && measurement.serializedTextChars > measurement.maxSerializedTextChars) {
    throw new Error(
      `Bridge context guard rejected ${measurement.serializedTextChars} serialized text characters; limit is ${measurement.maxSerializedTextChars}. `
      + "Start a fresh Codex task or remove unusually large text/tool history.",
    );
  }
  if (legacySignature) {
    delete measurement.budgetMode;
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

export function normalizeReasoningSummary(reasoning = {}) {
  const effort = normalizeReasoningEffort(reasoning?.effort);
  const requested = reasoning?.summary ?? reasoning?.generate_summary;
  if (requested === false || requested === "none" || effort === "none") return "none";
  if (requested === "detailed") return "detailed";
  if (requested === true || requested === "auto" || requested === "concise") {
    return "concise";
  }
  return "concise";
}

export class RequestCompatibilityError extends Error {
  constructor(param, message) {
    super(message);
    this.name = "RequestCompatibilityError";
    this.code = "unsupported_parameter";
    this.param = param;
    this.statusCode = 400;
  }
}

function rejectUnsupported(param, detail) {
  throw new RequestCompatibilityError(
    param,
    `The GitHub Copilot relay cannot honor ${param}${detail ? `: ${detail}` : "."}`,
  );
}

function defaultSamplingValue(value) {
  return value == null || Number(value) === 1;
}

function validatePortableTool(tool, param = "tools") {
  if (!tool || typeof tool !== "object") rejectUnsupported(param, "tool declarations must be objects");
  if (tool.type === "namespace") {
    for (const child of Array.isArray(tool.tools) ? tool.tools : []) {
      validatePortableTool(child, param);
    }
    return;
  }
  if (!["function", "custom"].includes(tool.type)) {
    rejectUnsupported(
      param,
      `hosted tool type ${JSON.stringify(tool.type ?? "unknown")} has no outer Codex execution mapping`,
    );
  }
}

function validatePortableTools(body) {
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
    validatePortableTool(tool);
  }
  for (const item of Array.isArray(body?.input) ? body.input : []) {
    if (item?.type !== "additional_tools") continue;
    for (const tool of Array.isArray(item.tools) ? item.tools : []) {
      validatePortableTool(tool, "input.additional_tools");
    }
  }
}

function normalizeToolChoice(value) {
  const requested = value ?? "auto";
  if (["auto", "none", "required"].includes(requested)) return requested;
  if (requested && typeof requested === "object"
    && ["function", "custom"].includes(requested.type)
    && typeof requested.name === "string"
    && requested.name) {
    return {
      mode: "specific",
      type: requested.type,
      name: requested.name,
      namespace: typeof requested.namespace === "string" ? requested.namespace : null,
    };
  }
  rejectUnsupported(
    "tool_choice",
    "supported choices are auto, none, required, or a named function/custom outer tool",
  );
}

export function resolveRequestCompatibility(body = {}) {
  validatePortableTools(body);
  if (body.background === true) rejectUnsupported("background", "background responses are not implemented");
  if (body.conversation != null) rejectUnsupported("conversation", "server-side Conversations state is not implemented");
  if (body.prompt != null) rejectUnsupported("prompt", "OpenAI-hosted prompt templates are unavailable through Copilot");
  if (body.store === true) rejectUnsupported("store", "responses are local and are not retrievable through the OpenAI API");
  if (body.moderation != null) rejectUnsupported("moderation", "OpenAI moderation configuration is provider-specific");
  if (body.max_tool_calls != null) rejectUnsupported("max_tool_calls", "this limit applies to hosted tools, which remain outside the relay");
  if (!defaultSamplingValue(body.temperature)) {
    rejectUnsupported("temperature", "Copilot does not expose per-request sampling temperature");
  }
  if (!defaultSamplingValue(body.top_p)) {
    rejectUnsupported("top_p", "Copilot does not expose per-request nucleus sampling");
  }
  if (body.top_logprobs != null && Number(body.top_logprobs) !== 0) {
    rejectUnsupported("top_logprobs", "Copilot does not return token log probabilities");
  }

  const serviceTier = body.service_tier ?? null;
  if (serviceTier != null && !["auto", "default"].includes(serviceTier)) {
    rejectUnsupported("service_tier", `tier ${JSON.stringify(serviceTier)} has no Copilot equivalent`);
  }

  const reasoningMode = body.reasoning?.mode ?? "standard";
  if (!["standard", null].includes(reasoningMode)) {
    rejectUnsupported("reasoning.mode", `mode ${JSON.stringify(reasoningMode)} has no Copilot SDK equivalent`);
  }
  const reasoningContext = body.reasoning?.context ?? "auto";
  if (!["auto", "all_turns", "current_turn", null].includes(reasoningContext)) {
    rejectUnsupported("reasoning.context", `context mode ${JSON.stringify(reasoningContext)} is unknown`);
  }

  const textFormat = body.text?.format;
  if (textFormat != null && textFormat.type !== "text") {
    rejectUnsupported("text.format", "structured output enforcement is not implemented");
  }
  const textVerbosity = body.text?.verbosity ?? null;
  if (textVerbosity != null && !["low", "medium", "high"].includes(textVerbosity)) {
    rejectUnsupported("text.verbosity", `verbosity ${JSON.stringify(textVerbosity)} is unknown`);
  }

  const toolChoice = normalizeToolChoice(body.tool_choice);
  const parallelToolCalls = body.parallel_tool_calls ?? true;
  if (body.parallel_tool_calls != null && typeof body.parallel_tool_calls !== "boolean") {
    rejectUnsupported("parallel_tool_calls", "the value must be a boolean");
  }

  const maxOutputTokens = body.max_output_tokens == null
    ? null
    : Number(body.max_output_tokens);
  if (maxOutputTokens != null
    && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0)) {
    rejectUnsupported("max_output_tokens", "the value must be a positive integer");
  }

  const truncation = body.truncation ?? "auto";
  if (!["auto", "disabled"].includes(truncation)) {
    rejectUnsupported("truncation", `strategy ${JSON.stringify(truncation)} is unknown`);
  }

  const reasoningEffort = normalizeReasoningEffort(body.reasoning?.effort);
  const reasoningSummary = normalizeReasoningSummary({
    ...body.reasoning,
    effort: reasoningEffort,
  });
  const systemInstructions = [];
  if (!parallelToolCalls) {
    systemInstructions.push(
      "The outer Responses request disables parallel tool calls. Request at most one outer tool in each assistant turn, then wait for its result before requesting another.",
    );
  }
  if (textVerbosity) {
    systemInstructions.push(
      `The outer Responses request selects ${textVerbosity} verbosity. Use ${textVerbosity} verbosity by default while preserving required facts, evidence, caveats, and next steps.`,
    );
  }
  if (toolChoice === "none") {
    systemInstructions.push("The outer Responses request disables tool use for this turn. Return a text response without requesting a tool.");
  } else if (toolChoice === "required") {
    systemInstructions.push("The outer Responses request requires tool use. Request at least one available outer tool before returning a final answer.");
  } else if (toolChoice?.mode === "specific") {
    const qualifiedTool = toolChoice.namespace
      ? `${toolChoice.namespace}.${toolChoice.name}`
      : toolChoice.name;
    systemInstructions.push(
      `The outer Responses request requires the specific ${toolChoice.type} tool ${qualifiedTool}. Request that tool before returning a final answer.`,
    );
  }

  return {
    maxOutputTokens,
    parallelToolCalls,
    reasoningContext,
    reasoningEffort,
    reasoningSummary,
    serviceTier,
    systemInstructions,
    textVerbosity,
    toolChoice,
    truncation,
    useHistoryCompaction: truncation !== "disabled",
  };
}

export function resolveModelCompatibility(model) {
  const limits = model?.capabilities?.limits ?? {};
  const vision = limits.vision ?? {};
  const tokenPrices = model?.billing?.tokenPrices ?? {};
  const longContext = tokenPrices.longContext;
  const basePromptTokens = Number(tokenPrices.maxPromptTokens);
  const longPromptTokens = Number(longContext?.maxPromptTokens);
  const hasLongContext = Number.isFinite(longPromptTokens)
    && longPromptTokens > 0
    && (!Number.isFinite(basePromptTokens) || longPromptTokens > basePromptTokens);
  const capabilityPromptTokens = Number(limits.max_prompt_tokens);
  const maxPromptTokens = hasLongContext
    ? longPromptTokens
    : (Number.isFinite(capabilityPromptTokens)
        ? capabilityPromptTokens
        : (Number.isFinite(basePromptTokens) ? basePromptTokens : null));
  const supportsVision = model?.capabilities?.supports?.vision !== false;
  const advertisedImageCount = Number(vision.max_prompt_images);
  const maxImageAttachments = supportsVision
    ? (Number.isFinite(advertisedImageCount)
        ? Math.max(0, Math.floor(advertisedImageCount))
        : MAX_IMAGE_ATTACHMENTS)
    : 0;
  const advertisedImageBytes = Number(vision.max_prompt_image_size);
  const maxSingleAttachmentBase64Chars = Number.isFinite(advertisedImageBytes)
    && advertisedImageBytes > 0
    ? 4 * Math.ceil(advertisedImageBytes / 3)
    : MAX_ATTACHMENT_BASE64_CHARS;
  const maxAttachmentBase64Chars = Math.min(
    MAX_ATTACHMENT_BASE64_CHARS,
    maxImageAttachments * maxSingleAttachmentBase64Chars,
  );

  return {
    contextTier: hasLongContext ? "long_context" : "default",
    maxPromptTokens,
    maxOutputTokens: Number.isFinite(Number(limits.max_output_tokens))
      ? Number(limits.max_output_tokens)
      : null,
    maxContextWindowTokens: Number.isFinite(Number(limits.max_context_window_tokens))
      ? Number(limits.max_context_window_tokens)
      : null,
    maxImageAttachments,
    maxAttachmentBase64Chars,
    maxSingleAttachmentBase64Chars,
    supportedMediaTypes: Array.isArray(vision.supported_media_types)
      ? [...vision.supported_media_types]
      : [],
  };
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

function contentOutputToText(
  output,
  attachments = null,
  contextStats = null,
  attachmentContext = {},
) {
  if (typeof output === "string") return output;
  if (!Array.isArray(output)) return JSON.stringify(output ?? null);
  return output.map((piece) => {
    if (typeof piece === "string") return piece;
    if (!piece || typeof piece !== "object") return String(piece ?? "");
    if (["input_text", "output_text"].includes(piece.type)) return String(piece.text ?? "");
    if (piece.type === "input_image") {
      if (attachments && contextStats) {
        return stringifyContentPiece(
          piece,
          attachments,
          contextStats,
          attachmentContext,
        );
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

export function makeAssistantMessageItem(text, { phase = null, id = null } = {}) {
  const item = {
    id: typeof id === "string" && id ? id : `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: String(text ?? ""), annotations: [] }],
  };
  if (typeof phase === "string" && phase) item.phase = phase;
  return item;
}

export function makeReasoningItem(text, { id = null } = {}) {
  return {
    id: typeof id === "string" && id ? id : `rs_${randomUUID().replaceAll("-", "")}`,
    type: "reasoning",
    status: "completed",
    summary: [{ type: "summary_text", text: String(text ?? "") }],
  };
}

export function makeResponseObject({
  responseId,
  model,
  output,
  usage,
  requestBody = {},
  status = "completed",
}) {
  const normalizedUsage = usage ?? {
    input_tokens: 0,
    input_tokens_details: null,
    output_tokens: 0,
    output_tokens_details: null,
    total_tokens: 0,
  };
  const response = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    error: null,
    incomplete_details: null,
    instructions: requestBody.instructions ?? null,
    max_output_tokens: requestBody.max_output_tokens ?? null,
    model,
    output,
    parallel_tool_calls: requestBody.parallel_tool_calls ?? true,
    previous_response_id: requestBody.previous_response_id ?? null,
    reasoning: requestBody.reasoning ?? { effort: null, summary: null },
    service_tier: requestBody.service_tier ?? "default",
    store: requestBody.store ?? false,
    temperature: requestBody.temperature ?? null,
    text: {
      format: { type: "text" },
      ...(requestBody.text ?? {}),
    },
    tool_choice: requestBody.tool_choice ?? "auto",
    tools: Array.isArray(requestBody.tools) ? requestBody.tools : [],
    top_p: requestBody.top_p ?? null,
    truncation: requestBody.truncation ?? "disabled",
    usage: status === "completed" ? normalizedUsage : null,
    metadata: requestBody.metadata ?? {},
  };
  if (status === "completed") response.completed_at = Math.floor(Date.now() / 1000);
  return response;
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
