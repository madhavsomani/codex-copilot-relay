import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {StringDecoder} from 'node:string_decoder';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_IMAGE = 32 * 1024 * 1024;
const executeFile = promisify(execFile);
const nativeVersionChecks = new Map();
export const nativeJobs = new Set();

export class NativeToolError extends Error {
  constructor(message, code = 'native_tool_failed', statusCode = 502) {
    super(message); this.code = code; this.statusCode = statusCode;
  }
}

async function readNativeVersion(executable) {
  const stat = await fs.stat(executable);
  const signature = `${executable}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  if (!nativeVersionChecks.has(signature)) {
    if (nativeVersionChecks.size >= 16) nativeVersionChecks.clear();
    const pending = executeFile(executable, ['--version'], {
      windowsHide:true, timeout:5000, maxBuffer:16384, env:nativeEnvironment(),
    }).then(result => result.stdout).catch(() => {
      nativeVersionChecks.delete(signature);
      throw new Error('The installed Codex executable could not report its version.');
    });
    nativeVersionChecks.set(signature, pending);
  }
  return await nativeVersionChecks.get(signature);
}

async function inspectNativeExecutable(executable, inspectVersion) {
  const stat = await fs.stat(executable);
  if (!stat.isFile()) throw new Error('The configured Codex executable is not a file.');
  const reported = await inspectVersion(executable);
  const version = /^codex-cli\s+(\d+)\.(\d+)\.(\d+)([^\s]*)\s*$/m.exec(reported);
  if (!version || !(Number(version[1]) > 0 || Number(version[2]) > 153 ||
    (Number(version[2]) === 153 && Number(version[3]) >= 4))) {
    throw new Error('Native images require stock Codex 0.153.4 or newer.');
  }
  return {codexPath:executable, codexVersion:`${version[1]}.${version[2]}.${version[3]}${version[4]}`};
}

async function resolveNativeExecutable(configuredPath, {localAppData = process.env.LOCALAPPDATA, inspectVersion = readNativeVersion} = {}) {
  if (typeof configuredPath !== 'string' || !path.isAbsolute(configuredPath)) {
    throw new Error('An absolute installed Codex executable is required.');
  }
  try {
    return {...await inspectNativeExecutable(configuredPath, inspectVersion), executableSource:'configured'};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const desktopBin = localAppData && path.isAbsolute(localAppData) ? path.join(localAppData, 'OpenAI', 'Codex', 'bin') : null;
  const relative = desktopBin && path.relative(desktopBin, configuredPath).split(path.sep);
  if (!relative || relative.length !== 2 || !/^[a-f0-9]{8,64}$/i.test(relative[0]) || relative[1].toLowerCase() !== 'codex.exe') {
    throw new Error('The configured Codex executable is missing. Update its explicit path using Enable-Codex-NativeTools.ps1 -CodexPath.');
  }
  const entries = await fs.readdir(desktopBin, {withFileTypes:true}).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{8,64}$/i.test(entry.name)) continue;
    const executable = path.join(desktopBin, entry.name, 'codex.exe');
    try {
      const stat = await fs.lstat(executable);
      if (stat.isFile() && !stat.isSymbolicLink() && (await fs.realpath(executable)).toLowerCase() === executable.toLowerCase()) {
        candidates.push({executable, modified:stat.mtimeMs});
      }
    } catch {}
  }
  candidates.sort((left, right) => right.modified - left.modified || left.executable.localeCompare(right.executable));
  for (const candidate of candidates) {
    try {
      return {...await inspectNativeExecutable(candidate.executable, inspectVersion), executableSource:'desktop-update'};
    } catch {}
  }
  throw new Error('No compatible installed Codex desktop installation was found after the configured executable disappeared. Finish updating or reinstall stock Codex 0.153.4 or newer.');
}

export async function loadNativeToolsConfig(root, options) {
  const disabled = {enabled:false, searchEnabled:false, imageEnabled:false};
  let config;
  try {
    config = JSON.parse(await fs.readFile(path.join(root, 'runtime', 'native-tools.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return disabled;
    return {...disabled, error:'Invalid native-tools.json: ' + error.message};
  }
  try {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Expected an object.');
    const imageEnabled = config.imageEnabled ?? (config.enabled === true);
    if (imageEnabled !== true) return disabled;
    const executable = await resolveNativeExecutable(config.codexPath, options);
    return {...disabled, imageEnabled:true, ...executable, model:config.model || 'gpt-6-astra'};
  } catch (error) {
    return {...disabled, error:'Native image configuration unavailable: ' + error.message};
  }
}

export function nativeEnvironment(environment = process.env) {
  // Native Codex owns login/refresh. Never read credentials or forward relay
  // bearer tokens, endpoint overrides, API keys, or inherited agent settings.
  return {...Object.fromEntries(Object.entries(environment).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|USERPROFILE|HOME|TEMP|TMP|APPDATA|LOCALAPPDATA|COMSPEC|PATHEXT|CODEX_HOME)$/i.test(key))), RUST_LOG: 'off'};
}

export function nativeArguments(kind, model, cwd, imagePaths = []) {
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json',
    '--sandbox', 'read-only', '--model', model, '--cd', cwd,
    '-c', 'model_provider="openai"', '-c', 'model_reasoning_effort="low"',
    '-c', 'web_search="disabled"',
    '-c', 'features.shell_tool=false', '-c', 'features.multi_agent=false',
    '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.image_generation=' + (kind === 'image'),
    ...imagePaths.flatMap(file => ['--image', file]), '-'];
}

export async function runNativeCodex(config, kind, prompt, {signal, imagePaths = [], onSearch, onUsage, onSubmitted, cwd = os.tmpdir(), timeoutMs = 600000, spawnProcess = spawn} = {}) {
  if (kind !== 'image') throw new NativeToolError('Native search helper was removed.', 'native_tools_disabled', 501);
  if (config.error) throw new NativeToolError(config.error, 'native_tools_unavailable', 503);
  if (!(kind === 'image' ? (config.imageEnabled ?? config.enabled) : (config.searchEnabled ?? config.enabled))) throw new NativeToolError('Native Codex tools are disabled. Enable them explicitly with Enable-Codex-NativeTools.ps1; they use OpenAI/ChatGPT usage, not Copilot credits.', 'native_tools_disabled', 501);
  if (signal?.aborted) throw new NativeToolError('Native tool cancelled.', 'native_tool_cancelled', 499);
  if (nativeJobs.size >= 2) throw new NativeToolError('Both native-tool slots are busy. Retry after a current tool finishes.', 'native_tools_busy', 429);
  const child = spawnProcess(config.codexPath, nativeArguments(kind, config.model, cwd, imagePaths),
    {cwd, env: nativeEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  nativeJobs.add(child);
  try{onSubmitted?.();}catch{}
  let buffer = '', bytes = 0, threadId = null, usage = null, turnCompleted = false;
  const messages = [], searches = new Map();
  const decoder = new StringDecoder('utf8');
  return await new Promise((resolve, reject) => {
    let failure;
    const stop = (error) => {failure ??= error; child.kill();};
    const cancel = () => stop(new NativeToolError('Native tool cancelled.', 'native_tool_cancelled', 499));
    const timer = setTimeout(() => stop(new NativeToolError('Native Codex tool timed out.', 'native_tool_timeout', 504)), timeoutMs);
    signal?.addEventListener('abort', cancel, {once: true});
    child.stderr.on('data', () => {}); // Do not log native account/session diagnostics.
    child.stdin.on('error', () => {});
    child.on('error', () => stop(new NativeToolError('Unable to launch the configured Codex executable.', 'native_tool_launch_failed')));
    const parse = (line) => {
      let event; try {event = JSON.parse(line);} catch {return;}
      if (event.type === 'thread.started' && /^[0-9a-f-]{36}$/i.test(event.thread_id)) threadId = event.thread_id;
      if (event.type === 'turn.completed') {usage = event.usage; turnCompleted = true;try{onUsage?.(usage);}catch{}}
      if (event.type === 'turn.failed') failure = new NativeToolError(event.error?.message || 'Native Codex turn failed.');
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text);
      if (event.item?.type === 'web_search' && ['item.started', 'item.completed'].includes(event.type)) {
        const complete = event.type === 'item.completed';
        searches.set(event.item.id, {...event.item, complete});
        onSearch?.({...event.item, complete});
        if (searches.size > 5) stop(new NativeToolError('Native search exceeded its five-operation limit.', 'native_search_limit'));
      }
      if (event.item && ['command_execution', 'mcp_tool_call'].includes(event.item.type))
        stop(new NativeToolError('Native helper requested a tool outside its configured scope.', 'native_tool_scope'));
    };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) return stop(new NativeToolError('Native helper exceeded its output limit.', 'native_output_limit'));
      buffer += decoder.write(chunk);
      let end; while ((end = buffer.indexOf('\n')) >= 0) {parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);}
    });
    child.on('close', code => {
      nativeJobs.delete(child);
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      buffer += decoder.end();
      if (buffer) parse(buffer);
      if (failure) return reject(failure);
      if (code !== 0 || !turnCompleted) return reject(new NativeToolError('Native Codex did not complete. Check native Codex sign-in and usage limits.', 'native_turn_incomplete'));
      resolve({threadId, text: messages.at(-1) || '', usage, searches: [...searches.values()]});
    });
    child.stdin.end(prompt);
  });
}

export function validateImageRequest(body, edit = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new NativeToolError('Image request must be an object.', 'invalid_image_request', 400);
  const allowed = new Set(['model','prompt','n','quality','size','background', ...(edit ? ['images'] : [])]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new NativeToolError('Unsupported image parameter: ' + key, 'unsupported_parameter', 400);
  const backgroundSupported = body.background == null || ['auto','opaque'].includes(body.background);
  if (body.model !== 'gpt-image-2' || (body.n != null && body.n !== 1) ||
    ['quality','size'].some(key => body[key] != null && body[key] !== 'auto') || !backgroundSupported)
    throw new NativeToolError('The native image adapter supports gpt-image-2, one image, automatic quality/size, and automatic or opaque background only.', 'unsupported_parameter', 400);
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 32000) throw new NativeToolError('Image prompt must contain 1-32000 characters.', 'invalid_image_prompt', 400);
  if (edit && (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 5)) throw new NativeToolError('Image edits require 1-5 embedded reference images.', 'invalid_image_reference', 400);
  return (edit ? body.images : []).map(image => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image?.image_url ?? '');
    if (!match || match[2].length > Math.ceil(MAX_IMAGE / 3) * 4) throw new NativeToolError('Image references must be bounded PNG/JPEG/WebP data URLs.', 'invalid_image_reference', 400);
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString('base64') !== match[2]) throw new NativeToolError('Invalid reference image encoding.', 'invalid_image_reference', 400);
    return {bytes, extension: match[1]};
  });
}

export async function imageWithNativeCodex(config, body, {edit = false, signal,onUsage,onSubmitted} = {}) {
  const references = validateImageRequest(body, edit);
  if (config.error) throw new NativeToolError(config.error, 'native_tools_unavailable', 503);
  if (!(config.imageEnabled ?? config.enabled)) throw new NativeToolError('Native image tools are disabled. Run Enable-Codex-NativeTools.ps1 to opt into OpenAI/ChatGPT image usage.', 'native_tools_disabled', 501);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-native-image-'));
  try {
    const imagePaths = [];
    for (const [index, image] of references.entries()) {
      const file = path.join(directory, 'reference-' + index + '.' + image.extension);
      await fs.writeFile(file, image.bytes, {flag: 'wx'}); imagePaths.push(file);
    }
    const referenceInstruction = edit ? 'Use num_last_images_to_include=' + references.length + ' for the supplied reference images. ' : '';
    const result = await runNativeCodex(config, 'image',
      'Use only image_gen.imagegen exactly once. ' + referenceInstruction +
      'Pass the following prompt verbatim. No local reads, other tools, variants or retries. After generation return only the saved path provided by the tool. Image prompt:\n' + body.prompt, {signal, imagePaths, cwd: directory,onUsage,onSubmitted});
    if (!result.threadId) throw new NativeToolError('Native image result has no thread ID.', 'native_image_missing');
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    // Read only an actual PNG inside this newly-created native thread. Never
    // trust a model-supplied path as permission to read arbitrary local files.
    const outputDirectory = path.join(codexHome, 'generated_images', result.threadId);
    const resolvedDirectory = await fs.realpath(outputDirectory);
    if (path.resolve(resolvedDirectory).toLowerCase() !== path.resolve(outputDirectory).toLowerCase()) throw new NativeToolError('Native image directory redirects elsewhere.', 'native_image_path');
    const files = (await fs.readdir(outputDirectory)).filter(name => name.endsWith('.png'));
    if (files.length !== 1) throw new NativeToolError('Expected exactly one native generated image.', 'native_image_missing');
    const file = path.join(outputDirectory, files[0]);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_IMAGE) throw new NativeToolError('Invalid native image artifact.', 'native_image_path');
    const bytes = await fs.readFile(file);
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new NativeToolError('Native image artifact is not PNG.', 'native_image_invalid');
    return {created: Math.floor(Date.now() / 1000), data: [{b64_json: bytes.toString('base64')}], model: 'gpt-image-2'};
  } finally {
    // mkdtemp returned this exact directory; no caller-provided paths are deleted.
    const resolved = await fs.realpath(directory);
    if (resolved === directory && path.basename(directory).startsWith('relay-native-image-')) await fs.rm(directory, {recursive:true, force:true});
  }
}

export function prepareNativeSearch(body) {
  const declarations = (body.tools || []).filter(tool => ['web_search', 'web_search_preview'].includes(tool?.type));
  if (!declarations.length) return {body, search: false};
  {
    const tools = (body.tools || []).filter(tool => !declarations.includes(tool));
    if (['web_search','web_search_preview'].includes(body.tool_choice?.type) || (body.tool_choice === 'required' && !tools.length))
      throw new NativeToolError('Hosted search is disabled in the native adapter.', 'native_tools_disabled', 501);
    // Stale desktop catalogs send optional search on every continuation. Do not
    // let an unavailable optional capability prevent ordinary model/tool work.
    return {search:false, body:{...body, tools, instructions:[body.instructions, 'Hosted web search is unavailable for this request. Do not claim to have searched the web.'].filter(Boolean).join('\n')}};
  }
}
