import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModelCompatibility, extractToolDeclarations, buildSessionInput, assertSerializedContextWithinLimit} from './bridge-core.mjs';
import {prepareContextTools, serializeContextTools, contextEventFields} from './context-policy.mjs';
import {countModelTokens} from './context-tokenizer.mjs';

const model = {
  capabilities: {limits: {max_context_window_tokens: 1_000_000, max_prompt_tokens: 872_000, max_output_tokens: 128_000}},
  billing: {tokenPrices: {maxPromptTokens: 272_000, longContext: {maxPromptTokens: 872_000}}},
};

test('standard tier stays at 400k with a 272k prompt instead of opting into 1M', () => {
  const limits = resolveModelCompatibility(model);
  assert.equal(limits.contextTier, 'default');
  assert.equal(limits.maxPromptTokens, 272_000);
  assert.equal(limits.maxContextWindowTokens, 400_000);
  assert.equal(limits.maxOutputTokens, 128_000);
});

test('standard pricing budgets stay model-specific and never exceed capability limits', () => {
  const luna = structuredClone(model);
  luna.billing.tokenPrices.maxPromptTokens = 200_000;
  assert.equal(resolveModelCompatibility(luna).maxPromptTokens, 200_000);
  assert.equal(resolveModelCompatibility(luna).maxContextWindowTokens, 328_000);
  const smaller = structuredClone(model);
  smaller.capabilities.limits.max_prompt_tokens = 128_000;
  assert.equal(resolveModelCompatibility(smaller).maxPromptTokens, 128_000);
  assert.equal(resolveModelCompatibility({}).maxPromptTokens, null);
});

function toolCatalog(count) {
  return [{type: 'function', name: 'exec_command', description: 'Run local commands', parameters: {type: 'object'}},
    ...Array.from({length: count}, (_, index) => ({type: 'namespace', name: 'mcp__example', tools: [{
      type: 'function', name: 'lookup_' + index, description: 'Lookup record ' + index + '. Preserve approvals.',
      strict: true, parameters: {type: 'object', properties: {query: {type: 'string', description: 'Detailed parameter guidance. '.repeat(150)}}, required: ['query']},
    }]}))];
}

test('large catalogs defer definitions without losing tools, schemas or approvals', () => {
  const declarations = extractToolDeclarations({tools: toolCatalog(1000)});
  const original = JSON.stringify(declarations.sdkTools);
  const tools = prepareContextTools(declarations);
  assert.equal(tools.length, 1001);
  assert.equal(tools[0].defer, 'never');
  assert.ok(tools.slice(1).every(tool => tool.defer === 'auto'));
  assert.deepEqual(tools[1].parameters, declarations.sdkTools[1].parameters);
  assert.equal(tools[1].description, declarations.sdkTools[1].description);
  assert.equal(tools[1].skipPermission, declarations.sdkTools[1].skipPermission);
  assert.equal(JSON.stringify(declarations.sdkTools), original);
  const serialized = serializeContextTools(tools);
  assert.ok(serialized.length < original.length / 8);
  const budget = {maxSerializedTextTokens: 272_000, countTokens: countModelTokens, serializedToolDefinitions: serialized};
  const input = buildSessionInput({instructions: 'Preserve all approval requirements.', input: 'Run the requested check.'}, process.cwd(), budget);
  assert.doesNotThrow(() => assertSerializedContextWithinLimit(input, tools, budget));
  assert.ok(input.contextStats.serializedTextTokens < 100_000);
});

test('small catalogs and specifically selected tools remain eager', () => {
  const declarations = extractToolDeclarations({tools: toolCatalog(2)});
  assert.deepEqual(prepareContextTools(declarations), declarations.sdkTools);
  assert.equal(serializeContextTools([]), '[]');
  const selected = {...declarations.sdkTools[1], defer: 'never'};
  assert.equal(JSON.parse(serializeContextTools([selected]))[0].description, selected.description);
});

test('native Codex image generation stays immediately callable in a large catalog', () => {
  const native = {type:'namespace',name:'image_gen',tools:[{type:'function',name:'imagegen',description:'Native generation; preserve approvals.',parameters:{type:'object',properties:{prompt:{type:'string'}}}}]};
  const declarations = extractToolDeclarations({tools:[...toolCatalog(50),native]});
  const image = declarations.metadata.find(item=>item.namespace==='image_gen');
  const tools = prepareContextTools(declarations);
  assert.equal(tools.find(tool=>tool.name===image.internalName).defer,'never');
  const input = buildSessionInput({tools:[native],input:'Generate the requested asset.'});
  assert.match(input.systemContent,/native.*image_gen\.imagegen/i);
  assert.match(input.systemContent,/not Copilot credits/);
  assert.match(input.systemContent,/explicitly requests.*fallback/);
  assert.doesNotMatch(buildSessionInput({input:'Hello'}).systemContent,/native.*image_gen\.imagegen/i);
});

test('loaded search schemas are referenced once without deleting changed historical definitions', () => {
  const original = {type:'function',name:'lookup',description:'Preserve every permission rule.',parameters:{type:'object',properties:{query:{type:'string',description:'Detailed exact field guidance. '.repeat(300)}}}};
  const namespace = {type:'namespace',name:'mcp__audit',description:'Namespace safety instructions stay here.',tools:[original]};
  const body = {tools:[],input:[{type:'tool_search_output',call_id:'search_1',tools:[namespace]},{role:'user',content:'Use the lookup.'}]};
  const declarations = extractToolDeclarations(body);
  const baseline = buildSessionInput(body);
  const optimized = buildSessionInput(body,process.cwd(),{registeredToolNames:declarations.sdkTools.map(tool=>tool.name)});
  assert.ok(optimized.prompt.length < baseline.prompt.length / 3);
  assert.equal(optimized.contextStats.deduplicatedSearchTools,1);
  assert.ok(optimized.contextStats.deduplicatedSearchChars > 8000);
  assert.match(optimized.prompt,/Namespace safety instructions stay here/);
  assert.match(optimized.prompt,/search_1/);
  assert.match(optimized.prompt,/registered declaration/);
  assert.equal(declarations.sdkTools[0].description.includes(original.description),true);
  assert.deepEqual(declarations.sdkTools[0].parameters,original.parameters);
  assert.match(buildSessionInput(body,process.cwd(),{registeredToolNames:[]}).prompt,/Detailed exact field guidance/);
  const changed = structuredClone(namespace);changed.tools[0].description='Changed permission rule.';
  body.input.splice(1,0,{type:'tool_search_output',call_id:'search_2',tools:[changed]});
  const revised = buildSessionInput(body,process.cwd(),{registeredToolNames:declarations.sdkTools.map(tool=>tool.name)});
  assert.match(revised.prompt,/Preserve every permission rule/);
  assert.equal(revised.contextStats.deduplicatedSearchTools,1);
});

test('namespace-level deferral survives flattening and discovery stays loaded', () => {
  const definition = {type: 'namespace', name: 'mcp__audit', defer_loading: true, tools: [{
    type: 'function', name: 'lookup', description: 'Exact lookup constraints', parameters: {type: 'object'},
  }]};
  const body = {tools: [definition]};
  assert.equal(extractToolDeclarations(body).sdkTools[0].defer, 'auto');
  body.tools.push(...toolCatalog(40));
  body.input = [{type: 'tool_search_output', call_id: 'search_1', execution: 'client', tools: [definition]}];
  const declared = extractToolDeclarations(body);
  const lookup = declared.metadata.find(item => item.namespace === 'mcp__audit');
  assert.equal(prepareContextTools(declared).find(item => item.name === lookup.internalName).defer, 'never');
});

test('context accounting must not silently shorten deferred descriptions', () => {
  const description = 'Exact safety constraints. '.repeat(100);
  const serialized = JSON.parse(serializeContextTools([{name: 'lookup', defer: 'auto', description, parameters: {type: 'object'}}]));
  assert.equal(serialized[0].description, description);
});

test('compaction telemetry exposes only numeric context and success, never content', () => {
  assert.deepEqual(contextEventFields({type: 'session.compaction_complete', data: {
    success: true, preCompactionTokens: 230000, postCompactionTokens: 80000, summaryContent: 'private',
  }}), {success: true, preCompactionTokens: 230000, postCompactionTokens: 80000});
  assert.equal(contextEventFields({type: 'assistant.message', data: {content: 'private'}}), null);
});

test('standard budget compacts growing history after lazy catalog admission', () => {
  const tools = prepareContextTools(extractToolDeclarations({tools: toolCatalog(1000)}));
  const input = Array.from({length: 350}, (_, index) => ({role: 'assistant', content: 'Old step ' + index + ': ' + 'history '.repeat(1800)}));
  input.push({role: 'user', content: 'LATEST_REQUEST_KEEP: validate saved results; do not publish.'});
  const budget = {maxSerializedTextTokens: 272_000, countTokens: countModelTokens, serializedToolDefinitions: serializeContextTools(tools)};
  const compacted = buildSessionInput({instructions: 'APPROVAL_RULE_KEEP', input}, process.cwd(), budget);
  assert.equal(compacted.contextStats.historyCompacted, true);
  assert.ok(compacted.contextStats.omittedHistoryEntries > 0);
  assert.ok(compacted.contextStats.serializedTextTokens <= 244_800);
  assert.match(compacted.systemContent, /APPROVAL_RULE_KEEP/);
  assert.match(compacted.prompt, /LATEST_REQUEST_KEEP/);
  assert.doesNotThrow(() => assertSerializedContextWithinLimit(compacted, tools, budget));
});
