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
