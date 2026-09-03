// Owns one SDK worker generation. Model/tool execution is never replayed here;
// only session creation (before sending a prompt) may be retried once.
export function isClosedConnectionError(error) {
  return /Connection is closed|Connection got disposed|Client not connected|\bEPIPE\b|\bECONNRESET\b|ERR_STREAM_DESTROYED|write after (?:end|a stream was destroyed)/i
    .test(String(error?.message ?? error));
}

export async function bounded(operation, timeoutMs, label = "Copilot SDK operation") {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(message, code = "copilot_unavailable") {
  return Object.assign(new Error(message), { statusCode: 503, code });
}

export class CopilotRuntime {
  constructor({
    createClient,
    onLost = () => {},
    log = () => {},
    maxSessions = 64,
    recycleAfterSessions = 128,
    recycleAfterMs = 6 * 60 * 60 * 1000,
    probeIntervalMs = 10_000,
    operationTimeoutMs = 2_500,
    startupTimeoutMs = 30_000,
    retryDelayMs = 5_000,
    now = Date.now,
  }) {
    Object.assign(this, { createClient, onLost, log, maxSessions, recycleAfterSessions,
      recycleAfterMs, probeIntervalMs, operationTimeoutMs, startupTimeoutMs, retryDelayMs, now });
    this.client = null;
    this.startingClient = null;
    this.generation = 0;
    this.sessions = new Set();
    this.creating = 0;
    this.created = 0;
    this.recoveries = 0;
    this.recycles = 0;
    this.state = "new";
    this.lastError = null;
    this.lastCheckedAt = null;
    this.lastHealthyAt = null;
    this.retryAfter = 0;
    this.startedAt = 0;
    this.flight = null;
    this.probe = null;
    this.timer = null;
    this.stopped = false;
  }

  snapshot() {
    return {
      ok: this.state === "ready" && Boolean(this.client),
      state: this.state,
      generation: this.generation,
      recoveries: this.recoveries,
      recycles: this.recycles,
      activeSessions: this.sessions.size,
      creatingSessions: this.creating,
      maxSessions: this.maxSessions,
      sessionsCreatedThisWorker: this.created,
      recycleAfterSessions: this.recycleAfterSessions,
      recycleAfterMs: this.recycleAfterMs,
      lastCheckedAt: this.lastCheckedAt,
      lastHealthyAt: this.lastHealthyAt,
      lastError: this.lastError,
      retryAfter: this.retryAfter ? new Date(this.retryAfter).toISOString() : null,
    };
  }

  isCurrent(generation) {
    return !this.stopped && Boolean(this.client) && generation === this.generation;
  }

  shouldRecycle() {
    return this.client && this.sessions.size === 0 && this.creating === 0
      && (this.created >= this.recycleAfterSessions || this.now() - this.startedAt >= this.recycleAfterMs);
  }

  async start() {
    await this.ready();
    if (this.probeIntervalMs > 0 && !this.timer) {
      this.timer = setInterval(() => void this.checkHealth().catch(() => {}), this.probeIntervalMs);
      this.timer.unref?.();
    }
  }

  async ready() {
    if (this.stopped) throw unavailable("Copilot runtime is stopped.");
    if (this.flight) await this.flight;
    if (this.shouldRecycle()) await this.replace({ recycle: true });
    if (!this.client) {
      if (this.now() < this.retryAfter) throw unavailable("Copilot SDK is recovering; retry shortly.");
      await this.replace();
    }
    if (this.stopped || !this.client) throw unavailable("Copilot SDK is unavailable; recovery will retry automatically.");
    return this.client;
  }

  replace({ lost = null, recycle = false } = {}) {
    if (this.flight) return this.flight;
    if (this.stopped) return Promise.resolve();
    const old = this.client, generation = this.generation;
    this.client = null;
    this.state = recycle ? "recycling" : generation ? "recovering" : "starting";
    if (lost) {
      this.recoveries++;
      this.lastError = "Copilot SDK connection closed; replacing the dead worker.";
      this.sessions.clear();
      try { this.onLost(generation, unavailable(this.lastError, "copilot_connection_lost")); }
      catch (error) { this.log("sdk.cleanup_error", { message: String(error?.message ?? error) }); }
    }
    if (recycle) this.recycles++;
    this.log("sdk.replacing", { generation, reason: lost ? "connection_lost" : recycle ? "idle_recycle" : "startup" });
    this.flight = (async () => {
      // Publish the single-flight promise even when the factory throws synchronously.
      await Promise.resolve();
      let next;
      try {
        // Do not call graceful stop on hundreds of dead sessions: SDK stop retries
        // each disconnect serially. forceStop owns only this SDK's subprocess.
        if (old) await bounded(() => old.forceStop(), this.operationTimeoutMs, "SDK worker cleanup");
        if (this.stopped) return;
        next = this.createClient();
        this.startingClient = next;
        await bounded(() => next.start(), this.startupTimeoutMs, "SDK worker startup");
        await bounded(() => next.ping("relay readiness"), this.operationTimeoutMs, "SDK ping");
        if (this.stopped) {
          await next.forceStop();
          return;
        }
        this.client = next;
        this.generation++;
        this.created = 0;
        this.startedAt = this.now();
        this.lastCheckedAt = this.lastHealthyAt = new Date(this.now()).toISOString();
        this.lastError = null;
        this.retryAfter = 0;
        this.state = "ready";
        this.log("sdk.ready", { generation: this.generation, recoveries: this.recoveries, recycles: this.recycles });
      } catch (error) {
        if (next) await bounded(() => next.forceStop(), this.operationTimeoutMs, "SDK startup cleanup").catch(() => {});
        if (!this.stopped) {
          this.state = "unavailable";
          this.lastError = String(error?.message ?? error).slice(0, 500);
          this.retryAfter = this.now() + this.retryDelayMs;
          this.log("sdk.recovery_failed", { message: this.lastError });
        }
      } finally {
        this.startingClient = null;
        this.flight = null;
      }
    })();
    return this.flight;
  }

  async reportFailure(error, generation = this.generation) {
    if (this.stopped || generation !== this.generation || !isClosedConnectionError(error)) return;
    const client = this.client;
    if (!client || this.flight) { await this.flight; return; }
    // A model-side socket error may contain the same wording as a dead local
    // transport. Confirm the SDK connection itself is closed before invalidating
    // other tasks. A healthy or merely slow ping is not crash evidence.
    try {
      await bounded(() => client.ping("relay failure verification"), this.operationTimeoutMs, "SDK ping");
    } catch (confirmation) {
      if (this.client === client && this.isCurrent(generation) && isClosedConnectionError(confirmation)) {
        await this.replace({ lost: confirmation });
      }
    }
  }

  async checkHealth() {
    if (this.stopped) return this.snapshot();
    if (this.flight) return this.snapshot();
    if (!this.client) {
      if (this.now() >= this.retryAfter) void this.replace();
      return this.snapshot();
    }
    if (this.shouldRecycle()) {
      void this.replace({ recycle: true });
      return this.snapshot();
    }
    if (this.probe) return this.probe;
    const client = this.client, generation = this.generation;
    this.probe = (async () => {
      try {
        await bounded(() => client.ping("relay health"), this.operationTimeoutMs, "SDK ping");
        if (this.isCurrent(generation)) {
          this.state = "ready";
          this.lastError = null;
          this.lastHealthyAt = new Date(this.now()).toISOString();
        }
      } catch (error) {
        if (this.isCurrent(generation)) {
          this.state = "degraded";
          this.lastError = String(error?.message ?? error).slice(0, 500);
          // A slow ping alone is not proof that healthy active sessions are lost.
          if (isClosedConnectionError(error)) void this.replace({ lost: error });
        }
      } finally {
        this.lastCheckedAt = new Date(this.now()).toISOString();
        this.probe = null;
      }
      return this.snapshot();
    })();
    return this.probe;
  }

  async createSession(config) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await this.ready(), generation = this.generation;
      if (this.sessions.size + this.creating >= this.maxSessions) {
        throw unavailable(`Relay session capacity (${this.maxSessions}) reached. Existing tool continuations are preserved; finish or cancel an idle task before retrying.`, "relay_session_capacity");
      }
      this.creating++;
      let session;
      let abandoned = false;
      try {
        const allocation = Promise.resolve().then(() => client.createSession(config)).then(value => {
          if (abandoned || !this.isCurrent(generation)) {
            void bounded(() => value.disconnect(), this.operationTimeoutMs, "Late SDK session cleanup")
              .catch(error => this.reportFailure(error, generation));
          }
          return value;
        });
        session = await bounded(() => allocation, this.startupTimeoutMs, "SDK session creation");
        if (!this.isCurrent(generation)) throw unavailable("Copilot worker changed before the prompt was sent.");
        this.sessions.add(session);
        this.created++;
        return { session, generation };
      } catch (error) {
        abandoned = true;
        if (attempt === 0 && isClosedConnectionError(error)) {
          await this.reportFailure(error, generation);
        } else {
          throw error;
        }
      } finally {
        this.creating--;
      }
    }
    throw unavailable("Copilot SDK could not create a session after recovery.");
  }

  release(session) {
    this.sessions.delete(session);
  }

  async stop() {
    this.stopped = true;
    this.state = "stopped";
    clearInterval(this.timer);
    this.timer = null;
    const clients = new Set([this.client, this.startingClient].filter(Boolean));
    this.client = null;
    this.sessions.clear();
    await Promise.allSettled([...clients].map(client => bounded(() => client.forceStop(), this.operationTimeoutMs, "SDK shutdown")));
    if (this.flight) await this.flight;
  }
}
