import {createHash} from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function sessionSignature(body, compatibility) {
  const {declarations, modelRouting, sessionTools, ...settings} = compatibility;
  return createHash('sha256').update(JSON.stringify(canonical({
    settings,
    tools: [...sessionTools].sort((left, right) => left.name.localeCompare(right.name)),
    instructions: body.instructions ?? null,
    messages: Array.isArray(body.input) ? body.input.filter(item => ['developer','system','user'].includes(item?.role)) : body.input ?? null,
  }))).digest('hex');
}

export function discoveryDecision(prior, owner, body, compatibility) {
  if (!owner || prior?.owner !== owner) return 'discovery_unidentified';
  return prior.signature === sessionSignature(body, compatibility) ? 'discovery_reused' : 'discovery_contract_changed';
}

export function checkpointPolicy(environment = {}) {
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Math.floor(Number(value)) : fallback;
  return {steps:positive(environment.BRIDGE_CHECKPOINT_STEPS,20), aiCredits:positive(environment.BRIDGE_CHECKPOINT_AI_CREDITS,500), mode:'advisory'};
}

export async function prepareDiscoveryContinuation(outputs, candidates, owner, body, compatibility) {
  if (candidates.length > 1) throw Object.assign(new Error('Tool outputs from multiple Copilot exchanges cannot share one request.'), {statusCode:409});
  if (!outputs.some(item => item.type === 'tool_search_output')) return {outputs, reason:outputs.length ? 'tool_continuation' : 'fresh_task_context'};
  const prior = candidates[0];
  if (!prior) return {outputs:[], reason:'discovery_session_expired'};
  if (prior.sink && !prior.sink.closed) throw Object.assign(new Error('Tool search response is still streaming.'), {statusCode:409});
  const reason = discoveryDecision(prior, owner, body, compatibility);
  if (reason === 'discovery_reused') return {outputs, reason};
  prior.done = true;
  await prior.disconnect();
  return {outputs:[], reason};
}

export function checkpointState(usage = {}, policy = checkpointPolicy()) {
  const steps = usage.sdkApiCalls || 0;
  const aiCredits = usage.creditMeteredApiCalls > 0 ? (usage.totalNanoAiu || 0) / 1e9 : null;
  return {steps, aiCredits, stepCheckpoint:Math.floor(steps / policy.steps), creditCheckpoint:aiCredits === null ? 0 : Math.floor(aiCredits / policy.aiCredits),
    partial: (usage.unmeteredCalls || 0) > 0 || (usage.creditMeteredApiCalls || 0) < steps,
    stepInterval:policy.steps, creditInterval:policy.aiCredits, mode:policy.mode};
}

export function checkpointMessage(usage, policy) {
  const state = checkpointState(usage, policy);
  return '[Relay cost checkpoint, advisory; this task today in America/Los_Angeles: ' + state.steps + ' model steps; ' +
    (state.aiCredits === null ? 'AI credits unreported' : state.aiCredits.toFixed(3) + ' SDK AI credits') +
    (state.partial ? '; partial metering' : '') + '. Give a concise cost/progress checkpoint before more optional iteration. Deliver the reviewable result; do not silently start another creative batch. Continue necessary authorized work and verification. This is not a hard spending cap.]';
}

export const efficiencyInstructions = [
  'Efficiency: invoke already-loaded tools directly. Search only for a missing capability, with a specific query; do not repeatedly rediscover the same tool.',
  'For routine diagnostics, request narrow ranges and bounded output (around 4000 tokens); summarize long logs locally. Read every required skill, safety instruction and relevant evidence fully; never trade verification for brevity.',
  'For creative/editing work, plan at most three revision passes per requested batch unless the user explicitly authorizes more. Deliver a complete reviewable result before additional optional polishing or paid generation. At relay cost checkpoints, report progress and measured cost briefly. Checkpoints are advisory, not a spending cap. Preserve explicit model choices and all external-action approvals.',
];

export function toolOutputPolicy(call = {}) {
  const argumentsText = String(call.arguments ?? call.input ?? '');
  const instructionRead = /AGENTS\.md|SKILL\.md|\.md\b|instructions|documentation|Get-Content|readFile|\bcat\s|\bsed\s/i.test(argumentsText);
  const routine = /exec_command|write_stdin|terminal/i.test(call.name ?? '') && !instructionRead;
  return {maxTextBytes:instructionRead ? Infinity : routine ? 16384 : 65536};
}
