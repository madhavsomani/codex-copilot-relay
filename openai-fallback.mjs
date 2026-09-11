// Optional public-API transport. Never reads Codex auth stores or reuses its
// subscription tokens. The default gateway remains Copilot-only.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import WebSocket, {WebSocketServer} from 'ws';
import {ProviderUsageObserver} from './provider-usage-observer.mjs';
import {featureFailure} from './provider-telemetry.mjs';

const ORIGIN = 'https://api.openai.com';
const MAX_BODY = 128 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, code='openai_fallback_unavailable', statusCode=503) => Object.assign(new Error(message),{code,statusCode});
const secureEqual = (a,b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left=Buffer.from(a), right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
};

export function fallbackConfig(environment=process.env) {
  return {enabled:environment.RELAY_OPENAI_ENABLED==='1',
    apiKey:environment.RELAY_OPENAI_API_KEY || '',
    localToken:environment.RELAY_OPENAI_LOCAL_TOKEN || '',
    model:environment.RELAY_OPENAI_MODEL || '',
    organization:environment.RELAY_OPENAI_ORGANIZATION || '',
    project:environment.RELAY_OPENAI_PROJECT || ''};
}

export function authorizeFallback(request, config) {
  if (!config.enabled) throw fail('Explicit public OpenAI services are disabled. See docs/HYBRID-SETUP.md.', 'openai_fallback_disabled',501);
  if (!config.apiKey || config.localToken.length<32)
    throw fail('Configure RELAY_OPENAI_API_KEY and a separate RELAY_OPENAI_LOCAL_TOKEN (at least 32 characters).');
  // A webpage, even localhost, must not be able to spend this account's money.
  if (request.headers.origin) throw fail('Browser origins are not allowed on the paid gateway. Use a trusted local backend.', 'origin_forbidden',403);
  const host = request.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) throw fail('Invalid local Host header.','invalid_host',403);
  const token=request.headers['x-relay-openai-token'] || request.headers.authorization?.replace(/^Bearer /,'');
  if (!secureEqual(token, config.localToken)) throw fail('Missing or invalid local OpenAI gateway token.', 'unauthorized',401);
}

export function responseFallbackReason(body, {knownResponse=false}={}) {
  if (typeof body?.model==='string' && body.model.startsWith('openai/')) return 'explicit_openai_model';
  if (knownResponse) return 'openai_continuation';
  // No capability-driven fallback. A hosted declaration is not permission to
  // move an ordinary Copilot model turn (and its whole history) to OpenAI.
  return null;
}

export function openAIResponseBody(body, config) {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw fail('Expected a Responses JSON object.','invalid_request',400);
  const explicit=typeof body.model==='string' && body.model.startsWith('openai/');
  const model=explicit ? body.model.slice(7) : config.model;
  if (!model || !/^[\w.:-]+$/.test(model)) throw fail('Set RELAY_OPENAI_MODEL to an available OpenAI model, or request openai/<model>.','openai_model_required',400);
  // Preserve tools, content, sampling, storage and safety fields exactly. Do not
  // translate hosted computer calls into local actions or acknowledge safety checks.
  return {...body,model};
}

export function upstreamPath(url, method) {
  const pathname=url.pathname.replace(/^\/v1\/openai\//,'/v1/');
  const allowed = [
    [/^\/v1\/responses$/,['POST']],
    [/^\/v1\/responses\/[A-Za-z0-9_-]+(?:\/input_items)?$/,['GET','DELETE']],
    [/^\/v1\/responses\/[A-Za-z0-9_-]+\/cancel$/,['POST']],
    [/^\/v1\/images\/(generations|edits|variations)$/,['POST']],
    [/^\/v1\/files(?:\/[A-Za-z0-9_-]+(?:\/content)?)?$/,['GET','POST','DELETE']],
    [/^\/v1\/vector_stores(?:\/[A-Za-z0-9_-]+(?:\/(?:files|file_batches|search)(?:\/[A-Za-z0-9_-]+(?:\/(?:cancel|files|content))?)?)?)?$/,['GET','POST','DELETE']],
    [/^\/v1\/containers(?:\/[A-Za-z0-9_-]+(?:\/files(?:\/[A-Za-z0-9_-]+(?:\/content)?)?)?)?$/,['GET','POST','DELETE']],
    [/^\/v1\/realtime\/(?:client_secrets|calls(?:\/[A-Za-z0-9_-]+\/(?:accept|reject|refer|hangup))?)$/,['POST']],
    [/^\/v1\/audio\/(?:speech|transcriptions|translations)$/,['POST']],
  ];
  if (!allowed.some(([pattern,methods])=>pattern.test(pathname)&&methods.includes(method)))
    throw fail('This public OpenAI route/method is not supported by the relay.','unsupported_openai_route',404);
  return pathname + url.search;
}

export class OpenAIResponseRoutes {
  constructor(directory) {
    this.file=directory ? path.join(directory,'openai-response-routes.json') : null;
    this.entries=new Map();
    if (this.file && fs.existsSync(this.file)) {
      try {if (fs.statSync(this.file).size>2_000_000) throw new Error();
        const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
        for (const [key,time] of data) if (/^[a-f0-9]{64}$/.test(key) && Number.isFinite(time)) this.entries.set(key,time);
      } catch {throw fail('OpenAI route metadata is unreadable; repair it before enabling fallback.','route_metadata_invalid');}
    }
    this.prune();
  }
  prune() {
    for (const [key,time] of this.entries) if (Date.now()-time>30*86400_000) this.entries.delete(key);
    while(this.entries.size>10_000) this.entries.delete(this.entries.keys().next().value);
  }
  has(id) {this.prune();return typeof id==='string' && this.entries.has(hash(id));}
  remember(id) {
    if (typeof id!=='string'||!/^resp_[\w-]+$/.test(id)) return;
    const key=hash(id); if(this.entries.has(key)) return;
    this.entries.set(key,Date.now());this.prune();
    if (this.file) {fs.mkdirSync(path.dirname(this.file),{recursive:true});
      fs.writeFileSync(this.file+'.tmp',JSON.stringify([...this.entries]),{mode:0o600});
      fs.renameSync(this.file+'.tmp',this.file);}
  }
}

async function readRaw(request) {
  if(Number(request.headers['content-length'])>MAX_BODY)throw fail('Public API upload exceeds 128 MiB.','request_too_large',413);
  const chunks=[];let count=0;
  for await(const chunk of request){count+=chunk.length;if(count>MAX_BODY)throw fail('Public API upload exceeds 128 MiB.','request_too_large',413);chunks.push(chunk);}
  return Buffer.concat(chunks,count);
}

export class OpenAIFallback {
  constructor({directory,config=()=>fallbackConfig(),fetchImpl=fetch,WebSocketImpl=WebSocket,log=()=>{},telemetry}={}) {
    this.config=config;this.fetch=fetchImpl;this.WebSocket=WebSocketImpl;this.log=log;
    this.telemetry=telemetry;
    this.metadataError=null;
    try {this.routes=new OpenAIResponseRoutes(directory);}
    catch(error) {this.metadataError=error;this.routes=new OpenAIResponseRoutes();}
    this.jobs=new Set();
    this.wss=new WebSocketServer({noServer:true,maxPayload:4*1024*1024,perMessageDeflate:false});
  }
  health() {const c=this.config();return {enabled:c.enabled,configured:Boolean(c.apiKey&&c.localToken.length>=32),
    backend:'openai-platform',automaticFallback:false,billing:'Separate OpenAI Platform billing; not Copilot or ChatGPT subscription',
    activeJobs:this.jobs.size,responseRouteCount:this.routes.entries.size,error:this.metadataError?.code ?? null,
    realtime:'WebSocket and WebRTC signaling API; desktop voice integration not verified'};}
  admit(request) {const c=this.config();authorizeFallback(request,c);
    if(this.metadataError)throw this.metadataError;
    if(this.jobs.size>=8)throw fail('OpenAI gateway has eight active jobs. Retry when a slot is free.','openai_gateway_busy',429);
    return c;}
  headers(c) {return {authorization:'Bearer '+c.apiKey,
    ...(c.organization?{'OpenAI-Organization':c.organization}:{}),...(c.project?{'OpenAI-Project':c.project}:{})};}
  observe(record,event,{billable=true}={}) {
    const value=event.response||event;
    if(value.object==='response'||event.response)this.routes.remember(value.id);
    if(value.model && /^[\w.:-]{1,120}$/.test(value.model) && record)record.model=value.model;
    if(event.session?.model&&record&&/^[\w.:-]{1,120}$/.test(event.session.model))record.model=event.session.model;
    const terminal=!event.type||['response.done','response.completed','response.failed','response.incomplete','image_generation.completed','image_edit.completed','conversation.item.input_audio_transcription.completed'].includes(event.type);
    if(value.usage&&terminal)this.telemetry?.usage(record,value.usage,{key:value.id||event.item_id||record?.id,model:value.model,billable});
    if(event.type==='rate_limits.updated')this.telemetry?.observeLimit(record,'observed',null,event.rate_limits);
    const error=event.error||value.error||value.status_details?.error;
    if(error&&record) {record.observedError=featureFailure(error);if(['quota_exhausted','rate_limited'].includes(record.observedError))this.telemetry?.observeLimit(record,record.observedError);}
    if(value.status==='failed'&&record)record.observedError||='feature_unavailable';
    if(record&&['incomplete','cancelled'].includes(value.status))record.outcome=value.status;
  }
  async forward(request,response,url,{body,reason='explicit_endpoint'}={}) {
    const record=this.telemetry?.start({provider:'openai-platform',kind:url.pathname.replace('/v1/openai/','/v1/').split('/')[2]});
    let c,route;
    try{c=this.admit(request);route=upstreamPath(url,request.method);}
    catch(error){this.telemetry?.finish(record,{status:'rejected',error,statusCode:error.statusCode});throw error;}
    const controller=new AbortController();this.jobs.add(controller);
    const cancel=()=>{if(!response.writableEnded)controller.abort();};
    response.once('close',cancel);request.once('aborted',cancel);
    let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),15*60_000);timer.unref();};touch();
    let status='failed',reportedError=null,statusCode=null,retryAfter=null;
    try {
      let payload=body;
      const hasBody=!['GET','HEAD','DELETE'].includes(request.method);
      if(payload===undefined&&hasBody)payload=await readRaw(request);
      if(route.split('?')[0]==='/v1/responses'&&request.method==='POST') {
        if(Buffer.isBuffer(payload)){try{payload=JSON.parse(payload.toString('utf8'));}catch{throw fail('Invalid Responses JSON.','invalid_json',400);}}
        // Explicit /openai/responses accepts ordinary native model IDs too.
        if(url.pathname.startsWith('/v1/openai/')&&typeof payload?.model==='string'&&!payload.model.startsWith('openai/'))
          payload={...payload,model:'openai/'+payload.model};
        payload=openAIResponseBody(payload,c);if(record)record.model=payload.model;
        payload=Buffer.from(JSON.stringify(payload));
      } else if(payload!==undefined&&!Buffer.isBuffer(payload))payload=Buffer.from(JSON.stringify(payload));
      if(record&&!record.model&&payload&&String(request.headers['content-type']).includes('application/json')){
        const metadata=new ProviderUsageObserver('application/json',value=>{if(/^[\w.:-]{1,120}$/.test(value.model||''))record.model=value.model;});
        await metadata.chunk(payload);await metadata.end();
      }
      const headers={...this.headers(c),accept:request.headers.accept || '*/*'};
      for(const key of ['openai-safety-identifier','openai-beta','idempotency-key'])
        if(request.headers[key])headers[key]=request.headers[key];
      if(hasBody)headers['content-type']=route.startsWith('/v1/responses')?'application/json':(request.headers['content-type']||'application/json');
      // These headers contain neither caller auth nor cookies; upstream is fixed.
      this.telemetry?.submitted(record);
      const upstream=await this.fetch(ORIGIN+route,{method:request.method,headers,body:hasBody?payload:undefined,signal:controller.signal,redirect:'manual'});
      statusCode=upstream.status;retryAfter=Number(upstream.headers.get('retry-after'))||null;
      if(upstream.status>=300&&upstream.status<400)throw fail('OpenAI returned a redirect; not followed.','upstream_redirect',502);
      const responseHeaders={'content-type':upstream.headers.get('content-type')||'application/json',
        'cache-control':'no-store','x-relay-backend':'openai-platform','x-relay-route-reason':reason};
      for(const key of ['retry-after','x-request-id','content-disposition'])if(upstream.headers.has(key))responseHeaders[key]=upstream.headers.get(key);
      response.writeHead(upstream.status,responseHeaders);
      const observer=new ProviderUsageObserver(responseHeaders['content-type'],event=>this.observe(record,event,{billable:request.method==='POST'}));
      if(upstream.body)for await(const chunk of upstream.body){touch();await observer.chunk(chunk);
        if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});}
      await observer.end();response.end();status=upstream.ok&&!record?.observedError?(record?.outcome||'completed'):'failed';
      reportedError=record?.observedError||(upstream.ok?null:{code:upstream.status===429?'rate_limit_exceeded':'upstream_error'});
    } catch(error) {
      reportedError=error;
      if(response.headersSent){response.destroy();}
      else if(!response.destroyed){const code=error.code||'openai_upstream_failed';response.writeHead(error.statusCode||502,{'content-type':'application/json','cache-control':'no-store'});
        response.end(JSON.stringify({error:{code,message:error.statusCode?error.message:'OpenAI request failed or timed out. No automatic retry was performed.'}}));}
    } finally {clearTimeout(timer);response.off('close',cancel);request.off('aborted',cancel);this.jobs.delete(controller);
      this.telemetry?.finish(record,{status,error:reportedError,statusCode});
      if(record?.status==='limited'&&retryAfter)this.telemetry?.observeLimit(record,record.errorCode,retryAfter);
      this.log('openai_gateway.request',{backend:'openai-platform',reason,status});}
  }
  attachRealtime(server) {
    server.on('upgrade',(request,socket,head)=>{
      let url,c,record;
      const reject=(status,message)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);};
      try {url=new URL(request.url,'http://127.0.0.1');
        if(!['/v1/realtime','/v1/openai/realtime'].includes(url.pathname))throw fail('Unsupported WebSocket endpoint.','not_found',404);
        if([...url.searchParams.keys()].some(key=>!['model','intent'].includes(key)))throw fail('Unsupported Realtime query parameter.','invalid_query',400);
        if(request.headers['sec-websocket-protocol'])throw fail('Use server-side header authentication, not credential-bearing WebSocket subprotocols.','invalid_protocol',400);
        record=this.telemetry?.start({provider:'openai-platform',kind:'voice',model:url.searchParams.get('model')});
        c=this.admit(request);
      } catch(error){this.telemetry?.finish(record,{status:'rejected',error,statusCode:error.statusCode});reject(error.statusCode||503,error.message);return;}
      let upstream;
      try {this.telemetry?.submitted(record);upstream=new this.WebSocket('wss://api.openai.com/v1/realtime'+url.search,
        {headers:{...this.headers(c),...(request.headers['openai-safety-identifier']?{'OpenAI-Safety-Identifier':request.headers['openai-safety-identifier']}:{})},
          handshakeTimeout:15_000,maxPayload:4*1024*1024,perMessageDeflate:false,followRedirects:false});}
      catch {this.telemetry?.finish(record,{status:'failed',error:'connection_failed'});reject(502,'Unable to open the configured OpenAI Realtime connection.');return;}
      let client,closed=false;let heartbeat,lifetime;
      let observation=Promise.resolve();
      const job={abort:()=>close()};this.jobs.add(job);
      const close=()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);this.jobs.delete(job);
        observation.finally(()=>this.telemetry?.finish(record,{status:record?.observedError?'failed':'completed',error:record?.observedError}));
        upstream.on('error',()=>{});
        if(upstream.readyState===WebSocket.OPEN)upstream.close();else if(upstream.readyState===WebSocket.CONNECTING)upstream.terminate();
        if(client?.readyState===WebSocket.OPEN)client.close();
        const cleanup=setTimeout(()=>{upstream.terminate();client?.terminate();if(!client)socket.destroy();},1000);cleanup.unref();};
      socket.once('close',close);
      upstream.once('unexpected-response',(_req,res)=>{if(record)record.observedError=featureFailure({},res.statusCode);res.resume();reject(res.statusCode===401?502:res.statusCode,'OpenAI Realtime rejected the connection.');close();});
      upstream.on('error',()=>{if(record)record.observedError='connection_failed';if(client)client.close(1011,'OpenAI Realtime connection failed');else reject(502,'OpenAI Realtime connection failed');close();});
      upstream.once('open',()=>{if(closed||socket.destroyed){close();return;}
        this.wss.handleUpgrade(request,socket,head,ws=>{client=ws;
          const relay=(source,target)=>source.on('message',(data,isBinary)=>{
            if(source===upstream&&!isBinary&&data.length<256*1024){
              observation=observation.then(()=>{try{this.observe(record,JSON.parse(data.toString()));}catch{}});
            }
            if(target.readyState!==WebSocket.OPEN||target.bufferedAmount>16*1024*1024){close();return;}
            target.send(data,{binary:isBinary},error=>{if(error)close();});});
          relay(client,upstream);relay(upstream,client);
          client.on('error',close);client.once('close',close);upstream.once('close',(code)=>{if(client.readyState===WebSocket.OPEN)client.close(code===1005?1000:code===1006?1011:code);close();});
          let lastClientPong=Date.now(),lastUpstreamPong=Date.now();
          client.on('pong',()=>{lastClientPong=Date.now();});upstream.on('pong',()=>{lastUpstreamPong=Date.now();});
          heartbeat=setInterval(()=>{
            if(Date.now()-Math.min(lastClientPong,lastUpstreamPong)>90_000){client.close(1011,'Realtime heartbeat timed out');close();return;}
            if(client.readyState===WebSocket.OPEN)client.ping();if(upstream.readyState===WebSocket.OPEN)upstream.ping();
          },30_000);heartbeat.unref();
          lifetime=setTimeout(()=>{client.close(1000,'Relay session limit: reconnect');close();},60*60_000);lifetime.unref();
          this.log('openai_gateway.realtime',{backend:'openai-platform',status:'connected'});
        });
      });
    });
  }
  close() {for(const job of this.jobs)job.abort();this.wss.close();}
}
