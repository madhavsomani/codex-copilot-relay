import { createHash } from "node:crypto";

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  ? value.toLowerCase() : null;
const metadataObject = value => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value ?? "{}"); } catch { return {}; }
};

// Codex supplies thread-id/client_metadata.thread_id independently for each
// child agent. Never identify a task using a shared prompt-cache or workspace.
export function requestOwner(body, headers = {}) {
  const metadata = body?.client_metadata ?? {};
  const fromBody = uuid(metadata.thread_id), fromHeader = uuid(headers["thread-id"]);
  if (fromBody && fromHeader && fromBody !== fromHeader) {
    throw Object.assign(new Error("Conflicting Codex thread identity in request metadata."), {
      statusCode: 400, code: "invalid_request_error",
    });
  }
  const turn = metadataObject(metadata["x-codex-turn-metadata"] ?? headers["x-codex-turn-metadata"]);
  const thread = fromHeader ?? fromBody ?? uuid(turn?.thread_id);
  if (!thread) return null;
  const kind = typeof turn?.request_kind === "string" ? turn.request_kind.slice(0, 80) : "turn";
  return createHash("sha256").update(`${thread}:${kind}`).digest("hex");
}

export function ownsExchange(exchange, owner) {
  return Boolean(exchange) && !exchange.done && !exchange.disconnecting
    && (!owner || !exchange.owner || owner === exchange.owner);
}

export function rememberResponse(map, exchange, responseId) {
  for (const [id, candidate] of map) if (candidate === exchange) map.delete(id);
  map.set(responseId, exchange);
}

export class ExchangeOwnership {
  constructor(exchanges) { this.exchanges = exchanges; this.locks = new Map(); }

  async run(owner, work) {
    if (!owner) return work();
    const job = (this.locks.get(owner) ?? Promise.resolve()).catch(() => {}).then(work);
    this.locks.set(owner, job);
    try { return await job; }
    finally { if (this.locks.get(owner) === job) this.locks.delete(owner); }
  }

  async retireSuperseded(owner) {
    if (!owner) return 0;
    const old = [...this.exchanges].filter(e => e.owner === owner && !e.done && !e.disconnecting);
    if (old.some(e => e.sink && !e.sink.closed)) {
      throw Object.assign(new Error("This Codex task already has an active request; its stream was preserved."), {
        statusCode: 409, code: "relay_task_busy",
      });
    }
    // Called only for a fresh, authoritative request (not a matching tool
    // continuation). Compaction/steering may discard a tool call before Codex
    // ever executes it, so retaining that old SDK session would leak a slot.
    const parked = old.filter(e => !e.sink && e.pendingCalls.size > 0);
    for (const exchange of parked) exchange.done = true;
    await Promise.all(parked.map(e => e.disconnect()));
    return parked.length;
  }

  snapshot() {
    const active = [...this.exchanges].filter(e => !e.done && !e.disconnecting);
    return {
      streaming: active.filter(e => e.sink && !e.sink.closed).length,
      waitingForTools: active.filter(e => !e.sink && e.pendingCalls.size > 0).length,
      identifiedTasks: new Set(active.map(e => e.owner).filter(Boolean)).size,
      anonymousSessions: active.filter(e => !e.owner).length,
    };
  }
}
