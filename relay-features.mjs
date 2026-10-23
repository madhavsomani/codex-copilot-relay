// Optional relay features: the relay's own additions on top of plain request
// forwarding. Each can be switched on or off at startup (Start-Relay.ps1
// -EnableFeature/-DisableFeature, BRIDGE_FEATURES, or `node relay-features.mjs`)
// and live from the dashboard. Choices persist in runtime/relay-features.json.
import {existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FEATURES = [
  {id:'cacheKeepWarm', label:'Prompt-cache keep-warm', client:'Claude Code', default:false, spends:true,
    description:'When a long main chat (about 100k+ tokens) goes quiet, send a tiny 1-token request with the identical history every 4.5 minutes, for up to 20 minutes, so Copilot\'s 5-minute prompt cache does not expire. Each ping costs roughly 1/20 of a cache rewrite; pings are wasted if you do not come back within 20 minutes. Subagents are never pinged.'},
  {id:'haikuExplore', label:'Haiku for Explore subagents', client:'Claude Code', default:false, spends:false,
    description:'Installs a relay-owned ~/.claude/agents/Explore.md that runs the read-only Explore search subagent on Haiku (about 1/40 of Opus per token). General-purpose subagents and the main chat keep their model. Never overwrites an Explore agent you wrote yourself. New Claude Code sessions pick it up.'},
  {id:'recoverCompletedAnswers', label:'Deliver completed answers after SDK errors', client:'Claude Code', default:true, spends:false,
    description:'If Claude Code already received a complete, verified answer and the Copilot SDK then stalls or errors, deliver that answer instead of failing the turn (which made Claude Code pay for a retry).'},
  {id:'imageHistoryTrim', label:'Trim old images in long chats', client:'Claude Code', default:true, spends:false,
    description:'Above about 24 MiB of image data, leave the oldest screenshots out of the request (with a note) so screenshot-heavy chats stay under Copilot\'s request size. Your transcript is not changed.'},
  {id:'encryptedPdfNote', label:'Replace encrypted PDFs with a note', client:'Claude Code', default:true, spends:false,
    description:'Copilot rejects every request that contains an encrypted PDF, which would break the whole chat. Replace it with a short note asking for an unlocked copy.'},
  {id:'idleToolEviction', label:'Release idle tool slots when full', client:'Claude Code', default:true, spends:false,
    description:'When every session slot is in use, release the tool call that has waited longest (over 5 minutes). Its results later rebuild from the chat history.'},
  {id:'codexCostCheckpoints', label:'Codex cost checkpoints', client:'Codex', default:true, spends:false,
    description:'Add an advisory note to Codex every 20 model steps or 500 AI credits per session (whole-session total), asking for a brief progress and cost check. Never a hard cap.'},
];
const byId = new Map(FEATURES.map(feature => [feature.id, feature]));
const defaults = () => Object.fromEntries(FEATURES.map(feature => [feature.id, feature.default]));

let state = defaults(), file = null, sources = {};
const listeners = new Set();

export function featureEnabled(id) {
  if (!byId.has(id)) throw new Error('Unknown relay feature: ' + id);
  return state[id] === true;
}
export function onFeatureChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

// "cacheKeepWarm=on,imageHistoryTrim=off" (also true/false, 1/0).
export function parseFeatureList(text = '') {
  const result = {};
  for (const part of String(text).split(',').map(value => value.trim()).filter(Boolean)) {
    const match = /^([A-Za-z]+)\s*=\s*(on|off|true|false|1|0)$/i.exec(part);
    if (!match || !byId.has(match[1])) throw new Error('Invalid BRIDGE_FEATURES entry: ' + part);
    result[match[1]] = /^(on|true|1)$/i.test(match[2]);
  }
  return result;
}

function readFile(target) {
  if (!target || !existsSync(target)) return {};
  try {
    const saved = JSON.parse(readFileSync(target, 'utf8'))?.features ?? {};
    return Object.fromEntries(Object.entries(saved).filter(([id, value]) => byId.has(id) && typeof value === 'boolean'));
  } catch { return {}; }
}
function persist() {
  if (!file) return;
  mkdirSync(path.dirname(file), {recursive:true});
  writeFileSync(file + '.tmp', JSON.stringify({version:1, features:state}, null, 2) + '\n', {mode:0o600});
  renameSync(file + '.tmp', file);
}

// Startup: defaults, then the saved choices, then BRIDGE_FEATURES (saved, so
// the dashboard and later restarts show the same state).
export function loadFeatures({runtimeDirectory, env = process.env} = {}) {
  file = runtimeDirectory ? path.join(runtimeDirectory, 'relay-features.json') : null;
  const saved = readFile(file), fromEnv = parseFeatureList(env.BRIDGE_FEATURES ?? '');
  state = {...defaults(), ...saved, ...fromEnv};
  sources = Object.fromEntries(FEATURES.map(({id}) => [id, id in fromEnv ? 'startup' : id in saved ? 'saved' : 'default']));
  if (Object.keys(fromEnv).length) persist();
  for (const listener of listeners) for (const id of Object.keys(state)) listener(id, state[id]);
  return snapshotFeatures();
}

export function setFeature(id, enabled) {
  if (!byId.has(id) || typeof enabled !== 'boolean') throw Object.assign(new Error('Unknown feature or non-boolean value.'), {statusCode:400});
  const previous = state[id];
  state = {...state, [id]:enabled}; sources[id] = 'dashboard';
  try {
    for (const listener of listeners) listener(id, enabled);
    persist();
  } catch (error) {
    state = {...state, [id]:previous};
    throw Object.assign(error, {statusCode:error.statusCode ?? 409});
  }
  return snapshotFeatures();
}

export function snapshotFeatures() {
  return FEATURES.map(feature => ({...feature, enabled:state[feature.id] === true, source:sources[feature.id] ?? 'default'}));
}

// Test helper: reset to defaults without touching disk.
export function resetFeatures(overrides = {}) { state = {...defaults(), ...overrides}; file = null; sources = {}; }

// --- Haiku Explore agent (a user-level Claude Code agent file) ---------------
const marker = '<!-- managed-by: codex-copilot-relay haikuExplore -->';
export const exploreAgentPath = (home = os.homedir()) => path.join(home, '.claude', 'agents', 'Explore.md');
export const EXPLORE_AGENT = `---
name: Explore
description: Fast, read-only agent for exploring codebases and files. Use it to find files by pattern, search code for keywords, or answer questions about how code is organized. Specify the thoroughness: "quick", "medium" or "very thorough".
tools: Glob, Grep, Read, Bash
model: haiku
---
${marker}
You are a fast, read-only search agent. Find what was asked and report it concisely.

- Never create, modify, move or delete files, and never run commands that change state (no installs, git commits, writes or redirects). Bash is for read-only commands such as ls, git log, git diff or git status only.
- Search broadly first (Glob, Grep), then read only the excerpts you need. Match the requested thoroughness.
- Report absolute file paths with line numbers and the key facts. Quote short excerpts only when they matter. Say clearly what you could not find.
`;
export function exploreAgentStatus(home) {
  const target = exploreAgentPath(home);
  if (!existsSync(target)) return 'absent';
  return readFileSync(target, 'utf8').includes(marker) ? 'managed' : 'user-owned';
}
export function applyExploreAgent(enabled, home) {
  const target = exploreAgentPath(home), status = exploreAgentStatus(home);
  if (status === 'user-owned') throw Object.assign(new Error('An Explore agent you wrote already exists at ' + target + '; the relay will not overwrite or remove it.'), {statusCode:409});
  if (enabled) { mkdirSync(path.dirname(target), {recursive:true}); writeFileSync(target, EXPLORE_AGENT); }
  else if (status === 'managed') rmSync(target, {force:true});
}

// CLI: node relay-features.mjs [list | on <id> | off <id>]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  loadFeatures({runtimeDirectory:path.join(root, 'runtime'), env:{}});
  const [command = 'list', id] = process.argv.slice(2);
  try {
    if (command === 'on' || command === 'off') {
      if (id === 'haikuExplore') applyExploreAgent(command === 'on');
      setFeature(id, command === 'on');
    } else if (command !== 'list') throw new Error('Usage: node relay-features.mjs [list | on <feature> | off <feature>]');
    for (const feature of snapshotFeatures()) console.log((feature.enabled ? '[on]  ' : '[off] ') + feature.id.padEnd(24) + feature.label);
    if (command !== 'list') console.log('Saved. A running relay picks this up at its next start; the dashboard switches apply live.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
