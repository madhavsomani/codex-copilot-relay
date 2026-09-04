import test from "node:test";
import assert from "node:assert/strict";
import { CopilotRuntime, isClosedConnectionError } from "./copilot-runtime.mjs";

function fixture(options = {}) {
  const clients = [], lost = [];
  const runtime = new CopilotRuntime({
    createClient() {
      const client = {
        dead: false, stopped: 0, created: 0,
        async start() {},
        async ping() { if (this.dead) throw new Error("Connection is closed."); },
        async createSession() {
          if (this.dead) throw new Error("Connection is closed.");
          return { id: ++this.created, async disconnect() {} };
        },
        async stop() { this.stopped++; },
        async forceStop() { this.stopped++; },
      };
      clients.push(client);
      return client;
    },
    onLost: (generation, error) => lost.push({ generation, message: error.message }),
    probeIntervalMs: 0,
    retryDelayMs: 0,
    ...options,
  });
  return { runtime, clients, lost };
}

test("health checks the SDK rather than merely the outer HTTP listener", async () => {
  const { runtime, clients, lost } = fixture();
  await runtime.start();
  const lease = await runtime.createSession({});
  clients[0].dead = true;
  const failed = await runtime.checkHealth();
  assert.equal(failed.ok, false);
  await runtime.ready();
  assert.equal(runtime.snapshot().ok, true);
  assert.equal(runtime.snapshot().generation, 2);
  assert.equal(runtime.snapshot().activeSessions, 0);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].generation, lease.generation);
  assert.equal(clients[0].stopped, 1);
  await runtime.stop();
});

test("concurrent closed-connection creates share one replacement and retry only before a prompt", async () => {
  const { runtime, clients, lost } = fixture();
  await runtime.start();
  clients[0].dead = true;
  const leases = await Promise.all(Array.from({ length: 12 }, () => runtime.createSession({})));
  assert.equal(clients.length, 2);
  assert.equal(lost.length, 1);
  assert.ok(leases.every(lease => lease.generation === 2));
  assert.equal(runtime.snapshot().activeSessions, 12);
  await runtime.stop();
});

test("late failures from an old generation cannot tear down its replacement", async () => {
  const { runtime, clients } = fixture();
  await runtime.start();
  clients[0].dead = true;
  await runtime.reportFailure(new Error("Connection is closed."), 1);
  await runtime.ready();
  await runtime.reportFailure(new Error("Connection is closed."), 1);
  assert.equal(clients.length, 2);
  assert.equal(clients[1].stopped, 0);
  await runtime.stop();
});

test("model and quota errors do not trigger destructive SDK recovery", async () => {
  const { runtime, clients } = fixture();
  await runtime.start();
  await runtime.reportFailure(new Error("400 prompt is too large"), 1);
  assert.equal(isClosedConnectionError(new Error("rate limit exceeded")), false);
  assert.equal(clients.length, 1);
  assert.equal(runtime.snapshot().ok, true);
  await runtime.stop();
});

test("provider socket errors cannot invalidate a still-responsive SDK worker", async () => {
  const { runtime, clients, lost } = fixture();
  await runtime.start();
  await runtime.createSession({});
  await runtime.reportFailure(new Error("upstream model transport: ECONNRESET"), 1);
  assert.equal(clients.length, 1);
  assert.equal(lost.length, 0);
  assert.equal(runtime.snapshot().activeSessions, 1);
  await runtime.stop();
});

test("a slow ping marks health degraded without killing healthy resumable work", async () => {
  const { runtime, clients } = fixture({ operationTimeoutMs: 15 });
  await runtime.start();
  await runtime.createSession({});
  clients[0].ping = () => new Promise(() => {});
  const health = await runtime.checkHealth();
  assert.equal(health.ok, false);
  assert.match(health.lastError, /timed out/i);
  assert.equal(clients[0].stopped, 0);
  clients[0].ping = async () => {};
  assert.equal((await runtime.checkHealth()).ok, true);
  await runtime.stop();
});

test("session admission is bounded including concurrent allocations", async () => {
  const { runtime } = fixture({ maxSessions: 2 });
  await runtime.start();
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => runtime.createSession({})));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
  const rejected = results.find(r => r.status === "rejected");
  assert.equal(rejected.reason.statusCode, 503);
  assert.equal(rejected.reason.code, "relay_session_capacity");
  runtime.release(results.find(r => r.status === "fulfilled").value.session);
  await runtime.createSession({});
  assert.equal(runtime.snapshot().activeSessions, 2);
  await runtime.stop();
});

test("idle recycling bounds worker lifetime but never rotates retained sessions", async () => {
  const { runtime, clients, lost } = fixture({ recycleAfterSessions: 2 });
  await runtime.start();
  const a = await runtime.createSession({}), b = await runtime.createSession({});
  runtime.release(a.session);
  await runtime.checkHealth();
  assert.equal(clients.length, 1);
  runtime.release(b.session);
  await runtime.checkHealth();
  await runtime.ready();
  assert.equal(clients.length, 2);
  assert.equal(lost.length, 0);
  assert.equal(runtime.snapshot().recycles, 1);
  await runtime.stop();
});

test("a 12-hour tool wait survives the worker-age threshold; recycle waits for release", async () => {
  let clock=0;
  const { runtime, clients } = fixture({ now: () => clock });
  await runtime.start();
  const lease=await runtime.createSession({});
  for(let hour=1;hour<=12;hour++) {
    clock=hour*60*60*1000;
    assert.equal((await runtime.checkHealth()).ok,true);
    assert.equal(clients.length,1);
    assert.equal(runtime.snapshot().activeSessions,1);
  }
  runtime.release(lease.session);
  await runtime.ready();
  assert.equal(clients.length,2);
  await runtime.stop();
});

test("shutdown cannot be undone by an in-progress recovery", async () => {
  let releaseStart;
  const { runtime, clients } = fixture();
  await runtime.start();
  clients[0].dead = true;
  const factory = runtime.createClient;
  runtime.createClient = () => {
    const client = factory();
    client.start = () => new Promise(resolve => { releaseStart = resolve; });
    return client;
  };
  const recovery = runtime.reportFailure(new Error("Connection is closed."), 1);
  while (!releaseStart) await new Promise(resolve => setImmediate(resolve));
  const stopping = runtime.stop();
  releaseStart();
  await recovery;
  await stopping;
  assert.equal(runtime.snapshot().state, "stopped");
  assert.equal(runtime.snapshot().ok, false);
  assert.ok(clients[1].stopped >= 1);
});

test("a synchronous factory failure does not wedge the recovery single-flight", async () => {
  const { runtime } = fixture();
  const factory = runtime.createClient;
  runtime.createClient = () => { throw new Error("temporary startup failure"); };
  await assert.rejects(runtime.start(), /unavailable/);
  runtime.createClient = factory;
  await runtime.start();
  assert.equal(runtime.snapshot().ok, true);
  await runtime.stop();
});

test("timed-out session allocations are cleaned up if they finish late", async () => {
  const { runtime, clients } = fixture({ startupTimeoutMs: 15 });
  await runtime.start();
  let finish, disconnected = 0;
  clients[0].createSession = () => new Promise(resolve => { finish = resolve; });
  await assert.rejects(runtime.createSession({}), /timed out/);
  finish({ async disconnect() { disconnected++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disconnected, 1);
  assert.equal(runtime.snapshot().activeSessions, 0);
  assert.equal(runtime.snapshot().creatingSessions, 0);
  await runtime.stop();
});
