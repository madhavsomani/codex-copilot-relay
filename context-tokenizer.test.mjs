import assert from "node:assert/strict";
import test from "node:test";
import { countModelTokens, tokenizerCompatibility } from "./context-tokenizer.mjs";

test("counts context tokens locally with the o200k vocabulary", () => {
  assert.equal(countModelTokens("hello world"), 2);
  assert.ok(countModelTokens("hello world ".repeat(100)) > 100);
  assert.equal(tokenizerCompatibility.encoding, "o200k_base");
  assert.equal(tokenizerCompatibility.exactProviderBilling, false);
});
