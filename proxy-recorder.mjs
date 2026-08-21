import fs from "node:fs";
import path from "node:path";

const SENSITIVE_KEY = /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|cookie|credential|private[_-]?key|client[_-]?secret|session[_-]?id/i;
const SECRET_VALUE = /Bearer\s+[A-Za-z0-9._~+/=-]+|(?:sk|rk|pk)-[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}/gi;
const DEFAULT_LIMIT = 200;
const DEFAULT_PAYLOAD_LIMIT = 96 * 1024;
const DEFAULT_STRING_LIMIT = 32 * 1024;

function clipString(value, maxChars) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
}

function scrubString(value, maxChars) {
  const dataUrl = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (dataUrl) {
    const mimeType = dataUrl[1].replace(/[^A-Za-z0-9.+/-]/g, "");
    return `[data URL omitted: ${mimeType}; ${dataUrl[2].length} base64 chars]`;
  }
  return clipString(value.replace(SECRET_VALUE, (match) => {
    if (/^Bearer\s/i.test(match)) return "Bearer [REDACTED]";
    return "[REDACTED]";
  }), maxChars);
}

function sanitizeValue(value, options, depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return scrubString(value, options.stringLimit);
  }
  if (depth >= options.maxDepth) return "[depth limit]";
  if (Array.isArray(value)) {
    return value.slice(0, options.maxArrayItems).map((item) => sanitizeValue(item, options, depth + 1));
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : sanitizeValue(item, options, depth + 1);
    }
    return result;
  }
  return String(value);
}

function payloadWithinLimit(value, options) {
  const sanitized = sanitizeValue(value, options);
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, "utf8") <= options.payloadLimit) return sanitized;

  const preview = Buffer.from(serialized, "utf8")
    .subarray(0, options.payloadLimit)
    .toString("utf8");
  return {
    _truncated: true,
    preview: `${preview}…`,
    omittedBytes: Math.max(0, Buffer.byteLength(serialized, "utf8") - options.payloadLimit),
  };
}

function safeError(error, options) {
  return payloadWithinLimit({
    name: error?.name ?? "Error",
    message: error instanceof Error ? error.message : String(error),
  }, options);
}

function newId() {
  return `proxy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ProxyRecorder {
  constructor({
    filePath,
    limit = DEFAULT_LIMIT,
    payloadLimit = DEFAULT_PAYLOAD_LIMIT,
    stringLimit = DEFAULT_STRING_LIMIT,
  }) {
    this.filePath = path.resolve(filePath);
    this.limit = limit;
    this.options = {
      payloadLimit,
      stringLimit,
      maxDepth: 12,
      maxArrayItems: 500,
    };
    this.records = [];
    this.persistedLineCount = 0;
    this.startedAt = new Date().toISOString();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    let lines;
    try {
      lines = fs.readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
    } catch {
      return;
    }
    this.persistedLineCount = lines.length;
    for (const line of lines.slice(-this.limit)) {
      try {
        const record = JSON.parse(line);
        if (record && typeof record.id === "string") this.records.push(record);
      } catch {
        // Ignore a partial final line after an interrupted local write.
      }
    }
  }

  start({ requestPath, body, inputBytes, streaming }) {
    const record = {
      id: newId(),
      receivedAt: new Date().toISOString(),
      completedAt: null,
      requestPath,
      status: "active",
      requestedModel: typeof body?.model === "string" ? body.model : null,
      selectedModel: null,
      streaming: Boolean(streaming),
      inputBytes: Number.isFinite(inputBytes) ? inputBytes : 0,
      outputBytes: 0,
      latencyMs: null,
      replayCount: 0,
      replayedTo: "github-copilot-sdk",
      input: payloadWithinLimit(body, this.options),
      copilotReplays: [],
      toolCalls: 0,
      toolRequests: [],
      toolResolutions: [],
      output: null,
      error: null,
      previousResponseId: typeof body?.previous_response_id === "string"
        ? body.previous_response_id
        : null,
      continuedFrom: null,
    };
    this.records.push(record);
    this.trim();
    return record;
  }

  setSelectedModel(record, model) {
    if (record) record.selectedModel = model;
  }

  replay(record, details) {
    if (!record) return;
    record.replayCount += 1;
    record.copilotReplays.push(payloadWithinLimit({
      at: new Date().toISOString(),
      ...details,
    }, this.options));
  }

  toolRequested(record, details) {
    if (!record) return;
    record.toolCalls += 1;
    record.toolRequests.push(payloadWithinLimit(details, this.options));
  }

  toolResolved(record, details) {
    if (!record) return;
    record.toolResolutions.push(payloadWithinLimit(details, this.options));
  }

  finish(record, { status, selectedModel, output, outputBytes = 0, error = null }) {
    if (!record || record.completedAt) return;
    if (selectedModel) record.selectedModel = selectedModel;
    record.status = status;
    record.completedAt = new Date().toISOString();
    record.latencyMs = Math.max(0, Date.parse(record.completedAt) - Date.parse(record.receivedAt));
    record.outputBytes = Number.isFinite(outputBytes) ? outputBytes : 0;
    record.output = output === null || output === undefined
      ? null
      : payloadWithinLimit(output, this.options);
    record.error = error === null || error === undefined
      ? null
      : safeError(error, this.options);
    this.persist(record);
  }

  persist(record) {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
      this.persistedLineCount += 1;

      // Rewriting the whole history after every response blocked the Node event
      // loop for increasingly long periods and made concurrent agents appear
      // serialized. Append in the hot path and compact only occasionally.
      if (this.persistedLineCount >= this.limit * 2) this.compact();
    } catch {
      // Observability must never take down the proxy. The in-memory dashboard remains available.
    }
  }

  compact() {
    const completedRecords = this.records
      .filter((item) => item.completedAt)
      .slice(-this.limit)
      .map((item) => JSON.stringify(item));
    fs.writeFileSync(
      this.filePath,
      completedRecords.length ? `${completedRecords.join("\n")}\n` : "",
      "utf8",
    );
    this.persistedLineCount = completedRecords.length;
  }

  trim() {
    if (this.records.length > this.limit) this.records.splice(0, this.records.length - this.limit);
  }

  summary() {
    const completed = this.records.filter((record) => record.status === "completed").length;
    const failed = this.records.filter((record) => record.status === "failed").length;
    const active = this.records.filter((record) => record.status === "active").length;
    const replayed = this.records.reduce((total, record) => total + (record.replayCount || 0), 0);
    const toolCalls = this.records.reduce((total, record) => total + (record.toolCalls || 0), 0);
    const latencies = this.records
      .map((record) => record.latencyMs)
      .filter((value) => Number.isFinite(value));
    const avgLatencyMs = latencies.length
      ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
      : null;
    return {
      received: this.records.length,
      replayed,
      completed,
      failed,
      active,
      toolCalls,
      avgLatencyMs,
    };
  }

  snapshot() {
    return {
      ok: true,
      localOnly: true,
      sanitized: true,
      historyFile: this.filePath,
      maxRecords: this.limit,
      startedAt: this.startedAt,
      summary: this.summary(),
      records: [...this.records].reverse(),
    };
  }

  clear() {
    this.records = [];
    this.persistedLineCount = 0;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, "", "utf8");
    } catch {
      // The dashboard still clears its in-memory view if the local file cannot be truncated.
    }
    return this.snapshot();
  }
}

export const recorderDefaults = {
  limit: DEFAULT_LIMIT,
  payloadLimit: DEFAULT_PAYLOAD_LIMIT,
};
