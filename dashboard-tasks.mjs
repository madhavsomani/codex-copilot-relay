import {checkpointPolicy, checkpointState} from './efficiency-policy.mjs';

export const TASKS_STYLE = String.raw`
  .task-costs { margin-bottom:18px; padding:16px; min-width:0; scroll-margin-top:145px; }
  .task-costs table { min-width:900px; width:100%; }
  .task-costs .table-wrap { max-width:100%; overflow-x:auto; }
  .task-costs td:first-child, .task-costs th:first-child { min-width:260px; width:260px; white-space:normal; overflow-wrap:anywhere; }
  .task-costs td:last-child { min-width:210px; max-width:310px; white-space:normal; }
  .task-costs td:nth-child(7) { min-width:180px; white-space:normal; font-size:12px; }
  .task-costs .task-filters { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .task-costs input[type=search] { min-width:180px; }
  .task-costs .trend-note { overflow-wrap:anywhere; }
  @media (max-width:650px) { .task-costs { scroll-margin-top:340px; } }
`;
export const TASKS_HTML = String.raw`
  <section class="panel task-costs" id="task-costs" aria-labelledby="task-costs-heading">
    <div class="trend-toolbar"><div><h2 id="task-costs-heading">Per-task cost checkpoints</h2><p id="task-budget-policy">Advisory checkpoints, not spending caps</p></div><div class="task-filters"><label class="trend-range">Search <input id="task-cost-search" type="search" placeholder="Session, client or ID" aria-label="Search sessions"></label><label class="trend-range">Period <select id="task-cost-day" aria-label="Task cost period"></select></label></div></div>
    <p class="trend-note" id="task-cost-coverage"></p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Task cost ledger"><table><thead><tr><th>Session name</th><th>Client</th><th>Responses</th><th>Model steps</th><th>Total tokens</th><th>SDK AI credits</th><th>Cost per day</th><th>Checkpoint status</th></tr></thead><tbody id="task-cost-rows"></tbody></table></div>
    <p class="trend-note">Both clients, grouped by stable session ID (hover the name). Titles come from local metadata; unknown titles are not invented. SDK credits are not dollars. One model step is one SDK inference, not one tool or user message. Cached input is included once. Historical unassigned costs are not silently attributed. No hard cap or automatic cancellation.</p>
  </section>
`;
export const TASKS_SCRIPT = String.raw`
  const checkpointPolicy = ${checkpointPolicy.toString()};
  const checkpointState = ${checkpointState.toString()};
  const TASK_ALL_DAYS = 'all';
  let taskCostData = null, taskCostSelectedDay = TASK_ALL_DAYS, taskCostQuery = '';
  // One row per client + session: totals across every retained day, plus the per-day split.
  function taskTotals(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = (row.client || 'codex') + '|' + row.taskId;
      const total = map.get(key) || {...row, day:TASK_ALL_DAYS, perDay:[], completed:0, failed:0, sdkApiCalls:0, inputTokens:0, outputTokens:0, cacheReadTokens:0, totalNanoAiu:0, creditMeteredApiCalls:0, meteredCalls:0, unmeteredCalls:0};
      for (const field of ['completed','failed','sdkApiCalls','inputTokens','outputTokens','cacheReadTokens','totalNanoAiu','creditMeteredApiCalls','meteredCalls','unmeteredCalls']) total[field] += row[field] || 0;
      total.retainedHistoryOnly = total.retainedHistoryOnly || row.retainedHistoryOnly;
      total.perDay.push({day:row.day, aiCredits:row.creditMeteredApiCalls > 0 ? (row.totalNanoAiu || 0) / 1e9 : null, steps:row.sdkApiCalls || 0});
      map.set(key, total);
    }
    for (const total of map.values()) total.perDay.sort((a,b) => b.day.localeCompare(a.day));
    return [...map.values()];
  }
  function perDayText(row) {
    const list = row.perDay || [{day:row.day, aiCredits:row.creditMeteredApiCalls > 0 ? (row.totalNanoAiu || 0) / 1e9 : null, steps:row.sdkApiCalls || 0}];
    const format = new Intl.NumberFormat(undefined,{maximumFractionDigits:1});
    return list.map(item => item.day.slice(5) + ': ' + (item.aiCredits === null ? item.steps + ' steps' : format.format(item.aiCredits))).join(' · ');
  }
  function renderTaskCosts(data = taskCostData) {
    if (!data) return;
    taskCostData = data;
    const analytics = data.analytics || {}, policy = data.efficiencyPolicy || checkpointPolicy();
    const allRows = data.taskCosts?.rows || (analytics.taskDaily || []);
    const days = [TASK_ALL_DAYS, ...[...new Set([...(analytics.pacificDaily || []).map(row => row.bucket),...allRows.map(row=>row.day)])].sort().reverse()];
    if (!days.includes(taskCostSelectedDay)) taskCostSelectedDay = TASK_ALL_DAYS;
    const selector = $('task-cost-day');
    if (JSON.stringify([...selector.options].map(option => option.value)) !== JSON.stringify(days)) {
      selector.replaceChildren();
      for (const day of days) { const option = document.createElement('option'); option.value = day; option.textContent = day === TASK_ALL_DAYS ? 'All days (session total)' : day; selector.appendChild(option); }
    }
    selector.value = taskCostSelectedDay || '';
    $('task-budget-policy').textContent = 'Advisory: every ' + policy.steps + ' model steps or ' + policy.aiCredits + ' SDK AI credits per task, counted on the session total across days. Creative batches: up to 3 passes unless explicitly extended.';
    $('task-cost-coverage').textContent = 'Codex + Claude Code · finalized responses. "All days" sums each session across every retained Pacific day (up to 31); pick a day to see one day only. Claude older rows are recovered only from retained history and labelled partial; newer daily totals survive recent-history rotation. Missing session IDs remain unattributed.';
    const query = taskCostQuery.trim().toLowerCase();
    const rows = (taskCostSelectedDay === TASK_ALL_DAYS ? taskTotals(allRows) : allRows.filter(row => row.day === taskCostSelectedDay))
      .filter(row => !query || [row.sessionName, row.clientLabel, row.taskId].some(value => String(value || '').toLowerCase().includes(query))).sort((left,right) => (right.totalNanoAiu || 0) - (left.totalNanoAiu || 0));
    const target = $('task-cost-rows'); target.replaceChildren();
    for (const row of rows) {
      const state = checkpointState(row, policy), tr = document.createElement('tr');
      const incomplete = state.partial || row.retainedHistoryOnly ? ' · partial' : '';
      const values = [row.sessionName || (row.taskId === 'unattributed' ? 'Unattributed (no validated task ID)' : row.taskId), row.clientLabel || 'Codex',
        number((row.completed || 0) + (row.failed || 0)), row.meteredCalls > 0 ? number(state.steps) + (row.unmeteredCalls > 0 ? ' · partial' : '') : 'not reported',
        row.meteredCalls > 0 ? number((row.inputTokens || 0) + (row.outputTokens || 0)) + (row.unmeteredCalls > 0 ? ' · partial' : '') : 'not reported',
        state.aiCredits === null ? 'not reported' : new Intl.NumberFormat(undefined,{maximumFractionDigits:9}).format(state.aiCredits) + incomplete, perDayText(row),
        state.stepCheckpoint || state.creditCheckpoint ? 'Checkpoint reached · next at ' + (state.stepCheckpoint + 1) * policy.steps + ' steps / ' + (state.creditCheckpoint + 1) * policy.aiCredits + ' credits' : 'Below first checkpoint'];
      for (const [index,value] of values.entries()) { const td = document.createElement('td'); td.textContent = value; if(index===0)td.title='Session ID: '+row.taskId+' · '+(row.retainedHistoryOnly?'Retained historical rows only · partial':'Durable session/day counters');tr.appendChild(td); }
      target.appendChild(tr);
    }
    if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 8; td.textContent = 'No attributed finalized responses for this period or search. This does not mean zero historical usage.'; tr.appendChild(td); target.appendChild(tr); }
  }
  $('task-cost-day').addEventListener('change', event => { taskCostSelectedDay = event.target.value; renderTaskCosts(); });
  $('task-cost-search').addEventListener('input', event => { taskCostQuery = event.target.value; renderTaskCosts(); });
`;
