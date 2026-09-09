// Real Codex parent/child routing plus parallel tools and large tool-result retention.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const base=args.get('--url')??'http://127.0.0.1:4144/v1';
const health=await (await fetch(base.replace(/\/v1$/,'')+'/health')).json();
assert.equal(health.routing.mode,'per-request','Explicit child-model test requires per-request routing');
const home=await mkdtemp(path.join(os.tmpdir(),'relay-real-agents-'));
const exec=promisify(execFile);
const hp=path.join(home,'health.json');await writeFile(hp,JSON.stringify(health));
const configHelper=path.join(root,'Codex-Copilot-Config.ps1').replaceAll("'","''");
await exec('powershell.exe',['-NoProfile','-Command',". '"+configHelper+"'; $h=Get-Content -Raw -LiteralPath '"+hp.replaceAll("'","''")+"' | ConvertFrom-Json; New-CodexCopilotModelCatalog -Health $h -Model 'gpt-6-astra' -Directory '"+home.replaceAll("'","''")+"'"],{cwd:root,windowsHide:true});
const catalog=path.join(home,'codex-copilot-models.json').replaceAll('\\','/');
await mkdir(path.join(home,'agents'));
for(const [role,model,effort] of [['sol_probe','gpt-5.6-sol','max'],['terra_probe','gpt-5.6-terra','high']]){
 await writeFile(path.join(home,'agents',role+'.toml'),'model = "'+model+'"\nmodel_reasoning_effort = "'+effort+'"\nsandbox_mode = "read-only"\n');
}
await writeFile(path.join(home,'config.toml'),[
 'model = "gpt-6-astra"','model_provider = "relay_probe"','model_reasoning_effort = "xhigh"',
 'model_catalog_json = '+JSON.stringify(catalog),'web_search = "disabled"',
 '[features]','multi_agent = true','[agents]','max_threads = 3',
 '[agents.sol_probe]','description = "Read-only verification child using Sol"','config_file = "agents/sol_probe.toml"',
 '[agents.terra_probe]','description = "Read-only verification child using Terra"','config_file = "agents/terra_probe.toml"',
 '[model_providers.relay_probe]','name = "Isolated relay probe"','base_url = '+JSON.stringify(base),
 'wire_api = "responses"','requires_openai_auth = false','request_max_retries = 0','stream_idle_timeout_ms = 120000',''
].join('\n'));
const prompt='This is an authorized sub-agent interoperability test. Spawn exactly two child agents in parallel: agent_type sol_probe must reply exactly SOL_CHILD_OK; agent_type terra_probe must reply exactly TERRA_CHILD_OK. Do not use a default agent type. Wait for both, then send each a followup requesting exactly SOL_REPLY_OK or TERRA_REPLY_OK respectively and wait again. Once both replied correctly, close both child agents and reply exactly REAL_MODEL_AGENTS_OK. Children must not use tools or create more agents. No filesystem edits.';
const job=exec(process.execPath,[path.join(root,'node_modules/@openai/codex/bin/codex.js'),'exec','--skip-git-repo-check','--sandbox','read-only','--json',prompt],{cwd:home,env:{...process.env,CODEX_HOME:home},windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});job.child.stdin.end();
let result;
try { result=await job; } catch(error) { await writeFile(path.join(home,'failure.txt'),(error.stdout??'')+'\n'+(error.stderr??'')); throw Error('Real-agent probe failed; inspect '+home+': '+error.message.slice(0,300)); }
await writeFile(path.join(home,'codex-output.jsonl'),result.stdout);
const cliMessages=result.stdout.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text);
assert.equal(cliMessages.at(-1),'REAL_MODEL_AGENTS_OK');
const code=randomUUID();
await writeFile(path.join(home,'large-result.txt'),'ordinary data '.repeat(1800)+'\nMIDDLE_VERIFICATION_CODE='+code+'\n'+'ordinary data '.repeat(1800));
const largeJob=exec(process.execPath,[path.join(root,'node_modules/@openai/codex/bin/codex.js'),'exec','--skip-git-repo-check','--sandbox','read-only','--json',
 'Use the shell exactly once to run Get-Content -Raw -LiteralPath ./large-result.txt. Set its output token budget to 20000 if available. Do not search, slice, filter, or reread the file. Read MIDDLE_VERIFICATION_CODE from that full result and reply with only the UUID value.'],
 {cwd:home,env:{...process.env,CODEX_HOME:home},windowsHide:true,timeout:120000,maxBuffer:1024*1024});largeJob.child.stdin.end();
const largeResult=await largeJob;
const largeMessages=largeResult.stdout.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text);
assert.equal(largeMessages.at(-1),code,'Middle of 50 KiB shell result must survive Codex truncation');
const contexts=[],tokens=[],messages=[];
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await scan(f);else if(e.name.endsWith('.jsonl'))for(const line of (await readFile(f,'utf8')).split('\n')){try{const r=JSON.parse(line);if(r.type==='turn_context')contexts.push({model:r.payload.model,effort:r.payload.effort});if(r.type==='event_msg'&&r.payload.type==='token_count')tokens.push(r.payload.info?.model_context_window);if(r.type==='response_item'&&r.payload.role==='assistant')messages.push(JSON.stringify(r.payload.content));}catch{}}}}
await scan(path.join(home,'sessions'));
for(const m of ['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra'])assert.ok(contexts.some(c=>c.model===m),'Missing real child context '+m);
for(const marker of ['SOL_CHILD_OK','TERRA_CHILD_OK','SOL_REPLY_OK','TERRA_REPLY_OK'])assert.ok(messages.some(s=>s.includes(marker)),'Missing child reply '+marker);
const data=await (await fetch(base.replace(/\/v1$/,'')+'/dashboard/api')).json();
const selected=[...new Set(data.records.map(r=>r.selectedModel))];
for(const m of ['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra'])assert.ok(selected.includes(m),'Missing selected backend '+m);
console.log(JSON.stringify({ok:true,home,contexts:[...new Map(contexts.map(c=>[c.model,c])).values()],effectiveWindows:[...new Set(tokens.filter(Boolean))],selectedModels:selected,childReplies:4,largeToolResultBytes:(await readFile(path.join(home,'large-result.txt'))).length,largeToolResultVerified:true}));
