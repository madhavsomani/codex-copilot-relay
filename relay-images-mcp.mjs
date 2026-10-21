// Streamable-HTTP MCP endpoint for the native image tools, served by the relay
// itself at /mcp. Register once with:
//   claude mcp add --scope user --transport http relay_images http://127.0.0.1:4144/mcp
//
// Stateless: every POST carries one JSON-RPC message and gets one reply (JSON,
// or an SSE stream for tool calls), so there is no session to lose across relay restarts. Tool logic is shared
// with the stdio adapter (claude-image-mcp.mjs). Without a server-to-client
// stream there is no elicitation, so Claude Code's own per-tool permission
// prompt is the approval gate.
import {createImageServer} from './claude-image-mcp.mjs';

export const mcpPath='/mcp';
const maxBodyBytes=64*1024;  // prompts plus reference paths; image bytes never arrive here

// Browsers always send Origin on cross-site POSTs; only loopback pages may call.
// The Host check blocks DNS rebinding onto the loopback listener.
export function loopbackRequest(request,port){
  const hosts=[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];
  if(!hosts.includes(String(request.headers.host??'').toLowerCase()))return false;
  const origin=request.headers.origin;
  if(origin===undefined)return true;
  try{const url=new URL(origin);return url.protocol==='http:'&&hosts.includes(url.host.toLowerCase());}catch{return false;}
}

function readBody(request){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    request.on('data',chunk=>{size+=chunk.length;if(size>maxBodyBytes){reject(Object.assign(new Error('too large'),{status:413}));request.destroy();}else chunks.push(chunk);});
    request.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error',reject);
  });
}

const send=(response,status,body)=>{
  if(response.destroyed||response.writableEnded)return;
  if(body===undefined){response.writeHead(status);return response.end();}
  response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  response.end(JSON.stringify(body));
};
const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});

export function createImagesMcpRoute({port,relayUrl=`http://127.0.0.1:${port}`,token,serverOptions={}}){
  return async function route(request,response,pathname){
    if(pathname!==mcpPath)return false;
    if(!loopbackRequest(request,port))return send(response,403,rpcError(null,-32000,'Loopback origin required.')),true;
    // No standalone SSE stream and no sessions to delete.
    if(request.method!=='POST')return response.writeHead(405,{allow:'POST'}),response.end(),true;
    if(!String(request.headers['content-type']??'').includes('application/json'))
      return send(response,415,rpcError(null,-32700,'Content-Type must be application/json.')),true;
    let message;
    try{message=JSON.parse(await readBody(request));}
    catch(error){return send(response,error.status??400,rpcError(null,-32700,'Invalid JSON.')),true;}
    if(!message||typeof message!=='object'||Array.isArray(message))
      return send(response,400,rpcError(null,-32600,'Send one JSON-RPC message per request.')),true;
    // Notifications and responses need no reply.
    if(message.id===undefined||message.method===undefined)return send(response,202),true;

    // Claude Code abandons a plain JSON reply after 60 s, and images take 30-90 s.
    // Tool calls therefore answer as an SSE stream: progress events every 15 s
    // keep the client waiting, then the result ends the stream.
    const stream=message.method==='tools/call';
    let reply;
    const server=createImageServer({relayUrl,token,approval:'permission',...serverOptions,write:line=>{
      const out=JSON.parse(line);
      if(out.id===message.id)reply=out;
      else if(stream&&!response.destroyed)response.write(`event: message\ndata: ${line.trim()}\n\n`);
    }});
    if(stream)response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
    const abort=()=>{if(!response.writableEnded)server.close();};  // client went away: stop the native job
    response.once('close',abort);
    try{await server.handle(message);}
    finally{response.off('close',abort);}
    reply??=rpcError(message.id,-32603,'No result.');
    if(!stream)send(response,200,reply);
    else if(!response.destroyed)response.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
    return true;
  };
}
