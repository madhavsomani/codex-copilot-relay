const MODEL_BASE = "https://developers.openai.com/api/docs/models/";

export const OPENAI_PRICING_SNAPSHOT = Object.freeze({
  sourceDate: "2026-08-24",
  currency: "USD",
  basis: "OpenAI standard API text-token list prices per 1 million tokens",
  disclaimer: "API-equivalent estimate only; not an OpenAI or GitHub charge and not a Copilot invoice.",
  models: Object.freeze({
    "gpt-5-mini": {
      inputUsdPerMillion: 0.25,
      cachedInputUsdPerMillion: 0.025,
      outputUsdPerMillion: 2,
      sourceUrl: `${MODEL_BASE}gpt-5-mini`,
    },
    "gpt-5.3-codex": {
      inputUsdPerMillion: 1.75,
      cachedInputUsdPerMillion: 0.175,
      outputUsdPerMillion: 14,
      sourceUrl: `${MODEL_BASE}gpt-5.3-codex`,
    },
    "gpt-5.4": {
      inputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 15,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
      sourceUrl: `${MODEL_BASE}gpt-5.4`,
    },
    "gpt-5.4-mini": {
      inputUsdPerMillion: 0.75,
      cachedInputUsdPerMillion: 0.075,
      outputUsdPerMillion: 4.5,
      sourceUrl: `${MODEL_BASE}gpt-5.4-mini`,
    },
    "gpt-5.5": {
      inputUsdPerMillion: 5,
      cachedInputUsdPerMillion: 0.5,
      outputUsdPerMillion: 30,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
      sourceUrl: `${MODEL_BASE}gpt-5.5`,
    },
    "gpt-5.6-luna": {
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      cacheWriteUsdPerMillion: 0.25,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
      sourceUrl: `${MODEL_BASE}gpt-5.6-luna`,
    },
    "gpt-5.6-sol": {
      inputUsdPerMillion: 4,
      cachedInputUsdPerMillion: 0.4,
      outputUsdPerMillion: 20,
      cacheWriteUsdPerMillion: 5,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
      sourceUrl: `${MODEL_BASE}gpt-5.6-sol`,
      promotionalThrough: "2026-11-21",
    },
    "gpt-5.6-terra": {
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      outputUsdPerMillion: 12,
      cacheWriteUsdPerMillion: 2.5,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
      sourceUrl: `${MODEL_BASE}gpt-5.6-terra`,
    },
  }),
});

function nonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function round(value, digits = 12) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function resolvePrice(model) {
  if (typeof model !== "string") return null;
  const exact = OPENAI_PRICING_SNAPSHOT.models[model];
  if (exact) return { id: model, price: exact };
  const match = Object.keys(OPENAI_PRICING_SNAPSHOT.models)
    .sort((left, right) => right.length - left.length)
    .find((id) => model.startsWith(`${id}-`));
  return match ? { id: match, price: OPENAI_PRICING_SNAPSHOT.models[match] } : null;
}

function estimateCall(event) {
  const resolved = resolvePrice(event?.model);
  if (!resolved) return null;
  const inputTokens = nonNegative(event.inputTokens);
  const outputTokens = nonNegative(event.outputTokens);
  const cacheReadTokens = Math.min(inputTokens, nonNegative(event.cacheReadTokens));
  const cacheWriteTokens = Math.min(
    Math.max(0, inputTokens - cacheReadTokens),
    nonNegative(event.cacheWriteTokens),
  );
  const regularInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
  const longContext = Number.isFinite(resolved.price.longContextThresholdTokens)
    && inputTokens > resolved.price.longContextThresholdTokens;
  const inputMultiplier = longContext ? resolved.price.longContextInputMultiplier : 1;
  const outputMultiplier = longContext ? resolved.price.longContextOutputMultiplier : 1;
  const cacheWriteRate = Number.isFinite(resolved.price.cacheWriteUsdPerMillion)
    ? resolved.price.cacheWriteUsdPerMillion
    : resolved.price.inputUsdPerMillion;
  const usd = (
    (regularInputTokens * resolved.price.inputUsdPerMillion * inputMultiplier)
    + (cacheReadTokens * resolved.price.cachedInputUsdPerMillion * inputMultiplier)
    + (cacheWriteTokens * cacheWriteRate * inputMultiplier)
    + (outputTokens * resolved.price.outputUsdPerMillion * outputMultiplier)
  ) / 1_000_000;
  return {
    model: resolved.id,
    usd: round(usd),
    longContext,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

export function estimateOpenAiEquivalent(events = []) {
  const byModel = new Map();
  const unpricedModels = new Set();
  let usd = 0;
  let pricedApiCalls = 0;
  let unpricedApiCalls = 0;
  for (const event of Array.isArray(events) ? events : []) {
    const estimate = estimateCall(event);
    if (!estimate) {
      unpricedApiCalls += 1;
      if (typeof event?.model === "string" && event.model) unpricedModels.add(event.model);
      continue;
    }
    pricedApiCalls += 1;
    usd += estimate.usd;
    const row = byModel.get(estimate.model) ?? {
      model: estimate.model,
      usd: 0,
      apiCalls: 0,
      longContextApiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    row.usd += estimate.usd;
    row.apiCalls += 1;
    row.longContextApiCalls += estimate.longContext ? 1 : 0;
    row.inputTokens += estimate.inputTokens;
    row.outputTokens += estimate.outputTokens;
    row.cacheReadTokens += estimate.cacheReadTokens;
    row.cacheWriteTokens += estimate.cacheWriteTokens;
    byModel.set(estimate.model, row);
  }
  return {
    usd: round(usd),
    pricedApiCalls,
    unpricedApiCalls,
    unpricedModels: [...unpricedModels].sort(),
    byModel: [...byModel.values()]
      .map((row) => ({ ...row, usd: round(row.usd) }))
      .sort((left, right) => right.usd - left.usd),
    sourceDate: OPENAI_PRICING_SNAPSHOT.sourceDate,
  };
}

export function publicPricingSnapshot(availableModels = []) {
  const ids = [...new Set(Array.isArray(availableModels) ? availableModels : [])].sort();
  return {
    sourceDate: OPENAI_PRICING_SNAPSHOT.sourceDate,
    currency: OPENAI_PRICING_SNAPSHOT.currency,
    basis: OPENAI_PRICING_SNAPSHOT.basis,
    disclaimer: OPENAI_PRICING_SNAPSHOT.disclaimer,
    models: ids.map((id) => {
      const resolved = resolvePrice(id);
      return resolved ? { id, ...resolved.price } : { id, unavailable: true };
    }),
  };
}
