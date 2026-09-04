import test from "node:test";
import assert from "node:assert/strict";
import { requestOwner, ownsExchange, ExchangeOwnership, rememberResponse } from "./exchange-ownership.mjs";

const thread = "12345678-1234-4234-8234-123456789abc";
function parked(owner) {
  return { owner, done: false, sink: null, pendingCalls: new Map([["call", {}]]),
    disconnected: 0, async disconnect() { this.disconnected++; } };
}
test("uses the Codex thread identity, never a shared prompt cache key", () => {
  const owner = requestOwner({ client_metadata: { thread_id: thread } });
  assert.equal(owner, requestOwner({}, { "thread-id": thread }));
  assert.equal(owner, requestOwner({}, { "thread-id": thread,
    "x-codex-turn-metadata": JSON.stringify({thread_id:thread,request_kind:"turn"}) }));
  assert.equal(requestOwner({ prompt_cache_key: thread }), null);
  assert.notEqual(owner, requestOwner({ client_metadata: { thread_id: thread.replace("abc", "def") } }));
  assert.ok(!owner.includes(thread));
});
test("auxiliary requests cannot supersede the main sampling session", () => {
  const base = { thread_id: thread };
  assert.notEqual(requestOwner({ client_metadata: base }), requestOwner({ client_metadata: {
    ...base, "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
  } }));
});
test("conflicting body and header thread identities are rejected", () => {
  assert.throws(() => requestOwner({ client_metadata: { thread_id: thread } },
    { "thread-id": thread.replace("abc", "def") }), /identity/i);
});
test("a child cannot resume its parent's pending call copied in forked history", () => {
  assert.equal(ownsExchange(parked("parent"), "child"), false);
  assert.equal(ownsExchange(parked("parent"), "parent"), true);
  assert.equal(ownsExchange({ ...parked("parent"), done: true }, "parent"), false);
  assert.equal(ownsExchange(parked(null), null), true);
});
test("fresh compacted history retires only the same task's abandoned tool wait", async () => {
  const old = parked("task-a"), other = parked("task-b");
  const ownership = new ExchangeOwnership(new Set([old, other]));
  assert.equal(await ownership.retireSuperseded("task-a"), 1);
  assert.equal(old.done, true);
  assert.equal(old.disconnected, 1);
  assert.equal(other.done, false);
  assert.equal(other.disconnected, 0);
});
test("active streams and anonymous sessions are never evicted for capacity", async () => {
  const active = { ...parked("task-a"), sink: { closed: false } };
  const anonymous = parked(null);
  const ownership = new ExchangeOwnership(new Set([active, anonymous]));
  await assert.rejects(ownership.retireSuperseded("task-a"), /active request/i);
  assert.equal(await ownership.retireSuperseded(null), 0);
  assert.equal(active.disconnected + anonymous.disconnected, 0);
});
test("serializes same-task admission while independent agents still overlap", async () => {
  const ownership = new ExchangeOwnership(new Set());
  const order = []; let release;
  const first = ownership.run("a", async () => { order.push("a1"); await new Promise(r => {release = r;}); });
  const second = ownership.run("a", async () => { order.push("a2"); });
  await ownership.run("b", async () => { order.push("b"); });
  assert.deepEqual(order, ["a1", "b"]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(order, ["a1", "b", "a2"]);
  assert.equal(ownership.locks.size, 0);
});
test("more than 1000 compactions do not retain obsolete SDK sessions", async () => {
  const exchanges = new Set(), ownership = new ExchangeOwnership(exchanges);
  const other = parked("slow-render"); exchanges.add(other);
  for (let i=0; i<1001; i++) {
    await ownership.retireSuperseded("active-task");
    const e = parked("active-task");
    e.disconnect = async () => { exchanges.delete(e); };
    exchanges.add(e);
    assert.equal(exchanges.size, 2);
  }
  assert.equal(other.disconnected, 0);
});
test("long tool chains retain only the latest response lookup per exchange", () => {
  const map = new Map(), a={}, b={};
  rememberResponse(map, b, "other");
  for (let i=0; i<10000; i++) rememberResponse(map, a, `response-${i}`);
  assert.equal(map.size, 2);
  assert.equal(map.get("other"), b);
  assert.equal(map.get("response-9999"), a);
});
