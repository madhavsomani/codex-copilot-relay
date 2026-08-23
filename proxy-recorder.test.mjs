import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProxyRecorder } from "./proxy-recorder.mjs";

test("records bounded sanitized input, Copilot replay, and output data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-recorder-"));
  const filePath = path.join(directory, "events.jsonl");
  try {
    const recorder = new ProxyRecorder({ filePath, limit: 3, payloadLimit: 8 * 1024 });
    const record = recorder.start({
      requestPath: "/v1/responses",
      inputBytes: 220,
      streaming: true,
      body: {
        model: "gpt-5.6-luna",
        headers: { Authorization: "Bearer do-not-store-this" },
        input: [
          { type: "message", role: "user", content: "ghp_1234567890SECRET" },
          {
            type: "custom_tool_call_output",
            call_id: "call-image",
            output: [{
              type: "input_image",
              image_url: `data:image/png;base64,${"A".repeat(10 * 1024)}`,
            }],
          },
        ],
      },
    });
    recorder.replay(record, {
      phase: "initial",
      model: "gpt-5.6-luna",
      prompt: "safe prompt",
    });
    recorder.toolRequested(record, { callId: "call_1", name: "exec" });
    recorder.finish(record, {
      status: "completed",
      selectedModel: "gpt-5.6-luna",
      output: { id: "resp_1", output: [{ type: "message", text: "done" }] },
      outputBytes: 100,
    });

    const snapshot = recorder.snapshot();
    assert.equal(snapshot.summary.received, 1);
    assert.equal(snapshot.summary.replayed, 1);
    assert.equal(snapshot.summary.completed, 1);
    assert.equal(snapshot.summary.toolCalls, 1);
    assert.equal(snapshot.records[0].selectedModel, "gpt-5.6-luna");
    const persisted = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(persisted, /do-not-store-this/);
    assert.doesNotMatch(persisted, /ghp_1234567890SECRET/);
    assert.doesNotMatch(persisted, /A{100}/);
    assert.match(persisted, /REDACTED/);
    assert.match(persisted, /data URL omitted: image\/png/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("loads bounded history and clears the local history file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-recorder-"));
  const filePath = path.join(directory, "events.jsonl");
  try {
    const recorder = new ProxyRecorder({ filePath, limit: 2 });
    for (let index = 0; index < 5; index += 1) {
      const record = recorder.start({
        requestPath: "/v1/responses",
        inputBytes: 1,
        streaming: false,
        body: { model: "gpt-5.6-sol", input: String(index) },
      });
      recorder.finish(record, { status: "completed", output: { index } });
    }

    const reloaded = new ProxyRecorder({ filePath, limit: 2 });
    assert.equal(reloaded.snapshot().records.length, 2);
    assert.ok(fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).length <= 3);
    reloaded.clear();
    assert.equal(reloaded.snapshot().records.length, 0);
    assert.equal(fs.readFileSync(filePath, "utf8"), "");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a two-tier recent history while lifetime mileage survives pruning and restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-recorder-"));
  const filePath = path.join(directory, "events.jsonl");
  const metricsFilePath = path.join(directory, "metrics.json");
  try {
    let tick = Date.parse("2026-08-20T00:00:00.000Z");
    const recorder = new ProxyRecorder({
      filePath,
      metricsFilePath,
      limit: 10,
      detailedLimit: 3,
      compactAfterLines: 11,
      now: () => new Date(tick),
    });

    for (let index = 0; index < 15; index += 1) {
      tick += 60_000;
      const record = recorder.start({
        requestPath: "/v1/responses",
        inputBytes: 100 + index,
        streaming: index % 2 === 0,
        body: { model: "gpt-5.6-sol", input: `request-${index}` },
      });
      recorder.replay(record, { phase: "initial", model: "gpt-5.6-sol" });
      recorder.toolRequested(record, { callId: `call-${index}`, name: "exec" });
      tick += 1_000;
      recorder.finish(record, {
        status: index === 14 ? "failed" : "completed",
        selectedModel: "gpt-5.6-sol",
        output: { index, text: "done" },
        outputBytes: 20,
        error: index === 14 ? new Error("expected failure") : null,
      });
    }
    recorder.compact();

    const reloaded = new ProxyRecorder({
      filePath,
      metricsFilePath,
      limit: 10,
      detailedLimit: 3,
      now: () => new Date(tick),
    });
    const snapshot = reloaded.snapshot();
    assert.equal(snapshot.records.length, 10);
    assert.equal(snapshot.records.filter((record) => record.detailTier === "detailed").length, 3);
    assert.equal(snapshot.records.filter((record) => record.detailTier === "lightweight").length, 7);
    assert.equal(snapshot.summary.received, 15);
    assert.equal(snapshot.summary.replayed, 15);
    assert.equal(snapshot.summary.completed, 14);
    assert.equal(snapshot.summary.failed, 1);
    assert.equal(snapshot.summary.toolCalls, 15);
    assert.equal(snapshot.analytics.hourly.at(-1).received, 15);
    assert.equal(snapshot.analytics.models[0].model, "gpt-5.6-sol");
    assert.equal(snapshot.analytics.models[0].received, 15);

    const beforeClear = snapshot.summary.received;
    reloaded.clear();
    assert.equal(reloaded.snapshot().records.length, 0);
    assert.equal(reloaded.snapshot().summary.received, beforeClear);
    assert.equal(fs.readFileSync(filePath, "utf8"), "");
    assert.ok(fs.statSync(metricsFilePath).size > 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("enforces the configured history ceiling by downgrading bodies before dropping metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-recorder-"));
  const filePath = path.join(directory, "events.jsonl");
  const metricsFilePath = path.join(directory, "metrics.json");
  try {
    const recorder = new ProxyRecorder({
      filePath,
      metricsFilePath,
      limit: 20,
      detailedLimit: 10,
      payloadLimit: 12 * 1024,
      maxRecordBytes: 8 * 1024,
      maxHistoryBytes: 24 * 1024,
      compactAfterLines: 21,
    });
    for (let index = 0; index < 30; index += 1) {
      const record = recorder.start({
        requestPath: "/v1/responses",
        inputBytes: 10_000,
        streaming: true,
        body: { model: "gpt-5.6-sol", input: `${index}-${"x".repeat(10_000)}` },
      });
      recorder.replay(record, { phase: "initial", prompt: "y".repeat(10_000) });
      recorder.finish(record, {
        status: "completed",
        selectedModel: "gpt-5.6-sol",
        output: { text: "z".repeat(10_000) },
        outputBytes: 10_000,
      });
    }
    recorder.compact();

    const snapshot = recorder.snapshot();
    assert.equal(snapshot.records.length, 20);
    assert.ok(snapshot.records.some((record) => record.detailTier === "lightweight"));
    assert.ok(fs.statSync(filePath).size <= 24 * 1024);
    assert.equal(snapshot.summary.received, 30);
    assert.ok(snapshot.storage.totalBytes < snapshot.storage.diskBudgetBytes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("returns lightweight indexes and fetches sanitized detail on demand", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-copilot-recorder-"));
  const filePath = path.join(directory, "events.jsonl");
  try {
    const recorder = new ProxyRecorder({ filePath });
    const record = recorder.start({
      requestPath: "/v1/responses",
      inputBytes: 10,
      streaming: false,
      body: { model: "gpt-5.6-sol", input: "private but sanitized detail" },
    });
    recorder.finish(record, {
      status: "completed",
      selectedModel: "gpt-5.6-sol",
      output: { text: "done" },
    });

    const lightweight = recorder.snapshot({ includeDetails: false });
    assert.equal(lightweight.records[0].input, undefined);
    assert.equal(lightweight.records[0].output, undefined);
    assert.equal(lightweight.records[0].detailAvailable, true);
    assert.equal(recorder.detail(record.id).input.input, "private but sanitized detail");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
