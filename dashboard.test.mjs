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
  assert.match(DASHBOARD_HTML, /Calls handled/);
  assert.match(DASHBOARD_HTML, /id="hourly-chart"/);
  assert.match(DASHBOARD_HTML, /id="daily-chart"/);
  assert.match(DASHBOARD_HTML, /id="model-usage-list"/);
  assert.match(DASHBOARD_HTML, /id="kpi-storage-chart"/);
  assert.match(DASHBOARD_HTML, /1,000/);
  assert.match(DASHBOARD_HTML, /200 detailed/);
  assert.match(DASHBOARD_HTML, /fetch\("\/dashboard\/api\/records\//);
  assert.doesNotMatch(DASHBOARD_HTML, /<script\s+src=/i);
  assert.match(DASHBOARD_HTML, /Clear detailed history/);
  assert.match(DASHBOARD_HTML, /Lifetime mileage is preserved/);
});

test("dashboard prioritizes measured SDK usage and demotes the hypothetical dollar benchmark", () => {
  assert.match(DASHBOARD_HTML, /Measured model usage/);
  assert.match(DASHBOARD_HTML, /Input tokens/);
  assert.match(DASHBOARD_HTML, /Output tokens/);
  assert.match(DASHBOARD_HTML, /SDK model calls/);
  assert.match(DASHBOARD_HTML, /id="input-tokens"/);
  assert.match(DASHBOARD_HTML, /id="output-tokens"/);
  assert.match(DASHBOARD_HTML, /id="sdk-calls"/);
  assert.match(DASHBOARD_HTML, /id="api-cost"/);
  assert.match(DASHBOARD_HTML, /class="usage-stat benchmark-stat"/);
  assert.match(DASHBOARD_HTML, /id="telemetry-live"/);
  assert.match(DASHBOARD_HTML, /Live durable totals/);
  assert.match(DASHBOARD_HTML, /Public API benchmark/);
  assert.match(DASHBOARD_HTML, /Reference only · not billed/);
  assert.doesNotMatch(DASHBOARD_HTML, /id="price-date"/);
  assert.doesNotMatch(DASHBOARD_HTML, /<span>API-equivalent estimate<\/span>/);
  assert.doesNotMatch(DASHBOARD_HTML, /id="rate-strip"/);
  assert.doesNotMatch(DASHBOARD_HTML, /id="ai-credits"|Measured AI credits/);
  assert.match(DASHBOARD_HTML, /Copilot entitlement/);
  assert.match(DASHBOARD_HTML, /id="brand-github-copilot"/);
  assert.match(DASHBOARD_HTML, /id="brand-openai"/);
  assert.match(DASHBOARD_HTML, /href="#brand-github-copilot"/);
  assert.match(DASHBOARD_HTML, /href="#brand-openai"/);
  assert.match(DASHBOARD_HTML, /id="relay-architecture"/);
  assert.match(DASHBOARD_HTML, /id="network-model-name"/);
  assert.match(DASHBOARD_HTML, /data\.defaultModel/);
  assert.match(DASHBOARD_HTML, /Codex App/);
  assert.match(DASHBOARD_HTML, /Local Relay/);
  assert.match(DASHBOARD_HTML, /GitHub Copilot/);
  assert.match(DASHBOARD_HTML, /EventSource\("\/dashboard\/events"\)/);
  assert.match(DASHBOARD_HTML, /prefers-reduced-motion/);
  assert.match(DASHBOARD_HTML, /aria-live="polite"/);
  assert.match(DASHBOARD_HTML, /Measured from SDK assistant\.usage events/);
  assert.match(DASHBOARD_HTML, /Telemetry integrity/);
  assert.match(DASHBOARD_HTML, /1 event = 1 model call/);
});

test("dashboard renders bounded upright transit glyphs without flying text or neon beams", () => {
  assert.match(DASHBOARD_HTML, /id="traffic-map"/);
  assert.match(DASHBOARD_HTML, /id="traffic-signals"/);
  assert.match(DASHBOARD_HTML, /id="route-main-journey"/);
  assert.match(DASHBOARD_HTML, /id="route-tool-journey"/);
  assert.match(DASHBOARD_HTML, /class(?::|=) "transit-shell"/);
  assert.match(DASHBOARD_HTML, /class(?::|=) "transit-copy-lines"/);
  assert.match(DASHBOARD_HTML, /class(?::|=) "transit-stream-lines"/);
  assert.match(DASHBOARD_HTML, /class(?::|=) "transit-tool-mark"/);
  assert.match(DASHBOARD_HTML, /const MAX_LIVE_CALLS = 64/);
  assert.match(DASHBOARD_HTML, /const MAX_LIVE_SIGNALS = 48/);
  assert.match(DASHBOARD_HTML, /const TRAFFIC_LANES = \[-20, -10, 0, 10, 20\]/);
  assert.doesNotMatch(DASHBOARD_HTML, /const TRAFFIC_COLORS = \[[^\]]*#ff8398/);
  assert.match(DASHBOARD_HTML, /const usedLanes = new Set\(\[\.\.\.state\.liveCalls\.values\(\)\]/);
  assert.match(DASHBOARD_HTML, /find\(lane => !usedLanes\.has\(lane\)\)/);
  assert.match(DASHBOARD_HTML, /function callVisual/);
  assert.match(DASHBOARD_HTML, /function launchTransitGlyph/);
  assert.match(DASHBOARD_HTML, /animateMotion/);
  assert.match(DASHBOARD_HTML, /rotate: "0"/);
  assert.match(DASHBOARD_HTML, /kind: "request"/);
  assert.match(DASHBOARD_HTML, /kind: "response"/);
  assert.match(DASHBOARD_HTML, /kind: "tool"/);
  assert.doesNotMatch(DASHBOARD_HTML, /packet-label|signal-trail|stroke-dashoffset/);
  assert.match(DASHBOARD_HTML, /prefers-reduced-motion: reduce/);
  assert.match(DASHBOARD_HTML, /renderActiveCalls\(\); setFlowPhase[\s\S]*try \{ launchTrafficForEvent/);
  assert.doesNotMatch(DASHBOARD_HTML, /requestAnimationFrame/);
});

test("dashboard shows the running relay version in a balanced responsive control grid", () => {
  assert.match(DASHBOARD_HTML, /id="relay-version"/);
  assert.match(DASHBOARD_HTML, /data\.relayVersion/);
  assert.match(DASHBOARD_HTML, /\.command-grid \{[^}]*align-items: start/);
  assert.match(DASHBOARD_HTML, /class="telemetry-rail"/);
  assert.match(DASHBOARD_HTML, /class="relay-stack"/);
  assert.match(DASHBOARD_HTML, /class="inspection-stack"/);
  assert.match(DASHBOARD_HTML, /class="model-breakdown"/);
  assert.match(
    DASHBOARD_HTML,
    /Average latency[\s\S]*class="kpi cyan storage-kpi"[\s\S]*Local telemetry/,
  );
  assert.doesNotMatch(DASHBOARD_HTML, /class="panel storage-panel storage-strip"/);
  assert.match(DASHBOARD_HTML, /function storageGauge/);
  assert.match(DASHBOARD_HTML, /storageGauge\("kpi-storage-chart"/);
  assert.match(DASHBOARD_HTML, /\.telemetry-rail, \.relay-stack, \.inspection-stack \{[^}]*display: grid/);
  assert.match(DASHBOARD_HTML, /\.command-grid \{[^}]*grid-template-columns: minmax\(270px/);
  assert.match(DASHBOARD_HTML, /@media \(min-width: 901px\) and \(max-width: 1350px\)[^{]*\{[^}]*inspection-stack/);
  assert.match(DASHBOARD_HTML, /\.live-inspector \{[^}]*display: flex/);
  assert.match(DASHBOARD_HTML, /\.inspector-body \{[^}]*flex: 1[^}]*grid-template-rows: auto auto minmax\(0,1fr\)/);
  assert.doesNotMatch(DASHBOARD_HTML, /grid-template-areas: "architecture inspector" "usage entitlement"/);
  assert.match(DASHBOARD_HTML, /\.architecture \{[^}]*min-height: 0/);
  assert.doesNotMatch(DASHBOARD_HTML, /\.architecture \{[^}]*min-height: 400px/);
  assert.match(DASHBOARD_HTML, /id="analytics" class="panel chart stack-chart compact-chart"/);
  assert.match(DASHBOARD_HTML, /\.compact-chart svg \{[^}]*height: 116px/);
  assert.match(DASHBOARD_HTML, /\.compact-chart \.chart-body \{[^}]*min-height: 128px/);
});

test("desktop dashboard fills tall-column space with useful responsive charts", () => {
  assert.match(DASHBOARD_HTML, /@media \(min-width: 1351px\)/);
  assert.match(DASHBOARD_HTML, /\.command-grid \{[^}]*align-items: stretch/);
  assert.match(
    DASHBOARD_HTML,
    /\.relay-stack, \.inspection-stack \{[^}]*height: 100%[^}]*grid-template-rows: auto minmax\(0,1fr\)[^}]*align-content: stretch[^}]*align-items: stretch/,
  );
  assert.match(DASHBOARD_HTML, /\.stack-chart \{[^}]*display: flex[^}]*flex-direction: column/);
  assert.match(DASHBOARD_HTML, /\.stack-chart \.chart-body \{[^}]*flex: 1[^}]*min-height: 0/);
  assert.match(DASHBOARD_HTML, /Math\.round\(svg\.clientHeight \|\| 168\)/);
});

test("dashboard treats resumable SDK exchanges as active sessions and labels freshness honestly", () => {
  assert.match(DASHBOARD_HTML, /id="streaming-active"/);
  assert.match(DASHBOARD_HTML, /setText\("active", number\(data\.activeExchanges \|\| 0\)\)/);
  assert.match(DASHBOARD_HTML, /state\.activeSamples\.push\(Number\(data\.activeExchanges\) \|\| 0\)/);
  assert.match(DASHBOARD_HTML, /setText\("streaming-active", number\(summary\.active\) \+ " streaming now"\)/);
  assert.match(DASHBOARD_HTML, /data\.sampledAt/);
  assert.match(DASHBOARD_HTML, /data\.metricsUpdatedAt/);
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
  assert.match(DASHBOARD_HTML, /className = "model-mark"/);
  assert.match(DASHBOARD_HTML, /SDK calls/);
  assert.doesNotMatch(DASHBOARD_HTML, /Contoso|Active Seats|developer@|Business: \$/);
});
