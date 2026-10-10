import {CopilotClient,CopilotRequestHandler} from '@github/copilot-sdk';
import {bounded} from '../copilot-runtime.mjs';

if(!process.argv.includes('--live'))throw new Error('Add --live for one finite authenticated SDK stream-format probe.');
const formats=[];let rows=0;
class Observe extends CopilotRequestHandler{
  async sendRequest(request,context){
    const body=await request.clone().json().catch(()=>null);
    const response=await super.sendRequest(request,context);
    if(!body?.messages||!response.body)return response;
    const decoder=new TextDecoder();let pending='';
    const entry={status:response.status,contentType:response.headers.get('content-type'),requestKeys:Object.keys(body),frameShapes:[]};
    formats.push(entry);
    const consume=text=>{
      pending+=text;let end;
      while((end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end).trim();pending=pending.slice(end+1);
        if(!line.startsWith('data:'))continue;const value=line.slice(5).trim();rows++;
        let event;try{event=JSON.parse(value);}catch{entry.nonJsonTerminal=value==='[DONE]'?'[DONE]':'non-JSON';continue;}
        const shape={type:event.type??null,keys:Object.keys(event),deltaKeys:event.delta?Object.keys(event.delta):null,
          choiceKeys:event.choices?.[0]?Object.keys(event.choices[0]):null,
          choiceDeltaKeys:event.choices?.[0]?.delta?Object.keys(event.choices[0].delta):null,
          finishReason:event.choices?.[0]?.finish_reason??event.delta?.stop_reason??null};
        if(!entry.frameShapes.some(previous=>JSON.stringify(previous)===JSON.stringify(shape))&&entry.frameShapes.length<30)entry.frameShapes.push(shape);
      }
      if(pending.length>2*1024*1024)throw new Error('Diagnostic frame too large.');
    };
    return new Response(response.body.pipeThrough(new TransformStream({
      transform(chunk,c){consume(decoder.decode(chunk,{stream:true}));c.enqueue(chunk);},flush(){consume(decoder.decode());}
    })),{status:response.status,headers:response.headers});
  }
}
const client=new CopilotClient({mode:'copilot-cli',useLoggedInUser:true,logLevel:'error',requestHandler:new Observe()});let session;
try{
  await bounded(()=>client.start(),30000,'SDK start');
  session=await client.createSession({model:'claude-opus-5.5',reasoningEffort:'low',streaming:true,
    availableTools:[],excludedTools:['builtin:*','mcp:*'],enableConfigDiscovery:false,skipCustomInstructions:true,
    skillDirectories:[],pluginDirectories:[],instructionDirectories:[],mcpServers:{},memory:{enabled:false},
    enableSessionStore:false,infiniteSessions:{enabled:false},systemMessage:{mode:'replace',content:'Return the requested fixture marker only.'}});
  const result=await session.sendAndWait({prompt:'Reply STREAM_FORMAT_OK.'},60000);
  console.log(JSON.stringify({ok:result?.data?.content?.includes('STREAM_FORMAT_OK'),rows,formats},null,2));
}finally{if(session)await bounded(()=>session.disconnect(),2500).catch(()=>{});await bounded(()=>client.forceStop(),2500).catch(()=>{});}
