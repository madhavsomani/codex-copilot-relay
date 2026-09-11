// Optional public-API transport. Never reads Codex auth stores or reuses its
// subscription tokens. The default gateway remains Copilot-only.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import WebSocket, {WebSocketServer} from 'ws';
import {validateSearchDeclaration} from './native-codex-tools.mjs';

const ORIGIN = 'https://api.openai.com';
const MAX_BODY = 128 * 1024 * 1024;
const HOSTED = new Set(['file_search','code_interpreter','computer_use_preview','computer','image_generation']);
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
  if (!config.enabled) throw fail('Public OpenAI fallback is disabled. See docs/HYBRID-SETUP.md.', 'openai_fallback_disabled',501);
  if (!config.apiKey || config.localToken.length<32)
    throw fail('Configure RELAY_OPENAI_API_KEY and a separate RELAY_OPENAI_LOCAL_TOKEN (at least 32 characters).');
  // A webpage, even localhost, must not be able to spend this account's money.
  if (request.headers.origin) throw fail('Browser origins are not allowed on the paid gateway. Use a trusted local backend.', 'origin_forbidden',403);
  const host = request.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) throw fail('Invalid local Host header.','invalid_host',403);
  const token=request.headers['x-relay-openai-token'] || request.headers.authorization?.replace(/^Bearer /,'');
  if (!secureEqual(token, config.localToken)) throw fail('Missing or invalid local OpenAI gateway token.', 'unauthorized',401);
}

export function responseFallbackReason(body, {nativeEnabled=false, knownResponse=false}={}) {
  if (typeof body?.model==='string' && body.model.startsWith('openai/')) return 'explicit_openai_model';
  if (knownResponse) return 'openai_continuation';
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
    if (HOSTED.has(tool?.type)) return 'hosted_' + tool.type;
    if (['web_search','web_search_preview'].includes(tool?.type)) {
      if (!nativeEnabled) return 'hosted_web_search';
      try {validateSearchDeclaration(tool);} catch {return 'extended_web_search';}
      if (body.max_tool_calls != null) return 'extended_web_search';
    }
  }
  if (body?.store===true || body?.background===true) return 'stored_response';
  if (body?.text?.format && body.text.format.type!=='text') return 'structured_output';
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

// Observe only response IDs in bounded event lines; never retain image/audio
// bodies, prompts, API keys, cookies, or opaque reasoning in gateway telemetry.
function responseObserver(contentType, remember) {
  const decoder=new StringDecoder('utf8');let line='',discard=false,json='';
  const isSse=contentType.includes('text/event-stream');
  const observe=text=>{try {const value=JSON.parse(text);remember(value.response?.id || (value.object==='response'?value.id:null));}catch{}};
  return {chunk(bytes){const text=decoder.write(bytes);
    if(!isSse){
      if(json.length<65536) {
        json=(json+text).slice(0,65536);
        // Responses containing base64 images can be enormous. Read just the
        // envelope prefix for affinity, without buffering generated media.
        if(/"object"\s*:\s*"response"/.test(json)) {
          const id=/"id"\s*:\s*"(resp_[\w-]+)"/.exec(json);if(id)remember(id[1]);
        }
      }
      return;
    }
    for(const part of text.split(/(?<=\n)/)) {
      if(!discard)line+=part;
      if(line.length>65536){line='';discard=true;}
      if(part.endsWith('\n')) {if(!discard && line.startsWith('data:'))observe(line.slice(5).trim());line='';discard=false;}
    }
  },end(){if(!isSse&&json.length<2_000_000)observe(json+decoder.end());}};
}

async function readRaw(request) {
  if(Number(request.headers['content-length'])>MAX_BODY)throw fail('Public API upload exceeds 128 MiB.','request_too_large',413);
  const chunks=[];let count=0;
  for await(const chunk of request){count+=chunk.length;if(count>MAX_BODY)throw fail('Public API upload exceeds 128 MiB.','request_too_large',413);chunks.push(chunk);}
  return Buffer.concat(chunks,count);
}

export class OpenAIFallback {
  constructor({directory,config=()=>fallbackConfig(),fetchImpl=fetch,WebSocketImpl=WebSocket,log=()=>{}}={}) {
    this.config=config;this.fetch=fetchImpl;this.WebSocket=WebSocketImpl;this.log=log;
    this.metadataError=null;
    try {this.routes=new OpenAIResponseRoutes(directory);}
    catch(error) {this.metadataError=error;this.routes=new OpenAIResponseRoutes();}
    this.jobs=new Set();
    this.wss=new WebSocketServer({noServer:true,maxPayload:4*1024*1024,perMessageDeflate:false});
  }
  health() {const c=this.config();return {enabled:c.enabled,configured:Boolean(c.apiKey&&c.localToken.length>=32),
    backend:'openai-platform',billing:'Separate OpenAI Platform billing; not Copilot or ChatGPT subscription',
    activeJobs:this.jobs.size,responseRouteCount:this.routes.entries.size,error:this.metadataError?.code ?? null,
    realtime:'WebSocket and WebRTC signaling API; desktop voice integration not verified'};}
  admit(request) {const c=this.config();authorizeFallback(request,c);
    if(this.metadataError)throw this.metadataError;
    if(this.jobs.size>=8)throw fail('OpenAI gateway has eight active jobs. Retry when a slot is free.','openai_gateway_busy',429);
    return c;}
  headers(c) {return {authorization:'Bearer '+c.apiKey,
    ...(c.organization?{'OpenAI-Organization':c.organization}:{}),...(c.project?{'OpenAI-Project':c.project}:{})};}
  async forward(request,response,url,{body,reason='explicit_endpoint'}={}) {
    const c=this.admit(request), route=upstreamPath(url,request.method);
    const controller=new AbortController();this.jobs.add(controller);
    const cancel=()=>{if(!response.writableEnded)controller.abort();};
    response.once('close',cancel);request.once('aborted',cancel);
    let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),15*60_000);timer.unref();};touch();
    let status='failed';
    try {
      let payload=body;
      const hasBody=!['GET','HEAD','DELETE'].includes(request.method);
      if(payload===undefined&&hasBody)payload=await readRaw(request);
      if(route.split('?')[0]==='/v1/responses'&&request.method==='POST') {
        if(Buffer.isBuffer(payload)){try{payload=JSON.parse(payload.toString('utf8'));}catch{throw fail('Invalid Responses JSON.','invalid_json',400);}}
        // Explicit /openai/responses accepts ordinary native model IDs too.
        if(url.pathname.startsWith('/v1/openai/')&&typeof payload?.model==='string'&&!payload.model.startsWith('openai/'))
          payload={...payload,model:'openai/'+payload.model};
        payload=Buffer.from(JSON.stringify(openAIResponseBody(payload,c)));
      } else if(payload!==undefined&&!Buffer.isBuffer(payload))payload=Buffer.from(JSON.stringify(payload));
      const headers={...this.headers(c),accept:request.headers.accept || '*/*'};
      for(const key of ['openai-safety-identifier','openai-beta','idempotency-key'])
        if(request.headers[key])headers[key]=request.headers[key];
      if(hasBody)headers['content-type']=route.startsWith('/v1/responses')?'application/json':(request.headers['content-type']||'application/json');
      // These headers contain neither caller auth nor cookies; upstream is fixed.
      const upstream=await this.fetch(ORIGIN+route,{method:request.method,headers,body:hasBody?payload:undefined,signal:controller.signal,redirect:'manual'});
      if(upstream.status>=300&&upstream.status<400)throw fail('OpenAI returned a redirect; not followed.','upstream_redirect',502);
      const responseHeaders={'content-type':upstream.headers.get('content-type')||'application/json',
        'cache-control':'no-store','x-relay-backend':'openai-platform','x-relay-route-reason':reason};
      for(const key of ['retry-after','x-request-id','content-disposition'])if(upstream.headers.has(key))responseHeaders[key]=upstream.headers.get(key);
      response.writeHead(upstream.status,responseHeaders);
      const observer=responseObserver(responseHeaders['content-type'],id=>this.routes.remember(id));
      if(upstream.body)for await(const chunk of upstream.body){touch();observer.chunk(chunk);
        if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});}
      observer.end();response.end();status=upstream.ok?'completed':'upstream_error';
    } catch(error) {
      if(response.headersSent){response.destroy();}
      else if(!response.destroyed){const code=error.code||'openai_upstream_failed';response.writeHead(error.statusCode||502,{'content-type':'application/json','cache-control':'no-store'});
        response.end(JSON.stringify({error:{code,message:error.statusCode?error.message:'OpenAI request failed or timed out. No automatic retry was performed.'}}));}
    } finally {clearTimeout(timer);response.off('close',cancel);request.off('aborted',cancel);this.jobs.delete(controller);
      this.log('openai_gateway.request',{backend:'openai-platform',reason,status});}
  }
  attachRealtime(server) {
    server.on('upgrade',(request,socket,head)=>{
      let url,c;
      const reject=(status,message)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);};
      try {url=new URL(request.url,'http://127.0.0.1');
        if(!['/v1/realtime','/v1/openai/realtime'].includes(url.pathname))throw fail('Unsupported WebSocket endpoint.','not_found',404);
        if([...url.searchParams.keys()].some(key=>!['model','intent'].includes(key)))throw fail('Unsupported Realtime query parameter.','invalid_query',400);
        if(request.headers['sec-websocket-protocol'])throw fail('Use server-side header authentication, not credential-bearing WebSocket subprotocols.','invalid_protocol',400);
        c=this.admit(request);
      } catch(error){reject(error.statusCode||503,error.message);return;}
      let upstream;
      try {upstream=new this.WebSocket('wss://api.openai.com/v1/realtime'+url.search,
        {headers:{...this.headers(c),...(request.headers['openai-safety-identifier']?{'OpenAI-Safety-Identifier':request.headers['openai-safety-identifier']}:{})},
          handshakeTimeout:15_000,maxPayload:4*1024*1024,perMessageDeflate:false,followRedirects:false});}
      catch {reject(502,'Unable to open the configured OpenAI Realtime connection.');return;}
      let client,closed=false;let heartbeat,lifetime;
      const job={abort:()=>close()};this.jobs.add(job);
      const close=()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);this.jobs.delete(job);
        upstream.on('error',()=>{});
        if(upstream.readyState===WebSocket.OPEN)upstream.close();else if(upstream.readyState===WebSocket.CONNECTING)upstream.terminate();
        if(client?.readyState===WebSocket.OPEN)client.close();
        const cleanup=setTimeout(()=>{upstream.terminate();client?.terminate();if(!client)socket.destroy();},1000);cleanup.unref();};
      socket.once('close',close);
      upstream.once('unexpected-response',(_req,res)=>{res.resume();reject(res.statusCode===401?502:res.statusCode,'OpenAI Realtime rejected the connection.');close();});
      upstream.on('error',()=>{if(client)client.close(1011,'OpenAI Realtime connection failed');else reject(502,'OpenAI Realtime connection failed');close();});
      upstream.once('open',()=>{if(closed||socket.destroyed){close();return;}
        this.wss.handleUpgrade(request,socket,head,ws=>{client=ws;
          const relay=(source,target)=>source.on('message',(data,isBinary)=>{
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
