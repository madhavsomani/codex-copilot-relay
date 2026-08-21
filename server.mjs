import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { CopilotClient } from "@github/copilot-sdk";
import { DASHBOARD_HTML } from "./dashboard.mjs";
import {
  BlankCompletionGuard,
  SlidingDeadline,
  resolveAssistantContent,
  startSseHeartbeat,
} from "./exchange-lifecycle.mjs";
import { ProxyRecorder } from "./proxy-recorder.mjs";
import {
  buildSessionInput,
  externalToolRequestToResponseItem,
  extractToolDeclarations,
  extractToolOutputs,
  makeAssistantMessageItem,
  makeResponseId,
  makeResponseObject,
  normalizeReasoningEffort,
  normalizeToolOutput,
} from "./bridge-core.mjs";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.BRIDGE_PORT ?? "4141", 10);
const expectedToken = process.env.BRIDGE_AUTH_TOKEN ?? "";
const requestedDefaultModel = process.env.BRIDGE_DEFAULT_MODEL ?? "gpt-5.6-sol";
const fallbackWorkingDirectory = process.env.BRIDGE_WORKING_DIRECTORY ?? process.cwd();

function environmentInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

const exchangeTimeoutMs = environmentInteger(
  "BRIDGE_EXCHANGE_TIMEOUT_MS",
  15 * 60 * 1000,
  30_000,
  24 * 60 * 60 * 1000,
);
const maxBlankCompletionRetries = environmentInteger(
  "BRIDGE_MAX_BLANK_COMPLETION_RETRIES",
  2,
  0,
  5,
);
const sseHeartbeatIntervalMs = environmentInteger(
  "BRIDGE_SSE_HEARTBEAT_INTERVAL_MS",
  15_000,
  1_000,
  60_000,
);
const runtimeDirectory = process.env.BRIDGE_RUNTIME_DIRECTORY ?? path.join(process.cwd(), "runtime");
const recorder = new ProxyRecorder({
  filePath: path.join(runtimeDirectory, "proxy-events.jsonl"),
});

const exchanges = new Set();
const exchangesByCallId = new Map();
const exchangesByResponseId = new Map();

function log(type, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    ...fields,
  })}\n`);
}

function sendJson(response, status, body) {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeSseEvent(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function errorPayload(error, code = "bridge_error") {
  return {
    error: {
      message: error instanceof Error ? error.message : String(error),
      type: "invalid_request_error",
      code,
      param: null,
    },
  };
}

function authorized(request) {
  if (!expectedToken) return true;
  const prefix = "Bearer ";
  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return { body: JSON.parse(text), bytes: total };
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
}

class ResponseSink {
  constructor(response, requestBody, record) {
    this.response = response;
    this.requestBody = requestBody;
    this.record = record;
    this.responseId = makeResponseId();
    this.model = requestBody.model ?? "gpt-5.6-sol";
    this.streaming = requestBody.stream !== false;
    this.closed = false;
    this.stopHeartbeat = () => {};

    if (this.streaming) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "close",
      });
      writeSseEvent(response, {
        type: "response.created",
        response: { id: this.responseId },
      });
      this.stopHeartbeat = startSseHeartbeat(response, {
        intervalMs: sseHeartbeatIntervalMs,
      });
    }
  }

  setModel(model) {
    this.model = model;
    recorder.setSelectedModel(this.record, model);
  }

  complete(output, usage) {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    const responseObject = makeResponseObject({
      responseId: this.responseId,
      model: this.model,
      output,
      usage,
    });
    recorder.finish(this.record, {
      status: "completed",
      selectedModel: this.model,
      output: responseObject,
      outputBytes: Buffer.byteLength(JSON.stringify(responseObject), "utf8"),
    });

    if (this.streaming) {
      for (const item of output) {
        writeSseEvent(this.response, {
          type: "response.output_item.done",
          item,
        });
      }
      writeSseEvent(this.response, {
        type: "response.completed",
        response: responseObject,
      });
      this.response.end();
    } else {
      sendJson(this.response, 200, responseObject);
    }
  }

  fail(error, code = "bridge_error") {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    const payload = errorPayload(error, code);
    recorder.finish(this.record, {
      status: "failed",
      selectedModel: this.model,
      error: payload.error,
    });
    if (this.streaming) {
      writeSseEvent(this.response, {
        type: "error",
        code,
        message: payload.error.message,
        param: null,
      });
      this.response.end();
    } else {
      sendJson(this.response, 500, payload);
    }
  }
}

class Exchange {
  constructor(session, model, toolMetadata, cleanup) {
    this.session = session;
    this.model = model;
    this.toolMetadata = toolMetadata;
    this.cleanupCallback = cleanup;
    this.sink = null;
    this.record = null;
    this.pendingCalls = new Map();
    this.lastToolMessage = null;
    this.streamedContent = "";
    this.blankGuard = new BlankCompletionGuard({
      maxRetries: maxBlankCompletionRetries,
    });
    this.done = false;
    this.disconnecting = false;
    this.deadline = new SlidingDeadline({
      timeoutMs: exchangeTimeoutMs,
      onTimeout: () => {
        this.fail(new Error("Copilot tool exchange became inactive and timed out."), "exchange_timeout");
      },
    });
    this.deadline.touch();

    session.on((event) => {
      Promise.resolve(this.handleEvent(event)).catch((error) => this.fail(error));
    });
  }

  attachSink(sink) {
    if (this.sink && !this.sink.closed) {
      throw new Error("A Copilot exchange already has an active Responses request.");
    }
    this.sink = sink;
    this.record = sink.record;
    this.deadline.touch();
  }

  beginTurn({ resetBlankRetries = true } = {}) {
    this.streamedContent = "";
    this.blankGuard.expectResponse({ resetRetries: resetBlankRetries });
    this.deadline.touch();
  }

  async handleEvent(event) {
    if (this.done) return;
    this.deadline.touch();

    if (event.type === "assistant.turn_start") {
      this.streamedContent = "";
      return;
    }

    if (event.type === "assistant.message_delta") {
      const delta = event.data?.deltaContent;
      if (typeof delta === "string") this.streamedContent += delta;
      return;
    }

    if (event.type === "assistant.message") {
      const decision = this.blankGuard.observeAssistantMessage(
        event.data,
        this.streamedContent,
      );
      this.streamedContent = "";

      if (decision.kind === "tool_calls") {
        this.lastToolMessage = {
          ...event.data,
          content: decision.content,
          toolRequests: decision.toolRequests,
        };
        this.maybeCompleteToolTurn();
        return;
      }

      if (decision.kind === "await_idle") {
        log("blank_completion.detected", {
          responseId: this.sink?.responseId ?? null,
          model: this.model,
          retriesUsed: this.blankGuard.retryCount,
        });
        return;
      }

      if (!this.sink) {
        throw new Error("Copilot produced a final answer without an active Codex request.");
      }
      await this.completeFinalMessage(decision.content, event.data);
      return;
    }

    if (event.type === "session.idle") {
      await this.handleSessionIdle(event.data);
      return;
    }

    if (event.type === "external_tool.requested") {
      const metadata = this.toolMetadata.get(event.data?.toolName);
      const item = externalToolRequestToResponseItem(metadata, event.data);
      const call = {
        item,
        requestId: event.data.requestId,
        toolCallId: event.data.toolCallId,
      };
      this.pendingCalls.set(call.toolCallId, call);
      exchangesByCallId.set(call.toolCallId, this);
      log("tool.requested", {
        callId: call.toolCallId,
        namespace: item.namespace ?? null,
        name: item.name,
        kind: item.type,
      });
      recorder.toolRequested(this.record, {
        callId: call.toolCallId,
        requestId: call.requestId,
        namespace: item.namespace ?? null,
        name: item.name,
        item,
      });
      this.maybeCompleteToolTurn();
      return;
    }

    if (event.type === "session.error") {
      throw new Error(event.data?.message ?? event.data?.error ?? "Copilot session failed.");
    }
  }

  async completeFinalMessage(text, eventData = {}) {
    if (!this.sink || this.sink.closed) return;
    const output = [makeAssistantMessageItem(text)];
    const usage = this.usageFromEvent(eventData);
    const responseId = this.sink.responseId;
    this.sink.complete(output, usage);
    log("response.completed", { responseId, kind: "message", model: this.model });
    this.done = true;
    await this.disconnect();
  }

  async handleSessionIdle() {
    if (!this.sink || this.sink.closed) {
      this.blankGuard.clearPending();
      this.streamedContent = "";
      return;
    }

    const streamedFallback = resolveAssistantContent({}, this.streamedContent);
    if (streamedFallback) {
      this.streamedContent = "";
      await this.completeFinalMessage(streamedFallback);
      return;
    }

    const decision = this.blankGuard.onSessionIdle();
    if (decision.kind === "ignore") return;
    if (decision.kind === "fail") {
      this.fail(
        new Error("GitHub Copilot returned an empty final answer after recovery retries."),
        decision.code,
      );
      return;
    }

    recorder.replay(this.record, {
      phase: "blank_completion_retry",
      model: this.model,
      attempt: decision.attempt,
    });
    log("blank_completion.retry", {
      responseId: this.sink.responseId,
      model: this.model,
      attempt: decision.attempt,
    });
    this.beginTurn({ resetBlankRetries: false });
    try {
      await this.session.send({ prompt: decision.prompt });
    } catch (error) {
      this.fail(error, "blank_completion_retry_failed");
    }
  }

  usageFromEvent(data) {
    const outputTokens = Number.isFinite(data?.outputTokens) ? data.outputTokens : 0;
    return {
      input_tokens: 0,
      input_tokens_details: null,
      output_tokens: outputTokens,
      output_tokens_details: null,
      total_tokens: outputTokens,
    };
  }

  maybeCompleteToolTurn() {
    if (!this.lastToolMessage || !this.sink || this.sink.closed) return;
    const expected = this.lastToolMessage.toolRequests
      .map((request) => request.toolCallId)
      .filter(Boolean);
    if (!expected.length || !expected.every((callId) => this.pendingCalls.has(callId))) return;

    const output = [];
    if (this.lastToolMessage.content) {
      output.push(makeAssistantMessageItem(this.lastToolMessage.content));
    }
    for (const callId of expected) output.push(this.pendingCalls.get(callId).item);

    const usage = this.usageFromEvent(this.lastToolMessage);
    const responseId = this.sink.responseId;
    this.sink.complete(output, usage);
    exchangesByResponseId.set(responseId, this);
    this.sink = null;
    this.lastToolMessage = null;
    this.streamedContent = "";
    log("response.completed", {
      responseId,
      kind: "tool_calls",
      count: expected.length,
      model: this.model,
    });
  }

  async resolve(outputs) {
    this.deadline.touch();
    for (const output of outputs) {
      const call = this.pendingCalls.get(output.call_id);
      if (!call) continue;
      const normalized = normalizeToolOutput(output);
      const payload = normalized.failed
        ? { requestId: call.requestId, error: normalized.text || "Outer Codex tool failed." }
        : { requestId: call.requestId, result: normalized.text };
      await this.session.rpc.tools.handlePendingToolCall(payload);
      this.deadline.touch();
      this.pendingCalls.delete(output.call_id);
      exchangesByCallId.delete(output.call_id);
      log("tool.resolved", {
        callId: output.call_id,
        failed: normalized.failed,
      });
      recorder.toolResolved(this.record, {
        callId: output.call_id,
        failed: normalized.failed,
        output: normalized.text,
      });
    }
  }

  fail(error, code = "bridge_error") {
    if (this.done) return;
    this.done = true;
    this.deadline.stop();
    log("exchange.error", {
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    this.sink?.fail(error, code);
    void this.session.abort().catch(() => {});
    void this.disconnect();
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;
    this.deadline.stop();
    for (const callId of this.pendingCalls.keys()) exchangesByCallId.delete(callId);
    for (const [responseId, exchange] of exchangesByResponseId) {
      if (exchange === this) exchangesByResponseId.delete(responseId);
    }
    try {
      await this.session.disconnect();
    } catch (error) {
      log("session.disconnect_error", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.cleanupCallback(this);
    }
  }
}

const client = new CopilotClient({
  mode: "copilot-cli",
  logLevel: "error",
  useLoggedInUser: true,
  workingDirectory: fallbackWorkingDirectory,
  sessionIdleTimeoutSeconds: 20 * 60,
});

await client.start();
const models = await client.listModels();
const availableModelIds = new Set(models.map((model) => model.id));
if (!availableModelIds.has(requestedDefaultModel)) {
  await client.stop();
  throw new Error(`The authenticated GitHub Copilot account does not expose ${requestedDefaultModel}.`);
}
const defaultModel = requestedDefaultModel;
const availableOpenAiModels = [...availableModelIds]
  .filter((model) => model.startsWith("gpt-"))
  .sort();

function resolveModel(requestedModel) {
  if (typeof requestedModel === "string" && availableModelIds.has(requestedModel)
    && requestedModel.startsWith("gpt-")) {
    return requestedModel;
  }

  return defaultModel;
}

async function startExchange(body, sink) {
  const declarations = extractToolDeclarations(body);
  const sessionInput = buildSessionInput(body, fallbackWorkingDirectory);
  const reasoningEffort = normalizeReasoningEffort(body?.reasoning?.effort);
  const model = resolveModel(body?.model);
  sink.setModel(model);

  const session = await client.createSession({
    clientName: "codex-copilot-responses-bridge",
    model,
    reasoningEffort,
    reasoningSummary: "none",
    streaming: true,
    includeSubAgentStreamingEvents: false,
    workingDirectory: sessionInput.workingDirectory,
    enableConfigDiscovery: false,
    skipCustomInstructions: true,
    skillDirectories: [],
    pluginDirectories: [],
    instructionDirectories: [],
    mcpServers: {},
    requestCanvasRenderer: false,
    requestExtensions: false,
    enableMcpApps: false,
    customAgentsLocalOnly: true,
    coauthorEnabled: false,
    manageScheduleEnabled: false,
    enableFileChangeTracking: false,
    infiniteSessions: { enabled: false },
    tools: declarations.sdkTools,
    availableTools: declarations.sdkTools.length ? ["custom:*"] : [],
    excludedTools: ["builtin:*", "mcp:*"],
    systemMessage: {
      mode: "customize",
      content: sessionInput.systemContent,
    },
  });

  const exchange = new Exchange(
    session,
    model,
    declarations.byInternalName,
    (value) => exchanges.delete(value),
  );
  exchanges.add(exchange);
  exchange.attachSink(sink);
  recorder.replay(sink.record, {
    phase: "initial",
    model,
    reasoningEffort,
    workingDirectory: sessionInput.workingDirectory,
    prompt: sessionInput.prompt,
    systemContent: sessionInput.systemContent,
    attachments: sessionInput.attachments,
    toolCount: declarations.sdkTools.length,
  });
  log("request.started", {
    responseId: sink.responseId,
    model,
    reasoningEffort,
    toolCount: declarations.sdkTools.length,
    workingDirectory: sessionInput.workingDirectory,
  });

  try {
    exchange.beginTurn();
    await session.send({
      prompt: sessionInput.prompt,
      attachments: sessionInput.attachments.length ? sessionInput.attachments : undefined,
    });
  } catch (error) {
    exchange.fail(error, "copilot_send_failed");
  }
}

async function continueExchange(body, sink, toolOutputs) {
  const matching = toolOutputs
    .map((output) => exchangesByCallId.get(output.call_id))
    .filter(Boolean);
  let exchange = matching[0]
    ?? (body.previous_response_id
      ? exchangesByResponseId.get(body.previous_response_id)
      : null);

  if (!exchange) {
    throw new Error("No pending Copilot tool call matches this Codex response.");
  }
  if (matching.some((candidate) => candidate !== exchange)) {
    throw new Error("Tool outputs from multiple Copilot exchanges cannot share one request.");
  }

  sink.setModel(exchange.model);
  exchange.attachSink(sink);
  exchangesByResponseId.set(sink.responseId, exchange);
  sink.record.continuedFrom = body.previous_response_id ?? null;
  recorder.replay(sink.record, {
    phase: "continuation",
    model: exchange.model,
    previousResponseId: body.previous_response_id ?? null,
    toolOutputs,
  });
  log("request.continued", {
    responseId: sink.responseId,
    toolOutputs: toolOutputs.length,
  });
  try {
    exchange.beginTurn();
    await exchange.resolve(toolOutputs);
  } catch (error) {
    exchange.fail(error, "tool_result_forward_failed");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true,
      provider: "github-copilot-sdk",
      model: defaultModel,
      models: availableOpenAiModels,
      activeExchanges: exchanges.size,
      reliability: {
        blankCompletionRetriesPerTurn: maxBlankCompletionRetries,
        exchangeTimeoutMs,
        exchangeTimeoutMode: "sliding",
        sseHeartbeatIntervalMs,
      },
      metering: "GitHub Copilot allowance applies",
    });
  }

  if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
    // Ephemeral launcher mode has a bearer token that a browser dashboard must
    // not be asked to carry. Persistent mode is loopback-only and intentionally
    // exposes this portal only to local processes.
    if (expectedToken) {
      return sendJson(response, 404, errorPayload("Dashboard is disabled for authenticated ephemeral bridges.", "not_found"));
    }
    if (request.method === "GET" && url.pathname === "/dashboard") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(DASHBOARD_HTML);
      return;
    }
    if (request.method === "GET" && url.pathname === "/dashboard/api") {
      return sendJson(response, 200, recorder.snapshot());
    }
    if (request.method === "POST" && url.pathname === "/dashboard/clear") {
      return sendJson(response, 200, recorder.clear());
    }
    return sendJson(response, 404, errorPayload("Not found.", "not_found"));
  }

  if (!authorized(request)) {
    return sendJson(response, 401, errorPayload("Invalid bridge bearer token.", "unauthorized"));
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    // Codex's provider endpoint expects its own ModelsResponse envelope rather
    // than the public OpenAI list-models shape. An empty catalog tells Codex to
    // retain its built-in metadata for the explicitly selected model.
    return sendJson(response, 200, { models: [] });
  }

  if (request.method !== "POST" || url.pathname !== "/v1/responses") {
    return sendJson(response, 404, errorPayload("Not found.", "not_found"));
  }

  let parsedBody;
  try {
    parsedBody = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, 400, errorPayload(error, "invalid_json"));
  }

  const body = parsedBody.body;
  const record = recorder.start({
    requestPath: url.pathname,
    body,
    inputBytes: parsedBody.bytes,
    streaming: body?.stream !== false,
  });
  const sink = new ResponseSink(response, body, record);
  try {
    const toolOutputs = extractToolOutputs(body)
      .filter((item) => exchangesByCallId.has(item.call_id));
    if (toolOutputs.length) {
      await continueExchange(body, sink, toolOutputs);
    } else {
      await startExchange(body, sink);
    }
  } catch (error) {
    sink.fail(error);
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.listen(port, host, () => {
  log("bridge.ready", {
    url: `http://${host}:${port}/v1`,
    model: defaultModel,
    models: availableOpenAiModels,
    authenticated: Boolean(expectedToken),
  });
});

async function shutdown(signal) {
  log("bridge.shutdown", { signal });
  server.close();
  await Promise.allSettled([...exchanges].map((exchange) => exchange.disconnect()));
  await client.stop();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void shutdown(signal));
}
