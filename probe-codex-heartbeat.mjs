import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResponsesEventStream } from "./responses-stream.mjs";

const marker = "CODEX_HEARTBEAT_OK";
const quietPeriodMs = 4_000;
const heartbeatIntervalMs = 250;
const codexIdleTimeoutMs = 1_000;
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const codexEntrypoint = path.join(
  projectDirectory,
  "node_modules",
  "@openai",
  "codex",
  "bin",
  "codex.js",
);

function writeEvent(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Codex heartbeat probe exceeded 20 seconds."));
    }, 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"models":[]}\n');
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/v1/responses") {
    response.writeHead(404).end();
    return;
  }

  for await (const _chunk of request) {
    // Drain the request before starting the deterministic quiet response.
  }
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const stream = new ResponsesEventStream({
    responseId: "resp_codex_heartbeat_probe",
    model: "gpt-5.6-sol",
    requestBody: { model: "gpt-5.6-sol", stream: true },
    emit: (event) => writeEvent(response, event),
  });
  stream.start();
  stream.appendTextDelta("CODEX_");
  const heartbeat = setInterval(() => stream.heartbeat(), heartbeatIntervalMs);
  heartbeat.unref?.();
  const finish = setTimeout(() => {
    clearInterval(heartbeat);
    const item = stream.finishText(marker);
    stream.complete([item], {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
    });
    response.end();
  }, quietPeriodMs);
  finish.unref?.();
  response.once("close", () => {
    clearInterval(heartbeat);
    clearTimeout(finish);
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const provider = `{ name = "Heartbeat probe", base_url = "${baseUrl}", wire_api = "responses", requires_openai_auth = false, request_max_retries = 0, stream_max_retries = 0, stream_idle_timeout_ms = ${codexIdleTimeoutMs} }`;
  const result = await run(process.execPath, [
    codexEntrypoint,
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    "gpt-5.6-sol",
    "--config",
    'model_provider="heartbeat_probe"',
    "--config",
    `model_providers.heartbeat_probe=${provider}`,
    "--config",
    'model_reasoning_effort="none"',
    "--json",
    `Return exactly ${marker}.`,
  ], { cwd: projectDirectory });
  const ok = result.code === 0 && result.stdout.includes(marker);
  console.log(JSON.stringify({
    ok,
    codexExitCode: result.code,
    quietPeriodMs,
    heartbeatIntervalMs,
    codexIdleTimeoutMs,
    markerObserved: result.stdout.includes(marker),
    stderrLineCount: result.stderr.trim() ? result.stderr.trim().split(/\r?\n/).length : 0,
    stderr: ok ? undefined : result.stderr.trim(),
  }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
