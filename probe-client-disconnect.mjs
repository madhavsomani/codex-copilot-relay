const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const rootUrl = args.get("--url") ?? "http://127.0.0.1:4144";
const model = args.get("--model") ?? "gpt-5.6-sol";

async function health() {
  const response = await fetch(`${rootUrl}/health`);
  if (!response.ok) throw new Error(`Health returned HTTP ${response.status}.`);
  return response.json();
}

const before = await health();
const controller = new AbortController();
const response = await fetch(`${rootUrl}/v1/responses`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  signal: controller.signal,
  body: JSON.stringify({
    model,
    stream: true,
    reasoning: { effort: "high" },
    input: [{
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: "Analyze the first 100 prime numbers in detail before answering with DISCONNECT_PROBE_DONE.",
      }],
    }],
  }),
});
if (!response.ok || !response.body) {
  throw new Error(`Streaming request returned HTTP ${response.status}.`);
}

const reader = response.body.getReader();
await reader.read();
controller.abort();
try {
  await reader.cancel();
} catch {
  // Aborting fetch is expected to reject or close the reader.
}

let after = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  after = await health();
  if (after.activeExchanges <= before.activeExchanges) break;
}

const dashboardResponse = await fetch(`${rootUrl}/dashboard/api`);
const dashboard = dashboardResponse.ok ? await dashboardResponse.json() : null;
const latestIndex = dashboard?.records?.[0] ?? null;
const latestResponse = latestIndex?.detailAvailable
  ? await fetch(`${rootUrl}/dashboard/api/records/${encodeURIComponent(latestIndex.id)}`)
  : null;
const latest = latestResponse?.ok ? (await latestResponse.json()).record : latestIndex;
const ok = after?.activeExchanges === before.activeExchanges
  && latest?.status === "failed"
  && /disconnected/i.test(latest?.error?.message ?? "");
console.log(JSON.stringify({
  ok,
  activeExchangesBefore: before.activeExchanges,
  activeExchangesAfter: after?.activeExchanges ?? null,
  latestDashboardStatus: latest?.status ?? null,
  latestDashboardError: latest?.error?.message ?? null,
}, null, 2));
if (!ok) process.exitCode = 1;
