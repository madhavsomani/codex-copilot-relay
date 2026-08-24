import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAssistantUsage,
  normalizeQuotaResult,
  safeCopilotModelBilling,
  summarizeAssistantUsage,
  toResponsesUsage,
} from "./copilot-telemetry.mjs";

test("normalizes and aggregates exact SDK assistant usage without trace identifiers", () => {
  const first = normalizeAssistantUsage({
    model: "gpt-5.6-sol",
    inputTokens: 1200,
    outputTokens: 80,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    reasoningTokens: 30,
    duration: 450,
    cost: 1,
    copilotUsage: { totalNanoAiu: 12_500_000 },
    providerCallId: "must-not-leave-the-server",
    serviceRequestId: "must-not-leave-the-server",
  });
  const second = normalizeAssistantUsage({
    model: "gpt-5.6-luna",
    inputTokens: 300,
    outputTokens: 40,
    cost: 0.25,
    copilotUsage: { totalNanoAiu: 2_500_000 },
  });
  assert.equal(first.providerCallId, undefined);
  assert.equal(first.totalNanoAiu, 12_500_000);

  const summary = summarizeAssistantUsage([first, second]);
  assert.equal(summary.metered, true);
  assert.equal(summary.sdkApiCalls, 2);
  assert.equal(summary.inputTokens, 1500);
  assert.equal(summary.outputTokens, 120);
  assert.equal(summary.cacheReadTokens, 200);
  assert.equal(summary.cacheWriteTokens, 100);
  assert.equal(summary.reasoningTokens, 30);
  assert.equal(summary.totalNanoAiu, 15_000_000);
  assert.equal(summary.copilotCostUnits, 1.25);
  assert.equal(summary.apiDurationMs, 450);
  assert.equal(summary.models.length, 2);
  assert.ok(summary.apiEquivalentUsd > 0);

  assert.deepEqual(toResponsesUsage(summary), {
    input_tokens: 1500,
    input_tokens_details: { cached_tokens: 200 },
    output_tokens: 120,
    output_tokens_details: { reasoning_tokens: 30 },
    total_tokens: 1620,
  });
});

test("returns an unmetered summary when no assistant usage event was observed", () => {
  const summary = summarizeAssistantUsage([]);
  assert.equal(summary.metered, false);
  assert.equal(summary.sdkApiCalls, 0);
  assert.equal(summary.apiEquivalentUsd, 0);
});

test("quota and model billing normalization expose only safe numeric account data", () => {
  const quota = normalizeQuotaResult({
    quotaSnapshots: {
      premium_interactions: {
        isUnlimitedEntitlement: false,
        entitlementRequests: 10_000_000,
        usedRequests: 170_000,
        remainingPercentage: 98.3,
        overage: 0,
        resetDate: "2026-08-24T20:22:12.481Z",
        usageAllowedWithExhaustedQuota: true,
        token: "never expose",
      },
    },
    login: "private-login",
  }, "2026-08-24T20:00:00.000Z");
  assert.equal(quota.status, "available");
  assert.equal(quota.snapshots.premium_interactions.remainingPercentage, 98.3);
  assert.equal(quota.snapshots.premium_interactions.token, undefined);
  assert.equal(quota.login, undefined);

  const billing = safeCopilotModelBilling([{
    id: "gpt-5.6-sol",
    billing: {
      multiplier: 1,
      tokenPrices: {
        inputPrice: 200,
        outputPrice: 1000,
        cacheReadPrice: 20,
        cacheWritePrice: 250,
        batchSize: 1_000_000,
        contextMax: 272_000,
        secret: "nope",
      },
    },
  }]);
  assert.deepEqual(billing[0], {
    id: "gpt-5.6-sol",
    multiplier: 1,
    tokenPrices: {
      inputPrice: 200,
      outputPrice: 1000,
      cacheReadPrice: 20,
      cacheWritePrice: 250,
      batchSize: 1_000_000,
      contextMax: 272_000,
      longContext: null,
    },
  });
});
