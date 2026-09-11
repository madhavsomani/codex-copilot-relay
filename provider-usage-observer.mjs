import {parser} from 'stream-json';
import {StringDecoder} from 'node:string_decoder';

const allowed=new Set(['type','object','id','model','status','response','usage','error','code','status_details','session',
  'input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details','input_token_details','output_token_details',
  'cached_tokens','reasoning_tokens','audio_tokens','image_tokens','text_tokens','cached_input_tokens','rate_limits','name','limit','remaining','reset_seconds']);

// Parse incrementally, retaining only allowlisted envelope fields. Large image,
// audio and text strings are streamed past, never buffered into telemetry.
function projection(onValue){
  const stream=parser.asStream({streamKeys:false,packKeys:true,streamStrings:true,packStrings:false,packNumbers:true,streamNumbers:false});
  const stack=[];let root=null,string='',stringAllowed=false,failed=false;
  const location=()=>{const parent=stack.at(-1);return {parent,key:parent?.array?String(parent.index++):parent?.key};};
  const keep=(parent,key)=>!parent||(parent.keep&&(parent.array||allowed.has(key)));
  const add=(parent,key,value)=>{if(!parent){root=value;return;}if(!parent.keep||(!parent.array&&!allowed.has(key)))return;
    if(parent.array){if(parent.value.length<8)parent.value.push(value);}else parent.value[key]=value;};
  stream.on('data',token=>{if(failed)return;
    if(stack.length>48){failed=true;return;}
    if(token.name==='keyValue'){stack.at(-1).key=token.value.length<=64?token.value:'';return;}
    if(token.name==='startObject'||token.name==='startArray'){
      const {parent,key}=location();const selected=keep(parent,key);const array=token.name==='startArray';const value=array?[]:Object.create(null);
      if(selected)add(parent,key,value);stack.push({value,keep:selected,key:null,array,index:0});return;}
    if(token.name==='endObject'||token.name==='endArray'){stack.pop();return;}
    if(token.name==='startString'){const parent=stack.at(-1);stringAllowed=keep(parent,parent?.key);string='';return;}
    if(token.name==='stringChunk'){if(stringAllowed&&string.length<256)string+=token.value.slice(0,256-string.length);return;}
    if(token.name==='endString'){const {parent,key}=location();if(stringAllowed)add(parent,key,string);return;}
    if(['numberValue','nullValue','trueValue','falseValue'].includes(token.name)){
      const {parent,key}=location();add(parent,key,token.name==='numberValue'?Number(token.value):token.name==='nullValue'?null:token.name==='trueValue');}
  });
  stream.on('error',()=>{failed=true;});
  return {async write(text){if(!failed)await new Promise(resolve=>stream.write(text,()=>resolve()));},
    async end(){if(failed){stream.destroy();return;}await new Promise(resolve=>{stream.once('end',resolve);stream.once('error',resolve);stream.end();});if(!failed&&root)try{onValue(root);}catch{}}};
}

export class ProviderUsageObserver {
  constructor(contentType,onValue){this.json=contentType.includes('json');this.sse=contentType.includes('text/event-stream');this.onValue=onValue;
    this.decoder=new StringDecoder('utf8');this.current=this.json?projection(onValue):null;this.prefix='';this.lineKind=null;this.lineHasContent=false;}
  async chunk(bytes){if(!this.json&&!this.sse)return;await this.text(this.decoder.write(bytes));}
  async text(text){if(this.json){await this.current.write(text);return;}
    for(const part of text.split(/(?<=\n)/)){
      const ended=part.endsWith('\n');let value=ended?part.slice(0,-1):part;if(ended)value=value.replace(/\r$/,'');
      value=value.replace(/\r/g,'');if(value.length)this.lineHasContent=true;
      if(this.lineKind===null){const count=Math.min(5-this.prefix.length,value.length);this.prefix+=value.slice(0,count);value=value.slice(count);
        if(this.prefix==='data:'){this.lineKind='data';this.current??=projection(this.onValue);await this.current.write(value);
        }else if(this.prefix.length>=5||ended)this.lineKind='other';
      }else if(this.lineKind==='data')await this.current.write(value);
      if(ended){if(!this.lineHasContent&&this.current){await this.current.end();this.current=null;}
        else if(this.lineKind==='data')await this.current.write('\n');
        this.prefix='';this.lineKind=null;this.lineHasContent=false;}
    }
  }
  async end(){const tail=this.decoder.end();if(tail)await this.text(tail);await this.current?.end();this.current=null;}
}
