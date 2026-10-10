import {invalid} from './protocol.mjs';

// Observe native metadata without teeing/buffering the whole model response or
// altering bytes consumed by the SDK. Bound one event, not the whole stream.
export function observeStream(response,onEvent,maxEventChars=2*1024*1024){
  if(!response.ok)return response;
  if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))
    throw invalid('SDK upstream did not return Anthropic SSE.',502,'api_error');
  const decoder=new TextDecoder();let line='',data=[],size=0,stopped=false,failed=false;
  function acceptLine(value){
    value=value.replace(/\r$/,'');
    if(!value){
      if(data.length){
        const text=data.join('\n');
        // Copilot adds an observed transport sentinel after Anthropic's
        // native terminal event. It is not JSON and must not mask truncation.
        if(text==='[DONE]'){
          if(!stopped&&!failed)throw invalid('Transport sentinel arrived before native message_stop.',502,'api_error');
          data=[];size=0;return;
        }
        let event;try{event=JSON.parse(text);}catch{throw invalid('Malformed native SSE event.',502,'api_error');}
        if((stopped||failed)&&event.type!=='ping')throw invalid('Native stream continued after its terminal event.',502,'api_error');
        if(event.type==='error'&&(!event.error||typeof event.error.type!=='string'||typeof event.error.message!=='string'))
          throw invalid('Malformed native SSE error.',502,'api_error');
        onEvent(event);if(event.type==='message_stop')stopped=true;if(event.type==='error')failed=true;
      }
      data=[];size=0;return;
    }
    size+=value.length;if(size>maxEventChars)throw invalid('Native SSE event exceeds the bounded parser limit.',502,'api_error');
    if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));
  }
  function consume(text){
    for(const part of text.split(/(?<=\n)/)){
      line+=part;
      if(line.length>maxEventChars)throw invalid('Native SSE line exceeds the bounded parser limit.',502,'api_error');
      if(line.endsWith('\n')){acceptLine(line.slice(0,-1));line='';}
    }
  }
  const stream=response.body.pipeThrough(new TransformStream({
    transform(chunk,controller){consume(decoder.decode(chunk,{stream:true}));controller.enqueue(chunk);},
    flush(){consume(decoder.decode());if(line||data.length||!stopped&&!failed)throw invalid('Native SSE ended before message_stop.',502,'api_error');}
  }));
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
}
