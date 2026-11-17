// Crash diagnostics. The relay has repeatedly died mid-traffic without a
// shutdown event; these records survive the restart so the cause can be found:
// - runtime/relay-vitals.json: the last 60 one-minute samples (memory, event
//   loop delay, active work), rewritten each minute;
// - runtime/relay-exits.jsonl: one line per JS-visible exit or uncaught error.
// A death that skips both (native crash, external kill) still leaves the last
// sample, and the next start reports it as an unclean previous exit.
// Metadata only: no prompts, paths of user files, tokens or error payloads.
import {appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {monitorEventLoopDelay} from 'node:perf_hooks';

const mib = bytes => Math.round(bytes / 1048576);

export function readPreviousRun(runtimeDirectory) {
  const file = path.join(runtimeDirectory, 'relay-vitals.json');
  if (!existsSync(file)) return null;
  try {
    const previous = JSON.parse(readFileSync(file, 'utf8'));
    return {pid:previous.pid, startedAt:previous.startedAt, cleanExit:previous.cleanExit === true,
      lastSample:previous.samples?.at(-1) ?? null, exit:previous.exit ?? null};
  } catch { return null; }
}

export function startVitals({runtimeDirectory, version, activity = () => ({}), intervalMs = 60000, keep = 60, onPrevious}) {
  mkdirSync(runtimeDirectory, {recursive:true});
  const file = path.join(runtimeDirectory, 'relay-vitals.json'), exits = path.join(runtimeDirectory, 'relay-exits.jsonl');
  const previous = readPreviousRun(runtimeDirectory);
  if (previous && !previous.cleanExit) onPrevious?.(previous);
  const delay = monitorEventLoopDelay({resolution:20}); delay.enable();
  const state = {pid:process.pid, version, startedAt:new Date().toISOString(), cleanExit:false, samples:[], exit:null};
  const write = () => {
    try { writeFileSync(file + '.tmp', JSON.stringify(state)); renameSync(file + '.tmp', file); } catch {}
  };
  const sample = () => {
    const memory = process.memoryUsage();
    let work = {}; try { work = activity(); } catch {}
    state.samples.push({at:new Date().toISOString(), uptimeS:Math.round(process.uptime()), rssMiB:mib(memory.rss),
      heapUsedMiB:mib(memory.heapUsed), heapTotalMiB:mib(memory.heapTotal), externalMiB:mib(memory.external),
      arrayBuffersMiB:mib(memory.arrayBuffers), loopDelayMaxMs:Math.round(delay.max / 1e6), loopDelayP99Ms:Math.round(delay.percentile(99) / 1e6), ...work});
    delay.reset();
    if (state.samples.length > keep) state.samples.splice(0, state.samples.length - keep);
    write();
  };
  const journal = entry => {
    try {
      if (existsSync(exits) && statSync(exits).size > 256 * 1024) renameSync(exits, exits + '.old');
      appendFileSync(exits, JSON.stringify({at:new Date().toISOString(), pid:process.pid, version, uptimeS:Math.round(process.uptime()),
        rssMiB:mib(process.memoryUsage().rss), ...entry}) + '\n');
    } catch {}
  };
  sample();
  // A fatal V8 error (e.g. out of memory) skips JS handlers; Node's own
  // diagnostic report still lands here. Set at runtime: the relay's command
  // line must stay exactly `node server.mjs` for ownership checks.
  try {
    const reports = path.join(runtimeDirectory, 'crash-logs');
    mkdirSync(reports, {recursive:true});
    process.report.directory = reports;
    process.report.reportOnFatalError = true;
    process.report.excludeEnv = true;
  } catch {}
  const timer = setInterval(sample, intervalMs); timer.unref();
  // Observe only: never changes Node's own crash behaviour.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    journal({event:'uncaught', origin, name:String(error?.name ?? 'Error').slice(0, 80), code:error?.code ?? null,
      message:String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 200)});
  });
  process.on('exit', code => {
    state.exit = {code, at:new Date().toISOString(), reason:state.reason ?? null};
    state.cleanExit = code === 0 && Boolean(state.reason);
    journal({event:'exit', code, reason:state.reason ?? null});
    write();
  });
  return {
    markShutdown(reason) { state.reason = String(reason).slice(0, 80); journal({event:'shutdown', reason:state.reason}); },
    stop() { clearInterval(timer); delay.disable(); },
  };
}
