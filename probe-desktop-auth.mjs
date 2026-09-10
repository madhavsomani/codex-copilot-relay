import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const cliPath = process.argv[2] || process.env.CODEX_BINARY;
if (!cliPath) throw new Error('Pass the installed Codex executable path');
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-desktop-auth-probe-'));
const placeholder = 'codex-copilot-local-only';
const fakeAccessToken = 'synthetic-chatgpt-token-never-forward';
const fakeAccountId = 'synthetic-account-never-forward';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeIdToken = [encode({ alg: 'none', typ: 'JWT' }), encode({
  email: 'fixture@example.invalid',
  'https://api.openai.com/auth': {
    chatgpt_plan_type: 'plus',
    chatgpt_account_id: fakeAccountId,
    chatgpt_user_id: 'synthetic-user',
  },
}), 'signature'].join('.');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SYSTEMROOT|WINDIR|USERPROFILE|HOME|TEMP|TMP|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT)$/i.test(key)));
const observations = [];
const server = http.createServer(async (request, response) => {
  for await (const chunk of request) void chunk;
  observations.push({
    route: request.url,
    authorization: request.headers.authorization ?? null,
    accountId: request.headers['chatgpt-account-id'] ?? null,
    allHeaders: JSON.stringify(request.headers),
  });
  if (!request.url.endsWith('/responses')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Local fixture route only' } }));
    return;
  }
  const item = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'AUTH_FIXTURE_OK', annotations: [] }] };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [
    { type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'AUTH_FIXTURE_OK' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  for (const event of events) response.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
  response.end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1';

function startCli(argumentsList, codexHome) {
  return spawn(cliPath, argumentsList, { cwd: fixtureRoot, windowsHide: true,
    env: { ...environment, CODEX_HOME: codexHome, RUST_LOG: 'off' }, stdio: ['pipe', 'pipe', 'pipe'] });
}

async function inspectAuth(codexHome) {
  const child = startCli(['app-server', '--stdio'], codexHome);
  const exit = once(child, 'exit');
  let buffer = '';
  let timer;
  const result = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Auth metadata timed out')), 20000);
    const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', reject);
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.error) return reject(new Error('Auth RPC rejected: ' + message.error.code));
        if (message.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'getAuthStatus', params: { includeToken: false, refreshToken: false } });
        }
        if (message.id === 2) resolve({ authMethod: message.result.authMethod,
          requiresOpenaiAuth: message.result.requiresOpenaiAuth,
          tokenReturned: message.result.authToken != null });
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'desktop_auth_fixture', version: '1.0' } } });
  }).finally(() => { clearTimeout(timer); child.stdin.end(); child.kill(); });
  await exit;
  return result;
}

async function requestMockModel(codexHome) {
  const child = startCli(['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--json',
    'Return AUTH_FIXTURE_OK without using any tools.'], codexHome);
  const exit = once(child, 'exit');
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 25000);
  const [code] = await exit;
  clearTimeout(timer);
  assert.equal(code, 0, 'Fixture Codex run failed: ' + errors.slice(-1200));
  assert.ok(output.includes('AUTH_FIXTURE_OK'), 'Mock response missing');
}

const cases = [
  { name: 'Original provider', openaiAuth: false, explicitBearer: false, expectedAuthMethod: null, expectedBearer: null },
  { name: 'Unsafe flag alone (synthetic control)', openaiAuth: true, explicitBearer: false, expectedAuthMethod: 'chatgpt', expectedBearer: 'Bearer ' + fakeAccessToken },
  { name: 'Separated desktop and relay auth', openaiAuth: true, explicitBearer: true, expectedAuthMethod: 'chatgpt', expectedBearer: 'Bearer ' + placeholder },
  { name: 'Relay without ChatGPT login', openaiAuth: true, explicitBearer: true, noLogin: true, expectedAuthMethod: null, expectedBearer: 'Bearer ' + placeholder },
];
const results = [];
try {
  for (const [index, testCase] of cases.entries()) {
    const codexHome = path.join(fixtureRoot, String(index));
    await fs.mkdir(codexHome);
    if (!testCase.noLogin) await fs.writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt',
      OPENAI_API_KEY: null, tokens: { id_token: fakeIdToken, access_token: fakeAccessToken,
        refresh_token: 'synthetic-refresh', account_id: fakeAccountId }, last_refresh: new Date().toISOString() }));
    const lines = [
      'model = "gpt-5.4"', 'model_provider = "fixture"', 'web_search = "disabled"',
      'cli_auth_credentials_store = "file"', 'check_for_update_on_startup = false',
      '[features]', 'apps = false', '[model_providers.fixture]', 'name = "Local auth fixture"',
      'base_url = "' + endpoint + '"', 'wire_api = "responses"',
      'requires_openai_auth = ' + testCase.openaiAuth, 'request_max_retries = 0', 'stream_max_retries = 0',
    ];
    if (testCase.explicitBearer) lines.push('experimental_bearer_token = "' + placeholder + '"');
    await fs.writeFile(path.join(codexHome, 'config.toml'), lines.join('\n'));
    const metadata = await inspectAuth(codexHome);
    assert.equal(metadata.authMethod, testCase.expectedAuthMethod);
    assert.equal(metadata.tokenReturned, false);
    const firstRequest = observations.length;
    await requestMockModel(codexHome);
    const requests = observations.slice(firstRequest);
    assert.ok(requests.length > 0);
    for (const request of requests) assert.equal(request.authorization, testCase.expectedBearer);
    if (testCase.explicitBearer) {
      for (const request of requests) {
        assert.equal(request.accountId, null, 'ChatGPT account header leaked');
        assert.ok(!request.allHeaders.includes(fakeAccessToken), 'ChatGPT access token leaked');
        assert.ok(!request.allHeaders.includes(fakeAccountId), 'ChatGPT account ID leaked');
      }
    }
    results.push({ name: testCase.name, metadata, requests: requests.length,
      relayGetsOnlyPlaceholder: testCase.explicitBearer,
      chatgptAccountHeaderPresent: requests.some((request) => request.accountId != null) });
  }
  console.log(JSON.stringify({ passed: true, fixtureRoot, realCredentialsUsed: false,
    modelCallsToExternalServices: 0, results }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
