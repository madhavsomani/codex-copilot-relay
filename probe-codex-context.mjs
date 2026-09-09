import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const args=new Map(); for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const root=path.dirname(fileURLToPath(import.meta.url));
const base=args.get('--url')??'http://127.0.0.1:4144/v1';
const home=path.resolve(args.get('--home')??path.join(root,'runtime','codex-context-probe-'+Date.now()));
await mkdir(home,{recursive:true});
const context=Number(args.get('--context')??1000000);
const compact=Number(args.get('--compact')??780000);
await writeFile(path.join(home,'config.toml'),[
  'model = "gpt-6-astra"','model_provider = "context_probe"','model_reasoning_effort = "xhigh"',
  'model_context_window = '+context,'model_auto_compact_token_limit = '+compact,
  'web_search = "disabled"',
  ...(args.get('--catalog') ? ['model_catalog_json = '+JSON.stringify(args.get('--catalog').replaceAll('\\','/'))] : []),
  '[model_providers.context_probe]','name = "Context probe"','base_url = "'+base+'"',
  'wire_api = "responses"','requires_openai_auth = false','',
].join('\n'));
const execution=promisify(execFile)(process.execPath,[path.join(root,'node_modules','@openai','codex','bin','codex.js'),
  'exec','--skip-git-repo-check','--sandbox','read-only','--json','Reply with exactly CODEX_CONTEXT_OK. Do not call tools.'],
  {cwd:home,env:{...process.env,CODEX_HOME:home},windowsHide:true,timeout:120000,maxBuffer:1024*1024});
execution.child.stdin.end();
const result=await execution;
assert.ok(result.stdout.includes('CODEX_CONTEXT_OK'));
assert.ok(!result.stderr.includes('Unknown model gpt-6-astra'), 'The catalog must resolve Astra without fallback metadata');
const windows=[];
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);
  if(entry.isDirectory())await scan(file); else if(entry.name.endsWith('.jsonl'))for(const line of (await readFile(file,'utf8')).split('\n')){
    try{const row=JSON.parse(line);if(row.type==='event_msg'&&row.payload?.type==='token_count'&&row.payload.info?.model_context_window)windows.push(row.payload.info.model_context_window);}catch{}
  }
}}
await scan(path.join(home,'sessions'));
assert.ok(windows.length,'Codex must report its effective context window');
assert.ok(windows.every(value=>value>=870000),'Codex must stop using the 258400-token fallback');
console.log(JSON.stringify({ok:true,configuredContextWindow:context,configuredAutoCompactLimit:compact,codexReportedContextWindow:windows.at(-1),markerObserved:true}));
