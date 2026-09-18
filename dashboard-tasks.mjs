import {checkpointPolicy, checkpointState} from './efficiency-policy.mjs';

export const TASKS_STYLE = String.raw`
  .task-costs { margin-bottom:18px; padding:16px; min-width:0; scroll-margin-top:145px; }
  .task-costs table { min-width:740px; width:100%; }
  .task-costs .table-wrap { max-width:100%; overflow-x:auto; }
  .task-costs td:first-child, .task-costs th:first-child { min-width:260px; width:260px; white-space:normal; overflow-wrap:anywhere; }
  .task-costs td:last-child { min-width:210px; max-width:310px; white-space:normal; }
  .task-costs .trend-note { overflow-wrap:anywhere; }
  @media (max-width:650px) { .task-costs { scroll-margin-top:340px; } }
`;
export const TASKS_HTML = String.raw`
  <section class="panel task-costs" id="task-costs" aria-labelledby="task-costs-heading">
    <div class="trend-toolbar"><div><h2 id="task-costs-heading">Per-task cost checkpoints</h2><p id="task-budget-policy">Advisory checkpoints, not spending caps</p></div><label class="trend-range">Pacific day <select id="task-cost-day" aria-label="Task cost Pacific day"></select></label></div>
    <p class="trend-note" id="task-cost-coverage"></p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Task cost ledger"><table><thead><tr><th>Task ID</th><th>Responses</th><th>Model steps</th><th>Total tokens</th><th>SDK AI credits</th><th>Checkpoint status</th></tr></thead><tbody id="task-cost-rows"></tbody></table></div>
    <p class="trend-note">One model step is one SDK inference, not one tool or user message. Input + output includes cached input once. Historical unassigned costs are not silently attributed. No hard cap or automatic cancellation.</p>
  </section>
`;
export const TASKS_SCRIPT = String.raw`
  const checkpointPolicy = ${checkpointPolicy.toString()};
  const checkpointState = ${checkpointState.toString()};
  let taskCostData = null, taskCostSelectedDay = null;
  function renderTaskCosts(data = taskCostData) {
    if (!data) return;
    taskCostData = data;
    const analytics = data.analytics || {}, policy = data.efficiencyPolicy || checkpointPolicy();
    const days = (analytics.pacificDaily || []).map(row => row.bucket).reverse();
    if (!days.includes(taskCostSelectedDay)) taskCostSelectedDay = days[0] || null;
    const selector = $('task-cost-day');
    if (JSON.stringify([...selector.options].map(option => option.value)) !== JSON.stringify(days)) {
      selector.replaceChildren();
      for (const day of days) { const option = document.createElement('option'); option.value = day; option.textContent = day; selector.appendChild(option); }
    }
    selector.value = taskCostSelectedDay || '';
    $('task-budget-policy').textContent = 'Advisory: every ' + policy.steps + ' model steps or ' + policy.aiCredits + ' SDK AI credits per task/day. Creative batches: up to 3 passes unless explicitly extended.';
    $('task-cost-coverage').textContent = 'Task attribution starts ' + (analytics.taskMeteringStartedAt ? new Date(analytics.taskMeteringStartedAt).toLocaleString(undefined,{timeZone:'America/Los_Angeles'}) + ' Pacific. Earlier days may be incomplete.' : 'with this release; older history has no reliable task attribution.');
    const rows = (analytics.taskDaily || []).filter(row => row.day === taskCostSelectedDay).sort((left,right) => (right.totalNanoAiu || 0) - (left.totalNanoAiu || 0));
    const target = $('task-cost-rows'); target.replaceChildren();
    for (const row of rows) {
      const state = checkpointState(row, policy), tr = document.createElement('tr');
      const incomplete = state.partial ? ' · partial' : '';
      const values = [row.taskId === 'unattributed' ? 'Unattributed (no validated task ID)' : row.taskId,
        number((row.completed || 0) + (row.failed || 0)), row.meteredCalls > 0 ? number(state.steps) + (row.unmeteredCalls > 0 ? ' · partial' : '') : 'not reported',
        row.meteredCalls > 0 ? number((row.inputTokens || 0) + (row.outputTokens || 0)) + (row.unmeteredCalls > 0 ? ' · partial' : '') : 'not reported',
        state.aiCredits === null ? 'not reported' : new Intl.NumberFormat(undefined,{maximumFractionDigits:9}).format(state.aiCredits) + incomplete,
        state.stepCheckpoint || state.creditCheckpoint ? 'Checkpoint reached · next at ' + (state.stepCheckpoint + 1) * policy.steps + ' steps / ' + (state.creditCheckpoint + 1) * policy.aiCredits + ' credits' : 'Below first checkpoint'];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }
      target.appendChild(tr);
    }
    if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 6; td.textContent = 'No attributed finalized responses for this day. This does not mean zero historical usage.'; tr.appendChild(td); target.appendChild(tr); }
  }
  $('task-cost-day').addEventListener('change', event => { taskCostSelectedDay = event.target.value; renderTaskCosts(); });
`;
