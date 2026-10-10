import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {CopilotClient} from '@github/copilot-sdk';
import {CopilotRuntime, bounded} from '../copilot-runtime.mjs';
import {countModelTokens} from '../context-tokenizer.mjs';
import {prepareVisionAttachments} from '../vision-attachments.mjs';
import {adapterVersion, catalog, digest, historyFingerprint, invalid, nativeHistory, refreshHistoryCache, renderContent, sdkToolName, sessionInput, toolContinuation, validate} from './protocol.mjs';
import {MessageSink} from './stream.mjs';
import {Ledger} from './ledger.mjs';
import {ClaudeRequestHandler} from './request-handler.mjs';
import {providerError} from './errors.mjs';
import {acquireRuntimeLease,defaultRuntimeDirectory} from './runtime-lease.mjs';

const features = Object.freeze({clientTools:true,parallelTools:true,modelDiscovery:true,adaptiveEffort:true,
  provider:'github-copilot-sdk',automaticFallback:false,signedThinking:true,redactedThinking:'fixture-verified',fixedThinkingBudgets:true,hostedTools:false,
  structuredOutputs:'SDK-advertised models only; native grammar validation',strictTools:'SDK-advertised structured-output models only',
  toolChoice:'native, model-specific restrictions',disableParallelTools:true,
  exactTokenCounting:false,anthropicCacheControls:false,autoModeClassifier:'live-tested-agent-fixture',
  remoteControl:false,experimentalBetas:false,thinkingDisplay:'actual upstream native blocks only'});
function json(response, status, body) {
  response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(body));
}
async function readBody(request, maxBytes) {
  let bytes=0; const chunks=[];
  for await (const chunk of request) {
    bytes+=chunk.length;if(bytes>maxBytes)throw invalid('Request body exceeds the isolated gateway byte limit.',413,'request_too_large');
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw invalid('Malformed JSON request.');}
}
const toolId = id => 'toolu_' + id;
const toolKey = (owner,id) => owner+':'+id;
function scope(headers) {
  return digest([headers['x-claude-code-session-id'] ?? 'anonymous',headers['x-claude-code-agent-id'] ?? 'main']);
}
function visionLimits(model) {
  const vision=model.capabilities?.limits?.vision ?? {};
  return {maxImageAttachments:model.capabilities?.supports?.vision===false?0:vision.max_prompt_images ?? 1,
    maxSingleAttachmentBase64Chars:4*Math.ceil((vision.max_prompt_image_size ?? 3145728)/3),
    maxAttachmentBase64Chars:4*1024*1024,supportedMediaTypes:vision.supported_media_types ?? []};
}
function admitContext(body,selected,input){
  if(input.system.length>1000000)throw invalid('System instructions exceed the Copilot upstream character limit.');
  // Local text-token estimate, not the unavailable exact Anthropic count.
  // Apply the same advertised prompt and prompt+output ceilings on every turn.
  const tokens=countModelTokens(input.system+'\n'+input.prompt+'\n'+JSON.stringify(selected.tools)+'\n'+JSON.stringify(body.output_config??{}));
  const limits=selected.model.capabilities?.limits??{};
  if(tokens>(limits.max_prompt_tokens??136000)||tokens+body.max_tokens>(limits.max_context_window_tokens??200000))
    throw invalid('Prompt exceeds the selected model\'s advertised context budget. Compact in Claude Code; no silent truncation.');
  return tokens;
}

class Turn {
  constructor(gateway, session, generation, body, selected, owner) {
    Object.assign(this,{gateway,session,generation,selected,owner});
    this.pending=new Map();this.body=body;this.done=false;this.expectedCalls=[];
    this.unsubscribe=session.on(event=>{try{this.event(event);}catch(error){void this.fail(error);}});
  }
  attach(body, response, row, nativeMessages) {
    this.row=row;
    this.nativeTerminal=null;this.nativeStarted=false;this.nativeStopped=false;this.upstreamFailure=null;
    this.nativeMessages=nativeMessages??body.messages;
    this.gateway.requestHandler?.bind(this.session.sessionId,body,this.selected,nativeMessages,event=>this.nativeEvent(event));
    this.body=body;this.events=[];this.expectedCalls=[];this.lastText='';
    this.sink=new MessageSink(response,body,()=>void this.fail(invalid('Client disconnected; request not replayed.',499,'api_error')),this.gateway.heartbeatMs);
    this.arm(this.gateway.modelTimeoutMs);
  }
  arm(ms) {
    clearTimeout(this.deadline);
    this.deadline=setTimeout(()=>void this.fail(invalid('SDK/tool continuation inactivity deadline reached.',504,'api_error')),ms);
    this.deadline.unref?.();
  }
  nativeEvent(event){
    if(this.done)return;
    if(this.sink&&!this.sink.closed)this.arm(this.gateway.modelTimeoutMs);
    if(event.type.startsWith('relay_transport_')){
      this.gateway.ledger.transport(this.row,event);
      if(event.type==='relay_transport_attempt')this.upstreamFailure=null;
      if(event.type==='relay_transport_response')this.upstreamFailure=event.status>=400?providerError(event.status,event.error):null;
      return;
    }
    if(event.type==='error'){void this.fail(providerError(null,event));return;}
    if(event.type==='message_start'){
      if(this.nativeStarted)throw invalid('Upstream replay after a partial native stream is refused.',502,'api_error');
      this.nativeStarted=true;
    }
    this.sink?.native(event,new Map(this.selected.tools.map((tool,index)=>[sdkToolName(tool,index),tool.name])));
    if(event.type==='message_delta'&&event.delta?.stop_reason){
      const {stop_reason,stop_sequence=null}=event.delta;
      if(!['end_turn','max_tokens','stop_sequence','tool_use','refusal','pause_turn'].includes(stop_reason)
        ||(stop_sequence!==null&&typeof stop_sequence!=='string'))throw invalid('Unknown native stop metadata.',502,'api_error');
      this.nativeTerminal={reason:stop_reason,sequence:stop_sequence};
    }
    if(event.type==='message_stop'){this.nativeStopped=true;this.completeNativeLimit();this.maybeTools();}
  }
  completeNativeLimit(){
    if(this.done||!this.sink||!this.nativeStopped||this.nativeTerminal?.reason!=='max_tokens'||!this.events.length)return;
    this.complete('max_tokens');void this.dispose();
  }
  event(event) {
    if(this.done)return;
    if(this.sink&&!this.sink.closed)this.arm(this.gateway.modelTimeoutMs);
    const data=event.data ?? {};
    if(event.type==='assistant.usage') {
      this.events.push(data);this.gateway.ledger.usage(this.row,data);this.completeNativeLimit();return;
    }
    if(event.type==='assistant.message_delta'){this.sink?.text(data.deltaContent);return;}
    if(event.type==='assistant.message') {
      this.sink?.finishText(data.content ?? '');this.lastText=data.content ?? '';
      this.expectedCalls=(data.toolRequests ?? []).map(call=>call.toolCallId);
      this.maybeTools();return;
    }
    if(event.type==='external_tool.requested') {
      const definition=this.selected.tools.find((tool,index)=>sdkToolName(tool,index)===data.toolName);
      if(!definition)throw invalid('SDK requested an undeclared client tool.',502,'api_error');
      const item={type:'tool_use',id:this.nativeStarted?data.toolCallId:toolId(data.toolCallId),name:definition.name,
        input:typeof data.arguments==='string'?JSON.parse(data.arguments):data.arguments ?? {}};
      const key=toolKey(this.owner,item.id);
      if(this.pending.has(item.id)||this.gateway.byTool.has(key))throw invalid('Duplicate live tool ID; no ownership overwrite.',502,'api_error');
      this.pending.set(item.id,{item,requestId:data.requestId});
      this.gateway.byTool.set(key,this);this.maybeTools();return;
    }
    if(event.type==='session.error') {
      const error=this.upstreamFailure??invalid(String(data.message ?? data.error ?? 'Copilot SDK session failed.'),502,'api_error');
      void this.gateway.runtime.reportFailure?.(error,this.generation);throw error;
    }
    if(event.type==='session.idle' && this.sink&&!this.sink.closed) {
      if(this.expectedCalls.length){this.maybeTools();return;}
      if(!this.sink.blocks.length)throw invalid('Copilot returned an empty completion; not treated as success.',502,'api_error');
      const finish=this.events.at(-1)?.finishReason;
      if(this.nativeStarted&&(!this.nativeTerminal||!this.nativeStopped))throw invalid('Native stream has no verified terminal metadata.',502,'api_error');
      this.complete(this.nativeTerminal?.reason??(finish==='length'?'max_tokens':finish==='content_filter'?'refusal':'end_turn'));void this.dispose();
    }
  }
  maybeTools() {
    if(!this.sink||this.sink.closed||!this.expectedCalls.length
      ||!this.expectedCalls.every(id=>this.pending.has(this.nativeStarted?id:toolId(id))))return;
    if(this.nativeStarted){
      if(!this.nativeStopped||!this.nativeTerminal)return;
      if(this.nativeTerminal.reason!=='tool_use')throw invalid('SDK tools conflict with native termination metadata.',502,'api_error');
      const nativeTools=this.sink.blocks.filter(block=>block.type==='tool_use');
      const execution=block=>block&&{id:block.id,name:block.name,input:block.input};
      // Upstream may add caller/other native metadata which SDK events omit.
      // Preserve it, but compare the actual executable ID/name/arguments only.
      if(nativeTools.length!==this.expectedCalls.length||nativeTools.some(block=>
        digest(execution(block))!==digest(execution(this.pending.get(block.id)?.item))))
        throw invalid('Native/SDK tool ID or input mismatch.',502,'api_error');
    }
    else for(const id of this.expectedCalls)this.sink.tool(this.pending.get(toolId(id)).item);
    this.expectedHistory=[...this.body.messages,{role:'assistant',content:this.sink.blocks}];
    this.upstreamHistory=[...this.nativeMessages,{role:'assistant',content:structuredClone(this.sink.blocks)}];
    this.complete('tool_use');this.arm(this.gateway.toolTimeoutMs);
  }
  complete(reason) {
    this.sink.finish(reason,this.events,this.nativeTerminal?.sequence??null);this.gateway.ledger.finish(this.row,'completed');this.sink=null;
  }
  async continue(body, response, row, results, selected, suffix) {
    // Admission already proved identical model/system/executable catalog and
    // owner. Use the current validated metadata so moved/removed tool cache
    // markers reach the native hook, never another owner's retained selection.
    this.selected=selected;
    // Claim ownership before awaiting image preparation or SDK continuation.
    this.attach(body,response,row,[...this.upstreamHistory,...suffix]);
    try {
      const allImages=[];for(const message of suffix)renderContent(message.content,allImages);
      const allPacked=await prepareVisionAttachments(allImages,visionLimits(this.selected.model));
      if(this.done)return;
      this.nativeMessages=refreshHistoryCache([...this.upstreamHistory,
        ...nativeHistory(suffix,allImages,allPacked)],body.messages);
      this.gateway.requestHandler?.bind(this.session.sessionId,body,this.selected,this.nativeMessages,event=>this.nativeEvent(event));
      for(const result of results) {
        const call=this.pending.get(result.tool_use_id);const images=[];
        let text=renderContent(result.content ?? '',images);
        const packed=await prepareVisionAttachments(images,visionLimits(this.selected.model));
        if(this.done)return;
        if(packed.note)text+='\n'+packed.note;
        this.pending.delete(result.tool_use_id);this.gateway.byTool.delete(toolKey(this.owner,result.tool_use_id));
        await this.session.rpc.tools.handlePendingToolCall({requestId:call.requestId,result:{
          textResultForLlm:text,resultType:result.is_error?'failure':'success',
          ...(packed.attachments.length?{binaryResultsForLlm:packed.attachments.map(image=>({type:'image',
            data:image.data,mimeType:image.mimeType,description:image.displayName}))}:{})}});
      }
    }catch(error){await this.fail(error);}
  }
  async fail(error) {
    if(this.done)return;
    this.gateway.onFault?.(error,this);
    this.gateway.ledger.failure(this.row,error,'failed',this.sink?.blocks.length);
    this.sink?.fail(error);await this.dispose();
  }
  async dispose() {
    if(this.done)return;this.done=true;clearTimeout(this.deadline);this.unsubscribe?.();
    this.gateway.turns.delete(this);for(const id of this.pending.keys()){
      const key=toolKey(this.owner,id);if(this.gateway.byTool.get(key)===this)this.gateway.byTool.delete(key);
    }
    this.pending.clear();this.gateway.runtime.release(this.session);
    this.gateway.requestHandler?.release(this.session.sessionId);
    await bounded(()=>this.session.abort(),2500,'SDK cancellation').catch(()=>{});
    await bounded(()=>this.session.disconnect(),2500,'SDK cleanup').catch(()=>{});
  }
}

export async function createGateway({runtime,models,token,workingDirectory=process.cwd(),ledger=new Ledger(),
  heartbeatMs=15000,modelTimeoutMs=900000,toolTimeoutMs=13*60*60*1000,maxBodyBytes=64*1024*1024,onRequest,onFault,requestHandler,mountPort}={}) {
  if(typeof token!=='string'||token.length<24)throw new Error('A random local gateway token of at least 24 characters is required.');
  if(!catalog(models).length)throw new Error('No supported Claude models are exposed by the authenticated SDK.');
  const gateway={runtime,models,ledger,heartbeatMs,modelTimeoutMs,toolTimeoutMs,requestHandler,onFault,turns:new Set(),byTool:new Map()};
  if(mountPort!==undefined&&(!Number.isInteger(mountPort)||mountPort<1024||mountPort>65535))throw new Error('Invalid mounted gateway port.');
  const handle=async(request,response)=>{
    let row,turn,onAdmissionClose,rebuilding;
    const cancelled=()=>invalid('Client disconnected; request not replayed.',499,'api_error');
    const assertOpen=()=>{if(response.destroyed)throw cancelled();};
    const detachAdmission=()=>{if(onAdmissionClose)response.off('close',onAdmissionClose);};
    try {
      const authority='127.0.0.1:'+(mountPort??server.address().port);
      if(request.headers.host!==authority||request.headers.origin||request.headers['sec-fetch-site']==='cross-site')
        throw invalid('Loopback CLI requests only; browser origins/DNS rebinding are rejected.',403,'permission_error');
      const supplied=request.headers.authorization?.replace(/^Bearer /,'') ?? request.headers['x-api-key'] ?? '';
      const left=Buffer.from(String(supplied)),right=Buffer.from(token);
      if(left.length!==right.length||!timingSafeEqual(left,right))throw invalid('Invalid local gateway credential.',401,'authentication_error');
      const url=new URL(request.url,'http://'+authority);
      if(request.method==='GET'&&url.pathname==='/health')return json(response,200,{ok:true,version:adapterVersion,
        client:'claude-code',sdk:runtime.snapshot(),activeTurns:gateway.turns.size,features,models:catalog(models)});
      if(request.method==='GET'&&url.pathname==='/metrics')return json(response,200,{...ledger.state,provider:'github-copilot-sdk',
        openaiInferenceCalls:0,anthropicDirectInferenceCalls:0,creditUnit:'AI credits = totalNanoAiu / 1e9; null means unreported'});
      if(request.method==='GET'&&url.pathname==='/v1/models') {
        const data=catalog(models);return json(response,200,{data,has_more:false,first_id:data[0].id,last_id:data.at(-1).id});
      }
      if(request.method==='HEAD'&&url.pathname==='/api/hello'){response.writeHead(200);return response.end();}
      if(request.method==='POST'&&url.pathname==='/v1/messages/count_tokens')
        throw invalid('Exact Anthropic token counting unavailable through the SDK. Claude Code may use its own estimate.',501,'api_error');
      if(request.method!=='POST'||url.pathname!=='/v1/messages')throw invalid('Unknown isolated gateway endpoint.',404,'not_found_error');
      // Every authenticated Messages request owns one receipt, even if it never
      // reaches parsing/model admission or an asynchronously created SDK session.
      row=ledger.start(null,request.headers,null);
      onAdmissionClose=()=>{if(!response.writableFinished)ledger.failure(row,cancelled());};
      response.once('close',onAdmissionClose);
      if(request.headers['anthropic-version']!=='2023-06-01')throw invalid('anthropic-version must be 2023-06-01.');
      const body=await readBody(request,maxBodyBytes);
      assertOpen();ledger.select(row,body,null);
      onRequest?.(body,request.headers);
      const selected=validate(body,models,{betaHeader:request.headers['anthropic-beta']});
      ledger.select(row,body,selected);
      const owner=scope(request.headers);
      const continuation=toolContinuation(body),results=continuation.results;
      const holders=new Set(results.map(item=>gateway.byTool.get(toolKey(owner,item.tool_use_id))).filter(Boolean));
      if(holders.size>1)throw invalid('Tool results mix multiple sessions.');
      const holder=[...holders][0];
      if(!holder&&results.some(item=>[...gateway.byTool.values()].some(turn=>turn.pending.has(item.tool_use_id))))
        throw invalid('Live tool result belongs to a different owner.',409);
      if(holder) {
        if(holder.sink||holder.rebuilding)throw invalid('Another request is already continuing these tools.',409);
        if(owner!==holder.owner||selected.model.id!==holder.selected.model.id)throw invalid('Tool continuation owner or model changed; start a fresh conversation.',409);
        if(historyFingerprint(body.messages.slice(0,continuation.index))!==historyFingerprint(holder.expectedHistory))throw invalid('Tool continuation history prefix changed.',409);
        if(new Set(results.map(item=>item.tool_use_id)).size!==holder.pending.size
          ||results.length!==holder.pending.size||results.some(item=>!holder.pending.has(item.tool_use_id)))throw invalid('Provide every outstanding tool result exactly once.',409);
        // Use the retained native prefix, including relay image-overview notes,
        // not only the client prefix. Reject before attaching/consuming results
        // so a smaller, valid retry keeps the same owned SDK tool continuation.
        admitContext(body,selected,sessionInput({...body,messages:[...holder.upstreamHistory,...continuation.messages]}));
        // validate() enforces results-first ordering. The full native user
        // message and trailing system reminders go through continue() and the SDK
        // request hook; only tool_result blocks resolve pending client tools.
        if(selected.signature===holder.selected.signature){
          assertOpen();turn=holder;detachAdmission();
          return await holder.continue(body,response,row,results,selected,continuation.messages);
        }
        // A Messages client may change generation controls, system text or its
        // catalog on the next request. Rebuild from its full validated history;
        // never feed results into an SDK session with stale settings. Pending
        // executable tool definitions remain bound until their results arrive.
        for(const {item} of holder.pending.values()){
          const executable=tool=>tool&&{name:tool.name,input_schema:tool.input_schema,strict:tool.strict??false};
          if(digest(executable(selected.tools.find(tool=>tool.name===item.name))??null)!==
            digest(executable(holder.selected.tools.find(tool=>tool.name===item.name))??null))
            throw invalid('Pending tool executable catalog changed; finish it with its original schema.',409);
        }
        row.continuationMode='rebuilt';
        row.continuationChanges=Object.keys(selected.bindingHashes).filter(key=>selected.bindingHashes[key]!==holder.selected.bindingHashes[key]);
        holder.rebuilding=true;rebuilding=holder;
      }
      // A persisted client transcript can be rebuilt after relay restart. Never
      // replay client tool execution or pretend SDK thinking survived restart.
      const input=sessionInput(body);
      if(input.system.length>1000000)throw invalid('System instructions exceed the Copilot upstream character limit.');
      const packed=await prepareVisionAttachments(input.attachments,visionLimits(selected.model));
      assertOpen();
      const nativeMessages=nativeHistory(body.messages,input.attachments,packed);
      if(body.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>['thinking','redacted_thinking'].includes(block.type)))
        &&historyFingerprint(nativeMessages)!==historyFingerprint(body.messages))
        throw invalid('Signed transcript images cannot be repacked without changing their native prefix. Use smaller images before starting the turn.');
      if(packed.note)input.prompt+='\n'+packed.note;
      const inputTokens=admitContext(body,selected,input);
      const tools=selected.tools.map((tool,index)=>({name:sdkToolName(tool,index),
        description:`Client tool ${tool.name}. ${tool.description ?? ''}`,parameters:tool.input_schema,defer:'never',skipPermission:true}));
      const {session,generation}=await runtime.createSession({clientName:'claude-code-copilot-relay-preview',model:selected.model.id,
        reasoningEffort:selected.effort,streaming:true,workingDirectory,
        contextTier:inputTokens>200000?'long_context':'default',modelCapabilities:{limits:{max_output_tokens:body.max_tokens}},
        enableConfigDiscovery:false,skipCustomInstructions:true,skillDirectories:[],pluginDirectories:[],instructionDirectories:[],
        mcpServers:{},memory:{enabled:false},largeOutput:{enabled:false},infiniteSessions:{enabled:false},
        enableSessionStore:false,enableFileChangeTracking:false,customAgentsLocalOnly:true,tools,
        toolSearch:{enabled:false},availableTools:tools.length&&selected.choice.type!=='none'?['custom:*']:[],excludedTools:['builtin:*','mcp:*'],
        systemMessage:{mode:'replace',content:input.system}});
      turn=new Turn(gateway,session,generation,body,selected,owner);turn.row=row;gateway.turns.add(turn);
      // Cancellation can happen while session creation awaits. The eventual
      // owned session must be released without ever sending its prompt.
      assertOpen();
      if(rebuilding){await rebuilding.dispose();rebuilding=null;assertOpen();}
      detachAdmission();
      turn.attach(body,response,row,nativeMessages);
      void session.send({prompt:input.prompt,attachments:packed.attachments}).catch(error=>turn.fail(error));
    }catch(error){
      if(rebuilding)rebuilding.rebuilding=false;
      detachAdmission();
      error.statusCode??=turn?502:500;
      if(turn)await turn.fail(error);
      else ledger.failure(row,error,error.statusCode>=400&&error.statusCode<500&&error.statusCode!==499?'rejected':'failed');
      if(response.destroyed||response.writableEnded)return;
      if(!response.headersSent)json(response,error.statusCode??500,{type:'error',error:{type:error.type??'api_error',message:error.message}});else response.destroy();
    }finally{if(rebuilding)rebuilding.rebuilding=false;}
  };
  const server=http.createServer(handle);
  server.requestTimeout=120000;server.headersTimeout=30000;server.timeout=0;
  gateway.server=server;
  gateway.handle=handle;gateway.mountPort=mountPort;
  let closing;
  gateway.close=()=>closing??=(async()=>{
    await Promise.all([...gateway.turns].map(turn=>turn.fail(invalid('Isolated gateway shutting down.',503,'api_error'))));
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await runtime.stop();
  })();
  gateway.listen=port=>new Promise((resolve,reject)=>{
    if(!Number.isInteger(port)||port<0||port>65535||port===4144)return reject(new Error('Choose an isolated port other than Codex port 4144.'));
    server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address()));});
  return gateway;
}

export async function startSdkGateway({token,port=4246,workingDirectory=process.cwd(),onRequest,onFault,requestHandler,
  runtimeDirectory,runtimeFactory,mountPort}={}) {
  if(typeof token!=='string'||token.length<24)throw new Error('Set a random local gateway token with at least 24 characters.');
  if(!Number.isInteger(port)||port<0||port>65535||port===4144)throw new Error('Choose an isolated port other than Codex port 4144.');
  const lease=acquireRuntimeLease(runtimeDirectory??defaultRuntimeDirectory(port));
  let gateway,runtime;
  try {
    // Acquire ownership before Ledger recovery can change an unfinished row,
    // and before any SDK worker/auth/model-discovery activity starts.
    const ledger=new Ledger(path.join(lease.directory,'ledger.json'));
    requestHandler??=new ClaudeRequestHandler();
    runtime=runtimeFactory?runtimeFactory():new CopilotRuntime({maxSessions:16,createClient:()=>new CopilotClient({mode:'copilot-cli',
      logLevel:'error',useLoggedInUser:true,workingDirectory,sessionIdleTimeoutSeconds:0,requestHandler}),
      onLost(generation,error){for(const turn of gateway?.turns??[])if(turn.generation===generation)void turn.fail(error);}});
    await runtime.start();const models=await (await runtime.ready()).listModels();
    gateway=await createGateway({runtime,models,token,workingDirectory,ledger,onRequest,onFault,requestHandler,mountPort});
    if(mountPort===undefined)await gateway.listen(port);
    const close=gateway.close;let closing;
    gateway.close=()=>closing??=(async()=>{try{await close();}finally{lease.release();}})();
    return gateway;
  }catch(error){try{if(gateway)await gateway.close();else await runtime?.stop();}finally{lease.release();}throw error;}
}
export async function run() {
  const gateway=await startSdkGateway({token:process.env.CLAUDE_RELAY_TOKEN,port:Number(process.env.CLAUDE_RELAY_PORT??4246),
    workingDirectory:process.env.CLAUDE_RELAY_CWD??process.cwd(),runtimeDirectory:process.env.CLAUDE_RELAY_RUNTIME});
  console.log(JSON.stringify({ready:true,port:gateway.server.address().port,version:adapterVersion,provider:'github-copilot-sdk',
    models:catalog(gateway.models).map(model=>model.id)}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void gateway.close().then(()=>process.exit()));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))run().catch(error=>{console.error(error.message);process.exitCode=1;});
