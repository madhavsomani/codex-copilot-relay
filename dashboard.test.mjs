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

test("dashboard renders bounded continuous journeys for concurrent relay calls", () => {
  assert.match(DASHBOARD_HTML, /id="traffic-map"/);
  assert.match(DASHBOARD_HTML, /id="traffic-packets"/);
  assert.match(DASHBOARD_HTML, /id="route-main-journey"/);
  assert.match(DASHBOARD_HTML, /id="route-tool-journey"/);
  assert.doesNotMatch(DASHBOARD_HTML, /id="route-codex-relay"/);
  assert.match(DASHBOARD_HTML, /class(?::|=) "packet-body"/);
  assert.match(DASHBOARD_HTML, /class(?::|=) "packet-label"/);
  assert.match(DASHBOARD_HTML, /PROMPT/);
  assert.match(DASHBOARD_HTML, /STREAM/);
  assert.match(DASHBOARD_HTML, /const MAX_LIVE_CALLS = 64/);
  assert.match(DASHBOARD_HTML, /const MAX_TRAFFIC_PACKETS = 96/);
  assert.match(DASHBOARD_HTML, /const TRAFFIC_LANES = \[-28, -14, 0, 14, 28\]/);
  assert.match(DASHBOARD_HTML, /const usedLanes = new Set\(\[\.\.\.state\.liveCalls\.values\(\)\]/);
  assert.match(DASHBOARD_HTML, /find\(lane => !usedLanes\.has\(lane\)\)/);
  assert.match(DASHBOARD_HTML, /function callVisual/);
  assert.match(DASHBOARD_HTML, /function launchJourneyPacket/);
  assert.match(DASHBOARD_HTML, /animateMotion/);
  assert.match(DASHBOARD_HTML, /prefers-reduced-motion: reduce/);
  assert.match(DASHBOARD_HTML, /renderActiveCalls\(\); setFlowPhase[\s\S]*try \{ launchTrafficForEvent/);
  assert.doesNotMatch(DASHBOARD_HTML, /requestAnimationFrame/);
});

test("dashboard shows the running relay version without stretching the flow card", () => {
  assert.match(DASHBOARD_HTML, /id="relay-version"/);
  assert.match(DASHBOARD_HTML, /data\.relayVersion/);
  assert.match(DASHBOARD_HTML, /\.command-grid \{[^}]*align-items: start/);
  assert.match(DASHBOARD_HTML, /\.architecture \{[^}]*min-height: 0/);
  assert.doesNotMatch(DASHBOARD_HTML, /\.architecture \{[^}]*min-height: 400px/);
});

test("dashboard adds reference-inspired observability without fabricated enterprise data", () => {
  assert.match(DASHBOARD_HTML, /id="observability-kpis"/);
  assert.match(DASHBOARD_HTML, /id="success-rate"/);
  assert.match(DASHBOARD_HTML, /class="kpi-sparkline"/);
  assert.match(DASHBOARD_HTML, /Live request inspector/);
  assert.match(DASHBOARD_HTML, /id="inspector-events"/);
  assert.match(DASHBOARD_HTML, /const MAX_LIVE_EVENTS = 16/);
  assert.match(DASHBOARD_HTML, /function renderKpis/);
  assert.match(DASHBOARD_HTML, /function renderLiveInspector/);
  assert.match(DASHBOARD_HTML, /function recordLiveEvent/);
  assert.match(DASHBOARD_HTML, /route-line main/);
  assert.match(DASHBOARD_HTML, /route-line tool/);
  assert.doesNotMatch(DASHBOARD_HTML, /Contoso|Active Seats|developer@|Business: \$/);
});
