import assert from "node:assert/strict";
import test from "node:test";
import {
  BlankCompletionGuard,
  PrematureCompletionGuard,
  SlidingDeadline,
  resolveAssistantContent,
  startSseHeartbeat,
} from "./exchange-lifecycle.mjs";

test("blank assistant completions wait for idle and retry with a hard limit", () => {
  const guard = new BlankCompletionGuard({ maxRetries: 2 });

  assert.deepEqual(
    guard.observeAssistantMessage({ content: "", toolRequests: [] }),
    { kind: "await_idle" },
  );
  assert.deepEqual(guard.onSessionIdle(), {
    kind: "retry",
    attempt: 1,
    prompt: guard.recoveryPrompt,
  });

  guard.observeAssistantMessage({ content: "   ", toolRequests: [] });
  assert.equal(guard.onSessionIdle().attempt, 2);

  guard.observeAssistantMessage({ content: "", toolRequests: [] });
  assert.deepEqual(guard.onSessionIdle(), {
    kind: "fail",
    code: "blank_completion",
  });
});

test("idle without any assistant message is also recovered", () => {
  const guard = new BlankCompletionGuard({ maxRetries: 1 });
  guard.expectResponse();
  assert.equal(guard.onSessionIdle().kind, "retry");
});

test("a new outer turn receives a fresh bounded blank retry budget", () => {
  const guard = new BlankCompletionGuard({ maxRetries: 1 });

  guard.expectResponse({ resetRetries: true });
  assert.equal(guard.onSessionIdle().kind, "retry");
  guard.expectResponse();
  assert.equal(guard.onSessionIdle().kind, "fail");

  guard.expectResponse({ resetRetries: true });
  assert.deepEqual(guard.onSessionIdle(), {
    kind: "retry",
    attempt: 1,
    prompt: guard.recoveryPrompt,
  });
});

test("tool calls and non-empty messages are never mistaken for blank completions", () => {
  const guard = new BlankCompletionGuard();

  const toolDecision = guard.observeAssistantMessage({
    content: "",
    toolRequests: [{ toolCallId: "call-1" }],
  });
  assert.equal(toolDecision.kind, "tool_calls");
  assert.equal(toolDecision.toolRequests.length, 1);

  assert.deepEqual(
    guard.observeAssistantMessage({ content: "Finished.", toolRequests: [] }),
    { kind: "message", content: "Finished." },
  );
});

test("streamed text recovers a final event whose content field is empty", () => {
  assert.equal(
    resolveAssistantContent({ content: "" }, "Recovered from streamed deltas."),
    "Recovered from streamed deltas.",
  );
  assert.equal(
    resolveAssistantContent({ content: "Final content." }, "partial"),
    "Final content.",
  );
});

test("sliding deadline is refreshed by activity", () => {
  const scheduled = [];
  const cleared = [];
  let expired = 0;
  const deadline = new SlidingDeadline({
    timeoutMs: 900_000,
    onTimeout: () => { expired += 1; },
    setTimeoutFn: (callback, timeoutMs) => {
      const timer = { callback, timeoutMs, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => cleared.push(timer),
  });

  deadline.touch();
  deadline.touch(12 * 60 * 60 * 1000);
  assert.equal(scheduled.length, 2);
  assert.equal(cleared.length, 1);
  assert.equal(scheduled[1].timeoutMs, 12 * 60 * 60 * 1000);

  scheduled[1].callback();
  assert.equal(expired, 1);
  deadline.stop();
  assert.equal(cleared.length, 1);
});

test("progress-only final messages are recovered for actionable tool work", () => {
  const guard = new PrematureCompletionGuard({ maxRetries: 2 });

  const first = guard.observe({
    content: "I’m moving straight into production and opening the editor now.",
    requiresAction: true,
    toolCount: 9,
  });
  assert.equal(first.kind, "retry");
  assert.equal(first.attempt, 1);
  assert.match(first.prompt, /request the next necessary outer tool now/i);

  assert.deepEqual(
    guard.observe({
      content: "The final clip is rendered and saved to C:\\output.mp4.",
      requiresAction: true,
      toolCount: 9,
    }),
    { kind: "complete" },
  );
});

test("premature completion recovery is bounded and does not affect answers", () => {
  const guard = new PrematureCompletionGuard({ maxRetries: 1 });

  assert.deepEqual(
    guard.observe({
      content: "Here is the explanation you requested.",
      requiresAction: false,
      toolCount: 9,
    }),
    { kind: "complete" },
  );

  assert.equal(guard.observe({
    content: "I’ll start the requested edit now.",
    requiresAction: true,
    toolCount: 2,
  }).kind, "retry");
  assert.deepEqual(
    guard.observe({
      content: "I’ll try the requested edit again now.",
      requiresAction: true,
      toolCount: 2,
    }),
    { kind: "complete", exhausted: true },
  );
});

test("SSE heartbeat keeps a quiet streaming response active", () => {
  const writes = [];
  const listeners = new Map();
  let tick;
  let cleared = false;
  const response = {
    writableEnded: false,
    destroyed: false,
    write: (value) => writes.push(value),
    once: (event, callback) => listeners.set(event, callback),
  };

  const stop = startSseHeartbeat(response, {
    intervalMs: 15_000,
    setIntervalFn: (callback) => {
      tick = callback;
      return { unref() {} };
    },
    clearIntervalFn: () => { cleared = true; },
  });

  tick();
  assert.deepEqual(writes, [": keep-alive\n\n"]);
  listeners.get("close")();
  assert.equal(cleared, true);
  stop();
});
