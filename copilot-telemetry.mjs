import { estimateOpenAiEquivalent } from "./pricing.mjs";

function nonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function nullableNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function safeModel(value) {
  if (typeof value !== "string") return "unknown";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "unknown";
}

export function normalizeAssistantUsage(value) {
  if (!value || typeof value !== "object") return null;
  return {
    model: safeModel(value.model),
    inputTokens: nonNegative(value.inputTokens),
    outputTokens: nonNegative(value.outputTokens),
    cacheReadTokens: nonNegative(value.cacheReadTokens),
    cacheWriteTokens: nonNegative(value.cacheWriteTokens),
    reasoningTokens: nonNegative(value.reasoningTokens),
    copilotCostUnits: nonNegative(value.copilotCostUnits ?? value.cost),
    totalNanoAiu: nonNegative(value.totalNanoAiu ?? value.copilotUsage?.totalNanoAiu),
    apiDurationMs: nonNegative(value.apiDurationMs ?? value.durationMs ?? value.duration),
  };
}

export function summarizeAssistantUsage(values = []) {
  const events = (Array.isArray(values) ? values : [])
    .map(normalizeAssistantUsage)
    .filter(Boolean);
  const estimate = estimateOpenAiEquivalent(events);
  const modelMap = new Map();
  const summary = {
    metered: events.length > 0,
    sdkApiCalls: events.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalNanoAiu: 0,
    copilotCostUnits: 0,
    apiDurationMs: 0,
    apiEquivalentUsd: estimate.usd,
    pricedApiCalls: estimate.pricedApiCalls,
    unpricedApiCalls: estimate.unpricedApiCalls,
    priceSourceDate: estimate.sourceDate,
    models: [],
  };
  for (const event of events) {
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "reasoningTokens",
      "totalNanoAiu",
      "copilotCostUnits",
      "apiDurationMs",
    ]) summary[field] += event[field];
    const row = modelMap.get(event.model) ?? {
      model: event.model,
      sdkApiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalNanoAiu: 0,
      copilotCostUnits: 0,
      apiDurationMs: 0,
      apiEquivalentUsd: 0,
    };
    row.sdkApiCalls += 1;
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "reasoningTokens",
      "totalNanoAiu",
      "copilotCostUnits",
      "apiDurationMs",
    ]) row[field] += event[field];
    modelMap.set(event.model, row);
  }
  for (const estimateRow of estimate.byModel) {
    const row = modelMap.get(estimateRow.model);
    if (row) row.apiEquivalentUsd = estimateRow.usd;
  }
  summary.models = [...modelMap.values()].sort((left, right) => right.sdkApiCalls - left.sdkApiCalls);
  return summary;
}

export function toResponsesUsage(summary) {
  const inputTokens = nonNegative(summary?.inputTokens);
  const outputTokens = nonNegative(summary?.outputTokens);
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: nonNegative(summary?.cacheReadTokens) },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: nonNegative(summary?.reasoningTokens) },
    total_tokens: inputTokens + outputTokens,
  };
}

export function normalizeQuotaResult(value, updatedAt = new Date().toISOString()) {
  const snapshots = Object.create(null);
  if (value?.quotaSnapshots && typeof value.quotaSnapshots === "object") {
    for (const [key, item] of Object.entries(value.quotaSnapshots)) {
      if (typeof key !== "string" || !item || typeof item !== "object") continue;
      const safeKey = key.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
      if (!safeKey) continue;
      const remaining = nonNegative(item.remainingPercentage);
      snapshots[safeKey] = {
        isUnlimitedEntitlement: Boolean(item.isUnlimitedEntitlement),
        entitlementRequests: nonNegative(item.entitlementRequests),
        usedRequests: nonNegative(item.usedRequests),
        remainingPercentage: Math.min(100, remaining),
        overage: nonNegative(item.overage),
        resetDate: typeof item.resetDate === "string" ? item.resetDate.slice(0, 64) : null,
        usageAllowedWithExhaustedQuota: Boolean(item.usageAllowedWithExhaustedQuota),
        overageAllowedWithExhaustedQuota: Boolean(item.overageAllowedWithExhaustedQuota),
      };
    }
  }
  return {
    status: "available",
    lastUpdatedAt: updatedAt,
    snapshots,
  };
}

function safeTokenPrices(value) {
  if (!value || typeof value !== "object") return null;
  return {
    inputPrice: nullableNumber(value.inputPrice),
    outputPrice: nullableNumber(value.outputPrice),
    cacheReadPrice: nullableNumber(value.cacheReadPrice ?? value.cachePrice),
    cacheWritePrice: nullableNumber(value.cacheWritePrice),
    batchSize: nullableNumber(value.batchSize),
    contextMax: nullableNumber(value.contextMax ?? value.maxPromptTokens),
    longContext: value.longContext ? safeTokenPrices({ ...value.longContext, longContext: null }) : null,
  };
}

export function safeCopilotModelBilling(models = []) {
  return (Array.isArray(models) ? models : [])
    .filter((model) => model && typeof model.id === "string" && model.id.startsWith("gpt-"))
    .map((model) => ({
      id: safeModel(model.id),
      multiplier: Number.isFinite(model.billing?.multiplier) ? model.billing.multiplier : 1,
      tokenPrices: safeTokenPrices(model.billing?.tokenPrices),
    }))
    .filter((model) => model.tokenPrices)
    .sort((left, right) => left.id.localeCompare(right.id));
}
