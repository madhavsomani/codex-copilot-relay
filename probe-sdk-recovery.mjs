// Live, opt-in fault injection. Owns an isolated relay; never targets port 4144.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const modelIndex = process.argv.indexOf("--model");
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : "gpt-5.6-luna";
if (process.platform !== "win32") throw new Error("This fault probe currently supports Windows only.");
const reservation = net.createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
assert.notEqual(port, 4144);
await new Promise(resolve => reservation.close(resolve));
const runtime = await mkdtemp(path.join(os.tmpdir(), "relay-sdk-recovery-"));
const env = { ...process.env, BRIDGE_PORT: String(port), BRIDGE_DEFAULT_MODEL: model,
  BRIDGE_RUNTIME_DIRECTORY: runtime, BRIDGE_SDK_PROBE_INTERVAL_MS: "500" };
delete env.BRIDGE_AUTH_TOKEN;
delete env.BRIDGE_EVENT_LOG_PATH;
const child = spawn(process.execPath, [path.join(root, "server.mjs")], {
  cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stdout.resume();
child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
const url = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated relay exited (${child.exitCode}): ${stderr}`);
    try { value = await check(); } catch (error) { value = false; }
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function health() {
  return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })).json();
}
async function request(body) {
  const response = await fetch(`${url}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, reasoning: { effort: "low" }, ...body }),
    signal: AbortSignal.timeout(90_000),
  });
  assert.equal(response.status, 200);
  return response;
}
let killedWorker;
try {
  const initial = await until(async () => { const h = await health(); return h.ok && h; }, "SDK startup");
  console.log(JSON.stringify({ stage: "started", port, generation: initial.sdk.generation }));
  const pending = await (await request({ stream: false,
    input: "Call relay_hold once with value WAIT; wait for the result before replying.",
    tools: [{ type: "function", name: "relay_hold", description: "Wait for an external test result.",
      parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }],
  })).json();
  assert.ok(pending.output.some(item => item.type === "function_call"), "probe must hold one tool continuation");
  const streaming = await request({ stream: true,
    input: "Write every integer from 1 through 2000 individually, one per line. Do not summarize or use tools.",
  });
  // Start consuming immediately so a socket close is captured, not an unhandled rejection.
  const streamed = streaming.text().then(raw => ({ raw }), error => ({ error }));
  await until(async () => (await health()).sdk.activeSessions >= 2, "two SDK sessions");
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Select-Object ProcessId,ParentProcessId,Name) | ConvertTo-Json -Compress`],
  { windowsHide: true });
  const children = [].concat(JSON.parse(stdout || "[]"));
  const workers = children.filter(p => /^(copilot|node)\.exe$/i.test(p.Name));
  assert.equal(workers.length, 1, "only the isolated relay's verified SDK child may be killed");
  const worker = workers[0];
  assert.equal(worker.ParentProcessId, child.pid);
  assert.notEqual(worker.ProcessId, child.pid);
  process.kill(worker.ProcessId, "SIGKILL");
  killedWorker = worker.ProcessId;
  console.log(JSON.stringify({ stage: "worker_killed", testRelayPid: child.pid, killedWorker }));
  const streamResult = await streamed;
  assert.ifError(streamResult.error);
  const events = streamResult.raw.split(/\r?\n\r?\n/)
    .map(block => block.split(/\r?\n/).find(line => line.startsWith("data: ")))
    .filter(Boolean).map(line => JSON.parse(line.slice(6)));
  assert.ok(events.every((event, index) => event.sequence_number === index));
  assert.equal(events.at(-1)?.type, "response.failed");
  // Responses uses a fixed public error-code enum; the message retains the cause.
  assert.equal(events.at(-1)?.response?.error?.code, "server_error");
  assert.match(events.at(-1)?.response?.error?.message ?? "", /Copilot SDK connection closed/);
  const recovered = await until(async () => {
    const h = await health();
    return h.ok && h.sdk.generation === initial.sdk.generation + 1 && h;
  }, "replacement SDK worker");
  assert.equal(child.exitCode, null, "HTTP relay must survive the SDK crash");
  assert.equal(recovered.activeExchanges, 0, "dead-generation exchanges must be released");
  assert.equal(recovered.sdk.activeSessions, 0);
  assert.equal(recovered.sdk.recoveries, 1);
  for (const [script, extra] of [
    ["probe-responses-stream.mjs", []],
    ["probe-relay-tools.mjs", ["--steps", "2"]],
    ["probe-concurrency.mjs", ["--count", "4"]],
  ]) {
    const { stdout: result } = await exec(process.execPath,
      [path.join(root, script), "--url", `${url}/v1`, "--model", model, ...extra],
      { cwd: root, windowsHide: true, timeout: 120_000 });
    const report = JSON.parse(result);
    assert.equal(report.ok, true, `${script} must pass after recovery`);
    console.log(JSON.stringify({ stage: "post_recovery_probe", probe: script, ...report }));
  }
  console.log(JSON.stringify({ ok: true, parentSurvived: true, deadSessionsCleared: true,
    failedStreamTerminated: true, generation: recovered.sdk.generation, recoveries: recovered.sdk.recoveries }));
} finally {
  // This PID came directly from spawn above, never from a production PID file.
  if (child.exitCode === null) {
    await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
  }
}
