import assert from "node:assert/strict";
import test from "node:test";
import { ResponsesEventStream } from "./responses-stream.mjs";

test("emits the standard Responses text streaming lifecycle in order", () => {
  const events = [];
  const stream = new ResponsesEventStream({
    responseId: "resp-test",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => events.push(event),
  });

  stream.start();
  stream.appendTextDelta("Hello");
  const item = stream.finishText("Hello world");
  const completed = stream.complete([item], {
    input_tokens: 1,
    output_tokens: 2,
    total_tokens: 3,
  });

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.content_part.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_text.done",
    "response.content_part.done",
    "response.output_item.done",
    "response.completed",
  ]);
  assert.deepEqual(events.map((event) => event.sequence_number), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(events[0].response.status, "in_progress");
  assert.equal(events.at(-1).response.status, "completed");
  assert.equal(events.at(-1).response.output[0].content[0].text, "Hello world");
  assert.equal(completed.id, "resp-test");
});

test("emits a harmless sequenced Responses event as an application heartbeat", () => {
  const events = [];
  const stream = new ResponsesEventStream({
    responseId: "resp-heartbeat",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => events.push(event),
  });

  stream.start();
  stream.heartbeat();
  stream.heartbeat();

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.in_progress",
    "response.in_progress",
    "response.in_progress",
  ]);
  assert.deepEqual(events.map((event) => event.sequence_number), [0, 1, 2, 3]);
  assert.equal(events.at(-1).response.id, "resp-heartbeat");
  assert.equal(events.at(-1).response.status, "in_progress");
});

test("emits tool items before the terminal completed event", () => {
  const events = [];
  const stream = new ResponsesEventStream({
    responseId: "resp-tool",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => events.push(event),
  });
  stream.start();
  const item = {
    id: "item-tool",
    type: "function_call",
    call_id: "call-tool",
    name: "echo",
    arguments: "{\"value\":1}",
    status: "completed",
  };
  stream.finishItem(item);
  stream.complete([item], null);

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.function_call_arguments.done",
    "response.output_item.done",
    "response.completed",
  ]);
});

test("emits phase-aware commentary and reasoning summary events", () => {
  const events = [];
  const stream = new ResponsesEventStream({
    responseId: "resp-reasoning",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => events.push(event),
  });

  stream.start();
  stream.appendReasoningDelta("Validated", { reasoningId: "sdk-reasoning-1" });
  const reasoningItem = stream.finishReasoning(
    "Validated the inputs.",
    { reasoningId: "sdk-reasoning-1" },
  );
  stream.appendTextDelta("Working", {
    messageId: "sdk-message-1",
    phase: "commentary",
  });
  const commentaryItem = stream.finishText("Working on it.", {
    messageId: "sdk-message-1",
    phase: "commentary",
  });
  stream.complete([reasoningItem, commentaryItem], null);

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.reasoning_summary_part.added",
    "response.reasoning_summary_text.delta",
    "response.reasoning_summary_text.delta",
    "response.reasoning_summary_text.done",
    "response.reasoning_summary_part.done",
    "response.output_item.done",
    "response.output_item.added",
    "response.content_part.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_text.done",
    "response.content_part.done",
    "response.output_item.done",
    "response.completed",
  ]);
  assert.equal(commentaryItem.phase, "commentary");
  assert.equal(reasoningItem.summary[0].text, "Validated the inputs.");
  assert.deepEqual(
    events.map((event) => event.sequence_number),
    events.map((_, index) => index),
  );
});

test("streams outer function arguments before completing the tool item", () => {
  const events = [];
  const stream = new ResponsesEventStream({
    responseId: "resp-tool-delta",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => events.push(event),
  });
  stream.start();
  stream.appendToolCallDelta('{"path":', {
    kind: "function",
    name: "read_file",
    namespace: "functions",
    toolCallId: "call-streamed",
  });
  stream.appendToolCallDelta('"README.md"}', { toolCallId: "call-streamed" });
  const item = {
    id: "temporary-final-id",
    type: "function_call",
    call_id: "call-streamed",
    namespace: "functions",
    name: "read_file",
    arguments: '{"path":"README.md"}',
    status: "completed",
  };
  stream.finishItem(item);
  stream.complete([item], null);

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.done",
    "response.output_item.done",
    "response.completed",
  ]);
  assert.notEqual(item.id, "temporary-final-id");
  assert.equal(events[2].item.call_id, "call-streamed");
  assert.equal(events[5].arguments, '{"path":"README.md"}');
});

test("emits a sequenced terminal response.failed event", () => {
  const events = [];
  const stream = new ResponsesEventStream({
    responseId: "resp-failed",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => events.push(event),
  });
  stream.start();
  stream.fail({
    id: "resp-failed",
    object: "response",
    status: "failed",
    error: { code: "invalid_prompt", message: "Context is too large." },
    output: [],
  });

  assert.deepEqual(events.map((event) => event.type), [
    "response.created",
    "response.in_progress",
    "response.failed",
  ]);
  assert.deepEqual(events.map((event) => event.sequence_number), [0, 1, 2]);
  assert.equal(events.at(-1).response.error.code, "invalid_prompt");
});
