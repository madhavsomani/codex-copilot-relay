import {randomUUID} from 'node:crypto';
import {adapterVersion, invalid, messageUsage} from './protocol.mjs';
import {errorResponseHeaders} from './errors.mjs';

export class MessageSink {
  constructor(response, body, onClose, heartbeatMs = 15000) {
    this.response = response; this.body = body; this.streaming = Boolean(body.stream); this.blocks = [];
    this.id = 'msg_' + randomUUID().replaceAll('-',''); this.model = body.model;
    this.closed = false; this.textIndex = null;
    response.once('close', () => {clearInterval(this.heartbeat); if (!this.closed) onClose();});
    if (this.streaming) {
      this.heartbeat = setInterval(() => this.frame('ping', {}), heartbeatMs); this.heartbeat.unref?.();
    }
  }
  start(){
    if(!this.streaming||this.started||this.closed)return;
    this.started=true;
    this.response.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache, no-transform',
      'x-accel-buffering':'no','x-relay-provider':'github-copilot-sdk','x-relay-adapter':adapterVersion});
    this.frame('message_start',{message:{id:this.id,type:'message',role:'assistant',content:[],
      model:this.model,stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});
  }
  frame(type, data) {
    if (!this.closed && this.streaming){this.start();this.response.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);}
  }
  toolControl(block){
    const choice=this.body.tool_choice??{type:'auto'};
    if(choice.type==='none'||choice.type==='tool'&&block.name!==choice.name
      ||choice.disable_parallel_tool_use===true&&this.blocks.some(item=>item.type==='tool_use'))
      throw invalid('Upstream tool output violated the exact client tool_choice control.',502,'api_error');
  }
  native(event,names) {
    if(this.closed)return;
    if(event.type==='message_start'){
      if(this.nativeMode||this.blocks.length)throw invalid('Native content replay refused.',502,'api_error');
      this.start();this.nativeMode=true;this.nativeOpen=null;this.nativeChars=0;return;
    }
    if(event.type==='message_stop'){
      if(this.nativeOpen!==null)throw invalid('Upstream stopped with an open native block.',502,'api_error');return;
    }
    if(!event.type.startsWith('content_block_'))return;
    if(!this.nativeMode)throw invalid('Native block arrived before message_start.',502,'api_error');
    this.nativeChars+=JSON.stringify(event).length;
    if(this.nativeChars>16*1024*1024)throw invalid('Native output exceeds the bounded response limit.',502,'api_error');
    const {index}=event;
    if(event.type==='content_block_start'){
      if(index!==this.blocks.length||this.nativeOpen!==null||index>=4096)
        throw invalid('Native content block index/order conflict.',502,'api_error');
      const block=structuredClone(event.content_block);
      if(!block||!['text','thinking','redacted_thinking','tool_use'].includes(block.type))
        throw invalid('Unsupported native content block; not stripped silently.',502,'api_error');
      if(block.type==='tool_use'){
        if(!names.has(block.name)||typeof block.id!=='string'||!block.id||block.id.length>256
          ||this.blocks.some(previous=>previous.type==='tool_use'&&previous.id===block.id))
          throw invalid('Native tool name/ID conflict.',502,'api_error');
        block.name=names.get(block.name);
        this.toolControl(block);
      }
      if(block.type==='text'&&typeof block.text!=='string'||block.type==='thinking'
        &&(typeof block.thinking!=='string'||typeof block.signature!=='string')
        ||block.type==='redacted_thinking'&&(typeof block.data!=='string'||!block.data))
        throw invalid('Malformed native content block.',502,'api_error');
      this.blocks.push(block);this.nativeOpen=index;this.nativeJson='';
      this.frame(event.type,{index,content_block:block});return;
    }
    if(index!==this.nativeOpen)throw invalid('Native delta/stop index conflict.',502,'api_error');
    const block=this.blocks[index];
    if(event.type==='content_block_delta'){
      const delta=event.delta;
      if(delta?.type==='text_delta'&&block.type==='text'&&typeof delta.text==='string')block.text+=delta.text;
      else if(delta?.type==='thinking_delta'&&block.type==='thinking'&&typeof delta.thinking==='string')block.thinking+=delta.thinking;
      else if(delta?.type==='signature_delta'&&block.type==='thinking'&&typeof delta.signature==='string')block.signature+=delta.signature;
      else if(delta?.type==='input_json_delta'&&block.type==='tool_use'&&typeof delta.partial_json==='string')this.nativeJson+=delta.partial_json;
      else throw invalid('Native content delta type conflict.',502,'api_error');
      this.frame(event.type,{index,delta});return;
    }
    if(event.type!=='content_block_stop')throw invalid('Unknown native content event.',502,'api_error');
    if(block.type==='thinking'&&!block.signature)throw invalid('Native thinking ended without an actual signature.',502,'api_error');
    if(block.type==='tool_use'){
      if(this.nativeJson){try{block.input=JSON.parse(this.nativeJson);}catch{throw invalid('Malformed native tool JSON.',502,'api_error');}}
      if(!block.input||typeof block.input!=='object'||Array.isArray(block.input))throw invalid('Native tool input must be an object.',502,'api_error');
    }
    this.frame(event.type,{index});this.nativeOpen=null;this.nativeJson='';
  }
  text(delta) {
    if (!delta || this.closed || this.nativeMode) return;
    if (this.textIndex == null) {
      this.textIndex = this.blocks.length; this.blocks.push({type:'text',text:''});
      this.frame('content_block_start',{index:this.textIndex,content_block:{type:'text',text:''}});
    }
    this.blocks[this.textIndex].text += delta;
    this.frame('content_block_delta',{index:this.textIndex,delta:{type:'text_delta',text:delta}});
  }
  finishText(full) {
    if(this.nativeMode)return;
    const current = this.textIndex == null ? '' : this.blocks[this.textIndex].text;
    if (full && !full.startsWith(current)) throw invalid('SDK final text differed from the streamed prefix.',502,'api_error');
    if (full) this.text(full.slice(current.length));
    if (this.textIndex != null) this.frame('content_block_stop',{index:this.textIndex});
    this.textIndex = null;
  }
  tool(block) {
    if(this.nativeMode)throw invalid('Cannot reconstruct a native tool block.',502,'api_error');
    this.toolControl(block);this.finishText(''); const index = this.blocks.length; this.blocks.push(block);
    this.frame('content_block_start',{index,content_block:{...block,input:{}}});
    this.frame('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
    this.frame('content_block_stop',{index});
  }
  finish(reason, events,stopSequence=null) {
    if (this.closed) return;
    if(this.nativeMode&&this.nativeOpen!==null)throw invalid('Cannot finish an open native block.',502,'api_error');
    if(reason==='end_turn'&&['any','tool'].includes(this.body.tool_choice?.type)&&!this.blocks.some(block=>block.type==='tool_use'))
      throw invalid('Upstream completed without the required native tool call.',502,'api_error');
    this.finishText(''); const usage = messageUsage(events);
    if (this.streaming) {
      this.frame('message_delta',{delta:{stop_reason:reason,stop_sequence:stopSequence},usage}); this.frame('message_stop',{});
    } else {
      this.response.writeHead(200,{'content-type':'application/json','x-relay-provider':'github-copilot-sdk','x-relay-adapter':adapterVersion});
      this.response.write(JSON.stringify({id:this.id,type:'message',role:'assistant',model:this.model,
        content:this.blocks,stop_reason:reason,stop_sequence:stopSequence,usage}));
    }
    this.closed = true; clearInterval(this.heartbeat); this.response.end();
  }
  fail(error) {
    if (this.closed) return;
    const payload = {type:'error',error:{type:error.type ?? 'api_error',message:error.message},...(error.requestId?{request_id:error.requestId}:{})};
    if (this.streaming&&this.started) this.frame('error',{error:payload.error,...(error.requestId?{request_id:error.requestId}:{})});
    else {this.response.writeHead(error.statusCode ?? 502,{'content-type':'application/json',
      ...errorResponseHeaders(error)});this.response.write(JSON.stringify(payload));}
    this.closed = true; clearInterval(this.heartbeat); this.response.end();
  }
}
