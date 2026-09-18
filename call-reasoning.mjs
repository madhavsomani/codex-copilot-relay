export function callReasoning(record = {}) {
  const levels = ['none','low','medium','high','xhigh','max'];
  const valid = (value, requested = false) => typeof value === 'string'
    && [...levels, ...(requested ? ['ultra','minimal','minimal_reasoning'] : [])].includes(value.toLowerCase()) ? value.toLowerCase() : null;
  const replay = (Array.isArray(record.copilotReplays) ? record.copilotReplays : []).findLast(item =>
    !item?.truncated && ['initial','continuation'].includes(item?.phase) && valid(item?.reasoningEffort));
  const requested = valid(record.requestedReasoningEffort ?? record.input?.reasoning?.effort, true);
  const selected = valid(record.selectedReasoningEffort) ?? valid(replay?.reasoningEffort);
  const source = selected ? (['initial','continuation','retained_replay','recorded_session'].includes(record.reasoningSource)
    ? record.reasoningSource : replay ? 'retained_replay' : 'recorded_session') : null;
  const capped = record.reasoningCapped === true || replay?.modelRouting?.reasoningCapped === true;
  const changed = Boolean(requested && selected && requested !== selected);
  let note = selected ? 'Applied SDK session reasoning effort; not an intelligence score.' : 'Applied effort not recorded; never inferred from current settings or requested effort.';
  if (source === 'continuation') note += ' Continued existing SDK session; its effort is preserved.';
  if (source === 'retained_replay') note += ' Recovered from an intact historical replay.';
  if (capped) note += ' Capped to the selected model capability.';
  return {requested, selected, source, changed, capped, note};
}
