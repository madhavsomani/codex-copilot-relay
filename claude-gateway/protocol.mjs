import {createHash} from 'node:crypto';

export const adapterVersion = '0.1.29';
export const digest = value => createHash('sha256').update(stable(value)).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
// Ignore API cache annotations only at known protocol block boundaries, never
// inside user tool arguments or JSON schemas (which can use that property name).
function unmark(value) {
  const {cache_control,...rest}=value;
  return rest;
}
export function historyFingerprint(messages,tools=[]) {
  const normalize=block=>{
    const result=unmark(block);
    // Stock Claude omits the transport's default direct caller when replaying
    // tools. Ignore only that exact protocol metadata, never tool arguments or
    // code-execution callers. The retained upstream prefix still keeps caller.
    if(block.type==='tool_use'&&stable(block.caller)==='{"type":"direct"}')delete result.caller;
    if(block.type==='tool_use'&&block.name==='Edit'&&block.input?.replace_all===false){
      const schema=tools.find(tool=>tool.name==='Edit')?.input_schema;
      if(schema?.properties?.replace_all?.type==='boolean'&&schema.properties.replace_all.default===false
        &&!schema.required?.includes('replace_all')){
        const {replace_all,...input}=block.input;
        result.input=input;
      }
    }
    return result;
  };
  const content=value => (typeof value==='string' ? [{type:'text',text:value}] : value)
    .map(block => block.type==='tool_result' ? {...normalize(block),content:content(block.content??'')} : normalize(block));
  return stable(messages.map(message=>({...unmark(message),content:content(message.content)})));
}
export function refreshHistoryCache(nativeMessages,clientMessages){
  // Caching annotations move between stock-client turns. They are not signed
  // content. Refresh only protocol-boundary annotations, never signatures,
  // redactions, image pixels, tool arguments, or the retained direct caller.
  const clear=value=>blocks(value,'content').map(block=>{
    const result=unmark(block);
    if(block.type==='tool_result')result.content=typeof block.content==='string'?block.content:clear(block.content??'');
    return result;
  });
  const mirror=(native,client)=>{
    if(typeof native==='string'&&typeof client==='string')return native;
    const result=clear(native),source=blocks(client??'','content');
    if(result.length!==source.length){
      if(result.length&&source.at(-1)?.cache_control!==undefined)result.at(-1).cache_control=source.at(-1).cache_control;
      return result;
    }
    return result.map((block,index)=>{
      const other=source[index];
      if(block.type!==other.type)return block;
      if(other.cache_control!==undefined)block.cache_control=other.cache_control;
      if(block.type==='tool_result')block.content=mirror(block.content,other.content??'');
      return block;
    });
  };
  if(nativeMessages.length!==clientMessages.length)throw invalid('Native/cache history message boundaries changed.',409);
  return nativeMessages.map((message,index)=>{
    const {cache_control,...result}=message;
    const client=clientMessages[index];
    if(client.cache_control!==undefined)result.cache_control=client.cache_control;
    result.content=typeof message.content==='string'&&typeof client.content==='string'?message.content:mirror(message.content,client.content);
    return result;
  });
}
// Diagnose a strict-prefix rejection without persisting either prefix or hashes
// of user text. The diagnostic never relaxes signature or ownership admission.
export function historyMismatch(expected,received,tools=[]){
  const shape=value=>typeof value==='string'?[{type:'text',text:value}]:value;
  const detail={expectedMessages:expected.length,receivedMessages:received.length};
  for(let i=0;i<Math.min(expected.length,received.length);i++){
    const a=expected[i],b=received[i];
    if(historyFingerprint([a],tools)===historyFingerprint([b],tools))continue;
    detail.messageIndex=i;
    if(a.role!==b.role)return {...detail,reason:'message-role'};
    const aa=shape(a.content),bb=shape(b.content);
    if(aa.length!==bb.length)return {...detail,reason:'block-count',expectedBlocks:aa.length,receivedBlocks:bb.length};
    for(let j=0;j<aa.length;j++)if(historyFingerprint([{role:a.role,content:[aa[j]]}],tools)!==historyFingerprint([{role:b.role,content:[bb[j]]}],tools)){
      return {...detail,blockIndex:j,reason:aa[j].type!==bb[j].type?'block-type':
        ['thinking','redacted_thinking'].includes(aa[j].type)?'signed-content':
        aa[j].type==='tool_use'?'tool-call':aa[j].type==='tool_result'?'tool-result':'content'};
    }
    return {...detail,reason:'message-metadata'};
  }
  return {...detail,reason:'message-count'};
}
export function invalid(message, statusCode = 400, type = 'invalid_request_error') {
  return Object.assign(new Error(message), {statusCode, type,
    ...(statusCode>=400&&statusCode<500&&![408,429].includes(statusCode)?{shouldRetry:'false'}:{})});
}
// Client names can be 128 characters. Keep SDK-owned names within a conservative
// 64-character budget, with deterministic per-catalog ownership and no truncation
// collisions. Only transport names change; client tools retain their exact names.
export function sdkToolName(tool,index){
  const prefix='client_'+index+'_';
  return prefix+(prefix.length+tool.name.length<=64?tool.name:digest(tool.name).slice(0,32));
}
export const anthropicId = id => id.replace(/(\d)\.(\d)/g, '$1-$2');
export function catalog(models) {
  return models.filter(model => /^claude-(opus|sonnet|haiku)-[\d.]+$/.test(model.id)&&model.policy?.state!=='disabled')
    .map(model => ({id: anthropicId(model.id), display_name: model.name ?? model.id,
      description: 'Via authenticated GitHub Copilot SDK; Copilot usage applies',
      type: 'model', created_at: '1970-01-01T00:00:00Z', copilot_id: model.id}));
}
export function resolveModel(requested, models) {
  const model = models.find(model => model.id.startsWith('claude-')&&model.policy?.state!=='disabled'
    && (model.id === requested || anthropicId(model.id) === requested));
  if (!model) throw invalid(`Model ${JSON.stringify(requested)} is not exposed by this authenticated Copilot account.`, 404, 'not_found_error');
  return model;
}
const topKeys = new Set(['model','max_tokens','messages','system','tools','tool_choice','stream',
  'thinking','output_config','metadata','temperature','top_p','top_k','stop_sequences','context_management']);
function blocks(value, label) {
  if (typeof value === 'string') return [{type: 'text', text: value}];
  if (!Array.isArray(value)) throw invalid(`${label} must be a string or content-block array.`);
  if (value.some(block => !block || typeof block !== 'object' || Array.isArray(block))) throw invalid(`${label} contains a malformed content block.`);
  return value;
}
// Stock Claude sends PDFs and plain-text documents as native document blocks,
// either in user content or inside a Read tool result. Forward them unchanged;
// the relay never fetches URLs or file IDs and never converts their contents.
function checkDocument(block){
  const source=block.source;
  const ok=source?.type==='base64'&&source.media_type==='application/pdf'&&typeof source.data==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(source.data)
    ||source?.type==='text'&&source.media_type==='text/plain'&&typeof source.data==='string';
  if(!ok)throw invalid('Only embedded base64 PDF or plain-text document blocks are supported; URLs/files are never fetched by the relay.');
  if(Object.keys(block).some(key=>!['type','source','title','context','citations','cache_control'].includes(key)))
    throw invalid('Unsupported document block fields.');
}
export function betaControls(value){
  if(value===undefined||value==='')return [];
  if(typeof value!=='string'||value.length>4096)throw invalid('anthropic-beta must be a bounded comma-separated control list.');
  const tokens=value.split(',').map(token=>token.trim());
  if(tokens.length>32||tokens.some(token=>!/^[A-Za-z0-9_.-]{1,128}$/.test(token)))
    throw invalid('Malformed anthropic-beta control list.');
  return [...new Set(tokens)];
}
export function validate(body, models, {betaHeader}={}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Expected a Messages request object.');
  for (const key of Object.keys(body)) if (!topKeys.has(key))
    throw invalid(`Unsupported request field ${key}; no silent pass-through or inference fallback. Disable experimental betas for this preview.`);
  const model = resolveModel(body.model, models);
  const betas=betaControls(betaHeader);
  const limits = model.capabilities?.limits ?? {};
  if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1
    || body.max_tokens > (limits.max_output_tokens ?? 64000)) throw invalid('max_tokens is outside this model\'s advertised output limit.');
  if (body.stream != null && typeof body.stream !== 'boolean') throw invalid('stream must be boolean.');
  for(const key of ['temperature','top_p'])if(body[key]!=null&&(!Number.isFinite(body[key])||body[key]<0||body[key]>1))throw invalid(`${key} must be between 0 and 1.`);
  if(body.top_k!=null&&(!Number.isSafeInteger(body.top_k)||body.top_k<0))throw invalid('top_k must be a nonnegative integer.');
  if(body.stop_sequences!=null&&(!Array.isArray(body.stop_sequences)||body.stop_sequences.length>100||body.stop_sequences.some(s=>typeof s!=='string'||s.length>1000)))throw invalid('stop_sequences must be a bounded string array.');
  const output = body.output_config === undefined ? {} : body.output_config;
  if(!output||typeof output!=='object'||Array.isArray(output))throw invalid('output_config must be an object.');
  if (Object.keys(output).some(key => !['effort','format'].includes(key))) throw invalid('output_config supports effort and native JSON schema format only; task budgets are unsupported.');
  if(output.format!==undefined){
    const format=output.format;
    if(!format||typeof format!=='object'||Array.isArray(format)||format.type!=='json_schema'
      ||Object.keys(format).some(key=>!['type','schema'].includes(key))
      ||!format.schema||typeof format.schema!=='object'||Array.isArray(format.schema))
      throw invalid('output_config.format requires type json_schema and an object schema.');
    if(model.capabilities?.supports?.structured_outputs!==true)
      throw invalid(`Native structured outputs are not advertised by Copilot for ${model.id}.`);
    // Upstream owns JSON Schema dialect/grammar validation. Never weaken a
    // schema, coerce its output or turn refusals/truncation into repaired JSON.
  }
  const efforts = model.supportedReasoningEfforts ?? [];
  // Absence means provider default, not an invented measured effort.
  const effort = output.effort;
  if (effort && !efforts.includes(effort)) throw invalid(`output_config.effort: ${model.id} does not support ${effort}.`);
  if (body.thinking) {
    if (!['adaptive','enabled','disabled'].includes(body.thinking.type)
      || Object.keys(body.thinking).some(key => !['type','display','budget_tokens'].includes(key)))
      throw invalid('Unknown thinking controls; signature-binding controls are unsupported.');
    if(body.thinking.type==='enabled'&&(!Number.isSafeInteger(body.thinking.budget_tokens)
      ||body.thinking.budget_tokens<1024||body.thinking.budget_tokens>=body.max_tokens))
      throw invalid('Fixed thinking budget must be at least 1024 and below max_tokens.');
    if(body.thinking.type!=='enabled'&&body.thinking.budget_tokens!==undefined)
      throw invalid('budget_tokens requires thinking.type enabled.');
    if (body.thinking.type==='adaptive'&&model.capabilities?.supports?.adaptive_thinking === 'unsupported') throw invalid('This model does not support adaptive thinking.');
  }
  const tools = body.tools ?? [];
  if (!Array.isArray(tools) || tools.length > 500) throw invalid('tools must be an array of at most 500 client tools.');
  const names = new Set();
  tools.forEach(tool => {
    if(/^web_search_/.test(tool?.type??''))throw invalid('Anthropic hosted web search is unsupported by Copilot. Use the configured relay_browser MCP tools and relay-browser-research skill, or explicitly configure a search connector. No provider fallback was attempted.');
    if (!tool || (tool.type && tool.type !== 'custom')) throw invalid(`Input tag '${tool?.type}' is not supported: hosted/advisor tools require a separate implementation.`);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(tool.name) || names.has(tool.name)) throw invalid('Tool names must be unique, 1-128 letters/digits/underscore/hyphen.');
    names.add(tool.name);
    if (!tool.input_schema || typeof tool.input_schema !== 'object' || tool.input_schema.type !== 'object') throw invalid('Client tools require an object input_schema.');
    if(tool.strict!==undefined&&typeof tool.strict!=='boolean')throw invalid('Tool strict must be boolean.');
    if(tool.strict===true&&model.capabilities?.supports?.structured_outputs!==true)
      throw invalid(`Native strict tools/structured outputs are not advertised by Copilot for ${model.id}.`);
    // Tool search: deferred definitions load when a tool_reference names them.
    for(const key of ['defer_loading','eager_input_streaming'])
      if(tool[key]!==undefined&&typeof tool[key]!=='boolean')throw invalid(`Tool ${key} must be boolean.`);
    if (Object.keys(tool).some(key => !['type','name','description','input_schema','cache_control','strict','defer_loading','eager_input_streaming'].includes(key)))
      throw invalid(`Unsupported tool schema fields for ${tool.name}; disable experimental betas.`);
  });
  if(tools.length&&tools.every(tool=>tool.defer_loading===true))throw invalid('At least one tool must not be deferred.');
  if(body.context_management!==undefined&&(!body.context_management||typeof body.context_management!=='object'||Array.isArray(body.context_management)))
    throw invalid('context_management must be an object.');
  if(tools.filter(tool=>tool.strict===true).length>20)throw invalid('At most 20 native strict tools are supported per request.');
  const choice = body.tool_choice === undefined ? {type:tools.length?'auto':'none'} : body.tool_choice;
  if(!choice||typeof choice!=='object'||Array.isArray(choice))throw invalid('tool_choice must be an object.');
  if (!['auto','none','any','tool'].includes(choice.type)) throw invalid('Unknown tool_choice type.');
  const allowedChoice=choice.type==='tool'?['type','name','disable_parallel_tool_use']
    :choice.type==='none'?['type']:['type','disable_parallel_tool_use'];
  if(Object.keys(choice).some(key=>!allowedChoice.includes(key)))throw invalid('Unknown or inapplicable tool_choice field.');
  if(choice.disable_parallel_tool_use!==undefined&&typeof choice.disable_parallel_tool_use!=='boolean')
    throw invalid('disable_parallel_tool_use must be boolean.');
  if(choice.type==='any'||choice.type==='tool'){
    if(!tools.length||choice.type==='tool'&&!names.has(choice.name))throw invalid('Forced tool choice requires a declared tool.');
    if(['claude-opus-5.5','claude-sonnet-5.5'].includes(model.id)||body.thinking?.type==='enabled')
      throw invalid(`Forced tool choice is not supported for ${model.id} or manual enabled thinking; use auto or none.`);
  }
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 10000) throw invalid('messages must be a non-empty bounded array.');
  for (const block of blocks(body.system ?? '', 'system')) if (block.type !== 'text' || typeof block.text !== 'string') throw invalid('system supports text blocks only.');
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw invalid('Malformed message object.');
    if (!['user','assistant','system'].includes(message.role)) throw invalid('Unknown message role.');
    let hasUserContent=false;
    for (const block of blocks(message.content, 'message.content')) {
      // A client-only tool turn may append user text/images after every result.
      // Keep the exact native order; never disguise the suffix as tool output.
      if(block.type==='tool_result'&&hasUserContent)throw invalid('tool_result blocks must come first, before additional user content.');
      if(block.type!=='tool_result')hasUserContent=true;
      if (!['text','image','document','tool_use','tool_result','thinking','redacted_thinking'].includes(block.type)) throw invalid(`Unsupported content block ${block.type}; no silent stripping.`);
      if(block.type==='document'){if(message.role!=='user')throw invalid('document blocks belong in user content.');checkDocument(block);}
      if(block.type==='thinking'&&(message.role!=='assistant'||typeof block.thinking!=='string'
        ||typeof block.signature!=='string'||!block.signature))throw invalid('Assistant thinking requires its original opaque signature and text.');
      if(block.type==='redacted_thinking'&&(message.role!=='assistant'||typeof block.data!=='string'||!block.data))
        throw invalid('Assistant redacted_thinking requires original opaque data.');
      if (block.type === 'text' && typeof block.text !== 'string') throw invalid('text block requires text.');
      if (block.type === 'tool_use' && (message.role !== 'assistant' || typeof block.id !== 'string'
        || typeof block.name !== 'string' || !block.input || typeof block.input !== 'object' || Array.isArray(block.input))) throw invalid('Malformed assistant tool_use.');
      if (block.type === 'tool_result') {
        if (message.role !== 'user' || typeof block.tool_use_id !== 'string') throw invalid('Malformed user tool_result.');
        for (const result of blocks(block.content ?? '', 'tool_result.content')){
          if (!['text','image','document','tool_reference'].includes(result.type)) throw invalid('tool_result supports text, embedded images, documents and tool references only.');
          if(result.type==='document')checkDocument(result);
          if(result.type==='tool_reference'&&(typeof result.tool_name!=='string'||Object.keys(result).some(key=>!['type','tool_name','cache_control'].includes(key))))
            throw invalid('Malformed tool_reference block.');
        }
      }
    }
  }
  const binding={system:historyFingerprint([{role:'system',content:body.system ?? ''}]),
      tools:(body.tools??[]).map(unmark),model:model.id,effort,format:output.format,betas:[...betas].sort(),choice,thinking:body.thinking,maxTokens:body.max_tokens,
      temperature:body.temperature,top_p:body.top_p,top_k:body.top_k,stop_sequences:body.stop_sequences,contextManagement:body.context_management};
  return {model,effort,tools,choice,betas,signature:digest(binding),
    bindingHashes:Object.fromEntries(Object.entries(binding).map(([key,value])=>[key,digest(value??null)]))};
}
export function renderContent(content, attachments = []) {
  return blocks(content, 'content').map(block => {
    if (block.type === 'text') return block.text;
    // Bootstrap/token admission only. The request hook sends these blocks in
    // their native positions; never turn an opaque signature into reasoning.
    // Signatures/redacted data are opaque protocol bytes, not text tokens.
    // Serializing them inflated both our estimate and the SDK's static-context
    // estimate, blocking even /compact before the native request hook ran.
    // Keep visible reasoning in the estimate; native history is untouched.
    if (block.type === 'thinking') return `[Native thinking]\n${block.thinking}`;
    if (block.type === 'redacted_thinking') return '[Opaque native redacted thinking]';
    if (block.type === 'image') {
      const source = block.source;
      if (source?.type !== 'base64' || !['image/jpeg','image/png','image/webp','image/gif'].includes(source.media_type)
        || typeof source.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.data)) throw invalid('Only embedded base64 raster images are supported; URLs/files are never fetched by the relay.');
      const name = `client-image-${attachments.length + 1}`;
      attachments.push({type:'blob',mimeType:source.media_type,data:source.data,displayName:name});
      return `[Image attachment: ${name}]`;
    }
    // Bootstrap/token admission only; the request hook forwards the native block.
    if (block.type === 'tool_reference') return `[Tool reference: ${block.tool_name}]`;
    if (block.type === 'document') return `[Document attachment${typeof block.title==='string'?': '+block.title.slice(0,200):''}]`;
    if (block.type === 'tool_use') return `[Assistant called ${block.name}; id=${block.id}; input=${JSON.stringify(block.input)}]`;
    if (block.type === 'tool_result') return `[Client tool result id=${block.tool_use_id}; failed=${Boolean(block.is_error)}]\n${renderContent(block.content ?? '', attachments)}`;
    throw invalid(`Unsupported content block ${block.type}.`);
  }).join('\n');
}
export function sessionInput(body) {
  const attachments = [];
  return {system:renderContent(body.system ?? '', attachments),
    prompt:body.messages.map(message => `[${message.role.toUpperCase()}]\n${renderContent(message.content, attachments)}`).join('\n\n'), attachments};
}
export function nativeHistory(messages,original,packed){
  if(!original.length)return messages;
  let index=0;
  const direct=original.length===packed.attachments.length;
  const walk=value=>blocks(value,'content').map(block=>{
    // A new image elsewhere must not rewrite plain-string tool outputs.
    if(block.type==='tool_result')return typeof block.content==='string'||block.content===undefined
      ?block:{...block,content:walk(block.content)};
    if(block.type!=='image')return block;
    const i=index++;
    if(!direct)return {type:'text',text:`[Image source ${i+1}; see the labelled overview attached to this request.]`};
    const image=packed.attachments[i];
    return {...block,source:{type:'base64',media_type:image.mimeType,data:image.data}};
  });
  const result=messages.map(message=>({...message,content:walk(message.content)}));
  if(!direct||packed.note){
    const last=result.findLast(message=>message.role==='user');
    if(!last)throw invalid('Images require a user message.');
    last.content.push({type:'text',text:packed.note||'[Images packed by the relay.]'});
    if(!direct)for(const image of packed.attachments)last.content.push({type:'image',
      source:{type:'base64',media_type:image.mimeType,data:image.data}});
  }
  return result;
}
export function toolContinuation(body) {
  // Stock Claude may append system reminders after its result-bearing user
  // message. Retain that entire suffix, but never search past a later user or
  // assistant message and accidentally consume an older completed tool turn.
  let index=body.messages.length-1;
  while(index>=0&&body.messages[index].role==='system')index--;
  const resultsIn=message=>message?.role==='user'?blocks(message.content,'content').filter(block=>block.type==='tool_result'):[];
  let results=resultsIn(body.messages[index]);
  if(results.length){
    let cursor=index-1;
    while(cursor>=0){
      while(cursor>=0&&body.messages[cursor].role==='system')cursor--;
      const previous=resultsIn(body.messages[cursor]);
      if(!previous.length)break;
      results=[...previous,...results];index=cursor;cursor--;
    }
  }
  return {index,messages:index<0?[]:body.messages.slice(index),results};
}
export function toolResults(body) {
  return toolContinuation(body).results;
}
export function messageUsage(events) {
  const sum = key => events.reduce((total,event) => total + (Number.isFinite(event[key]) ? event[key] : 0),0);
  // Copilot normalizes prompt tokens INCLUDING cache reads/writes. Anthropic
  // input_tokens EXCLUDES them. Preserve the actual cache breakdown separately.
  const cacheRead = sum('cacheReadTokens'), cacheWrite = sum('cacheWriteTokens');
  return {input_tokens:Math.max(0,sum('inputTokens')-cacheRead-cacheWrite),output_tokens:sum('outputTokens'),
    cache_read_input_tokens:cacheRead,cache_creation_input_tokens:cacheWrite};
}
