import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractToolDeclarations, externalToolRequestToResponseItem} from './bridge-core.mjs';
import {prepareContextTools} from './context-policy.mjs';
import {countModelTokens} from './context-tokenizer.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const codex = args.get('--codex');
assert.ok(codex, 'Supply the stock Codex executable; no model provider is contacted.');
const directory = path.join(root, 'runtime', 'tool-loading-probe-' + Date.now());
await mkdir(directory, {recursive: true});
const tools = Array.from({length: 80}, (_, index) => ({name: 'inspect_record_' + index,
  description: 'Read audit record ' + index + '. Read-only fixture. '.repeat(120),
  inputSchema: {type: 'object', properties: {record_id: {type: 'string', description: 'Identifier to inspect. '.repeat(80)}}, required: ['record_id']}}));
const captures = [];
const toolCalls = [];
let currentRun = null;
const server = http.createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { response.writeHead(400).end(); return; }
  if (request.url === '/mcp') {
    if (body.method === 'tools/call') toolCalls.push({run: currentRun, name: body.params.name, arguments: body.params.arguments});
    if (body.id == null) { response.writeHead(202).end(); return; }
    const result = body.method === 'initialize' ? {protocolVersion: '2024-11-05', capabilities: {tools: {}}, serverInfo: {name: 'local-audit', version: '1'}}
      : body.method === 'tools/list' ? {tools} : body.method === 'tools/call' ? {content: [{type: 'text', text: 'FIXTURE_ONLY'}]} : {};
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: body.id, result})); return;
  }
  if (request.url !== '/v1/responses') {response.writeHead(404).end(); return;}
  captures.push({run: currentRun, body});
  const step = captures.filter(item => item.run === currentRun).length;
  const declared = extractToolDeclarations(body);
  let output;
  if (currentRun !== 'discovery-off' && step === 1) {
    const search = declared.metadata.find(item => item.kind === 'tool_search');
    assert.ok(search, 'Codex must expose client-side tool discovery.');
    output = externalToolRequestToResponseItem(search, {toolCallId: 'local_search', arguments: {query: 'audit inspect_record_7', limit: 1}});
  } else if (currentRun !== 'discovery-off' && step === 2) {
    const lookup = declared.metadata.find(item => item.name === 'inspect_record_7');
    assert.ok(lookup, 'Codex search must return the requested tool.');
    assert.equal(prepareContextTools(declared).find(item => item.name === lookup.internalName).defer, 'never');
    output = externalToolRequestToResponseItem(lookup, {toolCallId: 'local_lookup', arguments: {record_id: 'fixture'}});
  }
  const message = {id: 'msg_local', type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'LOCAL_CAPTURE_OK', annotations: []}]};
  output ??= message;
  const complete = {id: 'resp_local_' + captures.length, object: 'response', status: 'completed', model: body.model, output: [output], usage: {input_tokens: 100, output_tokens: 5, total_tokens: 105}};
  response.writeHead(200, {'content-type': 'text/event-stream'});
  for (const event of [{type: 'response.created', response: {...complete, status: 'in_progress', output: []}},
    {type: 'response.output_item.added', output_index: 0, item: {...output, status: 'in_progress'}},
    {type: 'response.output_item.done', output_index: 0, item: output}, {type: 'response.completed', response: complete}]) {
    response.write('data: ' + JSON.stringify(event) + '\n\n');
  }
  response.end();
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const catalog = JSON.parse(await readFile(path.join(root, 'runtime/codex-copilot-models.json'), 'utf8'));
  for (const run of ['discovery-off', 'discovery-on', 'discovery-denied']) {
    const searchEnabled = run !== 'discovery-off';
    currentRun = run;
    const home = path.join(directory, currentRun); await mkdir(home, {recursive: true});
    const entry = structuredClone(catalog.models.find(model => model.slug === 'gpt-6-astra'));
    entry.supports_search_tool = searchEnabled;
    await writeFile(path.join(home, 'models.json'), JSON.stringify({models: [entry]}));
    await writeFile(path.join(home, 'config.toml'), ['model = "gpt-6-astra"', 'model_provider = "local_fixture"',
      'model_catalog_json = ' + JSON.stringify(path.join(home, 'models.json').replaceAll('\\', '/')),
      'web_search = "disabled"', '[features]', 'apps = false', '[model_providers.local_fixture]', 'name = "Local fixture"',
      'base_url = "' + base + '/v1"', 'wire_api = "responses"', 'requires_openai_auth = false',
      '[mcp_servers.audit]', 'url = "' + base + '/mcp"', 'required = true',
      '[mcp_servers.audit.tools.inspect_record_7]', 'approval_mode = "' + (run === 'discovery-on' ? 'approve' : 'prompt') + '"'].join('\n'));
    await new Promise((resolve, reject) => {
      const child = spawn(codex, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', 'Reply LOCAL_CAPTURE_OK.'],
        {cwd: home, env: {...process.env, CODEX_HOME: home}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
      const timer = setTimeout(() => {child.kill(); reject(new Error('Local capture timed out: ' + stderr.slice(-1200)));}, 30000);
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', code => {clearTimeout(timer); code === 0 && stdout.includes('LOCAL_CAPTURE_OK') ? resolve() : reject(new Error('Capture failed: ' + stderr.slice(-1500)));});
    });
  }
  const summary = captures.map(({run, body}) => ({run, wireBytes: Buffer.byteLength(JSON.stringify(body)),
    toolsBytes: Buffer.byteLength(JSON.stringify(body.tools)), toolTypes: body.tools.map(tool => tool.type),
    estimatedToolTokens: countModelTokens(JSON.stringify(body.tools)),
    declaredFunctions: extractToolDeclarations(body).sdkTools.length,
    searchable: body.tools.some(tool => tool.type === 'tool_search'),
    hostedWebSearch: body.tools.some(tool => /^web_search/.test(tool.type))}));
  assert.equal(summary.length, 7);
  assert.equal(summary[0].searchable, false); assert.equal(summary[1].searchable, true);
  assert.ok(summary[1].toolsBytes < summary[0].toolsBytes / 4);
  assert.ok(summary.every(row => !row.hostedWebSearch));
  assert.deepEqual(toolCalls, [{run: 'discovery-on', name: 'inspect_record_7', arguments: {record_id: 'fixture'}}]);
  assert.ok(JSON.stringify(captures.filter(item => item.run === 'discovery-on').at(-1).body.input).includes('FIXTURE_ONLY'));
  assert.ok(JSON.stringify(captures.at(-1).body.input).includes('MCP tool call requires approval'));
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ok: true, provider: 'loopback fixture only', paidInference: false, discoveryAndExecutionVerified: true, approvalDenialVerified: true, directory, summary}));
} finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
