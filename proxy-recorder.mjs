import fs from "node:fs";
import path from "node:path";

const SENSITIVE_KEY = /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|cookie|credential|private[_-]?key|client[_-]?secret|session[_-]?id/i;
const SECRET_VALUE = /Bearer\s+[A-Za-z0-9._~+/=-]+|(?:sk|rk|pk)-[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}/gi;
const DEFAULT_LIMIT = 1_000;
const DEFAULT_DETAILED_LIMIT = 200;
const DEFAULT_PAYLOAD_LIMIT = 96 * 1024;
const DEFAULT_STRING_LIMIT = 32 * 1024;
const DEFAULT_MAX_RECORD_BYTES = 512 * 1024;
const DEFAULT_MAX_HISTORY_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_METRICS_BYTES = 16 * 1024 * 1024;
const DEFAULT_HOURLY_RETENTION = 24 * 31;
const DEFAULT_DAILY_RETENTION = 365 * 10;
const DISK_BUDGET_BYTES = 1024 * 1024 * 1024;

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
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubString(value, options.stringLimit);
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
  const preview = Buffer.from(serialized, "utf8").subarray(0, options.payloadLimit).toString("utf8");
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

function newId(now) {
  return `proxy_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function safeDate(value, fallback) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function hourKey(value, fallback) {
  return safeDate(value, fallback).toISOString().slice(0, 13) + ":00:00.000Z";
}

function dayKey(value, fallback) {
  return safeDate(value, fallback).toISOString().slice(0, 10);
}

function emptyCounters() {
  return {
    received: 0,
    replayed: 0,
    completed: 0,
    failed: 0,
    toolCalls: 0,
    inputBytes: 0,
    outputBytes: 0,
    latencyTotalMs: 0,
    latencySamples: 0,
  };
}

function createMetrics(now, baseline = {}) {
  const timestamp = now.toISOString();
  return {
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    baseline: {
      source: baseline.source ?? "fresh",
      seededAt: timestamp,
      recoverableRecords: finiteNumber(baseline.recoverableRecords),
    },
    lifetime: emptyCounters(),
    hourly: Object.create(null),
    daily: Object.create(null),
    models: Object.create(null),
  };
}

function normalizedCounterObject(value) {
  const output = emptyCounters();
  if (!value || typeof value !== "object") return output;
  for (const key of Object.keys(output)) output[key] = finiteNumber(value[key]);
  return output;
}

function normalizeBucketMap(value) {
  const output = Object.create(null);
  if (!value || typeof value !== "object") return output;
  for (const [key, counters] of Object.entries(value)) {
    if (typeof key === "string" && counters && typeof counters === "object") {
      output[key] = normalizedCounterObject(counters);
    }
  }
  return output;
}

function normalizeModelMap(value) {
  const output = Object.create(null);
  if (!value || typeof value !== "object") return output;
  for (const [key, counters] of Object.entries(value)) {
    if (typeof key !== "string" || !counters || typeof counters !== "object") continue;
    output[key] = {
      received: finiteNumber(counters.received),
      replayed: finiteNumber(counters.replayed),
      completed: finiteNumber(counters.completed),
      failed: finiteNumber(counters.failed),
    };
  }
  return output;
}

function normalizeMetrics(value, now) {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  const metrics = createMetrics(now, value.baseline);
  metrics.createdAt = typeof value.createdAt === "string" ? value.createdAt : metrics.createdAt;
  metrics.updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : metrics.updatedAt;
  metrics.baseline = {
    source: typeof value.baseline?.source === "string" ? value.baseline.source : "unknown",
    seededAt: typeof value.baseline?.seededAt === "string" ? value.baseline.seededAt : metrics.createdAt,
    recoverableRecords: finiteNumber(value.baseline?.recoverableRecords),
  };
  metrics.lifetime = normalizedCounterObject(value.lifetime);
  metrics.hourly = normalizeBucketMap(value.hourly);
  metrics.daily = normalizeBucketMap(value.daily);
  metrics.models = normalizeModelMap(value.models);
  return metrics;
}

function addCounters(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (Number.isFinite(value) && key in target) target[key] += value;
  }
}

function modelName(value) {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  return scrubString(value.replace(/[\u0000-\u001f\u007f]/g, ""), 120) || "unknown";
}

function incrementModel(metrics, model, changes) {
  const key = modelName(model);
  metrics.models[key] ??= { received: 0, replayed: 0, completed: 0, failed: 0 };
  for (const [field, value] of Object.entries(changes)) {
    if (Number.isFinite(value) && field in metrics.models[key]) metrics.models[key][field] += value;
  }
}

function incrementRollup(metrics, at, changes, fallback) {
  const hourlyKey = hourKey(at, fallback);
  const dailyKey = dayKey(at, fallback);
  metrics.hourly[hourlyKey] ??= emptyCounters();
  metrics.daily[dailyKey] ??= emptyCounters();
  addCounters(metrics.hourly[hourlyKey], changes);
  addCounters(metrics.daily[dailyKey], changes);
}

function lightweightRecord(record) {
  const errorMessage = typeof record?.error?.message === "string"
    ? scrubString(record.error.message, 512)
    : null;
  return {
    id: record.id,
    receivedAt: record.receivedAt ?? null,
    completedAt: record.completedAt ?? null,
    requestPath: record.requestPath ?? null,
    status: record.status ?? "unknown",
    requestedModel: record.requestedModel ?? null,
    selectedModel: record.selectedModel ?? null,
    streaming: Boolean(record.streaming),
    inputBytes: finiteNumber(record.inputBytes),
    outputBytes: finiteNumber(record.outputBytes),
    latencyMs: Number.isFinite(record.latencyMs) ? record.latencyMs : null,
    replayCount: finiteNumber(record.replayCount),
    replayedTo: record.replayedTo ?? "github-copilot-sdk",
    toolCalls: finiteNumber(record.toolCalls),
    previousResponseId: record.previousResponseId ?? null,
    continuedFrom: record.continuedFrom ?? null,
    errorSummary: errorMessage,
    detailTier: "lightweight",
    detailAvailable: false,
  };
}

function recordIndex(record) {
  const index = lightweightRecord(record);
  index.detailTier = record.detailTier === "lightweight" ? "lightweight" : "detailed";
  index.detailAvailable = index.detailTier === "detailed";
  return index;
}

function previewValue(value, maxBytes) {
  if (value === null || value === undefined) return value ?? null;
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxBytes) return value;
  const preview = Buffer.from(serialized, "utf8").subarray(0, maxBytes).toString("utf8");
  return { _truncated: true, preview: `${preview}…`, omittedBytes: bytes - maxBytes };
}

function boundedDetailedRecord(record, maxBytes) {
  const withTier = { ...record, detailTier: "detailed", detailAvailable: true };
  if (Buffer.byteLength(JSON.stringify(withTier), "utf8") <= maxBytes) return withTier;
  const sectionBytes = Math.max(256, Math.floor(maxBytes / 8));
  const bounded = {
    ...withTier,
    input: previewValue(record.input, sectionBytes),
    copilotReplays: (record.copilotReplays ?? []).slice(-8).map((item) => previewValue(item, sectionBytes / 2)),
    toolRequests: (record.toolRequests ?? []).slice(-24).map((item) => previewValue(item, sectionBytes / 4)),
    toolResolutions: (record.toolResolutions ?? []).slice(-24).map((item) => previewValue(item, sectionBytes / 4)),
    output: previewValue(record.output, sectionBytes),
    error: previewValue(record.error, sectionBytes / 2),
    detailTruncated: true,
  };
  if (Buffer.byteLength(JSON.stringify(bounded), "utf8") <= maxBytes) return bounded;
  return { ...lightweightRecord(record), detailTruncated: true };
}

function replaceFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporaryPath, content, "utf8");
  try {
    fs.renameSync(temporaryPath, targetPath);
  } catch {
    fs.copyFileSync(temporaryPath, targetPath);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export class ProxyRecorder {
  constructor({
    filePath,
    metricsFilePath = path.join(path.dirname(path.resolve(filePath)), "proxy-metrics.json"),
    limit = DEFAULT_LIMIT,
    detailedLimit = DEFAULT_DETAILED_LIMIT,
    payloadLimit = DEFAULT_PAYLOAD_LIMIT,
    stringLimit = DEFAULT_STRING_LIMIT,
    maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
    maxHistoryBytes = DEFAULT_MAX_HISTORY_BYTES,
    maxMetricsBytes = DEFAULT_MAX_METRICS_BYTES,
    hourlyRetention = DEFAULT_HOURLY_RETENTION,
    dailyRetention = DEFAULT_DAILY_RETENTION,
    compactAfterLines,
    now = () => new Date(),
  }) {
    this.filePath = path.resolve(filePath);
    this.metricsFilePath = path.resolve(metricsFilePath);
    this.limit = Math.max(1, Math.floor(limit));
    this.detailedLimit = Math.min(this.limit, Math.max(0, Math.floor(detailedLimit)));
    this.maxRecordBytes = Math.max(1024, Math.floor(maxRecordBytes));
    this.maxHistoryBytes = Math.max(4096, Math.floor(maxHistoryBytes));
    this.maxMetricsBytes = Math.max(4096, Math.floor(maxMetricsBytes));
    this.hourlyRetention = Math.max(24, Math.floor(hourlyRetention));
    this.dailyRetention = Math.max(30, Math.floor(dailyRetention));
    this.compactAfterLines = Math.max(
      this.limit + 1,
      Math.floor(compactAfterLines ?? (this.limit + Math.max(1, this.detailedLimit))),
    );
    this.clock = now;
    this.options = { payloadLimit, stringLimit, maxDepth: 12, maxArrayItems: 500 };
    this.records = [];
    this.persistedLineCount = 0;
    this.startedAt = this.now().toISOString();
    this.metrics = null;
    this.load();
  }

  now() {
    return safeDate(this.clock(), new Date());
  }

  load() {
    const parsedRecords = [];
    if (fs.existsSync(this.filePath)) {
      try {
        const lines = fs.readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
        this.persistedLineCount = lines.length;
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record && typeof record.id === "string") parsedRecords.push(record);
          } catch {
            // Ignore a partial final line after an interrupted local write.
          }
        }
      } catch {
        // A damaged telemetry file must never block the relay from starting.
      }
    }
    const uniqueRecords = [...new Map(parsedRecords.map((record) => [record.id, record])).values()];
    this.records = uniqueRecords.slice(-this.limit);
    this.rebalanceDetails();
    try {
      this.metrics = normalizeMetrics(JSON.parse(fs.readFileSync(this.metricsFilePath, "utf8")), this.now());
    } catch {
      this.metrics = null;
    }
    if (!this.metrics) {
      this.metrics = createMetrics(this.now(), {
        source: uniqueRecords.length ? "history-migration" : "fresh",
        recoverableRecords: uniqueRecords.length,
      });
      this.seedMetrics(uniqueRecords);
      this.persistMetrics();
    }
    if (this.persistedLineCount > this.compactAfterLines || fileSize(this.filePath) > this.maxHistoryBytes) {
      try {
        this.compact();
      } catch {
        // The in-memory recorder and lifetime metrics are still usable.
      }
    }
  }

  seedMetrics(records) {
    const fallback = this.now();
    for (const record of records) {
      const receivedChanges = { received: 1, inputBytes: finiteNumber(record.inputBytes) };
      addCounters(this.metrics.lifetime, receivedChanges);
      incrementRollup(this.metrics, record.receivedAt, receivedChanges, fallback);
      incrementModel(this.metrics, record.requestedModel, { received: 1 });
      const replayCount = finiteNumber(record.replayCount);
      if (replayCount) {
        const replayChanges = { replayed: replayCount };
        addCounters(this.metrics.lifetime, replayChanges);
        incrementRollup(this.metrics, record.completedAt ?? record.receivedAt, replayChanges, fallback);
        incrementModel(this.metrics, record.selectedModel ?? record.requestedModel, { replayed: replayCount });
      }
      const toolCalls = finiteNumber(record.toolCalls);
      if (toolCalls) {
        const toolChanges = { toolCalls };
        addCounters(this.metrics.lifetime, toolChanges);
        incrementRollup(this.metrics, record.completedAt ?? record.receivedAt, toolChanges, fallback);
      }
      if (record.status === "completed" || record.status === "failed") {
        const statusChanges = {
          [record.status]: 1,
          outputBytes: finiteNumber(record.outputBytes),
          latencyTotalMs: finiteNumber(record.latencyMs),
          latencySamples: Number.isFinite(record.latencyMs) ? 1 : 0,
        };
        addCounters(this.metrics.lifetime, statusChanges);
        incrementRollup(this.metrics, record.completedAt ?? record.receivedAt, statusChanges, fallback);
        incrementModel(this.metrics, record.selectedModel ?? record.requestedModel, { [record.status]: 1 });
      }
    }
  }

  updateMetrics(at, changes, model, modelChanges = {}) {
    const fallback = this.now();
    addCounters(this.metrics.lifetime, changes);
    incrementRollup(this.metrics, at, changes, fallback);
    incrementModel(this.metrics, model, modelChanges);
    this.metrics.updatedAt = fallback.toISOString();
    this.persistMetrics();
  }

  pruneMetrics() {
    const hourlyKeys = Object.keys(this.metrics.hourly).sort();
    for (const key of hourlyKeys.slice(0, -this.hourlyRetention)) delete this.metrics.hourly[key];
    const dailyKeys = Object.keys(this.metrics.daily).sort();
    for (const key of dailyKeys.slice(0, -this.dailyRetention)) delete this.metrics.daily[key];
    const modelEntries = Object.entries(this.metrics.models);
    if (modelEntries.length > 100) {
      modelEntries.sort((left, right) => (
        (right[1].received + right[1].replayed) - (left[1].received + left[1].replayed)
      ));
      this.metrics.models = Object.assign(Object.create(null), modelEntries.slice(0, 100));
    }
  }

  persistMetrics() {
    try {
      this.pruneMetrics();
      let serialized = `${JSON.stringify(this.metrics)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > this.maxMetricsBytes) {
        const dailyKeys = Object.keys(this.metrics.daily).sort();
        for (const key of dailyKeys.slice(0, -365)) delete this.metrics.daily[key];
        serialized = `${JSON.stringify(this.metrics)}\n`;
      }
      if (Buffer.byteLength(serialized, "utf8") <= this.maxMetricsBytes) {
        replaceFile(this.metricsFilePath, serialized);
      }
    } catch {
      // Metrics are useful observability, never a reason to fail inference.
    }
  }

  start({ requestPath, body, inputBytes, streaming }) {
    const now = this.now();
    const record = {
      id: newId(now),
      receivedAt: now.toISOString(),
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
      previousResponseId: typeof body?.previous_response_id === "string" ? body.previous_response_id : null,
      continuedFrom: null,
      detailTier: "detailed",
      detailAvailable: true,
    };
    this.records.push(record);
    this.trim();
    this.updateMetrics(record.receivedAt, { received: 1, inputBytes: record.inputBytes }, record.requestedModel, {
      received: 1,
    });
    return record;
  }

  setSelectedModel(record, model) {
    if (record) record.selectedModel = model;
  }

  replay(record, details) {
    if (!record) return;
    const at = this.now().toISOString();
    record.replayCount += 1;
    record.copilotReplays.push(payloadWithinLimit({ at, ...details }, this.options));
    this.updateMetrics(at, { replayed: 1 }, details?.model ?? record.selectedModel ?? record.requestedModel, {
      replayed: 1,
    });
  }

  toolRequested(record, details) {
    if (!record) return;
    record.toolCalls += 1;
    record.toolRequests.push(payloadWithinLimit(details, this.options));
    this.updateMetrics(this.now().toISOString(), { toolCalls: 1 }, record.selectedModel ?? record.requestedModel);
  }

  toolResolved(record, details) {
    if (record) record.toolResolutions.push(payloadWithinLimit(details, this.options));
  }

  finish(record, { status, selectedModel, output, outputBytes = 0, error = null }) {
    if (!record || record.completedAt) return;
    if (selectedModel) record.selectedModel = selectedModel;
    record.status = status;
    record.completedAt = this.now().toISOString();
    record.latencyMs = Math.max(0, Date.parse(record.completedAt) - Date.parse(record.receivedAt));
    record.outputBytes = Number.isFinite(outputBytes) ? outputBytes : 0;
    record.output = output === null || output === undefined ? null : payloadWithinLimit(output, this.options);
    record.error = error === null || error === undefined ? null : safeError(error, this.options);
    if (!this.records.some((item) => item.id === record.id)) {
      this.records.push(record);
      this.trim();
    }
    const finalStatus = status === "failed" ? "failed" : "completed";
    this.updateMetrics(record.completedAt, {
      [finalStatus]: 1,
      outputBytes: record.outputBytes,
      latencyTotalMs: record.latencyMs,
      latencySamples: 1,
    }, record.selectedModel ?? record.requestedModel, { [finalStatus]: 1 });
    this.persist(record);
    this.rebalanceDetails();
  }

  persist(record) {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const storedRecord = boundedDetailedRecord(record, this.maxRecordBytes);
      fs.appendFileSync(this.filePath, `${JSON.stringify(storedRecord)}\n`, "utf8");
      this.persistedLineCount += 1;
      if (this.persistedLineCount >= this.compactAfterLines || fileSize(this.filePath) > this.maxHistoryBytes) {
        this.compact();
      }
    } catch {
      // Observability must never take down the proxy. The in-memory dashboard remains available.
    }
  }

  compact() {
    const completedRecords = this.records.filter((item) => item.completedAt).slice(-this.limit);
    const detailedStart = Math.max(0, completedRecords.length - this.detailedLimit);
    const storedRecords = completedRecords.map((record, index) => (
      index >= detailedStart && record.detailTier !== "lightweight"
        ? boundedDetailedRecord(record, this.maxRecordBytes)
        : lightweightRecord(record)
    ));
    let lines = storedRecords.map((record) => JSON.stringify(record));
    let totalBytes = lines.reduce((total, line) => total + Buffer.byteLength(line, "utf8") + 1, 0);
    for (let index = 0; totalBytes > this.maxHistoryBytes && index < storedRecords.length; index += 1) {
      if (storedRecords[index].detailTier !== "detailed") continue;
      const oldBytes = Buffer.byteLength(lines[index], "utf8");
      storedRecords[index] = lightweightRecord(storedRecords[index]);
      lines[index] = JSON.stringify(storedRecords[index]);
      totalBytes += Buffer.byteLength(lines[index], "utf8") - oldBytes;
    }
    while (totalBytes > this.maxHistoryBytes && lines.length) {
      totalBytes -= Buffer.byteLength(lines[0], "utf8") + 1;
      lines.shift();
      storedRecords.shift();
    }
    replaceFile(this.filePath, lines.length ? `${lines.join("\n")}\n` : "");
    this.persistedLineCount = lines.length;
    const storedById = new Map(storedRecords.map((record) => [record.id, record]));
    this.records = this.records
      .filter((record) => !record.completedAt || storedById.has(record.id))
      .map((record) => record.completedAt ? storedById.get(record.id) : record);
    this.trim();
  }

  trim() {
    while (this.records.length > this.limit) {
      const completedIndex = this.records.findIndex((record) => record.completedAt);
      this.records.splice(completedIndex >= 0 ? completedIndex : 0, 1);
    }
    this.rebalanceDetails();
  }

  rebalanceDetails() {
    const completedIndexes = this.records
      .map((record, index) => record.completedAt ? index : -1)
      .filter((index) => index >= 0);
    const keepDetailed = new Set(completedIndexes.slice(-this.detailedLimit));
    this.records = this.records.map((record, index) => {
      if (!record.completedAt || keepDetailed.has(index)) {
        if (record.detailTier === "lightweight") return record;
        record.detailTier = "detailed";
        record.detailAvailable = true;
        return record;
      }
      return lightweightRecord(record);
    });
  }

  summary() {
    const active = this.records.filter((record) => record.status === "active").length;
    const detailed = this.records.filter((record) => record.detailTier !== "lightweight").length;
    const lifetime = this.metrics.lifetime;
    return {
      received: lifetime.received,
      replayed: lifetime.replayed,
      completed: lifetime.completed,
      failed: lifetime.failed,
      active,
      toolCalls: lifetime.toolCalls,
      inputBytes: lifetime.inputBytes,
      outputBytes: lifetime.outputBytes,
      avgLatencyMs: lifetime.latencySamples
        ? Math.round(lifetime.latencyTotalMs / lifetime.latencySamples)
        : null,
      retained: this.records.length,
      detailed,
      lightweight: this.records.length - detailed,
    };
  }

  series(unit, count) {
    const now = this.now();
    const source = unit === "hour" ? this.metrics.hourly : this.metrics.daily;
    const rows = [];
    const cursor = new Date(now);
    if (unit === "hour") cursor.setUTCMinutes(0, 0, 0);
    else cursor.setUTCHours(0, 0, 0, 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const date = new Date(cursor);
      if (unit === "hour") date.setUTCHours(cursor.getUTCHours() - index);
      else date.setUTCDate(cursor.getUTCDate() - index);
      const key = unit === "hour" ? hourKey(date, now) : dayKey(date, now);
      const counters = source[key] ?? emptyCounters();
      rows.push({
        bucket: key,
        received: counters.received,
        replayed: counters.replayed,
        completed: counters.completed,
        failed: counters.failed,
        toolCalls: counters.toolCalls,
      });
    }
    return rows;
  }

  analytics() {
    const models = Object.entries(this.metrics.models)
      .map(([model, counters]) => ({ model, ...counters }))
      .sort((left, right) => ((right.received + right.replayed) - (left.received + left.replayed)));
    return { hourly: this.series("hour", 24), daily: this.series("day", 30), models };
  }

  storage() {
    const historyBytes = fileSize(this.filePath);
    const metricsBytes = fileSize(this.metricsFilePath);
    return {
      historyBytes,
      metricsBytes,
      totalBytes: historyBytes + metricsBytes,
      maxHistoryBytes: this.maxHistoryBytes,
      maxMetricsBytes: this.maxMetricsBytes,
      telemetryCapBytes: this.maxHistoryBytes + this.maxMetricsBytes,
      diskBudgetBytes: DISK_BUDGET_BYTES,
      utilizationPercent: this.maxHistoryBytes
        ? Math.min(100, Math.round((historyBytes / this.maxHistoryBytes) * 10_000) / 100)
        : 0,
    };
  }

  snapshot({ includeDetails = true } = {}) {
    return {
      ok: true,
      localOnly: true,
      sanitized: true,
      historyFile: this.filePath,
      metricsFile: this.metricsFilePath,
      maxRecords: this.limit,
      maxDetailedRecords: this.detailedLimit,
      startedAt: this.startedAt,
      metricsCreatedAt: this.metrics.createdAt,
      metricsBaseline: this.metrics.baseline,
      summary: this.summary(),
      analytics: this.analytics(),
      storage: this.storage(),
      records: [...this.records].reverse().map((record) => includeDetails ? record : recordIndex(record)),
    };
  }

  detail(id) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  clear() {
    this.records = [];
    this.persistedLineCount = 0;
    try {
      replaceFile(this.filePath, "");
    } catch {
      // The dashboard still clears its in-memory view if the local file cannot be truncated.
    }
    return this.snapshot({ includeDetails: false });
  }
}

export const recorderDefaults = {
  limit: DEFAULT_LIMIT,
  detailedLimit: DEFAULT_DETAILED_LIMIT,
  payloadLimit: DEFAULT_PAYLOAD_LIMIT,
  maxRecordBytes: DEFAULT_MAX_RECORD_BYTES,
  maxHistoryBytes: DEFAULT_MAX_HISTORY_BYTES,
  maxMetricsBytes: DEFAULT_MAX_METRICS_BYTES,
};
