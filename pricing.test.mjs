import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_PRICING_SNAPSHOT,
  estimateOpenAiEquivalent,
  publicPricingSnapshot,
} from "./pricing.mjs";

test("estimates standard, cached, and long-context OpenAI API-equivalent cost", () => {
  const standard = estimateOpenAiEquivalent([{
    model: "gpt-5.6-sol",
    inputTokens: 100_000,
    outputTokens: 100_000,
  }]);
  assert.equal(standard.usd, 2.4);
  assert.equal(standard.pricedApiCalls, 1);
  assert.equal(standard.unpricedApiCalls, 0);

  const cached = estimateOpenAiEquivalent([{
    model: "gpt-5.6-sol",
    inputTokens: 200_000,
    cacheReadTokens: 100_000,
    outputTokens: 0,
  }]);
  assert.equal(cached.usd, 0.44);

  const longContext = estimateOpenAiEquivalent([{
    model: "gpt-5.6-sol",
    inputTokens: 300_000,
    outputTokens: 100_000,
  }]);
  assert.equal(longContext.usd, 5.4);
  assert.equal(longContext.byModel[0].longContextApiCalls, 1);
});

test("prices cache writes for GPT-5.6 and reports unknown models without guessing", () => {
  const result = estimateOpenAiEquivalent([
    {
      model: "gpt-5.6-luna",
      inputTokens: 200_000,
      cacheWriteTokens: 200_000,
      outputTokens: 0,
    },
    { model: "third-party-model", inputTokens: 500, outputTokens: 50 },
  ]);
  assert.equal(result.usd, 0.05);
  assert.equal(result.pricedApiCalls, 1);
  assert.equal(result.unpricedApiCalls, 1);
  assert.deepEqual(result.unpricedModels, ["third-party-model"]);
});

test("publishes a source-dated standard-rate catalog for every relay GPT model", () => {
  const models = [
    "gpt-5-mini",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
  ];
  const snapshot = publicPricingSnapshot(models);
  assert.equal(snapshot.sourceDate, "2026-08-24");
  assert.equal(snapshot.currency, "USD");
  assert.equal(snapshot.models.length, models.length);
  assert.ok(snapshot.models.every((model) => model.sourceUrl.startsWith("https://developers.openai.com/")));
  assert.match(snapshot.disclaimer, /not an OpenAI or GitHub charge/i);
  assert.equal(OPENAI_PRICING_SNAPSHOT.models["gpt-5.6-sol"].outputUsdPerMillion, 20);
});
