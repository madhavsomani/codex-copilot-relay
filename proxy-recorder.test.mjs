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
