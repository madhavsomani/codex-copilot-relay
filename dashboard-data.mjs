// Pure presentation helpers shared with the dependency-free inline dashboard.
export function callRoute(record = {}, current = {}) {
  const requested = record.requestedModel || null;
  const selected = record.selectedModel || null;
  const reported = [...new Set((record.usage?.models || []).map(row => row.model).filter(Boolean))];
  const changed = Boolean(requested && selected && requested !== selected);
  const historical = Number.isFinite(Date.parse(record.receivedAt)) && Number.isFinite(Date.parse(current.startedAt))
    && Date.parse(record.receivedAt) < Date.parse(current.startedAt);
  let note = selected ? (requested ? 'Requested model honored' : 'Installation default selected') : 'Awaiting backend selection';
  if (changed) note = record.continuedFrom ? 'Continued existing SDK exchange'
    : record.routingMode === 'locked-default' ? 'Forced default routing'
    : 'Routed to a different model';
  if (historical) note += ' · earlier relay run';
  return {requested, selected, reported, changed, historical, note};
}

export function sdkCredits(usage) {
  if (!usage || !Number.isFinite(usage.totalNanoAiu) || usage.totalNanoAiu < 0) return null;
  if (!(usage.creditMeteredApiCalls > 0) && !(usage.totalNanoAiu > 0)) return null;
  return usage.totalNanoAiu / 1_000_000_000;
}

export function nativeImageStatus(native) {
  if (!native || typeof native.imageEnabled !== 'boolean') return 'Image status unavailable';
  return (native.imageEnabled ? 'Images enabled' : 'Images disabled') + ' · native search removed';
}
