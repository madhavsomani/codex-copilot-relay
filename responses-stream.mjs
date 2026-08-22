import { makeAssistantMessageItem, makeResponseObject } from "./bridge-core.mjs";

function inProgressItem(item) {
  if (item?.type === "message") {
    return { ...item, status: "in_progress", content: [] };
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
    this.doneItemIds = new Set();
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

  ensureTextItem() {
    if (this.activeText) return this.activeText;
    const item = makeAssistantMessageItem("");
    const outputIndex = this.doneItemIds.size;
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

  appendTextDelta(delta) {
    if (!delta) return;
    const active = this.ensureTextItem();
    active.text += String(delta);
    this.emit({
      type: "response.output_text.delta",
      item_id: active.item.id,
      output_index: active.outputIndex,
      content_index: 0,
      delta: String(delta),
    });
  }

  finishText(text) {
    const finalText = String(text ?? "");
    if (!finalText && !this.activeText) return null;
    const active = this.ensureTextItem();
    if (finalText.startsWith(active.text) && finalText.length > active.text.length) {
      this.appendTextDelta(finalText.slice(active.text.length));
    }
    const resolvedText = finalText || active.text;
    const item = makeAssistantMessageItem(resolvedText);
    item.id = active.item.id;
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

  finishItem(item) {
    if (!item || this.doneItemIds.has(item.id)) return item;
    const outputIndex = this.doneItemIds.size;
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
