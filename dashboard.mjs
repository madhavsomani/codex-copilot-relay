export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Copilot Relay</title>
  <style>
    :root { color-scheme: dark; --bg: #0b1020; --panel: #121a2d; --panel2: #17223a; --line: #263653; --text: #edf4ff; --muted: #8ea1bf; --accent: #77b7ff; --good: #68d391; --bad: #ff8d9f; --warn: #ffd27d; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top right, #1a315b 0, transparent 32rem), var(--bg); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    header { padding: 28px 32px 18px; border-bottom: 1px solid var(--line); background: rgba(11,16,32,.8); position: sticky; top: 0; z-index: 3; backdrop-filter: blur(14px); }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 1500px; margin: 0 auto; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 24px; letter-spacing: -.03em; }
    h2 { font-size: 15px; }
    .subtitle, .byline, .muted { color: var(--muted); }
    .subtitle { margin-top: 5px; }
    .byline { display: flex; align-items: center; gap: 5px; margin-top: 7px; font-size: 12px; }
    .byline a { color: var(--accent); font-weight: 650; text-decoration: none; }
    .byline a:hover, .byline a:focus-visible { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
    button { border: 1px solid #3d5a85; border-radius: 8px; color: var(--text); background: #1a2a48; padding: 9px 13px; cursor: pointer; }
    button:hover { background: #243d65; }
    main { max-width: 1500px; margin: 0 auto; padding: 22px 32px 42px; }
    .notice { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; padding: 12px 14px; border: 1px solid #2f4b70; border-radius: 10px; background: rgba(23,34,58,.7); margin-bottom: 18px; }
    .pill { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); box-shadow: 0 0 12px var(--good); }
    .stats { display: grid; grid-template-columns: repeat(6, minmax(125px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .stat, .panel { border: 1px solid var(--line); border-radius: 12px; background: linear-gradient(145deg, rgba(23,34,58,.94), rgba(14,21,39,.94)); box-shadow: 0 12px 35px rgba(0,0,0,.16); }
    .stat { padding: 15px; min-height: 92px; }
    .stat-label { color: var(--muted); font-size: 12px; }
    .stat-value { font-size: 27px; font-weight: 700; margin-top: 7px; letter-spacing: -.04em; }
    .stat-value.good { color: var(--good); } .stat-value.bad { color: var(--bad); } .stat-value.accent { color: var(--accent); }
    .workspace { display: grid; grid-template-columns: minmax(560px, 1.2fr) minmax(380px, .8fr); gap: 18px; align-items: start; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 17px; border-bottom: 1px solid var(--line); }
    .table-wrap { overflow: auto; max-height: 610px; }
    table { width: 100%; border-collapse: collapse; min-width: 690px; }
    th, td { padding: 11px 12px; border-bottom: 1px solid rgba(38,54,83,.72); text-align: left; vertical-align: top; white-space: nowrap; }
    th { position: sticky; top: 0; background: #17223a; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; z-index: 1; }
    tbody tr { cursor: pointer; } tbody tr:hover, tbody tr.selected { background: rgba(119,183,255,.09); }
    td.wrap { white-space: normal; min-width: 160px; max-width: 260px; }
    .status { font-size: 12px; } .status.completed { color: var(--good); } .status.failed { color: var(--bad); } .status.active { color: var(--warn); }
    .model { color: var(--accent); font-weight: 600; } .tiny { color: var(--muted); font-size: 11px; }
    .detail { min-height: 610px; }
    .detail-body { padding: 16px; }
    .detail-section { margin-bottom: 17px; } .detail-section:last-child { margin-bottom: 0; }
    .detail-section h3 { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 7px; }
    pre { margin: 0; padding: 12px; max-height: 190px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: #0a1020; color: #d6e4fb; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { padding: 36px 18px; text-align: center; color: var(--muted); }
    .error { color: var(--bad); }
    @media (max-width: 1050px) { .stats { grid-template-columns: repeat(3, 1fr); } .workspace { grid-template-columns: 1fr; } .detail { min-height: auto; } }
    @media (max-width: 650px) { header, main { padding-left: 16px; padding-right: 16px; } .topline { align-items: flex-start; flex-direction: column; } .stats { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <div>
        <h1>Codex Copilot Relay</h1>
        <p class="subtitle">Transparent localhost Responses gateway with Copilot-backed inference</p>
        <p class="byline">Created by <a href="https://www.linkedin.com/in/madhavsomani" target="_blank" rel="noopener noreferrer" aria-label="Madhav Somani on LinkedIn">Madhav Somani</a><span aria-hidden="true">↗</span></p>
      </div>
      <button id="clear">Clear local history</button>
    </div>
  </header>
  <main>
    <div class="notice"><span class="pill"><span class="dot"></span> loopback only</span><span class="pill">provider: <strong id="provider">github-copilot-sdk</strong></span><span class="pill">Responses: full lifecycle · 13h tool wait</span><span class="pill">compatibility: long context · Codex tools/memory preserved</span><span class="pill">context: bounded, salience-aware compaction</span><span class="pill">history: sanitized and capped at <strong id="limit">200</strong> calls</span><span class="pill" id="updated">waiting for bridge…</span></div>
    <section class="stats">
      <div class="stat"><div class="stat-label">Calls received</div><div class="stat-value accent" id="received">0</div></div>
      <div class="stat"><div class="stat-label">Replayed to Copilot</div><div class="stat-value accent" id="replayed">0</div></div>
      <div class="stat"><div class="stat-label">Completed</div><div class="stat-value good" id="completed">0</div></div>
      <div class="stat"><div class="stat-label">Failed</div><div class="stat-value bad" id="failed">0</div></div>
      <div class="stat"><div class="stat-label">Active now</div><div class="stat-value" id="active">0</div></div>
      <div class="stat"><div class="stat-label">Avg latency</div><div class="stat-value" id="latency">—</div></div>
    </section>
    <div class="workspace">
      <section class="panel"><div class="panel-head"><h2>Intercepted call timeline</h2><span class="tiny" id="count">0 records</span></div><div class="table-wrap"><table><thead><tr><th>Received</th><th>Route / model</th><th>Status</th><th>Replay</th><th>Tools</th><th>Latency</th><th>Bytes</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty">No Responses calls have crossed the bridge yet.</div></div></section>
      <aside class="panel detail"><div class="panel-head"><h2>Selected call</h2><span class="tiny" id="selected-id">none</span></div><div class="detail-body" id="detail"><div class="empty">Select a timeline row to inspect the sanitized Codex input, Copilot replay, and output response.</div></div></aside>
    </div>
  </main>
  <script>
    const state = { records: [], selected: null };
    const $ = (id) => document.getElementById(id);
    const fmt = (value) => value === null || value === undefined ? "—" : String(value);
    const json = (value) => value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
    const bytes = (value) => { if (!Number.isFinite(value)) return "—"; if (value < 1024) return value + " B"; if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB"; return (value / 1024 / 1024).toFixed(1) + " MB"; };
    const duration = (value) => Number.isFinite(value) ? (value < 1000 ? value + " ms" : (value / 1000).toFixed(1) + " s") : "—";
    const time = (value) => { try { return new Date(value).toLocaleTimeString(); } catch { return "—"; } };
    function setText(id, value) { $(id).textContent = fmt(value); }
    function renderStats(data) {
      const summary = data.summary || {};
      setText("received", summary.received || 0); setText("replayed", summary.replayed || 0); setText("completed", summary.completed || 0); setText("failed", summary.failed || 0); setText("active", summary.active || 0); setText("latency", summary.avgLatencyMs === null ? "—" : duration(summary.avgLatencyMs));
      setText("limit", data.maxRecords || 200); setText("count", (data.records || []).length + " records"); setText("updated", "updated " + new Date().toLocaleTimeString());
    }
    function renderRows() {
      const rows = $("rows"); rows.replaceChildren(); const records = state.records; $("empty").style.display = records.length ? "none" : "block";
      for (const record of records) {
        const row = document.createElement("tr"); if (record.id === state.selected) row.className = "selected"; row.onclick = () => { state.selected = record.id; renderRows(); renderDetail(); };
        const cells = [time(record.receivedAt), (record.requestPath || "—") + "\n" + (record.selectedModel || record.requestedModel || "unknown"), record.status, record.replayCount || 0, record.toolCalls || 0, duration(record.latencyMs), bytes((record.inputBytes || 0) + (record.outputBytes || 0))];
        cells.forEach((value, index) => { const cell = document.createElement("td"); cell.textContent = value; if (index === 1) { cell.className = "wrap"; cell.style.whiteSpace = "pre-line"; } if (index === 2) cell.className = "status " + record.status; if (index === 0) cell.className = "tiny"; row.appendChild(cell); }); rows.appendChild(row);
      }
    }
    function section(title, value, className) { const wrapper = document.createElement("section"); wrapper.className = "detail-section"; const heading = document.createElement("h3"); heading.textContent = title; wrapper.appendChild(heading); const block = document.createElement("pre"); if (className) block.className = className; block.textContent = json(value); wrapper.appendChild(block); return wrapper; }
    function renderDetail() {
      const record = state.records.find((item) => item.id === state.selected) || state.records[0]; const detail = $("detail"); detail.replaceChildren();
      if (!record) { $("selected-id").textContent = "none"; const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Select a timeline row to inspect the sanitized Codex input, Copilot replay, and output response."; detail.appendChild(empty); return; }
      state.selected = record.id; $("selected-id").textContent = record.id; detail.appendChild(section("Call metadata", { id: record.id, status: record.status, receivedAt: record.receivedAt, completedAt: record.completedAt, route: record.requestPath, requestedModel: record.requestedModel, selectedModel: record.selectedModel, streaming: record.streaming, inputBytes: record.inputBytes, outputBytes: record.outputBytes, latencyMs: record.latencyMs, replayCount: record.replayCount, toolCalls: record.toolCalls, previousResponseId: record.previousResponseId, continuedFrom: record.continuedFrom })); detail.appendChild(section("Codex input (sanitized)", record.input)); detail.appendChild(section("Copilot replay(s)", record.copilotReplays)); if (record.toolRequests && record.toolRequests.length) detail.appendChild(section("Tool requests", record.toolRequests)); if (record.toolResolutions && record.toolResolutions.length) detail.appendChild(section("Tool resolutions", record.toolResolutions)); detail.appendChild(section("Codex output (sanitized)", record.output)); if (record.error) detail.appendChild(section("Error", record.error, "error"));
    }
    async function refresh() { try { const response = await fetch("/dashboard/api", { cache: "no-store" }); if (!response.ok) throw new Error("dashboard API returned " + response.status); const data = await response.json(); state.records = data.records || []; if (!state.records.some((record) => record.id === state.selected)) state.selected = state.records[0]?.id || null; renderStats(data); renderRows(); renderDetail(); } catch (error) { $("updated").textContent = error.message; $("updated").className = "error"; } }
    $("clear").onclick = async () => { if (!confirm("Clear the local proxy history file and dashboard records?")) return; await fetch("/dashboard/clear", { method: "POST" }); state.selected = null; await refresh(); };
    refresh(); setInterval(refresh, 1500);
  </script>
</body>
</html>`;
