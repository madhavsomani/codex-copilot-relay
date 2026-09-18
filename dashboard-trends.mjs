import {usageTrendData} from './dashboard-data.mjs';

export const TRENDS_STYLE = String.raw`
    .usage-trends { margin-bottom: 18px; scroll-margin-top: 145px; }
    .trend-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
    .trend-toolbar p, .trend-note { color: var(--muted); font-size: 12px; }
    .trend-toolbar h2 { font-size: 18px; }
    .trend-range { display: flex; align-items: center; gap: 9px; font-size: 12px; }
    .trend-range select { font: inherit; color: var(--text); background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 8px; max-width: 100%; }
    .trend-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
    .trend-card { min-width: 0; padding: 16px; }
    .trend-card h3 { font-size: 14px; }
    .trend-total { display: block; color: var(--accent); font-size: 28px; line-height: 1.3; font-weight: 750; margin-top: 7px; overflow-wrap: anywhere; }
    .trend-card:last-child .trend-total { color: var(--cyan); }
    .trend-plot { height: 214px; margin: 12px 0 4px; overflow: hidden; }
    .trend-plot .axis-label { font-size: 12px; }
    .trend-hit { fill: transparent; cursor: pointer; outline: none; }
    .trend-hit:hover, .trend-hit:focus { fill: rgba(238,245,255,.08); stroke: var(--text); stroke-width: 1; }
    .trend-selection { stroke: var(--text); stroke-width: 1; stroke-dasharray: 3 4; opacity: .65; }
    .trend-detail { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 12px 0 0; font-size: 12px; color: var(--muted); min-height: 52px; }
    .trend-detail strong { color: var(--text); }
    .trend-note { margin-top: 8px; }
    @media (max-width: 850px) { .trend-grid { grid-template-columns: minmax(0,1fr); } }
    @media (max-width: 650px) { .usage-trends { scroll-margin-top: 340px; } .trend-card { padding: 12px; } }
`;

export const TRENDS_HTML = String.raw`
    <section class="usage-trends" id="usage-trends" aria-labelledby="usage-trends-heading">
      <div class="trend-toolbar">
        <div><h2 id="usage-trends-heading">Tokens &amp; Copilot cost over time</h2><p id="trend-period">Finalized relay responses · Pacific buckets · current bucket is partial</p></div>
        <label class="trend-range" for="usage-timezone">Timezone <select id="usage-timezone"><option value="America/Los_Angeles" selected>Pacific · Los Angeles</option><option value="UTC">UTC</option></select></label>
        <label class="trend-range" for="usage-range">Time range <select id="usage-range" aria-label="Time range"><option value="24h">24 hours · hourly</option><option value="5d" selected>5 days · daily</option><option value="30d">30 days · daily</option></select></label>
      </div>
      <div class="trend-grid">
        <article class="panel trend-card" aria-labelledby="token-trend-heading">
          <h3 id="token-trend-heading">Token usage</h3><strong class="trend-total" id="trend-token-total">—</strong><p class="trend-note" id="trend-token-summary">Reported tokens in selected range</p>
          <svg class="trend-plot" id="token-usage-chart" role="group" aria-label="Token usage over time" aria-describedby="trend-token-note trend-detail"></svg>
          <p class="trend-note" id="trend-token-note">Input + output; cached input is included, not added again.</p>
        </article>
        <article class="panel trend-card" aria-labelledby="credit-trend-heading">
          <h3 id="credit-trend-heading">Copilot cost · AI credits</h3><strong class="trend-total" id="trend-credit-total">—</strong><p class="trend-note" id="trend-credit-summary">SDK-reported credits in selected range</p>
          <svg class="trend-plot" id="credit-usage-chart" role="group" aria-label="Copilot SDK AI credits over time" aria-describedby="trend-credit-note trend-detail"></svg>
          <p class="trend-note" id="trend-credit-note">SDK nano-AIU ÷ 1,000,000,000. Not dollars or account balance.</p>
        </article>
      </div>
      <div class="trend-detail" id="trend-detail" aria-live="polite">Hover, tap, or focus a time bucket for exact values.</div>
      <p class="trend-note">Finalized calls only, grouped by completion time. Missing telemetry is a gap, not free usage. These charts exclude other Copilot clients and OpenAI providers.</p>
    </section>
`;

export const TRENDS_SCRIPT = String.raw`
    const usageTrendData = ${usageTrendData.toString()};
    let trendAnalytics = {}, trendRange = '5d', trendTimezone = 'America/Los_Angeles', trendView = null, trendSelection = null, trendSignature = null;
    const trendZoneLabel = () => trendTimezone === 'UTC' ? 'UTC' : 'Pacific';
    const trendNumber = value => value === null ? 'not reported' : new Intl.NumberFormat(undefined, {maximumFractionDigits: 9}).format(value);
    const trendDate = (bucket, hourly) => new Date(bucket).toLocaleString(undefined, {timeZone: hourly ? trendTimezone : 'UTC', month: 'short', day: 'numeric', ...(hourly ? {hour: '2-digit', hourCycle: 'h23', timeZoneName:'short'} : {})});
    function selectTrendBucket(bucket) {
      const row = trendView?.rows.find(item => item.bucket === bucket);
      if (!row) return;
      trendSelection = bucket;
      const detail = $('trend-detail'); detail.replaceChildren();
      const cells = [
        [trendDate(row.bucket, trendView.hourly) + ' ' + trendZoneLabel(), row === trendView.rows.at(-1) ? 'current bucket · partial' : 'selected bucket'],
        ['Tokens', trendNumber(row.totalTokens) + (row.tokenPartial ? ' · partial' : '')],
        ['Input / output', trendNumber(row.inputTokens) + ' / ' + trendNumber(row.outputTokens)],
        ['Cached input', trendNumber(row.cacheReadTokens)],
        ['AI credits', trendNumber(row.aiCredits) + (row.creditPartial ? ' · partial' : '')],
      ];
      for (const [label, value] of cells) {
        const cell = document.createElement('span'), heading = document.createElement('strong');
        heading.textContent = label + ': '; cell.append(heading, document.createTextNode(value)); detail.appendChild(cell);
      }
      for (const chartId of ['token-usage-chart', 'credit-usage-chart']) {
        const chart = $(chartId), marker = chart.querySelector('.trend-selection');
        const hit = [...chart.querySelectorAll('[data-bucket]')].find(item => item.getAttribute('data-bucket') === bucket);
        if (marker && hit) {
          const center = Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2;
          marker.setAttribute('x1', center); marker.setAttribute('x2', center); marker.setAttribute('visibility', 'visible');
        }
      }
    }
    function drawUsageTrend(chartId, field, color, unit) {
      const svg = $(chartId), rows = trendView.rows;
      svg.replaceChildren();
      const width = Math.max(220, Math.round(svg.clientWidth)), height = 214, left = 58, right = 12, top = 10, bottom = 44;
      const plotWidth = width - left - right, plotHeight = height - top - bottom;
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      const values = rows.map(row => row[field]).filter(value => value !== null);
      const maximum = Math.max(...values, 0) || 1;
      for (let tick = 0; tick <= 3; tick += 1) {
        const vertical = top + plotHeight * tick / 3;
        svg.appendChild(svgElement('line', {x1: left, x2: width - right, y1: vertical, y2: vertical, class: 'gridline'}));
        const label = svgElement('text', {x: left - 8, y: vertical + 4, 'text-anchor': 'end', class: 'axis-label'});
        const value = maximum * (3 - tick) / 3;
        label.textContent = value > 0 && value < .01 ? value.toExponential(1) : compact(value);
        svg.appendChild(label);
      }
      const step = plotWidth / Math.max(1, rows.length);
      rows.forEach((row, index) => {
        const value = row[field], center = left + step * (index + .5);
        if (value !== null) {
          const barHeight = plotHeight * value / maximum;
          const mark = value === 0
            ? svgElement('line', {x1: center - step * .3, x2: center + step * .3, y1: top + plotHeight, y2: top + plotHeight, stroke: color, 'stroke-width': 2})
            : svgElement('rect', {x: center - step * .32, y: top + plotHeight - barHeight, width: step * .64, height: barHeight, fill: color});
          mark.setAttribute('data-value', value); svg.appendChild(mark);
        }
      });
      svg.appendChild(svgElement('line', {x1: left, x2: left, y1: top, y2: top + plotHeight, class: 'trend-selection', visibility: 'hidden', 'pointer-events': 'none'}));
      rows.forEach((row, index) => {
        const hit = svgElement('rect', {x: left + step * index, y: top, width: step, height: plotHeight + 2, class: 'trend-hit', tabindex: 0, role: 'button', 'data-bucket': row.bucket,
          'aria-label': trendDate(row.bucket, trendView.hourly) + ' ' + trendZoneLabel() + ': ' + trendNumber(row[field]) + ' ' + unit + ((field === 'aiCredits' ? row.creditPartial : row.tokenPartial) ? ', partial telemetry' : '')});
        for (const event of ['pointerenter', 'focus', 'click']) hit.addEventListener(event, () => selectTrendBucket(row.bucket));
        hit.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectTrendBucket(row.bucket); }
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault(); const next = index + (event.key === 'ArrowRight' ? 1 : -1);
            svg.querySelectorAll('.trend-hit')[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
          }
        });
        svg.appendChild(hit);
      });
      const tickCount = Math.min(rows.length, Math.max(2, Math.floor(plotWidth / (trendView.hourly ? 120 : 85))));
      const indices = new Set(Array.from({length: tickCount}, (_, index) => Math.round(index * (rows.length - 1) / Math.max(1, tickCount - 1))));
      for (const index of indices) {
        const label = svgElement('text', {x: left + step * (index + .5), y: height - 17, 'text-anchor': index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle', class: 'axis-label'});
        label.textContent = trendDate(rows[index].bucket, trendView.hourly); svg.appendChild(label);
      }
      if (!values.length) {
        const label = svgElement('text', {x: left + plotWidth / 2, y: top + plotHeight / 2, 'text-anchor': 'middle', class: 'axis-label'});
        label.textContent = 'No reported ' + unit; svg.appendChild(label);
      }
    }
    function renderUsageTrends(analytics = trendAnalytics, force = false) {
      trendAnalytics = analytics;
      const signature = JSON.stringify([trendRange, trendTimezone, analytics.hourly, analytics.daily, analytics.pacificDaily, $('token-usage-chart').clientWidth]);
      if (!force && signature === trendSignature) return;
      trendSignature = signature; trendView = usageTrendData(analytics, trendRange, trendTimezone);
      const active = document.activeElement;
      const focused = active?.classList.contains('trend-hit') ? {id: active.parentElement.id, bucket: active.getAttribute('data-bucket')} : null;
      $('trend-token-total').textContent = trendView.totalTokens === null ? 'Not reported' : compact(trendView.totalTokens) + ' tokens';
      $('trend-credit-total').textContent = trendView.aiCredits === null ? 'Not reported' : compact(trendView.aiCredits) + ' AI credits';
      $('trend-token-total').title = trendNumber(trendView.totalTokens);
      $('trend-credit-total').title = trendNumber(trendView.aiCredits);
      $('trend-token-summary').textContent = (trendView.tokenPartial ? 'Partial reported subtotal' : 'Selected-range total') + ' · ' + number(trendView.meteredCalls) + ' / ' + number(trendView.finalizedCalls) + ' outcomes metered';
      $('trend-credit-summary').textContent = (trendView.creditPartial ? 'Partial reported subtotal' : 'Selected-range total') + ' · ' + (trendView.sdkApiCalls === null || trendView.creditMeteredApiCalls === null ? 'credit coverage unavailable' : number(trendView.creditMeteredApiCalls) + ' / ' + number(trendView.sdkApiCalls) + ' model steps report credits');
      const rows = trendView.rows;
      $('trend-period').textContent = rows.length ? trendDate(rows[0].bucket, trendView.hourly) + ' – ' + trendDate(rows.at(-1).bucket, trendView.hourly) + ' ' + trendZoneLabel() + ' · ' + (trendView.hourly ? 'hourly' : 'daily') + ' totals · current bucket is partial' : 'No retained telemetry for this range';
      drawUsageTrend('token-usage-chart', 'totalTokens', '#69b7ff', 'tokens');
      drawUsageTrend('credit-usage-chart', 'aiCredits', '#54e0d1', 'AI credits');
      if (rows.length) selectTrendBucket(rows.some(row => row.bucket === trendSelection) ? trendSelection : rows.at(-1).bucket);
      else $('trend-detail').textContent = 'No retained telemetry for this range.';
      if (focused) [...$(focused.id).querySelectorAll('.trend-hit')].find(hit => hit.getAttribute('data-bucket') === focused.bucket)?.focus({preventScroll: true});
    }
    $('usage-range').addEventListener('change', event => { trendRange = event.target.value; trendSelection = null; renderUsageTrends(); });
    $('usage-timezone').addEventListener('change', event => { trendTimezone = event.target.value; trendSelection = null; renderUsageTrends(); });
    let trendResizeTimer;
    window.addEventListener('resize', () => { clearTimeout(trendResizeTimer); trendResizeTimer = setTimeout(() => renderUsageTrends(), 100); });
`;
