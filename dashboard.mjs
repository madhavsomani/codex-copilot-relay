export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23172b4c'/%3E%3Cpath d='M7 17V7h5.2c2.4 0 3.8 1.25 3.8 3.2 0 1.45-.8 2.5-2.15 2.95L17 17h-3l-2.6-3.35H9.6V17H7Zm2.6-5.55h2.25c1 0 1.55-.42 1.55-1.18 0-.78-.55-1.17-1.55-1.17H9.6v2.35Z' fill='%2354e0d1'/%3E%3C/svg%3E">
  <title>Codex Copilot Relay</title>
  <style>
    :root { color-scheme: dark; --bg: #060a13; --panel: #111a2d; --panel2: #17243d; --line: #263958; --text: #eef5ff; --muted: #91a5c4; --accent: #69b7ff; --cyan: #54e0d1; --violet: #a98cff; --good: #6ddd9a; --bad: #ff8398; --warn: #ffd27a; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 82% -12%, rgba(38,91,164,.54) 0, transparent 34rem), radial-gradient(circle at -8% 30%, rgba(67,46,140,.32) 0, transparent 29rem), linear-gradient(180deg, #080d19 0, var(--bg) 55%); color: var(--text); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    header { padding: 25px 30px 17px; border-bottom: 1px solid var(--line); background: rgba(8,13,25,.84); position: sticky; top: 0; z-index: 4; backdrop-filter: blur(16px); }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 18px; max-width: 1720px; margin: 0 auto; }
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
    main { max-width: 1720px; margin: 0 auto; padding: 20px 30px 44px; }
    .notice { display: flex; flex-wrap: wrap; gap: 8px 17px; align-items: center; padding: 11px 14px; border: 1px solid #2e4c75; border-radius: 11px; background: rgba(18,29,50,.74); margin-bottom: 15px; }
    .pill { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); box-shadow: 0 0 12px var(--good); }
    .panel { border: 1px solid var(--line); border-radius: 15px; background: linear-gradient(145deg, rgba(23,36,61,.94), rgba(10,16,30,.97)); box-shadow: 0 15px 44px rgba(0,0,0,.2), inset 0 1px rgba(255,255,255,.025); }
    .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
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
    .storage-kpi .kpi-main { grid-template-columns: minmax(0,1fr) 92px; }
    .storage-kpi .kpi-value { color: var(--cyan); }
    .storage-chart-track { fill: #0b1325; stroke: rgba(84,224,209,.2); stroke-width: 1; }
    .storage-chart-history { fill: var(--accent); }
    .storage-chart-logs { fill: var(--cyan); }
    .storage-chart-other { fill: var(--violet); }
    .storage-chart-label { fill: var(--muted); font: 8px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .chart { min-height: 218px; overflow: hidden; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .chart-body { padding: 11px 13px 13px; min-height: 166px; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; color: var(--muted); font-size: 11px; }
    .key { display: inline-flex; align-items: center; gap: 5px; }
    .swatch { width: 9px; height: 9px; border-radius: 3px; background: var(--accent); } .swatch.cyan { background: var(--cyan); } .swatch.good { background: var(--good); } .swatch.bad { background: var(--bad); }
    svg { width: 100%; height: 154px; display: block; overflow: visible; }
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
    progress { width: 100%; height: 12px; margin: 14px 0 9px; accent-color: var(--cyan); }
    .workspace { display: grid; grid-template-columns: minmax(610px, 1.25fr) minmax(380px, .75fr); gap: 16px; align-items: start; }
    .workspace > *, .command-grid > *, .telemetry-rail > *, .relay-stack > *, .inspection-stack > * { min-width: 0; }
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
    .command-grid { display: grid; grid-template-columns: minmax(270px,.7fr) minmax(620px,1.66fr) minmax(310px,.78fr); gap: 12px; margin-bottom: 16px; align-items: start; }
    .telemetry-rail, .relay-stack, .inspection-stack { display: grid; gap: 12px; min-width: 0; align-content: start; align-items: start; }
    .telemetry-rail { grid-column: 1; grid-row: 1; }
    .relay-stack { grid-column: 2; grid-row: 1; }
    .inspection-stack { grid-column: 3; grid-row: 1; }
    .architecture { overflow: hidden; position: relative; min-height: 0; }
    .architecture::before { content: ""; position: absolute; width: 260px; height: 260px; right: 8%; top: 17%; border-radius: 50%; background: rgba(84,224,209,.08); filter: blur(70px); pointer-events: none; }
    .architecture-body { padding: 17px; position: relative; }
    .network-viewport { overflow-x: auto; padding: 2px 0 12px; scrollbar-width: thin; }
    .network-stage { min-width: 620px; border: 1px solid rgba(48,73,109,.74); border-radius: 15px; background: radial-gradient(circle at 61% 39%, rgba(84,224,209,.08), transparent 15rem), linear-gradient(180deg, rgba(5,10,19,.94), rgba(8,15,28,.86)); overflow: hidden; }
    .traffic-map { width: 100%; min-width: 620px; height: 292px; display: block; overflow: hidden; }
    .route-line { fill: none; stroke-width: 2; stroke-linecap: round; opacity: .52; }
    .route-line.main { stroke: url(#main-route-gradient); filter: drop-shadow(0 0 4px rgba(84,224,209,.22)); }
    .route-line.tool { stroke: url(#tool-route-gradient); opacity: .32; }
    .network-node { color: var(--accent); }
    .network-node .node-shell { fill: #0b1425; stroke: #536984; stroke-width: 1.6; }
    .network-node .node-glyph { fill: none; stroke: #b8c6d9; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .network-node[data-node="model"] { color: var(--violet); }
    .network-node[data-node="tools"] { color: var(--warn); }
    .network-label { fill: var(--text); font-size: 13px; font-weight: 700; text-anchor: middle; }
    .network-label.model-live { font-size: 11px; }
    .network-meta { fill: var(--muted); font-size: 9px; text-anchor: middle; letter-spacing: .035em; }
    .traffic-legend { fill: var(--muted); font-size: 9px; }
    .traffic-counter { fill: rgba(10,20,36,.86); stroke: #344b6a; }
    .traffic-signal { color: var(--accent); pointer-events: none; opacity: 0; animation: transit-fade var(--signal-duration,1.8s) ease-in-out forwards; }
    .transit-carrier { filter: drop-shadow(0 0 7px color-mix(in srgb, currentColor 70%, transparent)); }
    .transit-shell { fill: rgba(6,14,27,.97); stroke: currentColor; stroke-width: 1.35; }
    .transit-tail { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-dasharray: 3 4; opacity: .48; }
    .transit-copy-lines, .transit-stream-lines, .transit-tool-mark, .transit-error-mark { fill: none; stroke: #f3f8ff; stroke-linecap: round; stroke-linejoin: round; }
    .transit-copy-lines { stroke-width: 1.35; opacity: .92; }
    .transit-stream-lines { stroke-width: 2; }
    .transit-stream-lines path:nth-child(2) { opacity: .72; }
    .transit-stream-lines path:nth-child(3) { opacity: .45; }
    .transit-tool-mark, .transit-error-mark { stroke-width: 1.8; }
    .traffic-signal.response .transit-shell { fill: rgba(7,28,26,.96); }
    .traffic-signal.tool .transit-shell { fill: rgba(28,21,7,.96); }
    .traffic-signal.error .transit-shell { fill: rgba(34,8,14,.97); }
    @keyframes transit-fade { 0%,100% { opacity: 0; } 8%,88% { opacity: 1; } }
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
    .insight-stack { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }
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
    .quota-progress { width: 100%; height: 9px; margin: 11px 0 8px; accent-color: var(--good); }
    .quota-categories { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
    .quota-chip { border: 1px solid var(--line); border-radius: 99px; padding: 4px 7px; color: var(--muted); font-size: 9px; }
    .quota-chip.unlimited { color: var(--good); border-color: rgba(109,221,154,.35); }
    .button-small { padding: 5px 8px; font-size: 10px; }
    .token-cell { color: var(--cyan); }
    .live-inspector { min-height: 0; overflow: hidden; align-self: stretch; display: flex; flex-direction: column; }
    .inspector-body { padding: 13px 14px 14px; display: grid; gap: 12px; flex: 1; grid-template-rows: auto auto minmax(0,1fr); }
    .inspector-grid { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 6px 10px; padding: 10px; border: 1px solid var(--line); border-radius: 11px; background: rgba(5,10,20,.55); font-size: 10px; }
    .inspector-grid dt { color: var(--muted); }
    .inspector-grid dd { margin: 0; color: var(--text); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .inspector-grid dd.live-good { color: var(--good); }
    .inspector-grid dd.live-bad { color: var(--bad); }
    .event-log-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; }
    .event-log { display: grid; gap: 0; min-height: 0; max-height: 255px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: #070d18; }
    .event-row { display: grid; grid-template-columns: 49px 7px minmax(0,1fr); gap: 7px; align-items: center; padding: 7px 8px; border-bottom: 1px solid rgba(38,57,88,.52); font-size: 9px; }
    .event-row:last-child { border-bottom: 0; }
    .event-time { color: var(--muted); font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .event-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--event-color,var(--accent)); box-shadow: 0 0 7px var(--event-color,var(--accent)); }
    .event-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .event-empty { padding: 20px 10px; color: var(--muted); text-align: center; font-size: 10px; }
    .brand-library { position: absolute; width: 0; height: 0; overflow: hidden; }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .22; background-image: linear-gradient(rgba(124,151,191,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(124,151,191,.045) 1px, transparent 1px); background-size: 36px 36px; mask-image: linear-gradient(to bottom, black, transparent 72%); }
    header { border-bottom-color: rgba(75,101,142,.42); box-shadow: 0 12px 40px rgba(0,0,0,.18); }
    .brand-lockup { display: flex; align-items: center; gap: 13px; min-width: 0; }
    .brand-avatar { width: 43px; height: 43px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid rgba(105,183,255,.38); border-radius: 14px; color: #f6f9ff; background: linear-gradient(145deg, rgba(46,91,158,.82), rgba(91,61,154,.68)); box-shadow: 0 10px 25px rgba(27,70,129,.28), inset 0 1px rgba(255,255,255,.16); }
    .brand-avatar svg { width: 24px; height: 24px; }
    .eyebrow { color: var(--cyan); font-size: 9px; font-weight: 760; letter-spacing: .16em; text-transform: uppercase; }
    .panel-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .panel-title-icon { width: 30px; height: 30px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid rgba(105,183,255,.25); border-radius: 9px; color: #dceaff; background: rgba(105,183,255,.09); }
    .panel-title-icon.copilot { color: #f0eaff; border-color: rgba(169,140,255,.32); background: rgba(169,140,255,.1); }
    .panel-title-icon svg { width: 17px; height: 17px; }
    .notice { position: relative; overflow: hidden; background: linear-gradient(90deg, rgba(19,32,54,.9), rgba(11,20,36,.72)); }
    .notice::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 2px; background: linear-gradient(var(--cyan), var(--accent)); }
    .panel { border-color: rgba(54,77,113,.76); background: linear-gradient(145deg, rgba(19,31,53,.96), rgba(7,13,25,.985)); box-shadow: 0 18px 54px rgba(0,0,0,.22), inset 0 1px rgba(255,255,255,.035); }
    .kpi { min-height: 112px; border-color: rgba(54,77,113,.72); }
    .kpi-main { grid-template-columns: minmax(0,1fr) 88px; }
    svg.kpi-sparkline { width: 88px; }
    .architecture-body { padding: 14px; }
    .network-stage { position: relative; background: radial-gradient(circle at 57% 42%, rgba(84,224,209,.1), transparent 16rem), radial-gradient(circle at 86% 24%, rgba(169,140,255,.08), transparent 12rem), linear-gradient(180deg, rgba(5,10,19,.98), rgba(7,14,27,.94)); }
    .traffic-map { height: 300px; }
    .route-line { stroke-width: 1.6; opacity: .38; }
    .route-line.main { opacity: .52; }
    .network-node .node-shell { fill: rgba(11,20,37,.96); stroke: #526985; filter: drop-shadow(0 12px 18px rgba(0,0,0,.24)); }
    .network-node .node-brand { fill: currentColor; stroke: none; }
    .network-node[data-node="copilot"] { color: #c7b7ff; }
    .network-node[data-node="model"] { color: #8de5d5; }
    .network-node[data-node="tools"] { color: #ffd27a; }
    .stage-chip { fill: rgba(9,18,33,.88); stroke: rgba(82,105,137,.7); }
    .stage-chip-text { fill: var(--muted); font-size: 8px; font-weight: 700; letter-spacing: .08em; }
    .flow-footer { margin-top: 1px; }
    .measured-usage, .entitlement { overflow: hidden; }
    .usage-body, .entitlement-body { padding: 13px; }
    .usage-metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; }
    .usage-stat { min-width: 0; padding: 9px; border: 1px solid rgba(55,79,116,.78); border-radius: 10px; background: radial-gradient(circle at 100% 0, color-mix(in srgb, var(--usage-color,var(--accent)) 14%, transparent), transparent 6rem), rgba(6,12,23,.62); }
    .usage-stat-top { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 8px; line-height: 1.25; }
    .usage-stat-icon { width: 20px; height: 20px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 7px; color: var(--usage-color,var(--accent)); background: color-mix(in srgb, var(--usage-color,var(--accent)) 12%, transparent); }
    .usage-stat strong { display: block; margin-top: 7px; font-size: 19px; line-height: 1; letter-spacing: -.045em; overflow-wrap: anywhere; }
    .usage-stat small { display: block; margin-top: 4px; color: var(--muted); font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .benchmark-stat strong { color: var(--cyan); }
    .benchmark-footnote { margin-top: 9px; }
    .metering-line { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 9px; align-items: center; margin: 10px 1px 11px; }
    .metering-copy { color: var(--muted); font-size: 9px; }
    .metrics-freshness { color: var(--muted); font-size: 8px; margin-top: 4px; }
    .telemetry-live { display: inline-flex; align-items: center; gap: 5px; color: var(--good); font-size: 8px; white-space: nowrap; }
    .telemetry-live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
    .coverage-track { margin: 6px 0 0; }
    .coverage-value { color: var(--cyan); font: 700 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .model-ledger-head { display: flex; align-items: end; justify-content: space-between; gap: 9px; padding-top: 10px; border-top: 1px solid var(--line); }
    .model-ledger-head strong { font-size: 11px; }
    details.model-breakdown summary { cursor: pointer; list-style: none; }
    details.model-breakdown summary::-webkit-details-marker { display: none; }
    .model-ledger { display: grid; grid-template-columns: 1fr; gap: 6px; margin-top: 8px; }
    .model-ledger-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items: center; min-height: 0; padding: 7px 8px; border: 1px solid rgba(46,68,101,.76); border-radius: 9px; background: rgba(5,11,21,.52); }
    .model-identity { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .model-mark { width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 8px; color: #d9fff8; background: linear-gradient(145deg, rgba(84,224,209,.18), rgba(105,183,255,.1)); }
    .model-mark svg { width: 14px; height: 14px; }
    .model-copy { min-width: 0; }
    .model-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
    .model-copy span, .model-stat span { display: block; color: var(--muted); font-size: 8px; text-transform: uppercase; letter-spacing: .07em; }
    .model-stat { min-width: 0; }
    .model-stat { text-align: right; }
    .model-stat strong { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--cyan); }
    .entitlement .metric-hero { align-items: center; }
    .entitlement .metric-hero strong { font-size: 28px; }
    .entitlement-facts { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; margin: 9px 0; }
    .entitlement-fact { padding: 8px; border: 1px solid var(--line); border-radius: 9px; background: rgba(6,12,23,.58); }
    .entitlement-fact span { display: block; color: var(--muted); font-size: 9px; }
    .entitlement-fact strong { display: block; margin-top: 3px; font-size: 13px; }
    .integrity-card { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
    details.integrity-card summary { cursor: pointer; list-style: none; }
    details.integrity-card summary::-webkit-details-marker { display: none; }
    .integrity-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
    .integrity-head strong { font-size: 11px; }
    .verified-chip { display: inline-flex; align-items: center; gap: 5px; color: var(--good); font-size: 8px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .verified-chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
    .integrity-steps { display: grid; gap: 6px; }
    .integrity-step { display: grid; grid-template-columns: 22px minmax(0,1fr); gap: 8px; align-items: center; color: var(--muted); font-size: 9px; }
    .integrity-step > span:first-child { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid rgba(105,183,255,.28); border-radius: 7px; color: var(--accent); background: rgba(105,183,255,.07); font: 700 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .integrity-step strong { color: var(--text); font-weight: 650; }
    .integrity-coverage { margin-top: 10px; padding: 8px 9px; border: 1px solid rgba(84,224,209,.18); border-radius: 9px; color: var(--muted); background: rgba(84,224,209,.045); font-size: 9px; }
    .integrity-coverage strong { color: var(--cyan); }
    .live-inspector .panel-head { min-height: 66px; }
    .inspector-grid { grid-template-columns: minmax(92px,auto) minmax(0,1fr); }
    .live-inspector { min-height: 520px; }
    .event-log { max-height: 340px; }
    .stack-chart .panel-head { padding: 12px 14px; }
    .stack-chart .chart-body { min-height: 164px; }
    .compact-chart { min-height: 0; }
    .compact-chart .chart-body { min-height: 128px; padding-top: 6px; padding-bottom: 6px; }
    .compact-chart svg { height: 116px; }
    @media (min-width: 1351px) {
      .command-grid { align-items: stretch; }
      .relay-stack, .inspection-stack { height: 100%; grid-template-rows: auto minmax(0,1fr); align-content: stretch; align-items: stretch; }
      .stack-chart { display: flex; flex-direction: column; min-height: 0; }
      .stack-chart .panel-head { flex: 0 0 auto; }
      .stack-chart .chart-body { display: flex; flex: 1; min-height: 0; }
      .stack-chart svg { flex: 1 1 auto; height: 100%; min-height: 116px; }
    }
    @media (max-width: 1350px) { .command-grid { grid-template-columns: minmax(270px,.72fr) minmax(600px,1.6fr); } .inspection-stack { grid-column: 1 / -1; grid-row: auto; grid-template-columns: repeat(2,minmax(0,1fr)); } }
    @media (min-width: 901px) and (max-width: 1350px) { .inspection-stack { align-items: stretch; } .inspection-stack .live-inspector, .inspection-stack .stack-chart { height: 400px; min-height: 400px; } .inspection-stack .event-log { max-height: 120px; } .inspection-stack .stack-chart .chart-body { min-height: 344px; } .inspection-stack .stack-chart svg { height: 330px; } }
    @media (max-width: 1150px) { .kpis { grid-template-columns: repeat(2,minmax(0,1fr)); } .kpis .kpi:last-child { grid-column: 1 / -1; } }
    @media (max-width: 900px) { .command-grid { grid-template-columns: 1fr; } .relay-stack { order: 1; grid-column: auto; grid-row: auto; } .inspection-stack { order: 2; grid-column: auto; grid-row: auto; grid-template-columns: 1fr; } .telemetry-rail { order: 3; grid-column: auto; grid-row: auto; grid-template-columns: repeat(2,minmax(0,1fr)); } .live-inspector { min-height: auto; } }
    @media (max-width: 1050px) { .workspace { grid-template-columns: 1fr; } .detail { min-height: auto; } }
    @media (max-width: 650px) { header, main { padding-left: 14px; padding-right: 14px; } .topline { align-items: flex-start; flex-direction: column; } .header-actions { width: 100%; justify-content: space-between; flex-wrap: wrap; } .section-nav { order: 3; width: 100%; overflow-x: auto; } .telemetry-rail { grid-template-columns: 1fr; } .chart { min-height: 208px; } .compact-chart { min-height: 0; } .architecture-body { padding: 12px; } .brand-avatar { width: 38px; height: 38px; } }
    @media (max-width: 430px) { .kpis { grid-template-columns: 1fr; } .kpis .kpi:last-child { grid-column: auto; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; } }
  </style>
</head>
<body>
  <svg class="brand-library" aria-hidden="true">
    <symbol id="brand-github-copilot" viewBox="0 0 24 24"><path fill="currentColor" d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"/></symbol>
    <symbol id="brand-openai" viewBox="0 0 2406 2406"><path id="openai-arm" fill="currentColor" d="M1107.3 299.1c-197.999 0-373.9 127.3-435.2 315.3L650 743.5v427.9c0 21.4 11 40.4 29.4 51.4l344.5 198.515V833.3h.1v-27.9L1372.7 604c33.715-19.52 70.44-32.857 108.47-39.828L1447.6 450.3C1361 353.5 1237.1 298.5 1107.3 299.1zm0 117.5-.6.6c79.699 0 156.3 27.5 217.6 78.4-2.5 1.2-7.4 4.3-11 6.1L952.8 709.3c-18.4 10.4-29.4 30-29.4 51.4V1248l-155.1-89.4V755.8c-.1-187.099 151.601-338.9 339-339.2z"/><use href="#openai-arm" transform="rotate(60 1203 1203)"/><use href="#openai-arm" transform="rotate(120 1203 1203)"/><use href="#openai-arm" transform="rotate(180 1203 1203)"/><use href="#openai-arm" transform="rotate(240 1203 1203)"/><use href="#openai-arm" transform="rotate(300 1203 1203)"/></symbol>
  </svg>
  <header>
    <div class="topline">
      <div class="brand-lockup">
        <span class="brand-avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#brand-github-copilot"></use></svg></span>
        <div>
          <div class="eyebrow">GitHub Copilot SDK · local relay</div>
          <h1>Relay Control Room</h1>
          <p class="subtitle">Measured usage, entitlement, and live request signals · dependency-free</p>
          <p class="byline">Created by <a href="https://www.linkedin.com/in/madhavsomani" target="_blank" rel="noopener noreferrer" aria-label="Madhav Somani on LinkedIn">Madhav Somani</a><span aria-hidden="true">↗</span></p>
        </div>
      </div>
      <div class="header-actions"><nav class="section-nav" aria-label="Dashboard sections"><a href="#overview">Overview</a><a href="#relay-architecture">Relay</a><a href="#analytics">Analytics</a><a href="#history">Requests</a></nav><span class="version-badge">Relay <strong id="relay-version">—</strong></span><span class="live-badge" id="live-badge"><span class="dot"></span><span id="live-status">connecting live feed</span></span><button id="clear">Clear detailed history</button></div>
    </div>
  </header>
  <main>
    <div class="notice" id="overview"><span class="pill"><span class="dot"></span> loopback only</span><span class="pill">provider: <strong>github-copilot-sdk</strong></span><span class="pill">compatibility: long context · Codex tools/memory preserved</span><span class="pill">context: bounded, salience-aware compaction</span><span class="pill">history: <strong id="limit">1,000</strong> entries · <strong id="detail-limit">200 detailed</strong></span><span class="pill">auto-refresh: <strong>5s</strong></span><span class="pill" id="updated">waiting for bridge…</span></div>
    <section class="kpis" id="observability-kpis" aria-label="Relay key performance indicators">
      <article class="kpi"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">↗</span><span>Calls handled</span></div><div class="kpi-main"><strong class="kpi-value" id="received">0</strong><svg class="kpi-sparkline" id="kpi-requests-chart" role="img" aria-label="Recent received request trend"></svg></div><div class="kpi-foot"><strong id="replayed">0</strong> Copilot replays · <span id="traffic">0 B</span></div></article>
      <article class="kpi good"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">✓</span><span>Success rate</span></div><div class="kpi-main"><strong class="kpi-value" id="success-rate">—</strong><svg class="kpi-sparkline" id="kpi-success-chart" role="img" aria-label="Recent completion-rate trend"></svg></div><div class="kpi-foot"><strong id="completed">0</strong> completed · <span id="failed">0</span> failed</div></article>
      <article class="kpi violet"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">◷</span><span>Average latency</span></div><div class="kpi-main"><strong class="kpi-value" id="latency">—</strong><svg class="kpi-sparkline" id="kpi-latency-chart" role="img" aria-label="Recent completed-call latency trend"></svg></div><div class="kpi-foot"><strong id="tools">0</strong> lifetime tool calls</div></article>
      <article class="kpi cyan storage-kpi" id="local-telemetry"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">▣</span><span>Local telemetry</span></div><div class="kpi-main"><strong class="kpi-value" id="storage-total">0 B</strong><svg class="kpi-sparkline" id="kpi-storage-chart" role="img" aria-label="Local telemetry storage utilization"></svg></div><div class="kpi-foot"><strong id="storage-utilization">0%</strong> of <span id="telemetry-cap">408 MB</span> · <span id="retained">0 retained</span></div></article>
      <article class="kpi warn"><div class="kpi-top"><span class="kpi-icon" aria-hidden="true">●</span><span>Active sessions</span></div><div class="kpi-main"><strong class="kpi-value" id="active">0</strong><svg class="kpi-sparkline" id="kpi-active-chart" role="img" aria-label="Recent resumable SDK-session trend"></svg></div><div class="kpi-foot"><strong id="streaming-active">0 streaming now</strong> · tool waits included</div></article>
    </section>
    <section class="command-grid">
      <div class="relay-stack">
      <article class="panel architecture" id="relay-architecture">
        <div class="panel-head"><div class="panel-title"><span class="panel-title-icon"><span aria-hidden="true">⌁</span></span><div><h2>Live relay fabric</h2><span class="tiny">Upright request, response, and tool glyphs move only for real relay phases</span></div></div><span class="phase" id="flow-phase">IDLE</span></div>
        <div class="architecture-body">
          <div class="network-viewport">
            <div class="network-stage">
              <svg class="traffic-map idle" id="traffic-map" viewBox="0 0 840 310" role="img" aria-labelledby="traffic-map-title traffic-map-description">
                <title id="traffic-map-title">Live concurrent Codex relay signals</title>
                <desc id="traffic-map-description">Compact upright glyphs show real outbound requests, inbound responses, and tool handoffs across the local relay, GitHub Copilot SDK, GPT models, and Codex tools.</desc>
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
                <g id="traffic-signals" aria-hidden="true"></g>
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
                  <svg class="node-brand" x="-24" y="-24" width="48" height="48" viewBox="0 0 24 24" aria-hidden="true"><use href="#brand-github-copilot"></use></svg>
                  <text class="network-label" y="56">GitHub Copilot</text><text class="network-meta" y="72">OFFICIAL SDK</text>
                </g>
                <g class="network-node" data-node="model" transform="translate(760 148)">
                  <circle class="node-shell" r="43"></circle>
                  <svg class="node-brand" x="-23" y="-23" width="46" height="46" viewBox="0 0 2406 2406" aria-hidden="true"><use href="#brand-openai"></use></svg>
                  <text class="network-label model-live" id="network-model-name" y="62">GPT model</text><text class="network-meta" y="78">REMOTE INFERENCE</text>
                </g>
                <g class="network-node" data-node="tools" transform="translate(520 232)">
                  <rect class="node-shell" x="-48" y="-34" width="96" height="68" rx="17"></rect>
                  <g class="node-glyph"><path d="M-21 -8 H-6 L0 -17 L7 -8 H21 V14 H-21 Z"></path><path d="M-12 2 H12 M-12 10 H5"></path></g>
                  <text class="network-label" y="53">Codex tools</text><text class="network-meta" y="69">OUTER APP EXECUTES</text>
                </g>
                <g transform="translate(17 18)"><rect class="traffic-counter" width="165" height="25" rx="12.5"></rect><rect x="10" y="8" width="8" height="9" rx="2" fill="#69b7ff"></rect><text class="traffic-legend" id="traffic-count" x="24" y="16">idle · no calls in transit</text></g>
                <g transform="translate(615 14)" aria-hidden="true"><rect class="stage-chip" width="205" height="25" rx="12.5"></rect><circle cx="13" cy="12.5" r="3" fill="#54e0d1"></circle><text class="stage-chip-text" x="23" y="16">REAL EVENTS · NO SIMULATED TRAFFIC</text></g>
              </svg>
            </div>
          </div>
          <div class="flow-footer"><div class="event-copy" aria-live="polite"><strong id="live-event">Fabric ready</strong><span id="live-event-detail">The next real phase will travel as one compact data glyph.</span></div><span class="tiny" id="active-exchanges">0 exchanges</span></div>
          <div class="active-strip" id="active-calls" aria-label="Recently active relay calls"><span class="call-chip">No calls in flight</span></div>
        </div>
      </article>
      <article id="analytics" class="panel chart stack-chart compact-chart"><div class="panel-head"><h2>24-hour relay traffic</h2><div class="legend"><span class="key"><span class="swatch"></span>received</span><span class="key"><span class="swatch cyan"></span>Copilot replay</span></div></div><div class="chart-body"><svg id="hourly-chart" role="img" aria-label="Calls received and replayed to Copilot during the last 24 hours"></svg></div></article>
      </div>
      <div class="inspection-stack">
      <aside class="panel live-inspector" aria-labelledby="inspector-heading">
        <div class="panel-head"><div><h2 id="inspector-heading">Live request inspector</h2><span class="tiny">Most recent real SSE phase across every active call</span></div><span class="live-badge connected"><span class="dot"></span>live</span></div>
        <div class="inspector-body">
          <dl class="inspector-grid">
            <dt>Request ID</dt><dd id="inspector-id">waiting</dd>
            <dt>Model</dt><dd class="model" id="inspector-model">—</dd>
            <dt>Status</dt><dd id="inspector-status">idle</dd>
            <dt>Measured tokens</dt><dd id="inspector-tokens">—</dd>
            <dt>SDK model calls</dt><dd id="inspector-sdk-calls">—</dd>
            <dt>Latency</dt><dd id="inspector-latency">—</dd>
            <dt>Route</dt><dd id="inspector-route">—</dd>
            <dt>Outer tools</dt><dd id="inspector-tools">0</dd>
          </dl>
          <div class="event-log-head"><strong>Event log</strong><span>newest first · 16 max</span></div>
          <div class="event-log" id="inspector-events" aria-live="polite"><div class="event-empty">Waiting for relay traffic…</div></div>
        </div>
      </aside>
      <article class="panel chart stack-chart"><div class="panel-head"><h2>30-day outcomes</h2><div class="legend"><span class="key"><span class="swatch good"></span>completed</span><span class="key"><span class="swatch bad"></span>failed</span></div></div><div class="chart-body"><svg id="daily-chart" role="img" aria-label="Completed and failed calls during the last 30 days"></svg></div></article>
      </div>
      <aside class="telemetry-rail">
      <article class="panel measured-usage" id="model-usage">
        <div class="panel-head"><div class="panel-title"><span class="panel-title-icon"><svg viewBox="0 0 2406 2406" aria-hidden="true"><use href="#brand-openai"></use></svg></span><div><h2>Measured model usage</h2><span class="tiny">Live durable totals · Measured from SDK assistant.usage events</span></div></div><span class="telemetry-live" id="telemetry-live">connecting</span></div>
        <div class="usage-body">
          <div class="usage-metrics">
            <div class="usage-stat" style="--usage-color:var(--accent)"><div class="usage-stat-top"><span class="usage-stat-icon" aria-hidden="true">↘</span><span>Input tokens</span></div><strong id="input-tokens">0</strong></div>
            <div class="usage-stat" style="--usage-color:var(--cyan)"><div class="usage-stat-top"><span class="usage-stat-icon" aria-hidden="true">↗</span><span>Output tokens</span></div><strong id="output-tokens">0</strong></div>
            <div class="usage-stat" style="--usage-color:var(--violet)"><div class="usage-stat-top"><span class="usage-stat-icon" aria-hidden="true">✦</span><span>SDK calls</span></div><strong id="sdk-calls">0</strong></div>
            <div class="usage-stat benchmark-stat" style="--usage-color:var(--cyan)"><div class="usage-stat-top"><span class="usage-stat-icon" aria-hidden="true">$</span><span>Public API benchmark</span></div><strong id="api-cost">$0.00</strong><small>Reference only · not billed</small></div>
          </div>
          <div class="metering-line"><div><div class="metering-copy" id="cost-coverage">Waiting for usage coverage…</div><div class="metrics-freshness" id="metrics-freshness">Waiting for durable metrics…</div><div class="coverage-track" title="Share of finalized relay responses with exact SDK token telemetry"><div class="coverage-fill" id="coverage-fill"></div></div></div><span class="coverage-value" id="metering-percent">0%</span></div>
          <details class="model-breakdown"><summary class="model-ledger-head"><div><strong>By model</strong><div class="tiny">Actual assistant.usage model</div></div><span class="tiny">top 4 · expand</span></summary><div class="model-ledger" id="model-usage-list"><div class="empty">No measured model calls yet.</div></div></details>
          <p class="disclaimer benchmark-footnote"><strong>Reference only:</strong> the dollar figure applies source-dated public list prices to measured SDK tokens. It is not an OpenAI or GitHub charge. <a id="price-source" href="https://developers.openai.com/api/docs/models/gpt-5.6-sol" target="_blank" rel="noopener noreferrer">Rates dated <span id="price-source-date">—</span></a>.</p>
        </div>
      </article>
      <article class="panel entitlement">
        <div class="panel-head"><div class="panel-title"><span class="panel-title-icon copilot"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#brand-github-copilot"></use></svg></span><div><h2>Copilot entitlement</h2><span class="tiny">Authenticated live SDK quota</span></div></div><button class="button-small" id="refresh-quota">Refresh</button></div>
        <div class="entitlement-body">
          <div class="metric-hero quota"><strong id="quota-left">—</strong><span id="quota-state">waiting for SDK<br>quota snapshot</span></div>
          <progress class="quota-progress" id="quota-progress" value="0" max="100"></progress>
          <div class="entitlement-facts"><div class="entitlement-fact"><span>Premium units used</span><strong id="quota-used">—</strong></div><div class="entitlement-fact"><span>Monthly entitlement</span><strong id="quota-total">—</strong></div></div>
          <div class="quota-categories" id="quota-categories"><span class="quota-chip">Loading categories…</span></div>
          <details class="integrity-card"><summary class="integrity-head"><strong>Telemetry integrity</strong><span class="verified-chip">verified path</span></summary><div class="integrity-steps"><div class="integrity-step"><span>01</span><span><strong>Observe</strong> each SDK assistant.usage event</span></div><div class="integrity-step"><span>02</span><span><strong>Normalize</strong> tokens and discard trace identifiers</span></div><div class="integrity-step"><span>03</span><span><strong>Commit</strong> durable totals when the relay call finalizes</span></div></div><div class="integrity-coverage"><strong id="integrity-coverage">0%</strong> of finalized outcomes carry exact SDK telemetry · 1 event = 1 model call</div></details>
          <p class="disclaimer" id="quota-note">The SDK exposes entitlement and reset data, not your subscription purchase price.</p>
        </div>
      </article>
      </aside>
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
    const MAX_LIVE_SIGNALS = 48;
    const MAX_LIVE_EVENTS = 16;
    const TRAFFIC_COLORS = ["#69b7ff", "#54e0d1", "#a98cff", "#ffd27a", "#6ddd9a", "#8fd3ff"];
    const TRAFFIC_LANES = [-20, -10, 0, 10, 20];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const $ = (id) => document.getElementById(id);
    const fmt = (value) => value === null || value === undefined ? "—" : String(value);
    const number = (value) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);
    const json = (value) => value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
    const bytes = (value) => { if (!Number.isFinite(value)) return "—"; if (value < 1024) return value + " B"; if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB"; if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB"; return (value / 1024 / 1024 / 1024).toFixed(2) + " GB"; };
    const duration = (value) => Number.isFinite(value) ? (value < 1000 ? value + " ms" : value < 60000 ? (value / 1000).toFixed(1) + " s" : (value / 60000).toFixed(1) + " min") : "—";
    const time = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—"; };
    const usd = (value) => { const amount = Number(value) || 0; const digits = amount === 0 || amount >= 1 ? 2 : amount >= .01 ? 4 : 6; return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount); };
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
    function storageGauge(id, totalBytes, capacityBytes, historyBytes, logBytes) {
      const svg = $(id), total = Math.max(0, Number(totalBytes) || 0), capacity = Math.max(1, Number(capacityBytes) || 0);
      const history = Math.max(0, Number(historyBytes) || 0), logs = Math.max(0, Number(logBytes) || 0), other = Math.max(0, total - history - logs);
      const ratio = Math.min(1, total / capacity), trackX = 2, trackWidth = 84, usedWidth = trackWidth * ratio, partsTotal = Math.max(1, history + logs + other);
      svg.replaceChildren(); svg.setAttribute("viewBox", "0 0 88 35");
      const description = bytes(total) + " used of " + bytes(capacity) + "; " + bytes(history) + " history and " + bytes(logs) + " metrics and logs.";
      svg.setAttribute("aria-label", description);
      const title = svgElement("title"); title.textContent = description; svg.appendChild(title);
      svg.appendChild(svgElement("rect", { x: trackX, y: 8, width: trackWidth, height: 9, rx: 4.5, class: "storage-chart-track" }));
      let cursor = trackX;
      [[history, "storage-chart-history"], [logs, "storage-chart-logs"], [other, "storage-chart-other"]].forEach(([value, className]) => {
        const width = usedWidth * value / partsTotal;
        if (width <= 0) return;
        svg.appendChild(svgElement("rect", { x: cursor, y: 8, width, height: 9, rx: 4.5, class: className })); cursor += width;
      });
      const label = svgElement("text", { x: 86, y: 30, "text-anchor": "end", class: "storage-chart-label" });
      label.textContent = (ratio * 100).toFixed(ratio > 0 && ratio < .1 ? 1 : 0) + "% used"; svg.appendChild(label);
    }
    function renderKpis(data) {
      const summary = data.summary || {}, hourly = data.analytics?.hourly || [], daily = data.analytics?.daily || [];
      const outcomes = (Number(summary.completed) || 0) + (Number(summary.failed) || 0);
      const successRate = outcomes ? 100 * (Number(summary.completed) || 0) / outcomes : 0;
      setText("success-rate", outcomes ? successRate.toFixed(2) + "%" : "—");
      setText("active", number(data.activeExchanges || 0));
      setText("streaming-active", number(summary.active) + " streaming now");
      const recent = state.records.slice(0, 18).reverse();
      state.activeSamples.push(Number(data.activeExchanges) || 0); while (state.activeSamples.length > 18) state.activeSamples.shift();
      sparkline("kpi-requests-chart", hourly.slice(-18).map((row) => row.received), "#2d94ff");
      sparkline("kpi-success-chart", daily.slice(-18).map((row) => { const total = (Number(row.completed) || 0) + (Number(row.failed) || 0); return total ? 100 * (Number(row.completed) || 0) / total : 0; }), "#6ddd9a");
      sparkline("kpi-latency-chart", recent.map((record) => Number(record.latencyMs) || 0), "#a98cff");
      sparkline("kpi-active-chart", state.activeSamples, "#ffd27a");
    }
    function chartFrame(svg, rows, fields, colors, mode) {
      svg.replaceChildren();
      const width = Math.max(240, Math.round(svg.clientWidth || 640)), height = Math.max(168, Math.round(svg.clientHeight || 168)), left = 32, right = 8, top = 8, bottom = 24;
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
      const root = $("model-usage-list"); root.replaceChildren();
      const shown = (models || []).filter((item) => Number(item.sdkApiCalls) > 0).slice(0, 4);
      if (!shown.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No measured model calls yet."; root.appendChild(empty); return; }
      for (const item of shown) {
        const row = document.createElement("div"); row.className = "model-ledger-row";
        const identity = document.createElement("div"); identity.className = "model-identity";
        const mark = document.createElement("span"); mark.className = "model-mark";
        const icon = svgElement("svg", { viewBox: "0 0 2406 2406", "aria-hidden": "true" });
        icon.appendChild(svgElement("use", { href: "#brand-openai" })); mark.appendChild(icon);
        const copy = document.createElement("div"); copy.className = "model-copy";
        const label = document.createElement("strong"); label.textContent = item.model;
        const provider = document.createElement("span"); provider.textContent = compact(item.inputTokens) + " input · " + compact(item.outputTokens) + " output";
        copy.append(label, provider); identity.append(mark, copy); row.appendChild(identity);
        const cell = document.createElement("div"); cell.className = "model-stat";
        const caption = document.createElement("span"); caption.textContent = "SDK calls";
        const strong = document.createElement("strong"); strong.textContent = compact(item.sdkApiCalls);
        cell.append(caption, strong); row.appendChild(cell);
        root.appendChild(row);
      }
    }
    function renderPricing(data) {
      const summary = data.summary || {}, pricing = data.pricing || {};
      const coverage = Math.max(0, Math.min(100, Number(summary.meteringCoveragePercent) || 0));
      setText("api-cost", usd(summary.apiEquivalentUsd));
      setText("input-tokens", compact(summary.inputTokens));
      setText("output-tokens", compact(summary.outputTokens));
      setText("sdk-calls", number(summary.sdkApiCalls));
      setText("cost-coverage", coverage.toFixed(1) + "% exact coverage · " + number(summary.unmeteredCalls || 0) + " earlier outcomes unmetered");
      setText("metering-percent", coverage.toFixed(1) + "%");
      setText("integrity-coverage", coverage.toFixed(1) + "%");
      $("coverage-fill").style.width = coverage.toFixed(2) + "%";
      const sampledAt = new Date(data.sampledAt || Date.now());
      setText("telemetry-live", "live · " + sampledAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setText("metrics-freshness", data.metricsUpdatedAt ? "Durable through " + time(data.metricsUpdatedAt) : "Durable metrics are initializing");
      setText("price-source-date", pricing.sourceDate || "—");
      const priced = (pricing.models || []).filter((model) => !model.unavailable);
      if (priced[0]?.sourceUrl) $("price-source").href = priced[0].sourceUrl;
    }
    function renderQuota(data) {
      const quota = data.copilot?.quota || {}, snapshots = quota.snapshots || {};
      const premium = snapshots.premium_interactions;
      if (premium) {
        const remaining = Math.max(0, Math.min(100, Number(premium.remainingPercentage) || 0));
        setText("quota-left", premium.isUnlimitedEntitlement ? "Unlimited" : remaining.toFixed(1) + "% left");
        setText("quota-used", compact(premium.usedRequests));
        setText("quota-total", premium.isUnlimitedEntitlement ? "Unlimited" : compact(premium.entitlementRequests));
        $("quota-progress").value = premium.isUnlimitedEntitlement ? 100 : remaining;
        setText("quota-state", quota.status + " · resets " + time(premium.resetDate));
        $("quota-note").textContent = "GitHub's SDK reports these entitlement units. Purchase price and actual overage charges are not exposed here.";
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
      setText("traffic-count", calls.length ? number(calls.length) + (calls.length === 1 ? " call in transit" : " calls in transit") : "idle · no calls in transit");
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
      setText("inspector-sdk-calls", Number.isFinite(Number(usage.sdkApiCalls)) ? number(Number(usage.sdkApiCalls)) : "pending");
      setText("inspector-latency", duration(record.latencyMs));
      setText("inspector-route", (record.requestPath || "/v1/responses") + " · Codex → Relay → Copilot → Model");
      setText("inspector-tools", number(record.toolCalls || 0));
      $("inspector-status").className = status === "failed" ? "live-bad" : status === "completed" ? "live-good" : "";
    }
    function launchTransitGlyph(pathId, call, options = {}) {
      if (reducedMotion.matches) return;
      const layer = $("traffic-signals");
      if (!layer) return;
      while (layer.childElementCount >= MAX_LIVE_SIGNALS) layer.firstElementChild.remove();
      const reverse = Boolean(options.reverse);
      const kind = String(options.kind || "request");
      const seconds = Math.max(1.1, Number(options.seconds) || 1.9);
      const signal = svgElement("g", { class: "traffic-signal " + kind + (reverse ? " reverse" : ""), "data-call": String(call.id).slice(-32), "data-kind": kind });
      signal.style.color = options.color || call.color;
      signal.style.setProperty("--signal-duration", seconds + "s");
      const carrier = svgElement("g", { class: "transit-carrier", transform: "translate(0 " + call.lane + ")" });
      carrier.appendChild(svgElement("path", { class: "transit-tail", d: reverse ? "M15 0 H34" : "M-34 0 H-15" }));
      carrier.appendChild(svgElement("rect", { class: "transit-shell", x: -14, y: -9, width: 28, height: 18, rx: 5 }));
      if (kind === "request") {
        carrier.appendChild(svgElement("path", { class: "transit-copy-lines", d: "M-8 -4 H7 M-8 0 H4 M-8 4 H1" }));
      } else if (kind === "response") {
        const lines = svgElement("g", { class: "transit-stream-lines" });
        lines.appendChild(svgElement("path", { d: "M-8 -4 H7" }));
        lines.appendChild(svgElement("path", { d: "M-5 0 H9" }));
        lines.appendChild(svgElement("path", { d: "M-8 4 H3" }));
        carrier.appendChild(lines);
      } else if (kind === "error") {
        carrier.appendChild(svgElement("path", { class: "transit-error-mark", d: "M-5 -5 L5 5 M5 -5 L-5 5" }));
      } else {
        carrier.appendChild(svgElement("path", { class: "transit-tool-mark", d: "M-7 -5 L-11 0 L-7 5 M7 -5 L11 0 L7 5 M2 -7 L-2 7" }));
      }
      signal.appendChild(carrier);
      const motion = svgElement("animateMotion", { dur: seconds + "s", begin: "indefinite", fill: "freeze", rotate: "0", calcMode: "spline", keyTimes: "0;1", keySplines: ".2 .75 .2 1", keyPoints: reverse ? "1;0" : "0;1" });
      motion.appendChild(svgElement("mpath", { href: "#" + pathId }));
      signal.appendChild(motion);
      layer.appendChild(signal);
      if (typeof motion.beginElement === "function") motion.beginElement();
      setTimeout(() => signal.remove(), seconds * 1000 + 180);
    }
    function launchTrafficForEvent(event, call) {
      if (event.type === "relay.forwarded") launchTransitGlyph("route-main-journey", call, { kind: "request" });
      if (event.type === "relay.tool_requested") launchTransitGlyph("route-tool-journey", call, { kind: "tool", reverse: true, color: "#ffd27a" });
      if (event.type === "relay.tool_resolved") launchTransitGlyph("route-tool-journey", call, { kind: "tool", color: "#ffd27a" });
      if (event.type === "relay.completed") launchTransitGlyph("route-main-journey", call, { kind: "response", reverse: true, color: "#54e0d1" });
      if (event.type === "relay.failed") launchTransitGlyph("route-main-journey", call, { kind: "error", reverse: true, color: "#ff8398" });
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
      setText("network-model-name", model);
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
      setText("network-model-name", state.latestInspectorRecord?.selectedModel || state.latestInspectorRecord?.requestedModel || data.defaultModel || "GPT model");
      setText("received", number(summary.received)); setText("replayed", number(summary.replayed)); setText("completed", number(summary.completed)); setText("failed", number(summary.failed)); setText("tools", number(summary.toolCalls)); setText("latency", duration(summary.avgLatencyMs)); setText("traffic", bytes((summary.inputBytes || 0) + (summary.outputBytes || 0)));
      setText("limit", number(data.maxRecords || 1000)); setText("detail-limit", number(data.maxDetailedRecords || 200) + " detailed"); setText("count", number(state.records.length) + " retained records");
      const auxiliaryBytes = (storage.metricsBytes || 0) + (storage.eventLogBytes || 0) + (storage.watchdogLogBytes || 0) + (storage.processStdoutBytes || 0) + (storage.processStderrBytes || 0);
      const storageCapacity = storage.telemetryCapBytes || 0, storageRatio = storageCapacity ? Math.min(1, (storage.totalBytes || 0) / storageCapacity) : 0;
      setText("storage-total", bytes(storage.totalBytes || 0)); setText("storage-utilization", (storageRatio * 100).toFixed(storageRatio > 0 && storageRatio < .1 ? 1 : 0) + "%"); setText("telemetry-cap", bytes(storageCapacity)); setText("retained", number(summary.detailed || 0) + " detailed · " + number(summary.lightweight || 0) + " light");
      storageGauge("kpi-storage-chart", storage.totalBytes, storageCapacity, storage.historyBytes, auxiliaryBytes);
      $("local-telemetry").title = bytes(storage.historyBytes || 0) + " detailed history · " + bytes(auxiliaryBytes) + " metrics and event logs · bounded under 1 GB";
      chartFrame($("hourly-chart"), data.analytics?.hourly || [], ["received", "replayed"], ["#69b7ff", "#54e0d1"], "lines");
      chartFrame($("daily-chart"), data.analytics?.daily || [], ["completed", "failed"], ["#6ddd9a", "#ff8398"], "bars");
      renderModels(data.analytics?.models || []);
      renderPricing(data); renderQuota(data); renderKpis(data); setText("active-exchanges", number(data.activeExchanges || 0) + " resumable exchanges");
      setText("relay-version", data.relayVersion ? "v" + String(data.relayVersion).replace(/^v/i, "") : "unknown");
      setText("updated", "live data · " + time(data.sampledAt || Date.now())); $("updated").className = "pill";
    }
    function renderRows() {
      const rows = $("rows"); rows.replaceChildren(); const records = state.records.slice(0, state.visible); $("empty").style.display = records.length ? "none" : "block";
      for (const record of records) {
        const row = document.createElement("tr"); if (record.id === state.selected) row.className = "selected"; row.tabIndex = 0; row.setAttribute("role", "button"); row.onclick = () => selectRecord(record.id); row.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRecord(record.id); } };
        const measured = record.usage?.metered ? compact((record.usage.inputTokens || 0) + (record.usage.outputTokens || 0)) + " tokens\n" + number(record.usage.sdkApiCalls || 0) + " SDK calls" : "unmetered";
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
      detail.appendChild(section("Measured SDK usage and public API benchmark", record.usage || { metered: false, note: "This call predates exact SDK usage capture." }));
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
