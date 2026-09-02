import http from "node:http";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { CopilotClient } from "@github/copilot-sdk";
import { DASHBOARD_HTML } from "./dashboard.mjs";
import {
  BlankCompletionGuard,
  PrematureCompletionGuard,
  SlidingDeadline,
  observeClientDisconnect,
  resolveAssistantContent,
  startSseHeartbeat,
} from "./exchange-lifecycle.mjs";
import { ProxyRecorder } from "./proxy-recorder.mjs";
import {
  normalizeAssistantUsage,
  normalizeQuotaResult,
  safeCopilotModelBilling,
  summarizeAssistantUsage,
  toResponsesUsage,
} from "./copilot-telemetry.mjs";
import { publicPricingSnapshot } from "./pricing.mjs";
import { readJsonBody } from "./request-body.mjs";
import { ResponsesEventStream } from "./responses-stream.mjs";
import { countModelTokens, tokenizerCompatibility } from "./context-tokenizer.mjs";
import {
  assertSerializedContextWithinLimit,
  bridgeContextDefaults,
  buildSessionInput,
  classifyResponseFailureCode,
  externalToolRequestToResponseItem,
  extractToolDeclarations,
  extractToolOutputs,
  makeAssistantMessageItem,
  makeFailedResponseObject,
  makeReasoningItem,
  makeResponseId,
  makeResponseObject,
  normalizeToolOutput,
  resolveModelCompatibility,
  resolveRequestCompatibility,
  RequestCompatibilityError,
} from "./bridge-core.mjs";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.BRIDGE_PORT ?? "4141", 10);
const relayVersion = (() => {
  try {
    const metadata = JSON.parse(
      fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    );
    return typeof metadata.version === "string" ? metadata.version : "unknown";
  } catch {
    return "unknown";
  }
})();
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
const toolResultTimeoutMs = environmentInteger(
  "BRIDGE_TOOL_RESULT_TIMEOUT_MS",
  13 * 60 * 60 * 1000,
  60_000,
  7 * 24 * 60 * 60 * 1000,
);
const copilotSessionIdleTimeoutSeconds = environmentInteger(
  "BRIDGE_COPILOT_SESSION_IDLE_TIMEOUT_SECONDS",
  0,
  0,
  7 * 24 * 60 * 60,
);
const maxBlankCompletionRetries = environmentInteger(
  "BRIDGE_MAX_BLANK_COMPLETION_RETRIES",
  2,
  0,
  5,
);
const maxPrematureCompletionRetries = environmentInteger(
  "BRIDGE_MAX_PREMATURE_COMPLETION_RETRIES",
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
const quotaRefreshIntervalMs = environmentInteger(
  "BRIDGE_QUOTA_REFRESH_INTERVAL_MS",
  5 * 60 * 1000,
  30_000,
  60 * 60 * 1000,
);
const maxSerializedContextChars = environmentInteger(
  "BRIDGE_MAX_SERIALIZED_CONTEXT_CHARS",
  1_000_000,
  256_000,
  4_000_000,
);
const maxRequestBodyBytes = environmentInteger(
  "BRIDGE_MAX_REQUEST_BODY_BYTES",
  128 * 1024 * 1024,
  1024 * 1024,
  512 * 1024 * 1024,
);
const runtimeDirectory = process.env.BRIDGE_RUNTIME_DIRECTORY ?? path.join(process.cwd(), "runtime");
const recorderHistoryLimit = environmentInteger("BRIDGE_HISTORY_LIMIT", 1_000, 1_000, 10_000);
const recorderDetailedLimit = environmentInteger(
  "BRIDGE_DETAILED_HISTORY_LIMIT",
  200,
  25,
  recorderHistoryLimit,
);
const recorderMaxHistoryBytes = environmentInteger(
  "BRIDGE_HISTORY_MAX_MIB",
  256,
  32,
  768,
) * 1024 * 1024;
const recorderMaxMetricsBytes = environmentInteger(
  "BRIDGE_METRICS_MAX_MIB",
  16,
  1,
  64,
) * 1024 * 1024;
const recorderMaxRecordBytes = environmentInteger(
  "BRIDGE_HISTORY_RECORD_MAX_KIB",
  512,
  64,
  2_048,
) * 1024;
const eventLogPath = process.env.BRIDGE_EVENT_LOG_PATH
  ? path.resolve(process.env.BRIDGE_EVENT_LOG_PATH)
  : null;
const eventLogMaxBytes = environmentInteger(
  "BRIDGE_EVENT_LOG_MAX_MIB",
  64,
  8,
  128,
) * 1024 * 1024;
const watchdogLogMaxBytes = 8 * 1024 * 1024;
const auxiliaryLogMaxBytes = 32 * 1024 * 1024;
const telemetryDiskBudgetBytes = 1024 * 1024 * 1024;
const recorder = new ProxyRecorder({
  filePath: path.join(runtimeDirectory, "proxy-events.jsonl"),
  metricsFilePath: path.join(runtimeDirectory, "proxy-metrics.json"),
  limit: recorderHistoryLimit,
  detailedLimit: recorderDetailedLimit,
  maxHistoryBytes: recorderMaxHistoryBytes,
  maxMetricsBytes: recorderMaxMetricsBytes,
  maxRecordBytes: recorderMaxRecordBytes,
});
let copilotQuota = {
  status: "loading",
  lastUpdatedAt: null,
  snapshots: {},
};
let copilotModelBilling = [];
let openAiPublicPricing = publicPricingSnapshot([]);
let quotaRefreshPromise = null;
let quotaRefreshTimer = null;

const exchanges = new Set();
const exchangesByCallId = new Map();
const exchangesByResponseId = new Map();

function localFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function telemetryStorage() {
  const recorderStorage = recorder.storage();
  const eventLogBytes = localFileSize(eventLogPath ?? path.join(runtimeDirectory, "proxy.stdout.log"));
  const watchdogLogBytes = localFileSize(path.join(runtimeDirectory, "watchdog.log"));
  const processStdoutBytes = localFileSize(path.join(runtimeDirectory, "proxy.process.stdout.log"));
  const processStderrBytes = localFileSize(path.join(runtimeDirectory, "proxy.stderr.log"));
  const totalBytes = recorderStorage.totalBytes
    + eventLogBytes
    + watchdogLogBytes
    + processStdoutBytes
    + processStderrBytes;
  const telemetryCapBytes = recorderStorage.telemetryCapBytes
    + eventLogMaxBytes
    + watchdogLogMaxBytes
    + (2 * auxiliaryLogMaxBytes);
  return {
    ...recorderStorage,
    eventLogBytes,
    watchdogLogBytes,
    processStdoutBytes,
    processStderrBytes,
    totalBytes,
    telemetryCapBytes,
    diskBudgetBytes: telemetryDiskBudgetBytes,
    utilizationPercent: telemetryCapBytes
      ? Math.min(100, Math.round((totalBytes / telemetryCapBytes) * 10_000) / 100)
      : 0,
  };
}

function dashboardSnapshot() {
  const snapshot = recorder.snapshot({ includeDetails: false });
  snapshot.sampledAt = new Date().toISOString();
  snapshot.relayVersion = relayVersion;
  snapshot.defaultModel = defaultModel;
  snapshot.storage = telemetryStorage();
  snapshot.activeExchanges = exchanges.size;
  snapshot.copilot = {
    quota: copilotQuota,
    modelBilling: copilotModelBilling,
    usageUnit: "AI credits",
    currencyConversionApplied: false,
  };
  snapshot.pricing = openAiPublicPricing;
  return snapshot;
}

function log(type, fields = {}) {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    ...fields,
  })}\n`;
  if (!eventLogPath) {
    process.stdout.write(line);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
    const currentBytes = fs.existsSync(eventLogPath) ? fs.statSync(eventLogPath).size : 0;
    if (currentBytes + Buffer.byteLength(line, "utf8") > eventLogMaxBytes) {
      const keepBytes = Math.min(8 * 1024 * 1024, Math.floor(eventLogMaxBytes / 4));
      const existing = fs.readFileSync(eventLogPath);
      const tail = existing.subarray(Math.max(0, existing.length - keepBytes)).toString("utf8");
      const firstNewline = tail.indexOf("\n");
      const retainedTail = firstNewline >= 0 ? tail.slice(firstNewline + 1) : "";
      fs.writeFileSync(eventLogPath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        type: "event_log.compacted",
        retainedBytes: Buffer.byteLength(retainedTail, "utf8"),
        maxBytes: eventLogMaxBytes,
      })}\n${retainedTail}`, "utf8");
    }
    fs.appendFileSync(eventLogPath, line, "utf8");
  } catch {
    // Logging must never affect model traffic. Fall back to the process stream.
    process.stdout.write(line);
  }
}

function sendJson(response, status, body, headers = {}) {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(`${JSON.stringify(body)}\n`);
}

function writeSseEvent(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function openDashboardEventStream(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(`event: relay\ndata: ${JSON.stringify({
    type: "dashboard.ready",
    at: new Date().toISOString(),
    summary: recorder.summary(),
  })}\n\n`);
  const unsubscribe = recorder.subscribe((event) => {
    if (!response.writableEnded && !response.destroyed) {
      response.write(`event: relay\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(": heartbeat\n\n");
  }, sseHeartbeatIntervalMs);
  heartbeat.unref?.();
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.once("close", cleanup);
  response.once("close", cleanup);
}

function errorPayload(error, code = error?.code ?? "bridge_error") {
  return {
    error: {
      message: error instanceof Error ? error.message : String(error),
      type: "invalid_request_error",
      code,
      param: typeof error?.param === "string" ? error.param : null,
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
    this.stopDisconnectObserver = () => {};
    this.disconnectHandler = null;
    this.disconnectError = null;
    this.usageProvider = () => null;
    this.eventStream = null;

    this.stopDisconnectObserver = observeClientDisconnect(response, {
      isClosed: () => this.closed,
      onDisconnect: () => this.handleClientDisconnect(),
    });

    if (this.streaming) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      this.eventStream = new ResponsesEventStream({
        responseId: this.responseId,
        model: this.model,
        requestBody,
        emit: (event) => writeSseEvent(response, event),
      });
      this.eventStream.start();
      this.stopHeartbeat = startSseHeartbeat(response, {
        intervalMs: sseHeartbeatIntervalMs,
        emitHeartbeat: () => this.eventStream.heartbeat(),
      });
    }
  }

  setClientDisconnectHandler(handler) {
    this.disconnectHandler = handler;
    if (this.disconnectError) handler(this.disconnectError);
  }

  setUsageProvider(provider) {
    this.usageProvider = typeof provider === "function" ? provider : () => null;
  }

  relayUsage() {
    try {
      return this.usageProvider();
    } catch {
      return null;
    }
  }

  handleClientDisconnect() {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.eventStream?.close();
    this.disconnectError = new Error("Codex client disconnected before the Responses stream completed.");
    recorder.finish(this.record, {
      status: "failed",
      selectedModel: this.model,
      error: this.disconnectError,
      usage: this.relayUsage(),
    });
    log("response.client_disconnected", {
      responseId: this.responseId,
      model: this.model,
    });
    this.disconnectHandler?.(this.disconnectError);
  }

  setModel(model) {
    this.model = model;
    this.eventStream?.setModel(model);
    recorder.setSelectedModel(this.record, model);
  }

  appendTextDelta(delta, metadata = {}) {
    this.eventStream?.appendTextDelta(delta, metadata);
  }

  finishText(text, metadata = {}) {
    return this.streaming
      ? this.eventStream.finishText(text, metadata)
      : makeAssistantMessageItem(text, {
        id: metadata.messageId,
        phase: metadata.phase,
      });
  }

  appendReasoningDelta(delta, metadata = {}) {
    this.eventStream?.appendReasoningDelta(delta, metadata);
  }

  finishReasoning(text, metadata = {}) {
    return this.streaming
      ? this.eventStream.finishReasoning(text, metadata)
      : makeReasoningItem(text, { id: metadata.reasoningId });
  }

  appendToolCallDelta(delta, metadata = {}) {
    this.eventStream?.appendToolCallDelta(delta, metadata);
  }

  finishItem(item) {
    if (this.streaming) this.eventStream.finishItem(item);
    return item;
  }

  complete(output, usage, relayUsage = this.relayUsage()) {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.stopDisconnectObserver();
    const responseObject = this.streaming
      ? this.eventStream.complete(output, usage)
      : makeResponseObject({
        responseId: this.responseId,
        model: this.model,
        output,
        usage,
        requestBody: this.requestBody,
      });
    recorder.finish(this.record, {
      status: "completed",
      selectedModel: this.model,
      output: responseObject,
      outputBytes: Buffer.byteLength(JSON.stringify(responseObject), "utf8"),
      usage: relayUsage,
    });

    if (this.streaming) {
      this.response.end();
    } else {
      sendJson(this.response, 200, responseObject);
    }
  }

  fail(error, code = "bridge_error", relayUsage = this.relayUsage()) {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.stopDisconnectObserver();
    const payload = errorPayload(error, code);
    const responseErrorCode = classifyResponseFailureCode(payload.error.message);
    const failedResponse = makeFailedResponseObject({
      responseId: this.responseId,
      model: this.model,
      code: responseErrorCode,
      message: payload.error.message,
    });
    recorder.finish(this.record, {
      status: "failed",
      selectedModel: this.model,
      error: payload.error,
      usage: relayUsage,
    });
    log("response.failed", {
      responseId: this.responseId,
      model: this.model,
      code: responseErrorCode,
      message: payload.error.message,
    });
    if (this.streaming) {
      this.eventStream.fail(failedResponse);
      this.response.end();
    } else {
      sendJson(
        this.response,
        Number.isInteger(error?.statusCode) ? error.statusCode : 500,
        payload,
      );
    }
  }
}

class Exchange {
  constructor(session, model, toolMetadata, cleanup, {
    requiresAction = false,
    toolCount = 0,
  } = {}) {
    this.session = session;
    this.model = model;
    this.toolMetadata = toolMetadata;
    this.cleanupCallback = cleanup;
    this.sink = null;
    this.record = null;
    this.pendingCalls = new Map();
    this.lastToolMessage = null;
    this.streamedContent = "";
    this.streamedReasoning = "";
    this.currentMessageMetadata = {};
    this.completedReasoningTexts = new Set();
    this.responseItems = [];
    this.pendingFinalMessage = null;
    this.usageEvents = [];
    this.requiresAction = requiresAction;
    this.toolCount = toolCount;
    this.blankGuard = new BlankCompletionGuard({
      maxRetries: maxBlankCompletionRetries,
    });
    this.prematureGuard = new PrematureCompletionGuard({
      maxRetries: maxPrematureCompletionRetries,
    });
    this.done = false;
    this.disconnecting = false;
    this.deadline = new SlidingDeadline({
      timeoutMs: exchangeTimeoutMs,
      onTimeout: () => {
        this.fail(
          new Error(`Copilot exchange became inactive during ${this.deadlinePhase ?? "model work"} and timed out.`),
          "exchange_timeout",
        );
      },
    });
    this.armModelDeadline();

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
    this.responseItems = [];
    this.pendingFinalMessage = null;
    this.usageEvents = [];
    this.streamedContent = "";
    this.streamedReasoning = "";
    this.currentMessageMetadata = {};
    this.completedReasoningTexts = new Set();
    this.prematureGuard.reset();
    this.armModelDeadline();
    sink.setUsageProvider(() => this.currentUsage());
    sink.setClientDisconnectHandler((error) => this.clientDisconnected(sink, error));
    return !this.done;
  }

  clientDisconnected(sink, error) {
    if (this.done || this.sink !== sink) return;
    this.done = true;
    this.deadline.stop();
    this.sink = null;
    log("exchange.error", {
      responseId: sink.responseId,
      model: this.model,
      code: "client_disconnected",
      message: error.message,
    });
    void this.session.abort().catch(() => {});
    void this.disconnect();
  }

  armModelDeadline() {
    this.deadlinePhase = "model activity";
    this.deadline.touch(exchangeTimeoutMs);
  }

  armToolDeadline() {
    this.deadlinePhase = "outer tool execution";
    this.deadline.touch(toolResultTimeoutMs);
  }

  beginTurn({ resetBlankRetries = true } = {}) {
    this.streamedContent = "";
    this.streamedReasoning = "";
    this.currentMessageMetadata = {};
    this.blankGuard.expectResponse({ resetRetries: resetBlankRetries });
    this.armModelDeadline();
  }

  async handleEvent(event) {
    if (this.done) return;
    this.armModelDeadline();

    if (event.type === "assistant.usage") {
      const usage = normalizeAssistantUsage(event.data);
      if (usage) {
        this.usageEvents.push(usage);
        recorder.usageObserved(this.record, usage);
      }
      return;
    }

    if (event.type === "assistant.turn_start") {
      this.streamedContent = "";
      this.streamedReasoning = "";
      this.currentMessageMetadata = {};
      return;
    }

    if (event.type === "assistant.message_start") {
      this.currentMessageMetadata = {
        messageId: event.data?.messageId,
        phase: event.data?.phase,
      };
      return;
    }

    if (event.type === "assistant.reasoning_delta") {
      const delta = event.data?.deltaContent;
      if (typeof delta === "string") {
        this.streamedReasoning += delta;
        this.sink?.appendReasoningDelta(delta, {
          reasoningId: event.data?.reasoningId,
        });
      }
      return;
    }

    if (event.type === "assistant.reasoning") {
      const content = typeof event.data?.content === "string" && event.data.content
        ? event.data.content
        : this.streamedReasoning;
      if (content && !this.completedReasoningTexts.has(content)) {
        const item = this.sink?.finishReasoning(content, {
          reasoningId: event.data?.reasoningId,
        });
        if (item && !this.responseItems.some((candidate) => candidate.id === item.id)) {
          this.responseItems.push(item);
        }
        this.completedReasoningTexts.add(content);
      }
      this.streamedReasoning = "";
      return;
    }

    if (event.type === "assistant.message_delta") {
      const delta = event.data?.deltaContent;
      if (typeof delta === "string") {
        this.streamedContent += delta;
        this.sink?.appendTextDelta(delta, this.currentMessageMetadata);
      }
      return;
    }

    if (event.type === "assistant.tool_call_delta") {
      const metadata = this.toolMetadata.get(event.data?.name);
      if (metadata && typeof event.data?.inputDelta === "string") {
        this.sink?.appendToolCallDelta(event.data.inputDelta, {
          kind: metadata.kind,
          name: metadata.name,
          namespace: metadata.namespace,
          toolCallId: event.data?.toolCallId,
        });
      }
      return;
    }

    if (event.type === "assistant.message") {
      const messageMetadata = {
        messageId: event.data?.messageId ?? this.currentMessageMetadata.messageId,
        phase: event.data?.phase ?? this.currentMessageMetadata.phase,
      };
      if (typeof event.data?.reasoningText === "string"
        && event.data.reasoningText
        && !this.completedReasoningTexts.has(event.data.reasoningText)) {
        const reasoningItem = this.sink?.finishReasoning(event.data.reasoningText, {
          reasoningId: `${messageMetadata.messageId ?? event.id ?? "message"}-reasoning`,
        });
        if (reasoningItem
          && !this.responseItems.some((candidate) => candidate.id === reasoningItem.id)) {
          this.responseItems.push(reasoningItem);
        }
        this.completedReasoningTexts.add(event.data.reasoningText);
        this.streamedReasoning = "";
      }
      const decision = this.blankGuard.observeAssistantMessage(
        event.data,
        this.streamedContent,
      );
      this.streamedContent = "";

      if (decision.kind === "tool_calls") {
        if (this.pendingFinalMessage?.item
          && !this.responseItems.some((item) => item.id === this.pendingFinalMessage.item.id)) {
          this.responseItems.push(this.pendingFinalMessage.item);
        }
        this.pendingFinalMessage = null;
        const messageItem = decision.content && this.sink
          ? this.sink.finishText(decision.content, messageMetadata)
          : null;
        this.lastToolMessage = {
          ...event.data,
          content: decision.content,
          messageItem,
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
      if (this.pendingFinalMessage?.item
        && !this.responseItems.some((item) => item.id === this.pendingFinalMessage.item.id)) {
        this.responseItems.push(this.pendingFinalMessage.item);
      }
      this.pendingFinalMessage = {
        content: decision.content,
        eventData: event.data,
        item: this.sink.finishText(decision.content, messageMetadata),
      };
      this.currentMessageMetadata = {};
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

  async completeFinalMessage(text, eventData = {}, messageItem = null) {
    if (!this.sink || this.sink.closed) return;
    const item = messageItem ?? this.sink.finishText(text);
    const output = [...this.responseItems];
    if (item && !output.some((candidate) => candidate.id === item.id)) output.push(item);
    const relayUsage = this.currentUsage();
    const usage = relayUsage.metered
      ? toResponsesUsage(relayUsage)
      : this.usageFromEvent(eventData);
    const responseId = this.sink.responseId;
    this.sink.complete(output, usage, relayUsage);
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

    if (this.streamedReasoning) {
      const reasoningItem = this.sink.finishReasoning(this.streamedReasoning);
      if (reasoningItem
        && !this.responseItems.some((candidate) => candidate.id === reasoningItem.id)) {
        this.responseItems.push(reasoningItem);
      }
      this.streamedReasoning = "";
    }

    if (this.pendingFinalMessage) {
      const pending = this.pendingFinalMessage;
      this.pendingFinalMessage = null;
      const decision = this.prematureGuard.observe({
        content: pending.content,
        requiresAction: this.requiresAction,
        toolCount: this.toolCount,
      });
      if (decision.kind === "retry") {
        if (pending.item && !this.responseItems.some((item) => item.id === pending.item.id)) {
          this.responseItems.push(pending.item);
        }
        recorder.replay(this.record, {
          phase: "premature_completion_retry",
          model: this.model,
          attempt: decision.attempt,
          content: pending.content,
        });
        log("premature_completion.retry", {
          responseId: this.sink.responseId,
          model: this.model,
          attempt: decision.attempt,
        });
        this.beginTurn({ resetBlankRetries: false });
        try {
          await this.session.send({ prompt: decision.prompt });
        } catch (error) {
          this.fail(error, "premature_completion_retry_failed");
        }
        return;
      }
      if (decision.exhausted) {
        log("premature_completion.exhausted", {
          responseId: this.sink.responseId,
          model: this.model,
          attempts: this.prematureGuard.retryCount,
        });
      }
      await this.completeFinalMessage(pending.content, pending.eventData, pending.item);
      return;
    }

    const streamedFallback = resolveAssistantContent({}, this.streamedContent);
    if (streamedFallback) {
      this.streamedContent = "";
      this.pendingFinalMessage = {
        content: streamedFallback,
        eventData: {},
        item: this.sink.finishText(streamedFallback),
      };
      await this.handleSessionIdle();
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

  currentUsage() {
    return summarizeAssistantUsage(this.usageEvents);
  }

  maybeCompleteToolTurn() {
    if (!this.lastToolMessage || !this.sink || this.sink.closed) return;
    const expected = this.lastToolMessage.toolRequests
      .map((request) => request.toolCallId)
      .filter(Boolean);
    if (!expected.length || !expected.every((callId) => this.pendingCalls.has(callId))) return;

    const output = [...this.responseItems];
    if (this.lastToolMessage.messageItem) output.push(this.lastToolMessage.messageItem);
    for (const callId of expected) {
      const item = this.pendingCalls.get(callId).item;
      this.sink.finishItem(item);
      output.push(item);
    }

    const relayUsage = this.currentUsage();
    const usage = relayUsage.metered
      ? toResponsesUsage(relayUsage)
      : this.usageFromEvent(this.lastToolMessage);
    const responseId = this.sink.responseId;
    this.sink.complete(output, usage, relayUsage);
    exchangesByResponseId.set(responseId, this);
    this.sink = null;
    this.lastToolMessage = null;
    this.streamedContent = "";
    this.responseItems = [];
    this.pendingFinalMessage = null;
    this.armToolDeadline();
    log("response.completed", {
      responseId,
      kind: "tool_calls",
      count: expected.length,
      model: this.model,
    });
  }

  async resolve(outputs) {
    this.armModelDeadline();
    for (const output of outputs) {
      const call = this.pendingCalls.get(output.call_id);
      if (!call) continue;
      const normalized = normalizeToolOutput(output);
      const payload = normalized.failed
        ? { requestId: call.requestId, error: normalized.text || "Outer Codex tool failed." }
        : { requestId: call.requestId, result: normalized.text };
      await this.session.rpc.tools.handlePendingToolCall(payload);
      this.armModelDeadline();
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
      responseId: this.sink?.responseId ?? null,
      model: this.model,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    this.sink?.fail(error, code, this.currentUsage());
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
  sessionIdleTimeoutSeconds: copilotSessionIdleTimeoutSeconds,
});

await client.start();
const models = await client.listModels();
const availableModelIds = new Set(models.map((model) => model.id));
const modelsById = new Map(models.map((model) => [model.id, model]));
if (!availableModelIds.has(requestedDefaultModel)) {
  await client.stop();
  throw new Error(`The authenticated GitHub Copilot account does not expose ${requestedDefaultModel}.`);
}
const defaultModel = requestedDefaultModel;
const defaultModelCompatibility = resolveModelCompatibility(modelsById.get(defaultModel));
const availableOpenAiModels = [...availableModelIds]
  .filter((model) => model.startsWith("gpt-"))
  .sort();
copilotModelBilling = safeCopilotModelBilling(models);
openAiPublicPricing = publicPricingSnapshot(availableOpenAiModels);

async function refreshCopilotQuota({ force = false } = {}) {
  if (quotaRefreshPromise) return quotaRefreshPromise;
  const lastUpdatedMs = Date.parse(copilotQuota.lastUpdatedAt ?? "");
  if (!force && Number.isFinite(lastUpdatedMs)
    && Date.now() - lastUpdatedMs < quotaRefreshIntervalMs) {
    return copilotQuota;
  }
  const previous = copilotQuota;
  copilotQuota = {
    ...previous,
    status: Object.keys(previous.snapshots ?? {}).length ? "refreshing" : "loading",
    lastAttemptAt: new Date().toISOString(),
  };
  quotaRefreshPromise = (async () => {
    try {
      const result = await client.rpc.account.getQuota({});
      copilotQuota = {
        ...normalizeQuotaResult(result, new Date().toISOString()),
        lastAttemptAt: new Date().toISOString(),
      };
    } catch {
      copilotQuota = {
        status: Object.keys(previous.snapshots ?? {}).length ? "stale" : "unavailable",
        lastUpdatedAt: previous.lastUpdatedAt ?? null,
        lastAttemptAt: new Date().toISOString(),
        snapshots: previous.snapshots ?? {},
        message: "Copilot SDK quota lookup is temporarily unavailable.",
      };
      log("quota.refresh_failed");
    } finally {
      quotaRefreshPromise = null;
    }
    return copilotQuota;
  })();
  return quotaRefreshPromise;
}

void refreshCopilotQuota({ force: true });
quotaRefreshTimer = setInterval(() => void refreshCopilotQuota({ force: true }), quotaRefreshIntervalMs);
quotaRefreshTimer.unref?.();

function resolveModel(requestedModel) {
  if (typeof requestedModel === "string" && requestedModel) {
    if (availableModelIds.has(requestedModel) && requestedModel.startsWith("gpt-")) {
      return requestedModel;
    }
    throw new RequestCompatibilityError(
      "model",
      `Model ${JSON.stringify(requestedModel)} is not exposed by the authenticated GitHub Copilot account.`,
    );
  }

  return defaultModel;
}

function selectSessionTools(declarations, toolChoice) {
  if (toolChoice === "none") return [];
  if (toolChoice?.mode === "specific") {
    const matches = declarations.metadata.filter((metadata) =>
      metadata.kind === toolChoice.type
      && metadata.name === toolChoice.name
      && (toolChoice.namespace == null || metadata.namespace === toolChoice.namespace));
    if (matches.length !== 1) {
      const detail = matches.length === 0
        ? "the named tool is not present in this request"
        : "the name is ambiguous; include its namespace";
      throw new RequestCompatibilityError(
        "tool_choice",
        `The requested tool ${JSON.stringify(toolChoice.name)} cannot be selected because ${detail}.`,
      );
    }
    const selected = declarations.sdkTools.find((tool) =>
      tool.name === matches[0].internalName);
    return selected ? [{ ...selected, defer: "never" }] : [];
  }
  if (toolChoice === "required" && declarations.sdkTools.length === 0) {
    throw new RequestCompatibilityError(
      "tool_choice",
      "tool_choice is required, but the request does not declare an outer tool.",
    );
  }
  return declarations.sdkTools;
}

function resolveRelayRequest(body) {
  const requestCompatibility = resolveRequestCompatibility(body);
  const declarations = extractToolDeclarations(body);
  const sessionTools = selectSessionTools(declarations, requestCompatibility.toolChoice);
  const model = resolveModel(body?.model);
  const modelCompatibility = resolveModelCompatibility(modelsById.get(model));
  if (requestCompatibility.maxOutputTokens
    && modelCompatibility.maxOutputTokens
    && requestCompatibility.maxOutputTokens > modelCompatibility.maxOutputTokens) {
    throw new RequestCompatibilityError(
      "max_output_tokens",
      `Requested ${requestCompatibility.maxOutputTokens} output tokens, but ${model} advertises a maximum of ${modelCompatibility.maxOutputTokens}.`,
    );
  }
  return {
    ...requestCompatibility,
    declarations,
    model,
    modelCompatibility,
    sessionTools,
  };
}

async function startExchange(body, sink, requestCompatibility) {
  const declarations = requestCompatibility.declarations;
  const sessionTools = requestCompatibility.sessionTools;
  const serializedToolDefinitions = JSON.stringify(sessionTools);
  const toolDefinitionChars = serializedToolDefinitions.length;
  const reasoningEffort = requestCompatibility.reasoningEffort;
  const model = requestCompatibility.model;
  const modelCompatibility = requestCompatibility.modelCompatibility;
  const sessionInput = buildSessionInput(body, fallbackWorkingDirectory, {
    maxSerializedTextChars: maxSerializedContextChars,
    maxSerializedTextTokens: modelCompatibility.maxPromptTokens,
    countTokens: countModelTokens,
    serializedToolDefinitions,
    toolDefinitionChars,
    useHistoryCompaction: requestCompatibility.useHistoryCompaction,
    reasoningContext: requestCompatibility.reasoningContext,
    systemInstructions: requestCompatibility.systemInstructions,
    maxImageAttachments: modelCompatibility.maxImageAttachments,
    maxAttachmentBase64Chars: modelCompatibility.maxAttachmentBase64Chars,
    maxSingleAttachmentBase64Chars:
      modelCompatibility.maxSingleAttachmentBase64Chars,
  });
  if (requestCompatibility.toolChoice === "none") sessionInput.requiresAction = false;
  if (requestCompatibility.toolChoice === "required"
    || requestCompatibility.toolChoice?.mode === "specific") {
    sessionInput.requiresAction = true;
  }
  Object.assign(
    sessionInput.contextStats,
    assertSerializedContextWithinLimit(
      sessionInput,
      sessionTools,
      {
        maxSerializedTextChars: maxSerializedContextChars,
        maxSerializedTextTokens: modelCompatibility.maxPromptTokens,
        countTokens: countModelTokens,
      },
    ),
  );
  sink.setModel(model);

  const hasDeferredTools = sessionTools.some((tool) => tool.defer === "auto");
  const modelCapabilities = requestCompatibility.maxOutputTokens
    ? { limits: { max_output_tokens: requestCompatibility.maxOutputTokens } }
    : undefined;

  const session = await client.createSession({
    clientName: "codex-copilot-responses-bridge",
    model,
    contextTier: modelCompatibility.contextTier,
    reasoningEffort,
    reasoningSummary: requestCompatibility.reasoningSummary,
    modelCapabilities,
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
    enableSessionStore: false,
    memory: { enabled: false },
    infiniteSessions: {
      enabled: true,
      backgroundCompactionThreshold: 0.8,
      bufferExhaustionThreshold: 0.95,
    },
    tools: sessionTools,
    toolSearch: hasDeferredTools ? { enabled: true, deferThreshold: 1 } : { enabled: false },
    availableTools: sessionTools.length
      ? (hasDeferredTools
          ? ["custom:*", "builtin:tool_search_tool"]
          : ["custom:*"])
      : [],
    excludedTools: hasDeferredTools ? ["mcp:*"] : ["builtin:*", "mcp:*"],
    systemMessage: {
      mode: "replace",
      content: sessionInput.systemContent,
    },
  });

  const exchange = new Exchange(
    session,
    model,
    declarations.byInternalName,
    (value) => exchanges.delete(value),
    {
      requiresAction: sessionInput.requiresAction,
      toolCount: sessionTools.length,
    },
  );
  exchanges.add(exchange);
  if (!exchange.attachSink(sink)) return;
  recorder.replay(sink.record, {
    phase: "initial",
    model,
    reasoningEffort,
    reasoningSummary: requestCompatibility.reasoningSummary,
    requestCompatibility: {
      parallelToolCalls: requestCompatibility.parallelToolCalls,
      textVerbosity: requestCompatibility.textVerbosity,
      toolChoice: requestCompatibility.toolChoice,
      truncation: requestCompatibility.truncation,
    },
    workingDirectory: sessionInput.workingDirectory,
    prompt: sessionInput.prompt,
    systemContent: sessionInput.systemContent,
    attachments: {
      count: sessionInput.attachments.length,
      base64Chars: sessionInput.contextStats.attachmentBase64Chars,
      mimeTypes: [...new Set(sessionInput.attachments.map((item) => item.mimeType))],
    },
    contextStats: sessionInput.contextStats,
    compatibility: modelCompatibility,
    toolCount: sessionTools.length,
    deferredToolCount: sessionTools.filter((tool) => tool.defer === "auto").length,
  });
  if (sessionInput.contextStats.historyCompacted
    || sessionInput.contextStats.imageAttachments > 0
    || sessionInput.contextStats.omittedImageAttachments > 0
    || sessionInput.contextStats.truncatedToolOutputs > 0) {
    log("context.compacted", {
      responseId: sink.responseId,
      ...sessionInput.contextStats,
    });
  }
  log("request.started", {
    responseId: sink.responseId,
    model,
    reasoningEffort,
    reasoningSummary: requestCompatibility.reasoningSummary,
    toolCount: sessionTools.length,
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
  if (!exchange.attachSink(sink)) return;
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
      version: relayVersion,
      provider: "github-copilot-sdk",
      model: defaultModel,
      models: availableOpenAiModels,
      activeExchanges: exchanges.size,
      compatibility: {
        contextTier: defaultModelCompatibility.contextTier,
        maxPromptTokens: defaultModelCompatibility.maxPromptTokens,
        maxOutputTokens: defaultModelCompatibility.maxOutputTokens,
        maxContextWindowTokens: defaultModelCompatibility.maxContextWindowTokens,
        maxPromptImages: defaultModelCompatibility.maxImageAttachments,
        maxPromptImageBase64Chars:
          defaultModelCompatibility.maxSingleAttachmentBase64Chars,
        outerCodexInstructions: "forwarded",
        outerCodexTools: "declaration-only; execution remains in Codex",
        outerCodexMemory: "forwarded through request instructions",
        assistantMessagePhase: "preserved",
        readableReasoningSummaries: "forwarded when emitted by Copilot",
        streamedToolArguments: true,
        deferredOuterTools: "supported through Copilot tool search",
        unsupportedRequestSemantics: "rejected before streaming with HTTP 400",
        copilotNativeMemory: false,
        copilotBuiltInTools: "disabled except tool_search_tool for deferred outer declarations",
      },
      reliability: {
        blankCompletionRetriesPerTurn: maxBlankCompletionRetries,
        prematureCompletionRetriesPerTurn: maxPrematureCompletionRetries,
        exchangeTimeoutMs,
        exchangeTimeoutMode: "sliding",
        outerToolTimeoutMs: toolResultTimeoutMs,
        copilotSessionIdleTimeoutSeconds,
        sseHeartbeatIntervalMs,
        sseHeartbeatFormat: "response.in_progress",
        responsesStreamingLifecycle: "full",
        sdkSystemMessageMode: "replace",
        sdkAutomaticContextCompaction: true,
        contextGuard: {
          ...bridgeContextDefaults,
          budgetMode: defaultModelCompatibility.maxPromptTokens
            ? "model_tokens"
            : "fallback_characters",
          tokenizer: tokenizerCompatibility,
          maxPromptTokens: defaultModelCompatibility.maxPromptTokens,
          legacyFallbackMaxSerializedTextChars: maxSerializedContextChars,
          imageAttachments: defaultModelCompatibility.maxImageAttachments,
          attachmentBase64Chars:
            defaultModelCompatibility.maxAttachmentBase64Chars,
          singleAttachmentBase64Chars:
            defaultModelCompatibility.maxSingleAttachmentBase64Chars,
        },
        maxRequestBodyBytes,
        maxSerializedContextChars,
      },
      telemetry: {
        recentEntries: recorderHistoryLimit,
        detailedEntries: recorderDetailedLimit,
        lifetimeCounters: true,
        hourlyRollupDays: 31,
        dailyRollupYears: 10,
        maxHistoryBytes: recorderMaxHistoryBytes,
        maxMetricsBytes: recorderMaxMetricsBytes,
        maxEventLogBytes: eventLogMaxBytes,
        summary: recorder.summary(),
        storage: telemetryStorage(),
        sdkUsageEvents: true,
        quotaStatus: copilotQuota.status,
        publicPricingSourceDate: openAiPublicPricing.sourceDate,
      },
      metering: "Exact Copilot SDK usage plus separately labeled OpenAI API-equivalent estimate",
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
    if (request.method === "GET" && url.pathname === "/dashboard/events") {
      openDashboardEventStream(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/dashboard/api") {
      void refreshCopilotQuota();
      return sendJson(response, 200, dashboardSnapshot(), {
        "cache-control": "no-store",
      });
    }
    if (request.method === "GET" && url.pathname.startsWith("/dashboard/api/records/")) {
      let recordId;
      try {
        recordId = decodeURIComponent(url.pathname.slice("/dashboard/api/records/".length));
      } catch {
        return sendJson(response, 400, errorPayload("Invalid record identifier.", "invalid_record_id"));
      }
      const record = recorder.detail(recordId);
      if (!record) return sendJson(response, 404, errorPayload("Record not found.", "not_found"));
      return sendJson(response, 200, {
        ok: true,
        localOnly: true,
        sanitized: true,
        record,
      }, { "cache-control": "no-store" });
    }
    if (request.method === "POST" && url.pathname === "/dashboard/clear") {
      return sendJson(response, 200, recorder.clear());
    }
    if (request.method === "POST" && url.pathname === "/dashboard/quota/refresh") {
      const quota = await refreshCopilotQuota({ force: true });
      return sendJson(response, 200, { ok: true, quota }, { "cache-control": "no-store" });
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
    parsedBody = await readJsonBody(request, { maxBytes: maxRequestBodyBytes });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    const code = typeof error?.code === "string" ? error.code : "invalid_json";
    log("bridge.request_rejected", {
      statusCode,
      code,
      receivedBytes: error?.receivedBytes ?? null,
      limitBytes: error?.limitBytes ?? maxRequestBodyBytes,
    });
    return sendJson(
      response,
      statusCode,
      errorPayload(error, code),
      statusCode === 413 ? { connection: "close" } : {},
    );
  }

  const body = parsedBody.body;
  let requestCompatibility;
  try {
    requestCompatibility = resolveRelayRequest(body);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    const code = typeof error?.code === "string" ? error.code : "invalid_request_error";
    log("bridge.request_rejected", {
      statusCode,
      code,
      param: error?.param ?? null,
      receivedBytes: parsedBody.bytes,
    });
    return sendJson(response, statusCode, errorPayload(error, code));
  }
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
      await startExchange(body, sink, requestCompatibility);
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
    version: relayVersion,
    model: defaultModel,
    models: availableOpenAiModels,
    authenticated: Boolean(expectedToken),
    maxRequestBodyBytes,
  });
});

async function shutdown(signal) {
  log("bridge.shutdown", { signal });
  if (quotaRefreshTimer) clearInterval(quotaRefreshTimer);
  server.close();
  await Promise.allSettled([...exchanges].map((exchange) => exchange.disconnect()));
  await client.stop();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void shutdown(signal));
}
