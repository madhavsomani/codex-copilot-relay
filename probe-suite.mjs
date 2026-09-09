import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const root = path.dirname(fileURLToPath(import.meta.url));
const model = args.get('--model') ?? 'gpt-6-astra';
const runtime = path.resolve(args.get('--runtime') ?? path.join(root, 'runtime', 'compatibility-audit-' + Date.now()));
await mkdir(runtime, {recursive:true});
const exec = promisify(execFile);
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; assert.notEqual(port, 4144);
await new Promise(resolve => reservation.close(resolve));
const env = {...process.env, BRIDGE_PORT:String(port), BRIDGE_DEFAULT_MODEL:model, BRIDGE_RUNTIME_DIRECTORY:runtime,
  BRIDGE_MODEL_ROUTING_MODE:'per-request'};
delete env.BRIDGE_LOCKED_REASONING_EFFORT;
delete env.BRIDGE_AUTH_TOKEN; delete env.BRIDGE_EVENT_LOG_PATH;
const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {cwd:root, env, windowsHide:true, stdio:['ignore','pipe','pipe']});
let errors = ''; child.stdout.resume(); child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
const report = {model,port,isolated:true,startedAt:new Date().toISOString(),results:[]};
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated relay exited: ' + errors);
    try { const health = await (await fetch(`http://127.0.0.1:${port}/health`, {signal:AbortSignal.timeout(2000)})).json();
      if (health.ok) { report.health = health; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(report.health, 'Isolated SDK must become healthy');
  console.log(JSON.stringify({stage:'ready',port,version:report.health.version,context:report.health.compatibility}));
  const probes = [
    ['probe-compatibility.mjs',[]], ['probe-responses-stream.mjs',[]], ['probe-relay-tools.mjs',['--steps','6']],
    ['probe-deferred-tool.mjs',[]], ['probe-reasoning-phase.mjs',[]], ['probe-tool-choice.mjs',[]],
    ['probe-request-semantics.mjs',[]], ['probe-agent-message.mjs',[]], ['probe-concurrency.mjs',['--count','4']],
    ['probe-premature-recovery.mjs',[]], ['probe-delayed-tool.mjs',['--delay-ms','31000']], ['probe-vision.mjs',[]],
    ['probe-failure-stream.mjs',[]], ['probe-parallel-tools.mjs',[]], ['probe-steering.mjs',[]],
    ['probe-routing-agents.mjs',[]],
  ];
  if (args.get('--long-context') === 'true') probes.push(['probe-long-context.mjs',[]]);
  const only = args.get('--only');
  if (only && !probes.some(([name]) => name === only)) throw new Error('Unknown probe: ' + only);
  for (const [script, extra] of probes.filter(([name]) => !only || name === only)) {
    const started = Date.now();
    let result;
    try {
      const output = await exec(process.execPath, [path.join(root, script), '--url',`http://127.0.0.1:${port}/v1`,'--model',model,...extra], {cwd:root, windowsHide:true,timeout:300000,maxBuffer:1024*1024});
      result = {script,ok:true,wallMs:Date.now()-started,stdout:output.stdout,stderr:output.stderr};
    } catch(error) { result = {script,ok:false,wallMs:Date.now()-started,stdout:error.stdout ?? '',stderr:error.stderr ?? error.message}; }
    report.results.push(result);
    await writeFile(path.join(runtime,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({script,ok:result.ok,wallMs:result.wallMs,...(!result.ok ? {error:result.stderr.slice(-1700)} : {})}));
  }
  report.ok = report.results.every(x => x.ok); report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify({ok:report.ok,passed:report.results.filter(x=>x.ok).length,total:report.results.length,report:path.join(runtime,'report.json')}));
  if (!report.ok) process.exitCode = 1;
} finally {
  await writeFile(path.join(runtime,'report.json'),JSON.stringify(report,null,2));
  // Only terminate the isolated process tree created above. Production is untouched.
  if (child.exitCode === null) {
    if (process.platform === 'win32') await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
    else child.kill('SIGTERM');
  }
}
