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
