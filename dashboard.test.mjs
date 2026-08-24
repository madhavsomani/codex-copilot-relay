import assert from "node:assert/strict";
import test from "node:test";

import { DASHBOARD_HTML } from "./dashboard.mjs";

test("dashboard credits the author and reports the compatibility policy", () => {
  assert.match(DASHBOARD_HTML, /Created by\s*<a[^>]*>Madhav Somani<\/a>/);
  assert.match(
    DASHBOARD_HTML,
    /href="https:\/\/www\.linkedin\.com\/in\/madhavsomani"/,
  );
  assert.match(DASHBOARD_HTML, /target="_blank"/);
  assert.match(DASHBOARD_HTML, /rel="noopener noreferrer"/);
  assert.match(DASHBOARD_HTML, /compatibility: long context · Codex tools\/memory preserved/);
  assert.match(DASHBOARD_HTML, /context: bounded, salience-aware compaction/);
});

test("dashboard exposes lifetime mileage, lightweight charts, and on-demand detail", () => {
  assert.match(DASHBOARD_HTML, /Lifetime calls received/);
  assert.match(DASHBOARD_HTML, /id="hourly-chart"/);
  assert.match(DASHBOARD_HTML, /id="daily-chart"/);
  assert.match(DASHBOARD_HTML, /id="model-chart"/);
  assert.match(DASHBOARD_HTML, /id="storage-meter"/);
  assert.match(DASHBOARD_HTML, /1,000/);
  assert.match(DASHBOARD_HTML, /200 detailed/);
  assert.match(DASHBOARD_HTML, /fetch\("\/dashboard\/api\/records\//);
  assert.doesNotMatch(DASHBOARD_HTML, /<script\s+src=/i);
  assert.match(DASHBOARD_HTML, /Clear detailed history/);
  assert.match(DASHBOARD_HTML, /Lifetime mileage is preserved/);
});

test("dashboard exposes measured cost, Copilot quota, and a live accessible architecture view", () => {
  assert.match(DASHBOARD_HTML, /OpenAI API-equivalent estimate/);
  assert.match(DASHBOARD_HTML, /Not an actual charge/);
  assert.match(DASHBOARD_HTML, /Copilot entitlement/);
  assert.match(DASHBOARD_HTML, /id="relay-architecture"/);
  assert.match(DASHBOARD_HTML, /Codex App/);
  assert.match(DASHBOARD_HTML, /Local Relay/);
  assert.match(DASHBOARD_HTML, /GitHub Copilot/);
  assert.match(DASHBOARD_HTML, /EventSource\("\/dashboard\/events"\)/);
  assert.match(DASHBOARD_HTML, /prefers-reduced-motion/);
  assert.match(DASHBOARD_HTML, /aria-live="polite"/);
  assert.match(DASHBOARD_HTML, /Public price snapshot/);
});
