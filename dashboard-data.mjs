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

export function callTokenUsage(usage) {
  const count = field => usage?.metered === true && Number.isFinite(usage[field]) && usage[field] >= 0 ? usage[field] : null;
  const inputTokens = count('inputTokens'), outputTokens = count('outputTokens'), cachedInputTokens = count('cacheReadTokens');
  return {
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    inputTokens, outputTokens, cachedInputTokens,
    nonCachedInputTokens: inputTokens !== null && cachedInputTokens !== null && cachedInputTokens <= inputTokens ? inputTokens - cachedInputTokens : null,
    sdkApiCalls: count('sdkApiCalls'),
  };
}

export function nativeImageStatus(native) {
  if (!native || typeof native.imageEnabled !== 'boolean') return 'Image status unavailable';
  return (native.imageEnabled ? 'Images enabled' : 'Images disabled') + ' · native search removed';
}

export function usageTrendData(analytics = {}, range = '5d', timeZone = 'UTC') {
  const hourly = range === '24h';
  const count = hourly ? 24 : range === '30d' ? 30 : 5;
  const source = hourly ? analytics.hourly : timeZone === 'America/Los_Angeles' ? analytics.pacificDaily : analytics.daily;
  const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const rows = (Array.isArray(source) ? source : []).slice(-count).map(row => {
    const finalizedCalls = nonnegative(row.completed) + nonnegative(row.failed);
    const meteredCalls = nonnegative(row.meteredCalls);
    const sdkApiCalls = Number.isFinite(row.sdkApiCalls) ? nonnegative(row.sdkApiCalls) : null;
    const creditMeteredApiCalls = Number.isFinite(row.creditMeteredApiCalls) ? nonnegative(row.creditMeteredApiCalls) : null;
    const available = row.telemetryAvailable !== false;
    const idle = available && finalizedCalls === 0 && meteredCalls === 0 && sdkApiCalls === 0;
    const tokenReported = available && (idle || meteredCalls > 0);
    const aiCredits = available ? (idle ? 0 : sdkCredits(row)) : null;
    return {
      bucket: row.bucket,
      totalTokens: tokenReported ? nonnegative(row.inputTokens) + nonnegative(row.outputTokens) : null,
      inputTokens: tokenReported ? nonnegative(row.inputTokens) : null,
      outputTokens: tokenReported ? nonnegative(row.outputTokens) : null,
      cacheReadTokens: tokenReported ? nonnegative(row.cacheReadTokens) : null,
      aiCredits,
      totalNanoAiu: aiCredits === null ? null : nonnegative(row.totalNanoAiu),
      finalizedCalls, meteredCalls, sdkApiCalls, creditMeteredApiCalls,
      tokenPartial: row.telemetryPartial === true || (tokenReported && meteredCalls < finalizedCalls),
      creditPartial: row.telemetryPartial === true || (aiCredits !== null && !idle && (sdkApiCalls === null || creditMeteredApiCalls === null
        || creditMeteredApiCalls < sdkApiCalls || meteredCalls < finalizedCalls)),
    };
  });
  const sum = field => rows.reduce((total, row) => total + nonnegative(row[field]), 0);
  const tokenRows = rows.filter(row => row.totalTokens !== null);
  const creditRows = rows.filter(row => row.aiCredits !== null);
  return {
    rows, hourly,
    totalTokens: tokenRows.length ? sum('totalTokens') : null,
    aiCredits: creditRows.length ? sum('totalNanoAiu') / 1_000_000_000 : null,
    finalizedCalls: sum('finalizedCalls'), meteredCalls: sum('meteredCalls'),
    sdkApiCalls: rows.every(row => row.sdkApiCalls !== null) ? sum('sdkApiCalls') : null,
    creditMeteredApiCalls: rows.every(row => row.creditMeteredApiCalls !== null) ? sum('creditMeteredApiCalls') : null,
    tokenPartial: tokenRows.length < rows.length || rows.some(row => row.tokenPartial),
    creditPartial: creditRows.length < rows.length || rows.some(row => row.creditPartial),
  };
}
