// Opt-in authenticated regression: many compacted Codex windows while another
// task waits for a slow tool. Its two-slot relay is isolated from production.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const args = new Map();
for (let i=2; i<process.argv.length; i+=2) args.set(process.argv[i], process.argv[i+1]);
const model = args.get("--model") ?? "gpt-5.6-luna";
const rounds = Math.max(8, Math.min(2000, Number(args.get("--rounds") ?? 80)));
const reservation = net.createServer();
reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const port = reservation.address().port;
assert.notEqual(port, 4144);
await new Promise(r => reservation.close(r));
const runtime = await mkdtemp(path.join(os.tmpdir(), "relay-session-churn-"));
const env = { ...process.env, BRIDGE_PORT: String(port), BRIDGE_DEFAULT_MODEL: model,
  BRIDGE_RUNTIME_DIRECTORY: runtime, BRIDGE_MAX_COPILOT_SESSIONS: "2",
  BRIDGE_SDK_RECYCLE_AFTER_SESSIONS: "8", BRIDGE_SDK_PROBE_INTERVAL_MS: "500" };
delete env.BRIDGE_AUTH_TOKEN; delete env.BRIDGE_EVENT_LOG_PATH;
const child = spawn(process.execPath, [path.join(root, "server.mjs")], {
  cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.resume(); let stderr = "";
child.stderr.on("data", c => { stderr = (stderr+c).slice(-2000); });
const url = `http://127.0.0.1:${port}`;
const health = async () => (await fetch(`${url}/health`, {signal:AbortSignal.timeout(5000)})).json();
async function until(check, label) {
  const end=Date.now()+45000;
  while(Date.now()<end) {
    if(child.exitCode!==null) throw new Error(`Isolated relay exited: ${stderr}`);
    try { const v=await check(); if(v) return v; } catch {}
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error(`Timed out: ${label}`);
}
const tool = { type:"function", name:"relay_hold", description:"Wait for an external result.",
  parameters:{type:"object",properties:{value:{type:"string"}},required:["value"],additionalProperties:false} };
async function request(owner, body) {
  const response = await fetch(`${url}/v1/responses`, {
    method:"POST",headers:{"content-type":"application/json","thread-id":owner},
    signal:AbortSignal.timeout(90000),body:JSON.stringify({model,stream:false,
      reasoning:{effort:"low"},client_metadata:{thread_id:owner,
        "x-codex-turn-metadata":JSON.stringify({thread_id:owner,request_kind:"turn"})},...body}),
  });
  const data=await response.json();
  assert.equal(response.status,200,data.error?.message);
  return data;
}
async function hold(owner, round) {
  const response=await request(owner,{tools:[tool],input:`Fresh history window ${round}. Call relay_hold once with value WAIT. After its result reply with exactly TOOL_RESUMED_OK.`});
  const call=response.output.find(i=>i.type==="function_call");
  assert.ok(call,"model must return a pending tool call");
  return {id:response.id,callId:call.call_id};
}
async function resume(owner,pending) {
  const response=await request(owner,{previous_response_id:pending.id,
    input:[{type:"function_call_output",call_id:pending.callId,output:"WAIT finished"}]});
  const text=response.output.filter(i=>i.type==="message").flatMap(i=>i.content??[]).map(c=>c.text??"").join("");
  assert.equal(text.trim(),"TOOL_RESUMED_OK");
}
try {
  const initial=await until(async()=>{const h=await health();return h.ok&&h;},"startup");
  const slowOwner=randomUUID(), busyOwner=randomUUID();
  const slow=await hold(slowOwner,"slow tool"), heldAt=Date.now();
  let pending;
  for(let i=0;i<rounds;i++) {
    pending=await hold(busyOwner,i);
    const h=await health();
    assert.equal(h.activeExchanges,2);
    assert.equal(h.sdk.activeSessions,2);
    assert.equal(h.sdk.generation,initial.sdk.generation,"must not recycle the slow tool's worker");
    assert.equal(h.exchangeStates.waitingForTools,2);
    if((i+1)%10===0) console.log(JSON.stringify({stage:"churn",rounds:i+1,activeSessions:h.sdk.activeSessions,heldMs:Date.now()-heldAt}));
  }
  await resume(busyOwner,pending);
  await resume(slowOwner,slow);
  const final=await until(async()=>{const h=await health();return h.ok&&h.activeExchanges===0&&h.sdk.recycles>0&&h;},"idle recycle");
  console.log(JSON.stringify({ok:true,rounds,maxSessions:2,slowToolPreservedMs:Date.now()-heldAt,
    activeSessions:final.sdk.activeSessions,recycles:final.sdk.recycles,isolatedPort:port}));
} finally {
  if(child.exitCode===null) {
    if(process.platform==="win32") await exec("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true}).catch(()=>{});
    else child.kill("SIGTERM");
  }
}
