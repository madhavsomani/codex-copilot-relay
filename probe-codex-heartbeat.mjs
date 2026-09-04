import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResponsesEventStream } from "./responses-stream.mjs";

const marker = "CODEX_HEARTBEAT_OK";
const quietPeriodMs = 4_000;
const heartbeatIntervalMs = 250;
const codexIdleTimeoutMs = 1_000;
const codexReasoningEffort = process.env.PROBE_CODEX_REASONING_EFFORT ?? "none";
const codexReasoningSummary = process.env.PROBE_CODEX_REASONING_SUMMARY ?? null;
let capturedRequestShape = null;
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const codexEntrypoint = path.join(
  projectDirectory,
  "node_modules",
  "@openai",
  "codex",
  "bin",
  "codex.js",
);

function safeToolShape(tool) {
  return {
    type: tool?.type ?? null,
    strict: tool?.strict ?? null,
    deferLoading: tool?.defer_loading ?? null,
    allowedCallerCount: Array.isArray(tool?.allowed_callers)
      ? tool.allowed_callers.length
      : 0,
    hasOutputSchema: tool?.output_schema != null,
    nestedToolCount: Array.isArray(tool?.tools) ? tool.tools.length : 0,
  };
}

function summarizeToolTree(tools) {
  const summary = {
    total: 0,
    namespace: 0,
    function: 0,
    custom: 0,
    deferred: 0,
    strict: 0,
    outputSchema: 0,
  };
  const visit = (tool) => {
    if (!tool || typeof tool !== "object") return;
    summary.total += 1;
    if (["namespace", "function", "custom"].includes(tool.type)) summary[tool.type] += 1;
    if (tool.defer_loading === true) summary.deferred += 1;
    if (tool.strict === true) summary.strict += 1;
    if (tool.output_schema != null) summary.outputSchema += 1;
    for (const child of Array.isArray(tool.tools) ? tool.tools : []) visit(child);
  };
  for (const tool of Array.isArray(tools) ? tools : []) visit(tool);
  return summary;
}

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

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    capturedRequestShape = {
      keys: Object.keys(body).sort(),
      headerNames: Object.keys(request.headers).sort(),
      clientMetadataKeys: Object.keys(body.client_metadata ?? {}).sort(),
      threadHeaderMatchesMetadata: request.headers["thread-id"] === body.client_metadata?.thread_id,
      requestKind: (() => { try { return JSON.parse(request.headers["x-codex-turn-metadata"] ?? "{}").request_kind ?? null; } catch { return null; } })(),
      turnMetadataKeys: (() => { try { return Object.keys(JSON.parse(request.headers["x-codex-turn-metadata"] ?? "{}")); } catch { return []; } })(),
      reasoning: body.reasoning ?? null,
      text: body.text ?? null,
      toolChoice: body.tool_choice ?? null,
      parallelToolCalls: body.parallel_tool_calls ?? null,
      maxOutputTokens: body.max_output_tokens ?? null,
      serviceTier: body.service_tier ?? null,
      store: body.store ?? null,
      truncation: body.truncation ?? null,
      include: body.include ?? null,
      inputTypes: Array.isArray(body.input)
        ? body.input.map((item) => item?.type ?? null)
        : [],
      tools: Array.isArray(body.tools) ? body.tools.map(safeToolShape) : [],
      additionalToolGroups: Array.isArray(body.input)
        ? body.input
          .filter((item) => item?.type === "additional_tools")
          .map((item) => ({
            toolCount: Array.isArray(item.tools) ? item.tools.length : 0,
            treeSummary: summarizeToolTree(item.tools),
            tools: Array.isArray(item.tools) ? item.tools.map(safeToolShape) : [],
          }))
        : [],
    };
  } catch {
    capturedRequestShape = { parseError: true };
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
  const codexArguments = [
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
    `model_reasoning_effort="${codexReasoningEffort}"`,
    "--json",
    `Return exactly ${marker}.`,
  ];
  if (codexReasoningSummary) {
    codexArguments.splice(
      codexArguments.length - 2,
      0,
      "--config",
      `model_reasoning_summary="${codexReasoningSummary}"`,
    );
  }
  const result = await run(process.execPath, codexArguments, { cwd: projectDirectory });
  const ok = result.code === 0 && result.stdout.includes(marker);
  console.log(JSON.stringify({
    ok,
    codexExitCode: result.code,
    quietPeriodMs,
    heartbeatIntervalMs,
    codexIdleTimeoutMs,
    codexReasoningEffort,
    codexReasoningSummary,
    markerObserved: result.stdout.includes(marker),
    stderrLineCount: result.stderr.trim() ? result.stderr.trim().split(/\r?\n/).length : 0,
    requestShape: capturedRequestShape,
    stderr: ok ? undefined : result.stderr.trim(),
  }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
