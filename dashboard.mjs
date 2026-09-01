export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Copilot Relay</title>
  <style>
    :root { color-scheme: dark; --bg: #060a13; --panel: #111a2d; --panel2: #17243d; --line: #263958; --text: #eef5ff; --muted: #91a5c4; --accent: #69b7ff; --cyan: #54e0d1; --violet: #a98cff; --good: #6ddd9a; --bad: #ff8398; --warn: #ffd27a; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 82% -12%, rgba(38,91,164,.54) 0, transparent 34rem), radial-gradient(circle at -8% 30%, rgba(67,46,140,.32) 0, transparent 29rem), linear-gradient(180deg, #080d19 0, var(--bg) 55%); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
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
    .section-nav { display: flex; align-items: center; gap: 5px; padding: 4px; border: 1px solid var(--line); border-radius: 11px; background: rgba(6,11,21,.72); }
    .section-nav a { color: var(--muted); text-decoration: none; border-radius: 8px; padding: 6px 9px; font-size: 10px; }
    .section-nav a:hover, .section-nav a:focus-visible { color: var(--text); background: rgba(105,183,255,.12); outline: none; }
    main { max-width: 1540px; margin: 0 auto; padding: 20px 30px 44px; }
    .notice { display: flex; flex-wrap: wrap; gap: 8px 17px; align-items: center; padding: 11px 14px; border: 1px solid #2e4c75; border-radius: 11px; background: rgba(18,29,50,.74); margin-bottom: 15px; }
    .pill { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); box-shadow: 0 0 12px var(--good); }
    .panel { border: 1px solid var(--line); border-radius: 15px; background: linear-gradient(145deg, rgba(23,36,61,.94), rgba(10,16,30,.97)); box-shadow: 0 15px 44px rgba(0,0,0,.2), inset 0 1px rgba(255,255,255,.025); }
    .kpis { display: grid; grid-template-columns: repeat(6, minmax(170px, 1fr)); gap: 10px; margin-bottom: 15px; }
    .kpi { --card-color: var(--accent); min-width: 0; min-height: 120px; padding: 13px 14px 11px; border: 1px solid var(--line); border-radius: 14px; background: radial-gradient(circle at 95% 4%, color-mix(in srgb, var(--card-color) 17%, transparent), transparent 7rem), linear-gradient(145deg, rgba(21,34,58,.96), rgba(8,14,27,.98)); box-shadow: 0 13px 34px rgba(0,0,0,.2), inset 0 1px rgba(255,255,255,.03); overflow: hidden; }
    .kpi.good { --card-color: var(--good); } .kpi.violet { --card-color: var(--violet); } .kpi.cyan { --card-color: var(--cyan); } .kpi.warn { --card-color: var(--warn); }
    .kpi-top { display: flex; align-items: center; gap: 9px; color: var(--muted); font-size: 11px; }
    .kpi-icon { width: 31px; height: 31px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--card-color) 52%, var(--line)); border-radius: 10px; color: var(--card-color); background: color-mix(in srgb, var(--card-color) 11%, transparent); font-weight: 750; }
    .kpi-main { display: grid; grid-template-columns: minmax(0,1fr) 72px; align-items: end; gap: 8px; margin-top: 8px; }
    .kpi-value { min-width: 0; font-size: 25px; font-weight: 760; line-height: 1; letter-spacing: -.045em; overflow-wrap: anywhere; }
    .kpi-foot { color: var(--muted); font-size: 9px; margin-top: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kpi-foot strong { color: var(--card-color); font-weight: 680; }
    svg.kpi-sparkline { width: 72px; height: 35px; overflow: visible; }
    .spark-area { opacity: .14; }
    .spark-line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 4px currentColor); }
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
    .workspace > *, .command-grid > *, .insight-stack > * { min-width: 0; }
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
    .header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; flex-wrap: wrap; }
    .version-badge { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(84,224,209,.3); border-radius: 99px; padding: 7px 10px; color: var(--muted); background: rgba(84,224,209,.07); font-size: 10px; }
    .version-badge strong { color: var(--cyan); font: 700 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .live-badge { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); border-radius: 99px; padding: 8px 11px; color: var(--muted); background: rgba(10,18,33,.8); font-size: 11px; }
    .live-badge.connected { color: var(--good); border-color: rgba(109,221,154,.42); }
    .live-badge .dot { background: var(--warn); box-shadow: 0 0 12px var(--warn); }
    .live-badge.connected .dot { background: var(--good); box-shadow: 0 0 12px var(--good); }
    .command-grid { display: grid; grid-template-columns: minmax(250px,.66fr) minmax(620px,1.7fr) minmax(270px,.72fr); grid-template-areas: "insights architecture inspector"; gap: 12px; margin-bottom: 15px; align-items: start; }
    .command-grid > .architecture { grid-area: architecture; }
    .command-grid > .insight-stack { grid-area: insights; }
    .command-grid > .live-inspector { grid-area: inspector; }
    .architecture { overflow: hidden; position: relative; min-height: 0; }
    .architecture::before { content: ""; position: absolute; width: 260px; height: 260px; right: 8%; top: 17%; border-radius: 50%; background: rgba(84,224,209,.08); filter: blur(70px); pointer-events: none; }
    .architecture-body { padding: 17px; position: relative; }
    .network-viewport { overflow-x: auto; padding: 2px 0 12px; scrollbar-width: thin; }
    .network-stage { min-width: 720px; border: 1px solid rgba(48,73,109,.74); border-radius: 15px; background: radial-gradient(circle at 61% 39%, rgba(84,224,209,.08), transparent 15rem), linear-gradient(180deg, rgba(5,10,19,.94), rgba(8,15,28,.86)); overflow: hidden; }
    .traffic-map { width: 100%; min-width: 720px; height: 292px; display: block; overflow: hidden; }
    .route-line { fill: none; stroke-width: 2; stroke-linecap: round; opacity: .52; }
    .route-line.main { stroke: url(#main-route-gradient); filter: drop-shadow(0 0 4px rgba(84,224,209,.22)); }
    .route-line.tool { stroke: url(#tool-route-gradient); opacity: .32; }
    .network-node { color: var(--accent); }
    .network-node .node-shell { fill: #0b1425; stroke: #536984; stroke-width: 1.6; }
    .network-node .node-glyph { fill: none; stroke: #b8c6d9; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .network-node[data-node="model"] { color: var(--violet); }
    .network-node[data-node="tools"] { color: var(--warn); }
    .network-label { fill: var(--text); font-size: 13px; font-weight: 700; text-anchor: middle; }
    .network-meta { fill: var(--muted); font-size: 9px; text-anchor: middle; letter-spacing: .035em; }
    .traffic-legend { fill: var(--muted); font-size: 9px; }
    .traffic-counter { fill: rgba(10,20,36,.86); stroke: #344b6a; }
    .traffic-packet { color: var(--accent); pointer-events: none; filter: drop-shadow(0 0 7px currentColor); }
    .traffic-packet .packet-tail { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; opacity: .38; }
    .traffic-packet .packet-body { fill: #081323; stroke: currentColor; stroke-width: 1.25; }
    .traffic-packet .packet-label { fill: #f7fbff; font-size: 7px; font-weight: 800; letter-spacing: .07em; text-anchor: middle; dominant-baseline: middle; }
    .flow-legend { fill: var(--muted); font-size: 9px; }
    .flow-footer { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; border-top: 1px solid var(--line); padding-top: 14px; }
    .event-copy { min-width: 0; }
    .event-copy strong { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .event-copy span { color: var(--muted); font-size: 11px; }
    .phase { color: var(--cyan); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; border: 1px solid rgba(84,224,209,.3); background: rgba(84,224,209,.07); border-radius: 99px; padding: 5px 9px; }
    .active-strip { margin-top: 12px; display: flex; gap: 7px; overflow-x: auto; min-height: 29px; }
    .call-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 99px; padding: 5px 8px; color: var(--muted); background: #0b1325; font-size: 10px; }
    .call-chip strong { color: var(--text); }
    .call-color { width: 3px; height: 12px; border-radius: 2px; background: var(--call-color, var(--accent)); box-shadow: 0 0 7px var(--call-color, var(--accent)); }
    .insight-stack { display: grid; gap: 14px; }
    .insight { min-height: 0; }
    .insight-body { padding: 15px 16px; }
    .metric-hero { display: flex; justify-content: space-between; gap: 12px; align-items: end; }
    .metric-hero strong { font-size: 31px; letter-spacing: -.05em; }
    .metric-hero span { color: var(--muted); font-size: 10px; text-align: right; }
    .metric-hero.cost strong { color: var(--cyan); }
    .metric-hero.quota strong { color: var(--good); }
    .micro-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; margin: 13px 0; }
    .micro { min-width: 0; border: 1px solid var(--line); background: rgba(8,14,27,.63); border-radius: 10px; padding: 8px; }
    .micro span { display: block; color: var(--muted); font-size: 9px; }
    .micro strong { display: block; margin-top: 3px; font-size: 12px; overflow-wrap: anywhere; }
    .disclaimer { color: var(--muted); font-size: 10px; line-height: 1.5; }
    .disclaimer strong { color: var(--warn); }
    .disclaimer a { color: var(--accent); }
    .coverage-track { height: 6px; margin: 10px 0 6px; border-radius: 99px; overflow: hidden; background: #080e1c; }
    .coverage-fill { width: 0; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--cyan)); transition: width .35s ease; }
    .rate-strip { display: flex; gap: 6px; overflow-x: auto; margin-top: 10px; padding-bottom: 2px; }
    .rate-chip { flex: 0 0 auto; border: 1px solid var(--line); border-radius: 9px; padding: 6px 8px; background: #0a1221; font-size: 9px; color: var(--muted); }
    .rate-chip strong { display: block; color: var(--text); font-size: 10px; margin-bottom: 2px; }
    .quota-progress { width: 100%; height: 9px; margin: 11px 0 8px; accent-color: var(--good); }
    .quota-categories { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .quota-chip { border: 1px solid var(--line); border-radius: 99px; padding: 4px 7px; color: var(--muted); font-size: 9px; }
    .quota-chip.unlimited { color: var(--good); border-color: rgba(109,221,154,.35); }
    .button-small { padding: 5px 8px; font-size: 10px; }
    .token-cell { color: var(--cyan); }
    .live-inspector { min-height: 0; overflow: hidden; }
    .inspector-body { padding: 13px 14px 14px; display: grid; gap: 12px; }
    .inspector-grid { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 6px 10px; padding: 10px; border: 1px solid var(--line); border-radius: 11px; background: rgba(5,10,20,.55); font-size: 10px; }
    .inspector-grid dt { color: var(--muted); }
    .inspector-grid dd { margin: 0; color: var(--text); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .inspector-grid dd.live-good { color: var(--good); }
    .inspector-grid dd.live-bad { color: var(--bad); }
    .event-log-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; }
    .event-log { display: grid; gap: 0; max-height: 255px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: #070d18; }
    .event-row { display: grid; grid-template-columns: 49px 7px minmax(0,1fr); gap: 7px; align-items: center; padding: 7px 8px; border-bottom: 1px solid rgba(38,57,88,.52); font-size: 9px; }
    .event-row:last-child { border-bottom: 0; }
    .event-time { color: var(--muted); font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .event-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--event-color,var(--accent)); box-shadow: 0 0 7px var(--event-color,var(--accent)); }
    .event-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .event-empty { padding: 20px 10px; color: var(--muted); text-align: center; font-size: 10px; }
    @media (max-width: 1370px) { .command-grid { grid-template-columns: minmax(650px,1.5fr) minmax(300px,.7fr); grid-template-areas: "architecture inspector" "insights insights"; } .insight-stack { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 1250px) { .kpis { grid-template-columns: repeat(3, 1fr); } .charts { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 1150px) { .command-grid { grid-template-columns: 1fr; grid-template-areas: "architecture" "inspector" "insights"; } .live-inspector { min-height: auto; } }
    @media (max-width: 1050px) { .workspace { grid-template-columns: 1fr; } .detail { min-height: auto; } }
    @media (max-width: 650px) { header, main { padding-left: 14px; padding-right: 14px; } .topline { align-items: flex-start; flex-direction: column; } .header-actions { width: 100%; justify-content: space-between; flex-wrap: wrap; } .section-nav { order: 3; width: 100%; overflow-x: auto; } .kpis, .charts, .insight-stack { grid-template-columns: repeat(2, 1fr); } .chart { min-height: 220px; } .architecture-body { padding: 12px; } }
    @media (max-width: 430px) { .kpis, .charts { grid-template-columns: 1fr; } }
    @media (max-width: 430px) { .insight-stack { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; } }
  </style>
</head>
<body>
  <header>
    <div class="topline">
      <div>
        <h1>Codex Copilot Relay Observability</h1>
        <p class="subtitle">Usage, cost, architecture, and live request playback · local and dependency-free</p>
        <p class="byline">Created by <a href="https://www.linkedin.com/in/madhavsomani" target="_blank" rel="noopener noreferrer" aria-label="Madhav Somani on LinkedIn">Madhav Somani</a><span aria-hidden="true">↗</span></p>
      </div>
      <div class="header-actions"><nav class="section-nav" aria-label="Dashboard sections"><a href="#overview">Overview</a><a href="#relay-architecture">Relay</a><a href="#analytics">Analytics</a><a href="#history">Requests</a></nav><span class="version-badge">Relay <strong id="relay-version">—</strong></span><span class="live-badge" id="live-badge"><span class="dot"></span><span id="live-status">connecting live feed</span></span><button id="clear">Clear detailed history</button></div>
    </div>
  </header>
  <main>
    <div class="notice" id="overview"><span class="pill"><span class="dot"></span> loopback only</span><span class="pill">provider: <strong>github-copilot-sdk</strong></span><span class="pill">compatibility: long context · Codex tools/memory preserved</span><span class="pill">context: bounded, salience-aware compaction</span><span class="pill">history: <strong id="limit">1,000</strong> entries · <strong id="detail-limit">200 detailed</strong></span><span class="pill">auto-refresh: <strong>5s</strong></span><span class="pill" id="updated">waiting for bridge…</span></div>
    <section class="kpis" id="observability-kpis" aria-label="Relay key performance indicators">
      <article class="kpi"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">↗</span><span>Lifetime calls received</span></div><div class="kpi-main"><strong class="kpi-value" id="received">0</strong><svg class="kpi-sparkline" id="kpi-requests-chart" role="img" aria-label="Recent received request trend"></svg></div><div class="kpi-foot"><strong id="replayed">0</strong> Copilot replays</div></article>
      <article class="kpi good"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">✓</span><span>Success rate</span></div><div class="kpi-main"><strong class="kpi-value" id="success-rate">—</strong><svg class="kpi-sparkline" id="kpi-success-chart" role="img" aria-label="Recent completion-rate trend"></svg></div><div class="kpi-foot"><strong id="completed">0</strong> completed · <span id="failed">0</span> failed</div></article>
      <article class="kpi violet"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">◷</span><span>Average latency</span></div><div class="kpi-main"><strong class="kpi-value" id="latency">—</strong><svg class="kpi-sparkline" id="kpi-latency-chart" role="img" aria-label="Recent completed-call latency trend"></svg></div><div class="kpi-foot"><strong id="tools">0</strong> lifetime tool calls</div></article>
      <article class="kpi cyan"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">$</span><span>API-equivalent estimate</span></div><div class="kpi-main"><strong class="kpi-value" id="kpi-cost">$0.00</strong><svg class="kpi-sparkline" id="kpi-cost-chart" role="img" aria-label="Recent measured API-equivalent cost trend"></svg></div><div class="kpi-foot">Measured tokens · <strong>not a charge</strong></div></article>
      <article class="kpi violet"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">✦</span><span>Relay AI credits</span></div><div class="kpi-main"><strong class="kpi-value" id="kpi-credits">0</strong><svg class="kpi-sparkline" id="kpi-credits-chart" role="img" aria-label="Recent Copilot credit-unit trend"></svg></div><div class="kpi-foot"><strong id="kpi-sdk-calls">0</strong> measured SDK calls</div></article>
      <article class="kpi warn"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">●</span><span>Active now</span></div><div class="kpi-main"><strong class="kpi-value" id="active">0</strong><svg class="kpi-sparkline" id="kpi-active-chart" role="img" aria-label="Recent active-call trend"></svg></div><div class="kpi-foot"><strong id="active-exchanges-kpi">0</strong> resumable · <span id="traffic">0 B</span></div></article>
    </section>
    <section class="command-grid">
      <article class="panel architecture" id="relay-architecture">
        <div class="panel-head"><div><h2>Live request journey</h2><span class="tiny">One capsule represents one real prompt, response, or tool handoff</span></div><span class="phase" id="flow-phase">IDLE</span></div>
        <div class="architecture-body">
          <div class="network-viewport">
            <div class="network-stage">
              <svg class="traffic-map idle" id="traffic-map" viewBox="0 0 840 310" role="img" aria-labelledby="traffic-map-title traffic-map-description">
                <title id="traffic-map-title">Live concurrent Codex relay traffic</title>
                <desc id="traffic-map-description">A continuous request map where each labeled capsule represents one real Codex call traveling through the local relay, GitHub Copilot, a GPT model, or an outer Codex tool.</desc>
                <defs>
                  <linearGradient id="main-route-gradient" gradientUnits="userSpaceOnUse" x1="132" y1="148" x2="717" y2="148"><stop offset="0" stop-color="#2d94ff"></stop><stop offset=".52" stop-color="#54e0d1"></stop><stop offset="1" stop-color="#a98cff"></stop></linearGradient>
                  <linearGradient id="tool-route-gradient" gradientUnits="userSpaceOnUse" x1="132" y1="148" x2="717" y2="156"><stop offset="0" stop-color="#69b7ff"></stop><stop offset=".55" stop-color="#ffd27a"></stop><stop offset="1" stop-color="#a98cff"></stop></linearGradient>
                  <path id="route-main-journey" d="M132 148 C178 148 211 148 250 148 C360 148 410 82 470 82 C590 82 660 148 717 148"></path>
                  <path id="route-tool-journey" d="M132 148 C205 148 270 148 350 160 C405 178 460 252 570 232 C620 222 650 185 717 157"></path>
                </defs>
                <g aria-hidden="true">
                  <use href="#route-main-journey" class="route-line main"></use>
                  <use href="#route-tool-journey" class="route-line tool"></use>
                </g>
                <g id="traffic-packets" aria-hidden="true"></g>
                <g class="network-node" data-node="codex" transform="translate(82 148)">
                  <rect class="node-shell" x="-48" y="-42" width="96" height="84" rx="18"></rect>
                  <g class="node-glyph"><rect x="-22" y="-19" width="35" height="30" rx="4"></rect><path d="M-13 19 H22 M22 19 V-11 H14"></path><circle cx="-31" cy="-19" r="3"></circle><circle cx="-31" cy="-7" r="3"></circle><circle cx="-31" cy="5" r="3"></circle></g>
                  <text class="network-label" y="61">Codex App</text><text class="network-meta" y="77">TASKS + CHILD AGENTS</text>
                </g>
                <g class="network-node" data-node="relay" transform="translate(300 148)">
                  <rect class="node-shell" x="-50" y="-44" width="100" height="88" rx="18"></rect>
                  <g class="node-glyph"><rect x="-21" y="-25" width="42" height="50" rx="5"></rect><path d="M-12 -15 H12 M-12 -6 H12 M-12 3 H12 M-12 12 H12"></path><circle cx="14" cy="-15" r="1.5"></circle><circle cx="14" cy="-6" r="1.5"></circle><circle cx="14" cy="3" r="1.5"></circle><circle cx="14" cy="12" r="1.5"></circle></g>
                  <text class="network-label" y="63">Local Relay</text><text class="network-meta" id="relay-address" y="79">127.0.0.1:4144</text>
                </g>
                <g class="network-node" data-node="copilot" transform="translate(520 82)">
                  <rect class="node-shell" x="-48" y="-38" width="96" height="76" rx="18"></rect>
                  <g class="node-glyph"><path d="M-24 3 C-24 -14 -10 -24 0 -15 C10 -24 24 -14 24 3 V14 C17 22 8 20 0 14 C-8 20 -17 22 -24 14 Z"></path><path d="M-9 -1 L-2 6 M9 -1 L2 6"></path><circle cx="-11" cy="-4" r="2"></circle><circle cx="11" cy="-4" r="2"></circle></g>
                  <text class="network-label" y="56">GitHub Copilot</text><text class="network-meta" y="72">OFFICIAL SDK</text>
                </g>
                <g class="network-node" data-node="model" transform="translate(760 148)">
                  <circle class="node-shell" r="43"></circle>
                  <g class="node-glyph"><circle r="22"></circle><path d="M-14 -11 C-3 -19 12 -14 15 -3 C18 8 8 19 -4 18 C-16 17 -22 4 -17 -7 M-19 7 C-8 1 3 5 8 15 M-5 -18 C0 -7 9 -3 20 -5"></path></g>
                  <text class="network-label" y="62">GPT Model</text><text class="network-meta" y="78">REMOTE INFERENCE</text>
                </g>
                <g class="network-node" data-node="tools" transform="translate(520 232)">
                  <rect class="node-shell" x="-48" y="-34" width="96" height="68" rx="17"></rect>
                  <g class="node-glyph"><path d="M-21 -8 H-6 L0 -17 L7 -8 H21 V14 H-21 Z"></path><path d="M-12 2 H12 M-12 10 H5"></path></g>
                  <text class="network-label" y="53">Codex tools</text><text class="network-meta" y="69">OUTER APP EXECUTES</text>
                </g>
                <g transform="translate(17 18)"><rect class="traffic-counter" width="165" height="25" rx="12.5"></rect><rect x="10" y="8" width="8" height="9" rx="4.5" fill="#69b7ff"></rect><text class="traffic-legend" id="traffic-count" x="24" y="16">idle · labeled request journeys</text></g>
                <g transform="translate(602 14)" aria-hidden="true"><rect x="0" y="0" width="46" height="14" rx="7" fill="#0b1d31" stroke="#2d94ff"></rect><text class="flow-legend" x="23" y="10" text-anchor="middle">PROMPT</text><rect x="59" y="0" width="46" height="14" rx="7" fill="#0b1d31" stroke="#58e59b"></rect><text class="flow-legend" x="82" y="10" text-anchor="middle">STREAM</text></g>
              </svg>
            </div>
          </div>
          <div class="flow-footer"><div class="event-copy" aria-live="polite"><strong id="live-event">Waiting for the next Codex request</strong><span id="live-event-detail">The dashboard stays connected and will animate both directions.</span></div><span class="tiny" id="active-exchanges">0 exchanges</span></div>
          <div class="active-strip" id="active-calls" aria-label="Recently active relay calls"><span class="call-chip">No calls in flight</span></div>
        </div>
      </article>
      <aside class="insight-stack">
        <article class="panel insight">
          <div class="panel-head"><div><h2>OpenAI API-equivalent estimate</h2><span class="tiny">Measured text tokens · public list prices</span></div><span class="tiny" id="price-date">loading</span></div>
          <div class="insight-body">
            <div class="metric-hero cost"><strong id="api-cost">$0.00</strong><span id="cost-coverage">0% metered<br>forward-only coverage</span></div>
            <div class="micro-grid"><div class="micro"><span>Input tokens</span><strong id="input-tokens">0</strong></div><div class="micro"><span>Output tokens</span><strong id="output-tokens">0</strong></div><div class="micro"><span>SDK model calls</span><strong id="sdk-calls">0</strong></div></div>
            <div class="coverage-track" title="Share of completed relay responses with exact SDK token telemetry"><div class="coverage-fill" id="coverage-fill"></div></div>
            <p class="disclaimer"><strong>Not an actual charge.</strong> Measured SDK tokens are multiplied by standard public API rates; Copilot subscription billing is separate. <a id="price-source" href="https://developers.openai.com/api/docs/models/gpt-5.6-sol" target="_blank" rel="noopener noreferrer">Public price snapshot</a>: <span id="price-source-date">—</span>.</p>
            <div class="rate-strip" id="rate-strip" aria-label="Public model price snapshot"></div>
          </div>
        </article>
        <article class="panel insight">
          <div class="panel-head"><div><h2>Copilot entitlement</h2><span class="tiny">Fetched from the authenticated local SDK</span></div><button class="button-small" id="refresh-quota">Refresh</button></div>
          <div class="insight-body">
            <div class="metric-hero quota"><strong id="quota-left">—</strong><span id="quota-state">waiting for SDK<br>quota snapshot</span></div>
            <progress class="quota-progress" id="quota-progress" value="0" max="100"></progress>
            <div class="micro-grid"><div class="micro"><span>Used units</span><strong id="quota-used">—</strong></div><div class="micro"><span>Entitlement</span><strong id="quota-total">—</strong></div><div class="micro"><span>Relay AI credits</span><strong id="ai-credits">0</strong></div></div>
            <div class="quota-categories" id="quota-categories"><span class="quota-chip">Loading categories…</span></div>
            <p class="disclaimer" id="quota-note">The SDK exposes entitlement and reset data, not your subscription purchase price. AI credits are relay-session usage, not an invoice.</p>
          </div>
        </article>
      </aside>
      <aside class="panel live-inspector" aria-labelledby="inspector-heading">
        <div class="panel-head"><div><h2 id="inspector-heading">Live request inspector</h2><span class="tiny">Most recent real SSE phase across all calls</span></div><span class="live-badge connected"><span class="dot"></span>live</span></div>
        <div class="inspector-body">
          <dl class="inspector-grid">
            <dt>Request ID</dt><dd id="inspector-id">waiting</dd>
            <dt>Model</dt><dd class="model" id="inspector-model">—</dd>
            <dt>Status</dt><dd id="inspector-status">idle</dd>
            <dt>Measured tokens</dt><dd id="inspector-tokens">—</dd>
            <dt>Latency</dt><dd id="inspector-latency">—</dd>
            <dt>Estimated cost</dt><dd class="live-good" id="inspector-cost">—</dd>
            <dt>Route</dt><dd id="inspector-route">—</dd>
            <dt>Outer tools</dt><dd id="inspector-tools">0</dd>
          </dl>
          <div class="event-log-head"><strong>Event log</strong><span>newest first · 16 max</span></div>
          <div class="event-log" id="inspector-events" aria-live="polite"><div class="event-empty">Waiting for relay traffic…</div></div>
        </div>
      </aside>
    </section>
    <section class="charts" id="analytics">
      <article class="panel chart"><div class="panel-head"><h2>24-hour relay traffic</h2><div class="legend"><span class="key"><span class="swatch"></span>received</span><span class="key"><span class="swatch cyan"></span>Copilot replay</span></div></div><div class="chart-body"><svg id="hourly-chart" role="img" aria-label="Calls received and replayed to Copilot during the last 24 hours"></svg></div></article>
      <article class="panel chart"><div class="panel-head"><h2>30-day outcomes</h2><div class="legend"><span class="key"><span class="swatch good"></span>completed</span><span class="key"><span class="swatch bad"></span>failed</span></div></div><div class="chart-body"><svg id="daily-chart" role="img" aria-label="Completed and failed calls during the last 30 days"></svg></div></article>
      <article class="panel chart"><div class="panel-head"><h2>Model mileage</h2><span class="tiny">received + replayed</span></div><div class="chart-body"><div class="model-list" id="model-chart"><div class="empty">No model traffic yet.</div></div></div></article>
      <article class="panel chart"><div class="panel-head"><h2>Bounded storage</h2><span class="tiny">under 1 GB</span></div><div class="chart-body"><div class="storage-number" id="storage-total">0 B</div><progress id="storage-meter" value="0" max="1"></progress><div class="storage-lines"><div class="storage-line"><span>Detailed history</span><strong id="history-size">0 B</strong></div><div class="storage-line"><span>Metrics + event logs</span><strong id="metrics-size">0 B</strong></div><div class="storage-line"><span>Telemetry ceiling</span><strong id="telemetry-cap">408 MB</strong></div><div class="storage-line"><span>Retained tiers</span><strong id="retained">0</strong></div></div><p class="baseline" id="baseline">Mileage initializes from recoverable history, then remains exact as detail is pruned.</p></div></article>
    </section>
    <div class="workspace" id="history">
      <section class="panel"><div class="panel-head"><h2>Recent call history</h2><span class="tiny" id="count">0 records</span></div><div class="table-wrap"><table><thead><tr><th>Received</th><th>Route / model</th><th>Status</th><th>Tier</th><th>Replay</th><th>Tools</th><th>Latency</th><th>Bytes</th><th>Measured usage</th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty">No Responses calls have crossed the bridge yet.</div></div><div class="more"><button id="show-more" hidden>Show 200 more</button></div></section>
      <aside class="panel detail"><div class="panel-head"><h2>Selected call</h2><span class="tiny" id="selected-id">none</span></div><div class="detail-body" id="detail"><div class="empty">Select a row. Detailed bodies load only when requested; older entries keep lightweight metadata.</div></div></aside>
    </div>
  </main>
  <script>
    const state = { records: [], selected: null, visible: 200, details: new Map(), liveCalls: new Map(), liveEvents: [], activeSamples: [], latestInspectorRecord: null, flowTimer: null, refreshTimer: null };
    const svgNs = "http://www.w3.org/2000/svg";
    const MAX_LIVE_CALLS = 64;
    const MAX_TRAFFIC_PACKETS = 96;
    const MAX_LIVE_EVENTS = 16;
    const TRAFFIC_COLORS = ["#69b7ff", "#54e0d1", "#a98cff", "#ffd27a", "#ff8398", "#6ddd9a", "#ff9f6e", "#8fd3ff"];
    const TRAFFIC_LANES = [-28, -14, 0, 14, 28];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const $ = (id) => document.getElementById(id);
    const fmt = (value) => value === null || value === undefined ? "—" : String(value);
    const number = (value) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);
    const json = (value) => value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
    const bytes = (value) => { if (!Number.isFinite(value)) return "—"; if (value < 1024) return value + " B"; if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB"; if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB"; return (value / 1024 / 1024 / 1024).toFixed(2) + " GB"; };
    const duration = (value) => Number.isFinite(value) ? (value < 1000 ? value + " ms" : value < 60000 ? (value / 1000).toFixed(1) + " s" : (value / 60000).toFixed(1) + " min") : "—";
    const time = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—"; };
    const usd = (value) => { const amount = Number(value) || 0; if (amount === 0) return "$0.00"; if (amount < .01) return "$" + amount.toFixed(6); if (amount < 1) return "$" + amount.toFixed(4); return "$" + amount.toFixed(2); };
    const compact = (value) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(Number(value) || 0);
    function setText(id, value) { $(id).textContent = fmt(value); }
    function svgElement(name, attributes) { const node = document.createElementNS(svgNs, name); for (const entry of Object.entries(attributes || {})) node.setAttribute(entry[0], String(entry[1])); return node; }
    function sparkline(id, values, color) {
      const svg = $(id); svg.replaceChildren(); svg.setAttribute("viewBox", "0 0 72 35");
      const clean = (values || []).map(Number).filter(Number.isFinite);
      const series = clean.length > 1 ? clean : [clean[0] || 0, clean[0] || 0];
      const minimum = Math.min(...series), maximum = Math.max(...series), range = Math.max(1e-9, maximum - minimum);
      const points = series.map((value, index) => [2 + 68 * index / (series.length - 1), 31 - 27 * (value - minimum) / range]);
      const line = points.map((point, index) => (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1)).join(" ");
      const area = line + " L70 33 L2 33 Z";
      svg.appendChild(svgElement("path", { d: area, fill: color, class: "spark-area" }));
      svg.appendChild(svgElement("path", { d: line, stroke: color, class: "spark-line" }));
    }
    function renderKpis(data) {
      const summary = data.summary || {}, hourly = data.analytics?.hourly || [], daily = data.analytics?.daily || [];
      const outcomes = (Number(summary.completed) || 0) + (Number(summary.failed) || 0);
      const successRate = outcomes ? 100 * (Number(summary.completed) || 0) / outcomes : 0;
      setText("success-rate", outcomes ? successRate.toFixed(2) + "%" : "—");
      setText("kpi-cost", usd(summary.apiEquivalentUsd));
      setText("kpi-credits", compact(summary.aiCredits));
      setText("kpi-sdk-calls", number(summary.sdkApiCalls));
      setText("active-exchanges-kpi", number(data.activeExchanges || 0));
      const recent = state.records.slice(0, 18).reverse();
      state.activeSamples.push(Number(summary.active) || 0); while (state.activeSamples.length > 18) state.activeSamples.shift();
      sparkline("kpi-requests-chart", hourly.slice(-18).map((row) => row.received), "#2d94ff");
      sparkline("kpi-success-chart", daily.slice(-18).map((row) => { const total = (Number(row.completed) || 0) + (Number(row.failed) || 0); return total ? 100 * (Number(row.completed) || 0) / total : 0; }), "#6ddd9a");
      sparkline("kpi-latency-chart", recent.map((record) => Number(record.latencyMs) || 0), "#a98cff");
      sparkline("kpi-cost-chart", recent.map((record) => Number(record.usage?.apiEquivalentUsd) || 0), "#54e0d1");
      sparkline("kpi-credits-chart", recent.map((record) => Number(record.usage?.copilotCostUnits) || 0), "#a98cff");
      sparkline("kpi-active-chart", state.activeSamples, "#ffd27a");
    }
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
    function renderPricing(data) {
      const summary = data.summary || {}, pricing = data.pricing || {};
      const coverage = Math.max(0, Math.min(100, Number(summary.meteringCoveragePercent) || 0));
      setText("api-cost", usd(summary.apiEquivalentUsd));
      setText("input-tokens", compact(summary.inputTokens));
      setText("output-tokens", compact(summary.outputTokens));
      setText("sdk-calls", number(summary.sdkApiCalls));
      setText("cost-coverage", coverage.toFixed(1) + "% metered · " + number(summary.unmeteredCalls || 0) + " earlier unmetered");
      $("coverage-fill").style.width = coverage.toFixed(2) + "%";
      setText("price-date", pricing.sourceDate ? "snapshot " + pricing.sourceDate : "price unavailable");
      setText("price-source-date", pricing.sourceDate || "—");
      const priced = (pricing.models || []).filter((model) => !model.unavailable);
      if (priced[0]?.sourceUrl) $("price-source").href = priced[0].sourceUrl;
      const strip = $("rate-strip"); strip.replaceChildren();
      for (const model of priced) {
        const chip = document.createElement("a"); chip.className = "rate-chip"; chip.href = model.sourceUrl; chip.target = "_blank"; chip.rel = "noopener noreferrer";
        const name = document.createElement("strong"); name.textContent = model.id.replace("gpt-", "GPT ");
        const rate = document.createElement("span"); rate.textContent = "$" + model.inputUsdPerMillion + " in · $" + model.outputUsdPerMillion + " out / 1M";
        chip.append(name, rate); strip.appendChild(chip);
      }
    }
    function renderQuota(data) {
      const summary = data.summary || {}, quota = data.copilot?.quota || {}, snapshots = quota.snapshots || {};
      const premium = snapshots.premium_interactions;
      setText("ai-credits", (Number(summary.aiCredits) || 0).toFixed(6));
      if (premium) {
        const remaining = Math.max(0, Math.min(100, Number(premium.remainingPercentage) || 0));
        setText("quota-left", premium.isUnlimitedEntitlement ? "Unlimited" : remaining.toFixed(1) + "% left");
        setText("quota-used", compact(premium.usedRequests));
        setText("quota-total", premium.isUnlimitedEntitlement ? "Unlimited" : compact(premium.entitlementRequests));
        $("quota-progress").value = premium.isUnlimitedEntitlement ? 100 : remaining;
        setText("quota-state", quota.status + " · resets " + time(premium.resetDate));
        $("quota-note").textContent = "Premium interaction units are reported by GitHub's SDK. Continued use after quota is " + (premium.usageAllowedWithExhaustedQuota ? "allowed" : "blocked") + "; overage billing is " + (premium.overageAllowedWithExhaustedQuota ? "allowed" : "not allowed") + " by this entitlement. Actual charges depend on your GitHub plan.";
      } else {
        setText("quota-left", quota.status === "unavailable" ? "Unavailable" : "Loading…");
        setText("quota-state", quota.message || "waiting for SDK quota snapshot");
        setText("quota-used", "—"); setText("quota-total", "—"); $("quota-progress").value = 0;
      }
      const root = $("quota-categories"); root.replaceChildren();
      const entries = Object.entries(snapshots);
      if (!entries.length) { const chip = document.createElement("span"); chip.className = "quota-chip"; chip.textContent = quota.status || "loading"; root.appendChild(chip); }
      for (const entry of entries) {
        const chip = document.createElement("span"); chip.className = "quota-chip" + (entry[1].isUnlimitedEntitlement ? " unlimited" : "");
        chip.textContent = entry[0].replaceAll("_", " ") + ": " + (entry[1].isUnlimitedEntitlement ? "unlimited" : (Number(entry[1].remainingPercentage) || 0).toFixed(1) + "% left");
        root.appendChild(chip);
      }
    }
    function callVisual(id) {
      let hash = 2166136261;
      const text = String(id || "unknown");
      for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
      return {
        color: TRAFFIC_COLORS[hash % TRAFFIC_COLORS.length],
        lane: TRAFFIC_LANES[(hash >>> 8) % TRAFFIC_LANES.length],
      };
    }
    function ensureLiveCall(id, model, phase) {
      const prior = state.liveCalls.get(id);
      const baseVisual = prior || callVisual(id);
      const usedLanes = new Set([...state.liveCalls.values()].filter(call => call.id !== id).map(call => call.lane));
      const preferredLaneIndex = Math.max(0, TRAFFIC_LANES.indexOf(baseVisual.lane));
      const orderedLanes = TRAFFIC_LANES.map((_, offset) => TRAFFIC_LANES[(preferredLaneIndex + offset) % TRAFFIC_LANES.length]);
      const visual = prior || { ...baseVisual, lane: orderedLanes.find(lane => !usedLanes.has(lane)) ?? baseVisual.lane };
      const call = { id, model, phase, color: visual.color, lane: visual.lane };
      state.liveCalls.delete(id);
      state.liveCalls.set(id, call);
      while (state.liveCalls.size > MAX_LIVE_CALLS) state.liveCalls.delete(state.liveCalls.keys().next().value);
      return call;
    }
    function renderActiveCalls() {
      const root = $("active-calls"); root.replaceChildren();
      const calls = [...state.liveCalls.values()].reverse();
      setText("traffic-count", calls.length ? number(calls.length) + (calls.length === 1 ? " journey visible" : " journeys visible") : "idle · labeled request journeys");
      if (!calls.length) { const empty = document.createElement("span"); empty.className = "call-chip"; empty.textContent = "No calls in flight"; root.appendChild(empty); return; }
      for (const call of calls) {
        const chip = document.createElement("span"); chip.className = "call-chip";
        const marker = document.createElement("span"); marker.className = "call-color"; marker.style.setProperty("--call-color", call.color);
        const strong = document.createElement("strong"); strong.textContent = (call.id || "call").slice(-8);
        chip.append(marker, strong, document.createTextNode(" · " + (call.model || "model") + " · " + call.phase)); root.appendChild(chip);
      }
    }
    function renderEventLog() {
      const root = $("inspector-events"); root.replaceChildren();
      if (!state.liveEvents.length) { const empty = document.createElement("div"); empty.className = "event-empty"; empty.textContent = "Waiting for relay traffic…"; root.appendChild(empty); return; }
      for (const item of state.liveEvents) {
        const row = document.createElement("div"); row.className = "event-row";
        const at = document.createElement("span"); at.className = "event-time"; at.textContent = new Date(item.at).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const dot = document.createElement("span"); dot.className = "event-dot"; dot.style.setProperty("--event-color", item.color);
        const title = document.createElement("span"); title.className = "event-title"; title.textContent = item.title + " · " + item.id.slice(-8); title.title = item.title + " · " + item.id;
        row.append(at, dot, title); root.appendChild(row);
      }
    }
    function recordLiveEvent(event, call, title) {
      const color = event.type === "relay.failed" ? "#ff8398" : event.type === "relay.completed" ? "#6ddd9a" : call.color;
      state.liveEvents.unshift({ at: event.at || new Date().toISOString(), id: String(call.id || "unknown"), title, color });
      if (state.liveEvents.length > MAX_LIVE_EVENTS) state.liveEvents.length = MAX_LIVE_EVENTS;
      renderEventLog();
    }
    function renderLiveInspector(record, event) {
      if (!record) return;
      state.latestInspectorRecord = record;
      const usage = event?.usage || record.usage || {};
      const inputTokens = Number(usage.inputTokens), outputTokens = Number(usage.outputTokens);
      const hasTokens = Number.isFinite(inputTokens) || Number.isFinite(outputTokens);
      const status = event?.type ? event.type.replace("relay.", "") : (record.status || "retained");
      setText("inspector-id", String(record.id || "unknown").slice(-18));
      setText("inspector-model", record.selectedModel || record.requestedModel || event?.model || "unknown");
      setText("inspector-status", status);
      setText("inspector-tokens", hasTokens ? number((inputTokens || 0) + (outputTokens || 0)) + " tokens" : "unmetered / pending");
      setText("inspector-latency", duration(record.latencyMs));
      setText("inspector-cost", Number.isFinite(Number(usage.apiEquivalentUsd)) ? usd(Number(usage.apiEquivalentUsd)) : "pending");
      setText("inspector-route", (record.requestPath || "/v1/responses") + " · Codex → Relay → Copilot → Model");
      setText("inspector-tools", number(record.toolCalls || 0));
      $("inspector-status").className = status === "failed" ? "live-bad" : status === "completed" ? "live-good" : "";
    }
    function launchJourneyPacket(pathId, call, options = {}) {
      if (reducedMotion.matches) return;
      const layer = $("traffic-packets");
      if (!layer) return;
      while (layer.childElementCount >= MAX_TRAFFIC_PACKETS) layer.firstElementChild.remove();
      const reverse = Boolean(options.reverse);
      const seconds = Math.max(.8, Number(options.seconds) || 2.25);
      const labelText = String(options.label || "PROMPT").slice(0, 8).toUpperCase();
      const packet = svgElement("g", { class: "traffic-packet", "data-call": String(call.id).slice(-32), "data-kind": labelText.toLowerCase() });
      packet.style.color = options.color || call.color;
      const capsule = svgElement("g", { transform: "translate(0 " + call.lane + ")" });
      capsule.appendChild(svgElement("path", { class: "packet-tail", d: "M-33 0 H-25 M25 0 H33" }));
      capsule.appendChild(svgElement("rect", { class: "packet-body", x: -25, y: -7, width: 50, height: 14, rx: 7 }));
      const label = svgElement("text", { class: "packet-label", x: 0, y: .5 });
      label.textContent = labelText;
      capsule.appendChild(label);
      packet.appendChild(capsule);
      const motion = svgElement("animateMotion", { dur: seconds + "s", begin: "indefinite", fill: "freeze", rotate: "auto", calcMode: "spline", keyTimes: "0;1", keySplines: ".2 .75 .2 1", keyPoints: reverse ? "1;0" : "0;1" });
      motion.appendChild(svgElement("mpath", { href: "#" + pathId }));
      packet.appendChild(motion); layer.appendChild(packet);
      if (typeof motion.beginElement === "function") motion.beginElement();
      setTimeout(() => packet.remove(), seconds * 1000 + 180);
    }
    function launchTrafficForEvent(event, call) {
      if (event.type === "relay.forwarded") launchJourneyPacket("route-main-journey", call, { label: "PROMPT" });
      if (event.type === "relay.tool_requested") launchJourneyPacket("route-tool-journey", call, { label: "TOOL", reverse: true });
      if (event.type === "relay.tool_resolved") launchJourneyPacket("route-tool-journey", call, { label: "RESULT" });
      if (event.type === "relay.completed") launchJourneyPacket("route-main-journey", call, { label: "STREAM", reverse: true });
      if (event.type === "relay.failed") launchJourneyPacket("route-main-journey", call, { label: "ERROR", reverse: true, color: "#ff8398" });
    }
    function setFlowPhase(phase, title, detail) {
      const stage = $("traffic-map");
      stage.setAttribute("class", "traffic-map " + phase);
      setText("flow-phase", phase.toUpperCase().replace("-", " ")); setText("live-event", title); setText("live-event-detail", detail);
      clearTimeout(state.flowTimer);
      state.flowTimer = setTimeout(() => { stage.setAttribute("class", "traffic-map idle"); setText("flow-phase", "IDLE"); }, 2600);
    }
    function handleLiveEvent(event) {
      const record = event.record || {}, id = String(record.id || "unknown"), model = record.selectedModel || record.requestedModel || event.model || "model";
      if (event.type === "dashboard.ready") return;
      let phase = "active", animation = "request", title = "Codex request received", detail = "Call " + id.slice(-8) + " entered the loopback relay.";
      if (event.type === "relay.forwarded") { phase = "forwarded"; animation = "forward"; title = "Relay forwarded context to Copilot"; detail = model + " · " + (event.phase || "request") + "."; }
      if (event.type === "relay.usage") { phase = "model response"; animation = "process"; title = "Copilot model usage received"; detail = model + " · " + number(event.usage?.inputTokens || 0) + " input / " + number(event.usage?.outputTokens || 0) + " output tokens."; }
      if (event.type === "relay.tool_requested") { phase = "tool call"; animation = "tool-return"; title = "Tool call returned to Codex"; detail = "Codex will execute " + (event.tool || "the requested tool") + " outside the relay."; }
      if (event.type === "relay.tool_resolved") { phase = "tool result"; animation = "tool-forward"; title = "Tool result sent back through relay"; detail = event.failed ? "The outer tool reported a failure." : "Copilot can continue the same SDK session."; }
      if (event.type === "relay.completed") { phase = "completed"; animation = "response"; title = "Response completed back in Codex"; detail = model + " · " + duration(record.latencyMs) + " end-to-end."; }
      if (event.type === "relay.failed") { phase = "failed"; animation = "failed"; title = "Relay call failed"; detail = model + " · inspect the sanitized call record for details."; }
      const call = ensureLiveCall(id, model, phase);
      renderActiveCalls(); setFlowPhase(animation, title, detail);
      renderLiveInspector(record, event); recordLiveEvent(event, call, title);
      try { launchTrafficForEvent(event, call); } catch (error) { console.warn("Relay traffic animation skipped:", error); }
      if (event.type === "relay.completed" || event.type === "relay.failed") setTimeout(() => { if (state.liveCalls.get(id) === call) { state.liveCalls.delete(id); renderActiveCalls(); } }, 3000);
      clearTimeout(state.refreshTimer); state.refreshTimer = setTimeout(refresh, 250);
    }
    function connectLiveEvents() {
      const source = new EventSource("/dashboard/events");
      source.onopen = () => { $("live-badge").className = "live-badge connected"; setText("live-status", "live event stream"); };
      source.addEventListener("relay", (message) => { try { handleLiveEvent(JSON.parse(message.data)); } catch (error) { console.warn("Relay dashboard event skipped:", error); } });
      source.onerror = () => { $("live-badge").className = "live-badge"; setText("live-status", "reconnecting live feed"); };
    }
    function renderStats(data) {
      const summary = data.summary || {}, storage = data.storage || {};
      setText("received", number(summary.received)); setText("replayed", number(summary.replayed)); setText("completed", number(summary.completed)); setText("failed", number(summary.failed)); setText("active", number(summary.active)); setText("tools", number(summary.toolCalls)); setText("latency", duration(summary.avgLatencyMs)); setText("traffic", bytes((summary.inputBytes || 0) + (summary.outputBytes || 0)));
      setText("limit", number(data.maxRecords || 1000)); setText("detail-limit", number(data.maxDetailedRecords || 200) + " detailed"); setText("count", number(state.records.length) + " retained records");
      setText("storage-total", bytes(storage.totalBytes || 0)); setText("history-size", bytes(storage.historyBytes || 0)); setText("metrics-size", bytes((storage.metricsBytes || 0) + (storage.eventLogBytes || 0) + (storage.watchdogLogBytes || 0) + (storage.processStdoutBytes || 0) + (storage.processStderrBytes || 0))); setText("telemetry-cap", bytes(storage.telemetryCapBytes || 0)); setText("retained", number(summary.detailed || 0) + " detailed · " + number(summary.lightweight || 0) + " light");
      $("storage-meter").max = storage.telemetryCapBytes || 1; $("storage-meter").value = storage.totalBytes || 0;
      const baseline = data.metricsBaseline || {};
      $("baseline").textContent = "Lifetime call mileage is durable from " + time(data.metricsCreatedAt) + ". Exact token/cost metering began " + time(baseline.usageMeteringStartedAt) + "; " + number(summary.unmeteredCalls || 0) + " earlier outcomes remain honestly unmetered.";
      chartFrame($("hourly-chart"), data.analytics?.hourly || [], ["received", "replayed"], ["#69b7ff", "#54e0d1"], "lines");
      chartFrame($("daily-chart"), data.analytics?.daily || [], ["completed", "failed"], ["#6ddd9a", "#ff8398"], "bars");
      renderModels(data.analytics?.models || []);
      renderPricing(data); renderQuota(data); renderKpis(data); setText("active-exchanges", number(data.activeExchanges || 0) + " exchanges");
      setText("relay-version", data.relayVersion ? "v" + String(data.relayVersion).replace(/^v/i, "") : "unknown");
      setText("updated", "updated " + new Date().toLocaleTimeString()); $("updated").className = "pill";
    }
    function renderRows() {
      const rows = $("rows"); rows.replaceChildren(); const records = state.records.slice(0, state.visible); $("empty").style.display = records.length ? "none" : "block";
      for (const record of records) {
        const row = document.createElement("tr"); if (record.id === state.selected) row.className = "selected"; row.tabIndex = 0; row.setAttribute("role", "button"); row.onclick = () => selectRecord(record.id); row.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRecord(record.id); } };
        const measured = record.usage?.metered ? compact((record.usage.inputTokens || 0) + (record.usage.outputTokens || 0)) + " tokens\n" + usd(record.usage.apiEquivalentUsd) : "unmetered";
        const values = [time(record.receivedAt), (record.requestPath || "—") + "\n" + (record.selectedModel || record.requestedModel || "unknown"), record.status, record.detailTier, record.replayCount || 0, record.toolCalls || 0, duration(record.latencyMs), bytes((record.inputBytes || 0) + (record.outputBytes || 0)), measured];
        values.forEach((value, index) => { const cell = document.createElement("td"); if (index === 1) { cell.className = "wrap model"; cell.style.whiteSpace = "pre-line"; } else if (index === 2) cell.className = "status " + record.status; else if (index === 8) { cell.className = "token-cell"; cell.style.whiteSpace = "pre-line"; } if (index === 3) { const badge = document.createElement("span"); badge.className = "tier " + record.detailTier; badge.textContent = record.detailTier === "lightweight" ? "light" : "detail"; cell.appendChild(badge); } else cell.textContent = value; row.appendChild(cell); });
        rows.appendChild(row);
      }
      $("show-more").hidden = state.visible >= state.records.length;
    }
    function section(title, value, className) { const wrapper = document.createElement("section"); wrapper.className = "detail-section"; const heading = document.createElement("h3"); heading.textContent = title; const pre = document.createElement("pre"); if (className) pre.className = className; pre.textContent = json(value); wrapper.append(heading, pre); return wrapper; }
    function renderDetail(record, loading) {
      const detail = $("detail"); detail.replaceChildren(); setText("selected-id", record?.id || "none");
      if (!record) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Select a call to inspect it."; detail.appendChild(empty); return; }
      detail.appendChild(section("Call metadata", { id: record.id, tier: record.detailTier, status: record.status, receivedAt: record.receivedAt, completedAt: record.completedAt, route: record.requestPath, requestedModel: record.requestedModel, selectedModel: record.selectedModel, streaming: record.streaming, inputBytes: record.inputBytes, outputBytes: record.outputBytes, latencyMs: record.latencyMs, replayCount: record.replayCount, toolCalls: record.toolCalls, previousResponseId: record.previousResponseId, continuedFrom: record.continuedFrom }));
      detail.appendChild(section("Measured SDK usage and API-equivalent estimate", record.usage || { metered: false, note: "This call predates exact SDK usage capture." }));
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
        if (!state.liveEvents.length && state.records[0]) renderLiveInspector(state.records[0]);
        if (state.selected) { const cached = state.details.get(state.selected); renderDetail(cached || state.records.find((record) => record.id === state.selected)); }
      } catch (error) { $("updated").textContent = error.message; $("updated").className = "error"; }
    }
    $("show-more").onclick = () => { state.visible += 200; renderRows(); };
    $("clear").onclick = async () => { if (!confirm("Clear the 1,000-entry detailed history? Lifetime mileage is preserved.")) return; await fetch("/dashboard/clear", { method: "POST" }); state.selected = null; state.details.clear(); await refresh(); };
    $("refresh-quota").onclick = async () => { const button = $("refresh-quota"); button.disabled = true; button.textContent = "Refreshing…"; try { await fetch("/dashboard/quota/refresh", { method: "POST" }); await refresh(); } finally { button.disabled = false; button.textContent = "Refresh"; } };
    setText("relay-address", location.host); connectLiveEvents(); refresh(); setInterval(refresh, 5000);
  </script>
</body>
</html>`;
