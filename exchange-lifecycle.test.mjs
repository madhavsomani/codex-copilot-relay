import assert from "node:assert/strict";
import test from "node:test";
import {
  BlankCompletionGuard,
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
  deadline.touch();
  assert.equal(scheduled.length, 2);
  assert.equal(cleared.length, 1);
  assert.equal(scheduled[1].timeoutMs, 900_000);

  scheduled[1].callback();
  assert.equal(expired, 1);
  deadline.stop();
  assert.equal(cleared.length, 1);
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
