import assert from "node:assert/strict";
import test from "node:test";

import {
  createModelRoutingPolicy,
  MODEL_ROUTING_LOCKED_DEFAULT,
  MODEL_ROUTING_PER_REQUEST,
  resolveModelRouting,
} from "./model-routing.mjs";

test("locked-default routing preserves the requested model while selecting Astra xhigh", () => {
  const policy = createModelRoutingPolicy({
    mode: MODEL_ROUTING_LOCKED_DEFAULT,
    lockedReasoningEffort: "xhigh",
  });

  const routing = resolveModelRouting({
    requestedModel: "gpt-5.6-sol",
    defaultModel: "gpt-6-astra",
    requestedReasoningEffort: "max",
    policy,
  });

  assert.deepEqual(routing, {
    mode: MODEL_ROUTING_LOCKED_DEFAULT,
    requestedModel: "gpt-5.6-sol",
    selectedModel: "gpt-6-astra",
    requestedReasoningEffort: "max",
    reasoningEffort: "xhigh",
  });
});

test("locked-default routing also covers requests with no explicit model", () => {
  const policy = createModelRoutingPolicy({
    mode: MODEL_ROUTING_LOCKED_DEFAULT,
    lockedReasoningEffort: "xhigh",
  });

  const routing = resolveModelRouting({
    requestedModel: null,
    defaultModel: "gpt-6-astra",
    requestedReasoningEffort: "low",
    policy,
  });

  assert.equal(routing.requestedModel, null);
  assert.equal(routing.selectedModel, "gpt-6-astra");
  assert.equal(routing.reasoningEffort, "xhigh");
});

test("per-request routing remains available for non-Astra installations", () => {
  const policy = createModelRoutingPolicy();
  const routing = resolveModelRouting({
    requestedModel: "gpt-5.6-terra",
    defaultModel: "gpt-5.6-sol",
    requestedReasoningEffort: "high",
    policy,
  });

  assert.equal(routing.mode, MODEL_ROUTING_PER_REQUEST);
  assert.equal(routing.selectedModel, "gpt-5.6-terra");
  assert.equal(routing.reasoningEffort, "high");
});

test("locked-default routing rejects a missing or invalid effort", () => {
  assert.throws(
    () => createModelRoutingPolicy({ mode: MODEL_ROUTING_LOCKED_DEFAULT }),
    /BRIDGE_LOCKED_REASONING_EFFORT/,
  );
  assert.throws(
    () => createModelRoutingPolicy({
      mode: MODEL_ROUTING_LOCKED_DEFAULT,
      lockedReasoningEffort: "ultra",
    }),
    /BRIDGE_LOCKED_REASONING_EFFORT/,
  );
});
