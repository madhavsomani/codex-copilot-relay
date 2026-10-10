// Scripted loopback fixture only. No SDK, real account, or upstream inference.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const env=process.env,port=Number(env.BRIDGE_PORT),runtime=env.BRIDGE_RUNTIME_DIRECTORY;
const state={requests:0,unauthorized:0,model:null,effort:null,authenticated:false};
const save=()=>fs.writeFileSync(path.join(runtime,'fixture-state.json'),JSON.stringify(state));
if(env.PORTABLE_FIXTURE_FAIL_START==='1')process.exit(1);
const server=http.createServer(async(request,response)=>{
  const send=(status,value)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
  if(request.url==='/health')return send(200,{padding:env.PORTABLE_FIXTURE_OVERSIZE_HEALTH==='1'?'x'.repeat(131072):undefined,ok:true,provider:'github-copilot-sdk',version:env.PORTABLE_FIXTURE_VERSION,
    model:env.BRIDGE_DEFAULT_MODEL,routing:{mode:'per-request'},sdk:{ok:true},activeExchanges:0,
    lastCodexRequestAt:state.requests?new Date().toISOString():null,
    telemetry:{summary:{received:state.requests,completed:state.requests,failed:0,sdkApiCalls:0,inputTokens:0,outputTokens:0,totalNanoAiu:0,creditMeteredApiCalls:0}},
    modelCapabilities:{[env.BRIDGE_DEFAULT_MODEL]:{
      maxContextWindowTokens:400000,maxPromptTokens:272000,maxOutputTokens:128000,maxImageAttachments:1,
      supportedReasoningEfforts:['low','high','xhigh'],defaultReasoningEffort:'xhigh'}}});
  const valid=env.PORTABLE_FIXTURE_WRONG_TOKEN!=='1'&&request.headers.authorization===`Bearer ${env.BRIDGE_AUTH_TOKEN}`;
  if(!valid){state.unauthorized++;save();return send(401,{error:{message:'Fixture unauthorized'}});}
  if(request.url==='/v1/models')return send(200,{models:[]});
  if(request.url!=='/v1/responses')return send(404,{});
  let text='';for await(const chunk of request)text+=chunk.toString();
  const body=JSON.parse(text);state.requests++;state.model=body.model;state.effort=body.reasoning?.effort??null;state.authenticated=true;save();
  const message={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'PORTABLE_STOCK_OK',annotations:[]}]};
  const result={id:'resp_fixture',object:'response',status:'completed',model:body.model,output:[message],usage:{input_tokens:10,output_tokens:5,total_tokens:15}};
  if(!body.stream)return send(200,result);
  response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  let sequence=0;
  for(const event of [{type:'response.created',response:{...result,status:'in_progress',output:[]}},
    {type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress',content:[]}},
    {type:'response.content_part.added',item_id:message.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
    {type:'response.output_text.delta',item_id:message.id,output_index:0,content_index:0,delta:'PORTABLE_STOCK_OK'},
    {type:'response.output_text.done',item_id:message.id,output_index:0,content_index:0,text:'PORTABLE_STOCK_OK'},
    {type:'response.content_part.done',item_id:message.id,output_index:0,content_index:0,part:message.content[0]},
    {type:'response.output_item.done',output_index:0,item:message},{type:'response.completed',response:result}])
    response.write(`event: ${event.type}\ndata: ${JSON.stringify({...event,sequence_number:++sequence})}\n\n`);
  response.end();
});
const stop=()=>server.close(()=>process.exit(0));
process.on('message',message=>{if(message?.type==='shutdown')stop();});process.on('disconnect',stop);
server.listen(port,'127.0.0.1',()=>{
  if(env.PORTABLE_FIXTURE_NO_INITIALIZED!=='1')process.send?.({type:'initialized'});
  if(env.PORTABLE_FIXTURE_FAIL_AFTER_MS)setTimeout(()=>process.exit(1),Number(env.PORTABLE_FIXTURE_FAIL_AFTER_MS));
});
