export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Copilot Relay</title>
  <style>
    :root { color-scheme: dark; --bg: #080d19; --panel: #111a2d; --panel2: #17243d; --line: #263958; --text: #eef5ff; --muted: #91a5c4; --accent: #69b7ff; --cyan: #54e0d1; --good: #6ddd9a; --bad: #ff8398; --warn: #ffd27a; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 84% -10%, #173968 0, transparent 31rem), radial-gradient(circle at -8% 35%, #172548 0, transparent 27rem), var(--bg); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    header { padding: 25px 30px 17px; border-bottom: 1px solid var(--line); background: rgba(8,13,25,.84); position: sticky; top: 0; z-index: 4; backdrop-filter: blur(16px); }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 18px; max-width: 1540px; margin: 0 auto; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 25px; letter-spacing: -.035em; }
    h2 { font-size: 15px; letter-spacing: -.01em; }
    .subtitle, .byline, .muted { color: var(--muted); }
    .subtitle { margin-top: 4px; }
    .byline { display: flex; align-items: center; gap: 5px; margin-top: 7px; font-size: 12px; }
    .byline a { color: var(--accent); font-weight: 680; text-decoration: none; }
    .byline a:hover, .byline a:focus-visible { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
    button { border: 1px solid #3a5d8b; border-radius: 9px; color: var(--text); background: #172b4c; padding: 9px 13px; cursor: pointer; font: inherit; }
    button:hover { background: #21416e; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    main { max-width: 1540px; margin: 0 auto; padding: 20px 30px 44px; }
    .notice { display: flex; flex-wrap: wrap; gap: 8px 17px; align-items: center; padding: 11px 14px; border: 1px solid #2e4c75; border-radius: 11px; background: rgba(18,29,50,.74); margin-bottom: 15px; }
    .pill { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); box-shadow: 0 0 12px var(--good); }
    .stats { display: grid; grid-template-columns: repeat(8, minmax(115px, 1fr)); gap: 10px; margin-bottom: 15px; }
    .stat, .panel { border: 1px solid var(--line); border-radius: 13px; background: linear-gradient(145deg, rgba(23,36,61,.96), rgba(12,19,35,.96)); box-shadow: 0 13px 36px rgba(0,0,0,.16); }
    .stat { padding: 14px; min-height: 88px; }
    .stat-label { color: var(--muted); font-size: 11px; min-height: 30px; }
    .stat-value { font-size: 25px; font-weight: 730; margin-top: 4px; letter-spacing: -.04em; overflow-wrap: anywhere; }
    .stat-value.good { color: var(--good); } .stat-value.bad { color: var(--bad); } .stat-value.accent { color: var(--accent); } .stat-value.cyan { color: var(--cyan); }
    .charts { display: grid; grid-template-columns: 1.25fr 1.25fr .9fr .7fr; gap: 12px; margin-bottom: 16px; }
    .chart { min-height: 242px; overflow: hidden; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .chart-body { padding: 12px 14px 14px; min-height: 182px; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; color: var(--muted); font-size: 11px; }
    .key { display: inline-flex; align-items: center; gap: 5px; }
    .swatch { width: 9px; height: 9px; border-radius: 3px; background: var(--accent); } .swatch.cyan { background: var(--cyan); } .swatch.good { background: var(--good); } .swatch.bad { background: var(--bad); }
    svg { width: 100%; height: 168px; display: block; overflow: visible; }
    .gridline { stroke: #263958; stroke-width: 1; opacity: .75; }
    .axis-label { fill: var(--muted); font-size: 10px; }
    .chart-line { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .chart-area { opacity: .09; }
    .model-list { display: grid; gap: 12px; }
    .model-row { display: grid; gap: 5px; }
    .model-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 11px; }
    .model-meta strong { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { height: 8px; background: #0b1325; border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; min-width: 2px; background: linear-gradient(90deg, var(--accent), var(--cyan)); border-radius: inherit; }
    .storage-number { font-size: 29px; font-weight: 730; letter-spacing: -.04em; color: var(--cyan); }
    progress { width: 100%; height: 12px; margin: 14px 0 9px; accent-color: var(--cyan); }
    .storage-lines { display: grid; gap: 8px; color: var(--muted); font-size: 11px; }
    .storage-line { display: flex; justify-content: space-between; gap: 8px; }
    .baseline { margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
    .workspace { display: grid; grid-template-columns: minmax(610px, 1.25fr) minmax(380px, .75fr); gap: 16px; align-items: start; }
    .table-wrap { overflow: auto; max-height: 650px; }
    table { width: 100%; border-collapse: collapse; min-width: 735px; }
    th, td { padding: 10px 11px; border-bottom: 1px solid rgba(38,57,88,.72); text-align: left; vertical-align: top; white-space: nowrap; }
    th { position: sticky; top: 0; background: #17243d; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; z-index: 1; }
    tbody tr { cursor: pointer; } tbody tr:hover, tbody tr.selected { background: rgba(105,183,255,.09); }
    td.wrap { white-space: normal; min-width: 170px; max-width: 270px; }
    .status { font-size: 12px; } .status.completed { color: var(--good); } .status.failed { color: var(--bad); } .status.active { color: var(--warn); }
    .model { color: var(--accent); font-weight: 640; } .tiny { color: var(--muted); font-size: 11px; }
    .tier { display: inline-flex; align-items: center; border: 1px solid #345276; border-radius: 99px; padding: 1px 6px; color: var(--accent); font-size: 10px; }
    .tier.lightweight { color: var(--muted); border-color: var(--line); }
    .more { display: flex; justify-content: center; padding: 12px; border-top: 1px solid var(--line); }
    .detail { min-height: 650px; }
    .detail-body { padding: 15px; }
    .detail-section { margin-bottom: 16px; } .detail-section:last-child { margin-bottom: 0; }
    .detail-section h3 { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 7px; }
    pre { margin: 0; padding: 11px; max-height: 205px; overflow: auto; border: 1px solid var(--line); border-radius: 9px; background: #080e1c; color: #d8e6fb; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .empty { padding: 34px 18px; text-align: center; color: var(--muted); }
    .error { color: var(--bad); }
    @media (max-width: 1250px) { .stats { grid-template-columns: repeat(4, 1fr); } .charts { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 1050px) { .workspace { grid-template-columns: 1fr; } .detail { min-height: auto; } }
    @media (max-width: 650px) { header, main { padding-left: 14px; padding-right: 14px; } .topline { align-items: flex-start; flex-direction: column; } .stats, .charts { grid-template-columns: repeat(2, 1fr); } .chart { min-height: 220px; } }
    @media (max-width: 430px) { .stats, .charts { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <div>
        <h1>Codex Copilot Relay</h1>
        <p class="subtitle">Local Responses gateway telemetry · durable mileage without heavyweight logging</p>
        <p class="byline">Created by <a href="https://www.linkedin.com/in/madhavsomani" target="_blank" rel="noopener noreferrer" aria-label="Madhav Somani on LinkedIn">Madhav Somani</a><span aria-hidden="true">↗</span></p>
      </div>
      <button id="clear">Clear detailed history</button>
    </div>
  </header>
  <main>
    <div class="notice"><span class="pill"><span class="dot"></span> loopback only</span><span class="pill">provider: <strong>github-copilot-sdk</strong></span><span class="pill">compatibility: long context · Codex tools/memory preserved</span><span class="pill">context: bounded, salience-aware compaction</span><span class="pill">history: <strong id="limit">1,000</strong> entries · <strong id="detail-limit">200 detailed</strong></span><span class="pill">mileage: durable rollups</span><span class="pill" id="updated">waiting for bridge…</span></div>
    <section class="stats">
      <div class="stat"><div class="stat-label">Lifetime calls received</div><div class="stat-value accent" id="received">0</div></div>
      <div class="stat"><div class="stat-label">Lifetime Copilot replays</div><div class="stat-value cyan" id="replayed">0</div></div>
      <div class="stat"><div class="stat-label">Lifetime completed</div><div class="stat-value good" id="completed">0</div></div>
      <div class="stat"><div class="stat-label">Lifetime failed</div><div class="stat-value bad" id="failed">0</div></div>
      <div class="stat"><div class="stat-label">Active now</div><div class="stat-value" id="active">0</div></div>
      <div class="stat"><div class="stat-label">Lifetime tool calls</div><div class="stat-value" id="tools">0</div></div>
      <div class="stat"><div class="stat-label">Average latency</div><div class="stat-value" id="latency">—</div></div>
      <div class="stat"><div class="stat-label">Lifetime traffic</div><div class="stat-value" id="traffic">0 B</div></div>
    </section>
    <section class="charts">
      <article class="panel chart"><div class="panel-head"><h2>24-hour relay traffic</h2><div class="legend"><span class="key"><span class="swatch"></span>received</span><span class="key"><span class="swatch cyan"></span>Copilot replay</span></div></div><div class="chart-body"><svg id="hourly-chart" role="img" aria-label="Calls received and replayed to Copilot during the last 24 hours"></svg></div></article>
      <article class="panel chart"><div class="panel-head"><h2>30-day outcomes</h2><div class="legend"><span class="key"><span class="swatch good"></span>completed</span><span class="key"><span class="swatch bad"></span>failed</span></div></div><div class="chart-body"><svg id="daily-chart" role="img" aria-label="Completed and failed calls during the last 30 days"></svg></div></article>
      <article class="panel chart"><div class="panel-head"><h2>Model mileage</h2><span class="tiny">received + replayed</span></div><div class="chart-body"><div class="model-list" id="model-chart"><div class="empty">No model traffic yet.</div></div></div></article>
      <article class="panel chart"><div class="panel-head"><h2>Bounded storage</h2><span class="tiny">under 1 GB</span></div><div class="chart-body"><div class="storage-number" id="storage-total">0 B</div><progress id="storage-meter" value="0" max="1"></progress><div class="storage-lines"><div class="storage-line"><span>Detailed history</span><strong id="history-size">0 B</strong></div><div class="storage-line"><span>Metrics + event logs</span><strong id="metrics-size">0 B</strong></div><div class="storage-line"><span>Telemetry ceiling</span><strong id="telemetry-cap">408 MB</strong></div><div class="storage-line"><span>Retained tiers</span><strong id="retained">0</strong></div></div><p class="baseline" id="baseline">Mileage initializes from recoverable history, then remains exact as detail is pruned.</p></div></article>
    </section>
    <div class="workspace">
      <section class="panel"><div class="panel-head"><h2>Recent call history</h2><span class="tiny" id="count">0 records</span></div><div class="table-wrap"><table><thead><tr><th>Received</th><th>Route / model</th><th>Status</th><th>Tier</th><th>Replay</th><th>Tools</th><th>Latency</th><th>Bytes</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty">No Responses calls have crossed the bridge yet.</div></div><div class="more"><button id="show-more" hidden>Show 200 more</button></div></section>
      <aside class="panel detail"><div class="panel-head"><h2>Selected call</h2><span class="tiny" id="selected-id">none</span></div><div class="detail-body" id="detail"><div class="empty">Select a row. Detailed bodies load only when requested; older entries keep lightweight metadata.</div></div></aside>
    </div>
  </main>
  <script>
    const state = { records: [], selected: null, visible: 200, details: new Map() };
    const svgNs = "http://www.w3.org/2000/svg";
    const $ = (id) => document.getElementById(id);
    const fmt = (value) => value === null || value === undefined ? "—" : String(value);
    const number = (value) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);
    const json = (value) => value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
    const bytes = (value) => { if (!Number.isFinite(value)) return "—"; if (value < 1024) return value + " B"; if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB"; if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB"; return (value / 1024 / 1024 / 1024).toFixed(2) + " GB"; };
    const duration = (value) => Number.isFinite(value) ? (value < 1000 ? value + " ms" : value < 60000 ? (value / 1000).toFixed(1) + " s" : (value / 60000).toFixed(1) + " min") : "—";
    const time = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—"; };
    function setText(id, value) { $(id).textContent = fmt(value); }
    function svgElement(name, attributes) { const node = document.createElementNS(svgNs, name); for (const entry of Object.entries(attributes || {})) node.setAttribute(entry[0], String(entry[1])); return node; }
    function chartFrame(svg, rows, fields, colors, mode) {
      svg.replaceChildren();
      const width = 640, height = 168, left = 32, right = 8, top = 8, bottom = 24;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      const plotWidth = width - left - right, plotHeight = height - top - bottom;
      const maximum = Math.max(1, ...rows.flatMap((row) => fields.map((field) => Number(row[field]) || 0)));
      for (let index = 0; index <= 3; index += 1) {
        const y = top + (plotHeight * index / 3);
        svg.appendChild(svgElement("line", { x1: left, x2: width - right, y1: y, y2: y, class: "gridline" }));
        const label = svgElement("text", { x: left - 5, y: y + 3, "text-anchor": "end", class: "axis-label" });
        label.textContent = number(Math.round(maximum * (3 - index) / 3));
        svg.appendChild(label);
      }
      if (!rows.length) return;
      if (mode === "bars") {
        const groupWidth = plotWidth / rows.length;
        const barWidth = Math.max(1, groupWidth * .34);
        fields.forEach((field, fieldIndex) => rows.forEach((row, index) => {
          const value = Number(row[field]) || 0;
          const barHeight = plotHeight * value / maximum;
          const x = left + index * groupWidth + groupWidth * .12 + fieldIndex * barWidth;
          const rect = svgElement("rect", { x, y: top + plotHeight - barHeight, width: barWidth, height: barHeight, rx: 1.5, fill: colors[fieldIndex], opacity: .88 });
          const title = svgElement("title"); title.textContent = row.bucket + ": " + field + " " + number(value); rect.appendChild(title); svg.appendChild(rect);
        }));
      } else {
        fields.forEach((field, fieldIndex) => {
          const points = rows.map((row, index) => {
            const x = left + (rows.length === 1 ? plotWidth / 2 : plotWidth * index / (rows.length - 1));
            const y = top + plotHeight - plotHeight * (Number(row[field]) || 0) / maximum;
            return [x, y];
          });
          const linePath = points.map((point, index) => (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1)).join(" ");
          const areaPath = linePath + " L" + (left + plotWidth) + " " + (top + plotHeight) + " L" + left + " " + (top + plotHeight) + " Z";
          svg.appendChild(svgElement("path", { d: areaPath, fill: colors[fieldIndex], class: "chart-area" }));
          svg.appendChild(svgElement("path", { d: linePath, stroke: colors[fieldIndex], class: "chart-line" }));
        });
      }
      const axisText = (bucket) => mode === "lines" ? new Date(bucket).toLocaleTimeString(undefined, { hour: "numeric" }) : new Date(bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const first = svgElement("text", { x: left, y: height - 5, class: "axis-label" }); first.textContent = axisText(rows[0].bucket); svg.appendChild(first);
      const last = svgElement("text", { x: width - right, y: height - 5, "text-anchor": "end", class: "axis-label" }); last.textContent = axisText(rows.at(-1).bucket); svg.appendChild(last);
    }
    function renderModels(models) {
      const root = $("model-chart"); root.replaceChildren();
      const shown = (models || []).slice(0, 6);
      if (!shown.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No model traffic yet."; root.appendChild(empty); return; }
      const max = Math.max(1, ...shown.map((item) => (item.received || 0) + (item.replayed || 0)));
      for (const item of shown) {
        const total = (item.received || 0) + (item.replayed || 0);
        const row = document.createElement("div"); row.className = "model-row";
        const meta = document.createElement("div"); meta.className = "model-meta";
        const label = document.createElement("strong"); label.textContent = item.model;
        const count = document.createElement("span"); count.textContent = number(total);
        meta.append(label, count);
        const track = document.createElement("div"); track.className = "bar-track";
        const fill = document.createElement("div"); fill.className = "bar-fill"; fill.style.width = (100 * total / max).toFixed(1) + "%";
        track.appendChild(fill); row.append(meta, track); root.appendChild(row);
      }
    }
    function renderStats(data) {
      const summary = data.summary || {}, storage = data.storage || {};
      setText("received", number(summary.received)); setText("replayed", number(summary.replayed)); setText("completed", number(summary.completed)); setText("failed", number(summary.failed)); setText("active", number(summary.active)); setText("tools", number(summary.toolCalls)); setText("latency", duration(summary.avgLatencyMs)); setText("traffic", bytes((summary.inputBytes || 0) + (summary.outputBytes || 0)));
      setText("limit", number(data.maxRecords || 1000)); setText("detail-limit", number(data.maxDetailedRecords || 200) + " detailed"); setText("count", number(state.records.length) + " retained records");
      setText("storage-total", bytes(storage.totalBytes || 0)); setText("history-size", bytes(storage.historyBytes || 0)); setText("metrics-size", bytes((storage.metricsBytes || 0) + (storage.eventLogBytes || 0) + (storage.watchdogLogBytes || 0) + (storage.processStdoutBytes || 0) + (storage.processStderrBytes || 0))); setText("telemetry-cap", bytes(storage.telemetryCapBytes || 0)); setText("retained", number(summary.detailed || 0) + " detailed · " + number(summary.lightweight || 0) + " light");
      $("storage-meter").max = storage.telemetryCapBytes || 1; $("storage-meter").value = storage.totalBytes || 0;
      const baseline = data.metricsBaseline || {};
      $("baseline").textContent = baseline.source === "history-migration" ? "Mileage baseline: " + number(baseline.recoverableRecords || 0) + " recoverable calls. Exact and durable from " + time(baseline.seededAt) + "." : "Lifetime mileage is durable from " + time(data.metricsCreatedAt) + " and survives detailed-history pruning.";
      chartFrame($("hourly-chart"), data.analytics?.hourly || [], ["received", "replayed"], ["#69b7ff", "#54e0d1"], "lines");
      chartFrame($("daily-chart"), data.analytics?.daily || [], ["completed", "failed"], ["#6ddd9a", "#ff8398"], "bars");
      renderModels(data.analytics?.models || []);
      setText("updated", "updated " + new Date().toLocaleTimeString()); $("updated").className = "pill";
    }
    function renderRows() {
      const rows = $("rows"); rows.replaceChildren(); const records = state.records.slice(0, state.visible); $("empty").style.display = records.length ? "none" : "block";
      for (const record of records) {
        const row = document.createElement("tr"); if (record.id === state.selected) row.className = "selected"; row.onclick = () => selectRecord(record.id);
        const values = [time(record.receivedAt), (record.requestPath || "—") + "\n" + (record.selectedModel || record.requestedModel || "unknown"), record.status, record.detailTier, record.replayCount || 0, record.toolCalls || 0, duration(record.latencyMs), bytes((record.inputBytes || 0) + (record.outputBytes || 0))];
        values.forEach((value, index) => { const cell = document.createElement("td"); if (index === 1) { cell.className = "wrap model"; cell.style.whiteSpace = "pre-line"; } else if (index === 2) cell.className = "status " + record.status; if (index === 3) { const badge = document.createElement("span"); badge.className = "tier " + record.detailTier; badge.textContent = record.detailTier === "lightweight" ? "light" : "detail"; cell.appendChild(badge); } else cell.textContent = value; row.appendChild(cell); });
        rows.appendChild(row);
      }
      $("show-more").hidden = state.visible >= state.records.length;
    }
    function section(title, value, className) { const wrapper = document.createElement("section"); wrapper.className = "detail-section"; const heading = document.createElement("h3"); heading.textContent = title; const pre = document.createElement("pre"); if (className) pre.className = className; pre.textContent = json(value); wrapper.append(heading, pre); return wrapper; }
    function renderDetail(record, loading) {
      const detail = $("detail"); detail.replaceChildren(); setText("selected-id", record?.id || "none");
      if (!record) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Select a call to inspect it."; detail.appendChild(empty); return; }
      detail.appendChild(section("Call metadata", { id: record.id, tier: record.detailTier, status: record.status, receivedAt: record.receivedAt, completedAt: record.completedAt, route: record.requestPath, requestedModel: record.requestedModel, selectedModel: record.selectedModel, streaming: record.streaming, inputBytes: record.inputBytes, outputBytes: record.outputBytes, latencyMs: record.latencyMs, replayCount: record.replayCount, toolCalls: record.toolCalls, previousResponseId: record.previousResponseId, continuedFrom: record.continuedFrom }));
      if (loading) { const note = document.createElement("div"); note.className = "empty"; note.textContent = "Loading sanitized detail on demand…"; detail.appendChild(note); return; }
      if (record.detailTier === "lightweight" || !record.detailAvailable) { detail.appendChild(section("Lightweight retention", { note: "The full body aged out of the 200-call detailed tier. Mileage and metadata remain durable.", errorSummary: record.errorSummary || null })); return; }
      detail.appendChild(section("Codex input (sanitized)", record.input)); detail.appendChild(section("Copilot replay(s)", record.copilotReplays)); if (record.toolRequests?.length) detail.appendChild(section("Tool requests", record.toolRequests)); if (record.toolResolutions?.length) detail.appendChild(section("Tool resolutions", record.toolResolutions)); detail.appendChild(section("Codex output (sanitized)", record.output)); if (record.error) detail.appendChild(section("Error", record.error, "error"));
    }
    async function selectRecord(id) {
      state.selected = id; renderRows();
      const index = state.records.find((record) => record.id === id);
      if (!index) return renderDetail(null);
      if (!index.detailAvailable) return renderDetail(index);
      if (state.details.has(id)) return renderDetail(state.details.get(id));
      renderDetail(index, true);
      try {
        const response = await fetch("/dashboard/api/records/" + encodeURIComponent(id), { cache: "no-store" });
        if (!response.ok) throw new Error("detail returned " + response.status);
        const data = await response.json(); state.details.set(id, data.record);
        while (state.details.size > 20) state.details.delete(state.details.keys().next().value);
        if (state.selected === id) renderDetail(data.record);
      } catch (error) {
        if (state.selected === id) renderDetail({ ...index, detailTier: "lightweight", detailAvailable: false, errorSummary: error.message });
      }
    }
    async function refresh() {
      try {
        const response = await fetch("/dashboard/api", { cache: "no-store" });
        if (!response.ok) throw new Error("dashboard API returned " + response.status);
        const data = await response.json(); state.records = data.records || [];
        for (const index of state.records) {
          const cached = state.details.get(index.id);
          if (cached && (!index.detailAvailable || cached.status !== index.status || cached.replayCount !== index.replayCount || cached.toolCalls !== index.toolCalls)) state.details.delete(index.id);
        }
        if (!state.records.some((record) => record.id === state.selected)) state.selected = null;
        renderStats(data); renderRows();
        if (state.selected) { const cached = state.details.get(state.selected); renderDetail(cached || state.records.find((record) => record.id === state.selected)); }
      } catch (error) { $("updated").textContent = error.message; $("updated").className = "error"; }
    }
    $("show-more").onclick = () => { state.visible += 200; renderRows(); };
    $("clear").onclick = async () => { if (!confirm("Clear the 1,000-entry detailed history? Lifetime mileage is preserved.")) return; await fetch("/dashboard/clear", { method: "POST" }); state.selected = null; state.details.clear(); await refresh(); };
    refresh(); setInterval(refresh, 5000);
  </script>
</body>
</html>`;
