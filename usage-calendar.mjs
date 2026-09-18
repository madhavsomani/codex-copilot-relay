const pacificDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit'});

export function pacificDay(value) {
  const parts = Object.fromEntries(pacificDate.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function pacificDailySeries(hourly, now = new Date(), count = 30) {
  const today = pacificDay(now);
  const rows = new Map();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const bucket = new Date(Date.parse(today + 'T12:00:00Z') - offset * 86400000).toISOString().slice(0,10);
    rows.set(bucket, {bucket,telemetryAvailable:false,telemetryPartial:false,expectedHours:0,availableHours:0});
  }
  const source = new Map(hourly.map(row => [new Date(row.bucket).toISOString(),row]));
  const end = Math.floor(new Date(now).getTime() / 3600000) * 3600000;
  for (let offset = 0; offset < (count + 2) * 24; offset += 1) {
    const timestamp = new Date(end - offset * 3600000).toISOString();
    const target = rows.get(pacificDay(timestamp));
    if (!target) continue;
    target.expectedHours += 1;
    const hour = source.get(timestamp);
    if (!hour || hour.telemetryAvailable === false) continue;
    target.availableHours += 1;
    target.telemetryAvailable = true;
    if (hour.telemetryPartial) target.telemetryPartial = true;
    for (const [field,value] of Object.entries(hour)) {
      if (Number.isFinite(value) && value >= 0 && !['expectedHours','availableHours'].includes(field)) target[field] = (target[field] || 0) + value;
    }
  }
  return [...rows.values()].map(row => ({...row,telemetryPartial:row.telemetryPartial || row.availableHours < row.expectedHours}));
}
