export const MODEL_ROUTING_PER_REQUEST = "per-request";
export const MODEL_ROUTING_LOCKED_DEFAULT = "locked-default";

const ROUTING_MODES = new Set([
  MODEL_ROUTING_PER_REQUEST,
  MODEL_ROUTING_LOCKED_DEFAULT,
]);
const REASONING_EFFORTS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function createModelRoutingPolicy({
  mode = MODEL_ROUTING_PER_REQUEST,
  lockedReasoningEffort = null,
} = {}) {
  const normalizedMode = String(mode ?? MODEL_ROUTING_PER_REQUEST).trim().toLowerCase();
  if (!ROUTING_MODES.has(normalizedMode)) {
    throw new Error(`Unsupported relay model-routing mode ${JSON.stringify(mode)}.`);
  }

  if (normalizedMode === MODEL_ROUTING_PER_REQUEST) {
    return {
      mode: normalizedMode,
      lockedReasoningEffort: null,
    };
  }

  const normalizedEffort = String(lockedReasoningEffort ?? "").trim().toLowerCase();
  if (!REASONING_EFFORTS.has(normalizedEffort)) {
    throw new Error(
      "Locked-default model routing requires BRIDGE_LOCKED_REASONING_EFFORT "
      + "to be one of none, low, medium, high, xhigh, or max.",
    );
  }

  return {
    mode: normalizedMode,
    lockedReasoningEffort: normalizedEffort,
  };
}

export function resolveModelRouting({
  requestedModel,
  defaultModel,
  requestedReasoningEffort,
  policy,
}) {
  if (typeof defaultModel !== "string" || !defaultModel.trim()) {
    throw new Error("Relay model routing requires a non-empty default model.");
  }
  if (!policy || !ROUTING_MODES.has(policy.mode)) {
    throw new Error("Relay model routing requires a valid policy.");
  }

  const normalizedRequestedModel = typeof requestedModel === "string" && requestedModel.trim()
    ? requestedModel.trim()
    : null;
  const locked = policy.mode === MODEL_ROUTING_LOCKED_DEFAULT;

  return {
    mode: policy.mode,
    requestedModel: normalizedRequestedModel,
    selectedModel: locked ? defaultModel : (normalizedRequestedModel ?? defaultModel),
    requestedReasoningEffort,
    reasoningEffort: locked ? policy.lockedReasoningEffort : requestedReasoningEffort,
  };
}
