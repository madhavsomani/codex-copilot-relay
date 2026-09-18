import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {usageTrendData} from './dashboard-data.mjs';
import {DASHBOARD_HTML} from './dashboard.mjs';
import {ProxyRecorder} from './proxy-recorder.mjs';
import {summarizeAssistantUsage} from './copilot-telemetry.mjs';

const bucket = (overrides = {}) => ({bucket: '2026-09-15', completed: 1, failed: 0, meteredCalls: 1,
  sdkApiCalls: 1, creditMeteredApiCalls: 1, inputTokens: 1000, outputTokens: 100,
  cacheReadTokens: 800, totalNanoAiu: 74_800_000, telemetryAvailable: true, ...overrides});

test('trend ranges use the same bounded source for tokens and credits without summing cached input twice', () => {
  const daily = Array.from({length: 30}, (_, index) => bucket({bucket: new Date(Date.UTC(2026, 8, index + 1)).toISOString()}));
  const hourly = Array.from({length: 24}, (_, index) => bucket({bucket: new Date(Date.UTC(2026, 8, 15, index)).toISOString(), inputTokens: 2000}));
  const analytics = {daily, hourly};
  for (const [range, count, tokens] of [['24h', 24, 50400], ['5d', 5, 5500], ['30d', 30, 33000]]) {
    const view = usageTrendData(analytics, range);
    assert.equal(view.rows.length, count); assert.equal(view.totalTokens, tokens);
    assert.equal(view.aiCredits, count * 74_800_000 / 1e9);
    assert.equal(view.tokenPartial, false); assert.equal(view.creditPartial, false);
  }
  assert.equal(usageTrendData(analytics).rows[0].bucket, daily[25].bucket);
  assert.equal(usageTrendData(analytics, 'invalid').rows.length, 5);
});

test('missing and legacy credit telemetry is not interpreted as zero or dollars', () => {
  const rows = [bucket({totalNanoAiu: 0, creditMeteredApiCalls: 0, copilotCostUnits: 3, apiEquivalentUsd: 55}),
    bucket({totalNanoAiu: 0}), bucket({totalNanoAiu: 1, sdkApiCalls: 2})];
  const view = usageTrendData({daily: rows});
  assert.deepEqual(view.rows.map(row => row.aiCredits), [null, 0, .000000001]);
  assert.equal(view.aiCredits, .000000001); assert.equal(view.creditPartial, true);
  assert.equal(view.creditMeteredApiCalls, 2); assert.equal(view.sdkApiCalls, 4);
  assert.equal(view.rows[2].creditPartial, true);
  const legacy = usageTrendData({daily: [bucket({sdkApiCalls: undefined, creditMeteredApiCalls: undefined})]});
  assert.equal(legacy.aiCredits, .0748); assert.equal(legacy.sdkApiCalls, null); assert.equal(legacy.creditPartial, true);
});

test('empty history and unmetered calls have gaps; known idle intervals have zero usage', () => {
  assert.equal(usageTrendData().aiCredits, null); assert.equal(usageTrendData().totalTokens, null);
  const idle = bucket({completed: 0, meteredCalls: 0, sdkApiCalls: 0, creditMeteredApiCalls: 0, inputTokens: 0, outputTokens: 0, totalNanoAiu: 0});
  const view = usageTrendData({daily: [idle, {...idle, telemetryAvailable: false}, {...idle, completed: 1}]});
  assert.deepEqual(view.rows.map(row => row.totalTokens), [0, null, null]);
  assert.deepEqual(view.rows.map(row => row.aiCredits), [0, null, null]);
  assert.equal(view.tokenPartial, true); assert.equal(view.creditPartial, true);
});

test('partially metered finalized outcomes are explicitly subtotals', () => {
  const view = usageTrendData({daily: [bucket({completed: 2, failed: 1})]});
  assert.equal(view.totalTokens, 1100); assert.equal(view.aiCredits, .0748);
  assert.equal(view.tokenPartial, true); assert.equal(view.creditPartial, true);
  assert.equal(view.finalizedCalls, 3); assert.equal(view.meteredCalls, 1);
});

test('credit coverage and usage rollups survive UTC rollover, duplicate finalization, clearing and restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-trends-'));
  let clock = new Date('2026-09-14T23:59:00Z');
  const options = {filePath: path.join(directory, 'events.jsonl'), now: () => new Date(clock)};
  try {
    const recorder = new ProxyRecorder(options);
    const record = recorder.start({body: {model: 'gpt-6-astra'}});
    clock = new Date('2026-09-15T00:01:00Z');
    const usage = summarizeAssistantUsage([{inputTokens: 1000, outputTokens: 100, cacheReadTokens: 800, totalNanoAiu: 0},
      {inputTokens: 2000, outputTokens: 200, totalNanoAiu: 74_800_000}, {inputTokens: 100, outputTokens: 10}]);
    recorder.usageObserved(record, usage, usage);
    assert.equal(recorder.analytics().daily.at(-1).totalNanoAiu, 0);
    recorder.finish(record, {status: 'completed', usage});
    recorder.finish(record, {status: 'completed', usage});
    recorder.clear();
    for (const current of [recorder, new ProxyRecorder(options)]) {
      const analytics = current.analytics(), day = analytics.daily.at(-1), hour = analytics.hourly.at(-1);
      assert.equal(day.bucket, '2026-09-15'); assert.equal(day.telemetryAvailable, true);
      assert.equal(analytics.daily.at(-2).totalNanoAiu, 0);
      assert.equal(analytics.daily[0].telemetryAvailable, false);
      assert.equal(day.sdkApiCalls, 3); assert.equal(day.creditMeteredApiCalls, 2);
      assert.equal(hour.totalNanoAiu, day.totalNanoAiu);
      const view = usageTrendData(analytics);
      assert.equal(view.totalTokens, 3410); assert.equal(view.aiCredits, .0748);
      assert.equal(view.creditPartial, true);
    }
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('dashboard embeds both responsive charts and the same-range refresh without external dependencies', () => {
  const script = DASHBOARD_HTML.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new vm.Script(script));
  for (const id of ['usage-range', 'token-usage-chart', 'credit-usage-chart', 'trend-detail']) assert.ok(DASHBOARD_HTML.includes('id="' + id + '"'));
  assert.match(script, /renderUsageTrends\(data\.analytics/);
  assert.match(script, /pointerenter/); assert.match(script, /ArrowRight/); assert.match(script, /preventScroll: true/);
  assert.match(script, /signature === trendSignature/);
  assert.match(DASHBOARD_HTML, /grid-template-columns: minmax\(270px,.72fr\) minmax\(0,1.6fr\)/);
  assert.doesNotMatch(DASHBOARD_HTML, /<script\s+src=/i);
});
