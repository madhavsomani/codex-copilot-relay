import { randomUUID } from "node:crypto";
import {
  makeAssistantMessageItem,
  makeReasoningItem,
  makeResponseObject,
} from "./bridge-core.mjs";

function inProgressItem(item) {
  if (item?.type === "message") {
    return { ...item, status: "in_progress", content: [] };
  }
  if (item?.type === "reasoning") {
    return { ...item, status: "in_progress", summary: [] };
  }
  return { ...item, status: "in_progress" };
}

export class ResponsesEventStream {
  constructor({ responseId, model, requestBody = {}, emit }) {
    this.responseId = responseId;
    this.model = model;
    this.requestBody = requestBody;
    this.emitCallback = emit;
    this.sequenceNumber = 0;
    this.started = false;
    this.closed = false;
    this.activeText = null;
    this.activeReasoning = null;
    this.activeTools = new Map();
    this.doneItemIds = new Set();
    this.nextOutputIndex = 0;
  }

  setModel(model) {
    this.model = model;
  }

  emit(event) {
    if (this.closed) return;
    this.emitCallback({ ...event, sequence_number: this.sequenceNumber });
    this.sequenceNumber += 1;
  }

  makeInProgressResponse() {
    return makeResponseObject({
      responseId: this.responseId,
      model: this.model,
      output: [],
      usage: null,
      requestBody: this.requestBody,
      status: "in_progress",
    });
  }

  start() {
    if (this.started) return;
    this.started = true;
    const response = this.makeInProgressResponse();
    this.emit({ type: "response.created", response });
    this.emit({ type: "response.in_progress", response });
  }

  heartbeat() {
    if (!this.started || this.closed) return;
    this.emit({
      type: "response.in_progress",
      response: this.makeInProgressResponse(),
    });
  }

  close() {
    this.closed = true;
  }

  allocateOutputIndex() {
    const outputIndex = this.nextOutputIndex;
    this.nextOutputIndex += 1;
    return outputIndex;
  }

  ensureTextItem(metadata = {}) {
    if (this.activeText) {
      if (!this.activeText.item.phase && metadata.phase) {
        this.activeText.item.phase = metadata.phase;
      }
      return this.activeText;
    }
    const item = makeAssistantMessageItem("", {
      id: metadata.messageId,
      phase: metadata.phase,
    });
    const outputIndex = this.allocateOutputIndex();
    this.activeText = { item, outputIndex, text: "" };
    this.emit({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: inProgressItem(item),
    });
    this.emit({
      type: "response.content_part.added",
      item_id: item.id,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    return this.activeText;
  }

  appendTextDelta(delta, metadata = {}) {
    if (!delta) return;
    const active = this.ensureTextItem(metadata);
    active.text += String(delta);
    this.emit({
      type: "response.output_text.delta",
      item_id: active.item.id,
      output_index: active.outputIndex,
      content_index: 0,
      delta: String(delta),
    });
  }

  finishText(text, metadata = {}) {
    const finalText = String(text ?? "");
    if (!finalText && !this.activeText) return null;
    const active = this.ensureTextItem(metadata);
    if (finalText.startsWith(active.text) && finalText.length > active.text.length) {
      this.appendTextDelta(finalText.slice(active.text.length), metadata);
    }
    const resolvedText = finalText || active.text;
    const item = makeAssistantMessageItem(resolvedText, {
      id: active.item.id,
      phase: metadata.phase ?? active.item.phase,
    });
    this.emit({
      type: "response.output_text.done",
      item_id: item.id,
      output_index: active.outputIndex,
      content_index: 0,
      text: resolvedText,
    });
    this.emit({
      type: "response.content_part.done",
      item_id: item.id,
      output_index: active.outputIndex,
      content_index: 0,
      part: item.content[0],
    });
    this.emit({
      type: "response.output_item.done",
      output_index: active.outputIndex,
      item,
    });
    this.doneItemIds.add(item.id);
    this.activeText = null;
    return item;
  }

  ensureReasoningItem(metadata = {}) {
    if (this.activeReasoning) return this.activeReasoning;
    const item = makeReasoningItem("", { id: metadata.reasoningId });
    const outputIndex = this.allocateOutputIndex();
    this.activeReasoning = { item, outputIndex, text: "" };
    this.emit({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: inProgressItem(item),
    });
    this.emit({
      type: "response.reasoning_summary_part.added",
      item_id: item.id,
      output_index: outputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    });
    return this.activeReasoning;
  }

  appendReasoningDelta(delta, metadata = {}) {
    if (!delta) return;
    const active = this.ensureReasoningItem(metadata);
    active.text += String(delta);
    this.emit({
      type: "response.reasoning_summary_text.delta",
      item_id: active.item.id,
      output_index: active.outputIndex,
      summary_index: 0,
      delta: String(delta),
    });
  }

  finishReasoning(text, metadata = {}) {
    const finalText = String(text ?? "");
    if (!finalText && !this.activeReasoning) return null;
    const active = this.ensureReasoningItem(metadata);
    if (finalText.startsWith(active.text) && finalText.length > active.text.length) {
      this.appendReasoningDelta(finalText.slice(active.text.length), metadata);
    }
    const resolvedText = finalText || active.text;
    const item = makeReasoningItem(resolvedText, { id: active.item.id });
    this.emit({
      type: "response.reasoning_summary_text.done",
      item_id: item.id,
      output_index: active.outputIndex,
      summary_index: 0,
      text: resolvedText,
    });
    this.emit({
      type: "response.reasoning_summary_part.done",
      item_id: item.id,
      output_index: active.outputIndex,
      summary_index: 0,
      part: item.summary[0],
    });
    this.emit({
      type: "response.output_item.done",
      output_index: active.outputIndex,
      item,
    });
    this.doneItemIds.add(item.id);
    this.activeReasoning = null;
    return item;
  }

  ensureToolItem(metadata = {}) {
    const toolCallId = String(metadata.toolCallId ?? "");
    if (!toolCallId) return null;
    const existing = this.activeTools.get(toolCallId);
    if (existing) return existing;
    const custom = metadata.kind === "custom";
    const item = {
      id: `item_${randomUUID().replaceAll("-", "")}`,
      type: custom ? "custom_tool_call" : "function_call",
      call_id: toolCallId,
      name: String(metadata.name ?? "tool"),
      status: "in_progress",
      ...(custom ? { input: "" } : { arguments: "" }),
    };
    if (metadata.namespace) item.namespace = metadata.namespace;
    const active = {
      input: "",
      item,
      outputIndex: this.allocateOutputIndex(),
    };
    this.activeTools.set(toolCallId, active);
    this.emit({
      type: "response.output_item.added",
      output_index: active.outputIndex,
      item,
    });
    return active;
  }

  appendToolCallDelta(delta, metadata = {}) {
    if (!delta) return;
    const active = this.ensureToolItem(metadata);
    if (!active) return;
    active.input += String(delta);
    const custom = active.item.type === "custom_tool_call";
    this.emit({
      type: custom
        ? "response.custom_tool_call_input.delta"
        : "response.function_call_arguments.delta",
      item_id: active.item.id,
      output_index: active.outputIndex,
      delta: String(delta),
    });
  }

  finishItem(item) {
    if (!item || this.doneItemIds.has(item.id)) return item;
    const active = typeof item.call_id === "string"
      ? this.activeTools.get(item.call_id)
      : null;
    if (active) {
      item.id = active.item.id;
      const custom = item.type === "custom_tool_call";
      const finalInput = String(custom ? item.input ?? "" : item.arguments ?? "");
      if (finalInput.startsWith(active.input) && finalInput.length > active.input.length) {
        this.appendToolCallDelta(finalInput.slice(active.input.length), {
          toolCallId: item.call_id,
        });
      }
      this.emit({
        type: custom
          ? "response.custom_tool_call_input.done"
          : "response.function_call_arguments.done",
        item_id: item.id,
        output_index: active.outputIndex,
        ...(custom
          ? { input: finalInput }
          : { name: item.name, arguments: finalInput }),
      });
      this.emit({
        type: "response.output_item.done",
        output_index: active.outputIndex,
        item,
      });
      this.doneItemIds.add(item.id);
      this.activeTools.delete(item.call_id);
      return item;
    }
    const outputIndex = this.allocateOutputIndex();
    this.emit({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: inProgressItem(item),
    });
    if (item.type === "function_call") {
      this.emit({
        type: "response.function_call_arguments.done",
        item_id: item.id,
        output_index: outputIndex,
        name: item.name,
        arguments: item.arguments,
      });
    } else if (item.type === "custom_tool_call") {
      this.emit({
        type: "response.custom_tool_call_input.done",
        item_id: item.id,
        output_index: outputIndex,
        input: item.input,
      });
    }
    this.emit({ type: "response.output_item.done", output_index: outputIndex, item });
    this.doneItemIds.add(item.id);
    return item;
  }

  complete(output, usage) {
    for (const item of output) this.finishItem(item);
    const response = makeResponseObject({
      responseId: this.responseId,
      model: this.model,
      output,
      usage,
      requestBody: this.requestBody,
      status: "completed",
    });
    this.emit({ type: "response.completed", response });
    this.closed = true;
    return response;
  }

  fail(response) {
    this.emit({ type: "response.failed", response });
    this.closed = true;
  }
}
