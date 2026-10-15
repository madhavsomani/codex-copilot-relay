// Local stdio MCP adapter: native Codex image generation for stock Claude Code.
//
// Exposes generate_image and edit_image. Each call goes to the relay's existing
// loopback /v1/images/generations or /v1/images/edits endpoint, which runs the
// user's own signed-in stock Codex (native-codex-tools.mjs). That uses the
// separate OpenAI/ChatGPT image allowance, never GitHub Copilot credits.
//
// Guarantees:
// - Loopback relay only; no network listener of its own (stdio).
// - One request per call: no retries, no provider or model fallback.
// - A per-generation confirmation through MCP elicitation, independent of the
//   client's permission mode. Without elicitation support it refuses unless the
//   user opted into Claude Code's own per-tool permission prompt.
// - Never logs prompts, image bytes, file contents or credentials.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';

export const serverName='relay_images';
export const serverVersion='1.0.0';
const PNG=Buffer.from('89504e470d0a1a0a','hex');
// Matches native-codex-tools.mjs: one bounded image per reference, at most five.
export const limits=Object.freeze({promptChars:32000,references:5,referenceBytes:20*1024*1024,resultBytes:32*1024*1024,
  previewEdge:1024,previewBytes:1024*1024,timeoutMs:11*60*1000,progressMs:15000});
export const billingNotice='Uses your separate OpenAI/ChatGPT image allowance through your own signed-in Codex app, not GitHub Copilot credits.';
const media={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'};

export class ImageToolError extends Error{
  constructor(message,code='image_tool_failed'){super(message);this.code=code;}
}

export function relayBase(value='http://127.0.0.1:4144'){
  let url;try{url=new URL(value);}catch{throw new ImageToolError('Relay URL is invalid.','invalid_configuration');}
  // The relay is loopback-only; never send prompts or reference images elsewhere.
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password
    ||url.pathname!=='/'||url.search||url.hash)
    throw new ImageToolError('The image adapter only talks to the local relay at http://127.0.0.1:<port>.','invalid_configuration');
  return url.origin;
}

export function defaultOutputDirectory(env=process.env){
  return env.RELAY_IMAGES_DIR||path.join(env.USERPROFILE||env.HOME||os.homedir(),'Pictures','Codex Images');
}

function sniff(bytes){
  if(bytes.subarray(0,8).equals(PNG))return 'png';
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpeg';
  if(bytes.subarray(0,4).toString('latin1')==='RIFF'&&bytes.subarray(8,12).toString('latin1')==='WEBP')return 'webp';
}

export const tools=[
  {name:'generate_image',title:'Generate image (native Codex)',
    description:'Create one new image from a text prompt with your own signed-in Codex app (gpt-image-2). '
      +billingNotice+' The user is asked to confirm each generation. Saves a full-resolution PNG locally and returns its path plus a preview.',
    inputSchema:{type:'object',additionalProperties:false,required:['prompt'],properties:{
      prompt:{type:'string',minLength:1,maxLength:limits.promptChars,description:'What to draw. Passed to the image model verbatim.'},
      background:{type:'string',enum:['auto','opaque'],description:'Optional background treatment. Transparent output is not supported.'},
      filename:{type:'string',maxLength:80,description:'Optional short file name (letters, digits, dash, underscore). A unique suffix is always added.'}}},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}},
  {name:'edit_image',title:'Edit image with references (native Codex)',
    description:'Create one new image from a prompt plus 1-5 local reference images (PNG, JPEG or WebP, each at most 20 MB). '
      +'The reference files are sent to OpenAI through your Codex app. '+billingNotice
      +' The user is asked to confirm each generation. Originals are never modified.',
    inputSchema:{type:'object',additionalProperties:false,required:['prompt','reference_paths'],properties:{
      prompt:{type:'string',minLength:1,maxLength:limits.promptChars,description:'The edit or new image to create from the references.'},
      reference_paths:{type:'array',minItems:1,maxItems:limits.references,items:{type:'string'},description:'Absolute paths of local reference images.'},
      background:{type:'string',enum:['auto','opaque']},
      filename:{type:'string',maxLength:80}}},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}},
];

function checkArguments(name,args){
  if(!args||typeof args!=='object'||Array.isArray(args))throw new ImageToolError('Arguments must be an object.','invalid_arguments');
  const allowed=name==='edit_image'?['prompt','reference_paths','background','filename']:['prompt','background','filename'];
  for(const key of Object.keys(args))if(!allowed.includes(key))throw new ImageToolError('Unsupported argument: '+key,'invalid_arguments');
  if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>limits.promptChars)
    throw new ImageToolError('prompt must contain 1-'+limits.promptChars+' characters.','invalid_arguments');
  if(args.background!==undefined&&!['auto','opaque'].includes(args.background))
    throw new ImageToolError('background must be auto or opaque.','invalid_arguments');
  if(args.filename!==undefined&&(typeof args.filename!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(args.filename)))
    throw new ImageToolError('filename may only contain letters, digits, dash and underscore.','invalid_arguments');
  if(name==='edit_image'&&(!Array.isArray(args.reference_paths)||args.reference_paths.length<1
    ||args.reference_paths.length>limits.references||args.reference_paths.some(file=>typeof file!=='string')))
    throw new ImageToolError('reference_paths must list 1-'+limits.references+' image paths.','invalid_arguments');
}

// Read only regular local image files the model named explicitly; verify their
// bytes rather than trusting extensions. Device, network and linked paths are refused.
export async function readReference(file){
  if(!path.isAbsolute(file)||/^\\\\|^\/\//.test(file))throw new ImageToolError('Reference images need an absolute local path (no network paths).','invalid_reference');
  let stat;try{stat=await fs.lstat(file);}catch{throw new ImageToolError('A reference image was not found: '+path.basename(file),'invalid_reference');}
  if(!stat.isFile()||stat.isSymbolicLink())throw new ImageToolError('A reference path is not a regular file: '+path.basename(file),'invalid_reference');
  if(stat.size<1||stat.size>limits.referenceBytes)throw new ImageToolError('Each reference image must be at most 20 MB: '+path.basename(file),'invalid_reference');
  const bytes=await fs.readFile(file);
  const kind=sniff(bytes);
  if(!kind)throw new ImageToolError('Reference images must be PNG, JPEG or WebP: '+path.basename(file),'invalid_reference');
  return {name:path.basename(file),kind,image_url:'data:'+media[kind]+';base64,'+bytes.toString('base64')};
}

// Bounded preview for the model's vision input; the saved PNG keeps full resolution.
export async function preview(bytes,{loadSharp=()=>import('sharp')}={}){
  const {default:sharp}=await loadSharp();
  const meta=await sharp(bytes).metadata();
  let quality=85,edge=limits.previewEdge;
  for(;;){
    const out=await sharp(bytes).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality}).toBuffer();
    if(out.length<=limits.previewBytes||edge<=256)return {data:out.toString('base64'),mimeType:'image/jpeg',width:meta.width,height:meta.height};
    if(quality>60)quality-=15;else edge=Math.floor(edge*0.75);
  }
}

export async function saveImage(bytes,directory,name){
  await fs.mkdir(directory,{recursive:true});
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..*/,'').replace('T','-');
  for(let attempt=0;attempt<5;attempt++){
    const file=path.join(directory,`${name||'image'}-${stamp}-${randomBytes(3).toString('hex')}.png`);
    try{await fs.writeFile(file,bytes,{flag:'wx'});return file;}  // never overwrite
    catch(error){if(error.code!=='EEXIST')throw new ImageToolError('Could not save the image in '+directory+'.','save_failed');}
  }
  throw new ImageToolError('Could not choose a unique file name.','save_failed');
}

// Map the relay's documented native-image error codes to actionable text.
export function describeRelayError(status,payload){
  const code=payload?.error?.code,message=String(payload?.error?.message??'').slice(0,500);
  const hint={
    native_tools_disabled:'Native images are turned off. Enable them with Enable-Codex-NativeTools.ps1 (uses your OpenAI/ChatGPT allowance).',
    native_tools_unavailable:'Native Codex is unavailable: '+message,
    native_tools_busy:'Both native image slots are busy. Try again after the current image finishes.',
    native_tool_timeout:'The image took longer than the native time limit and was stopped.',
    native_tool_cancelled:'The image request was cancelled.',
    native_turn_incomplete:'Codex did not finish. Check that the Codex app is signed in and that your OpenAI/ChatGPT image limit is not used up.',
  }[code];
  return new ImageToolError((hint??(message||'Relay returned HTTP '+status+'.'))+' No retry or fallback was attempted.',code||'relay_http_'+status);
}

export function createImageServer({relayUrl=process.env.RELAY_URL,outputDirectory=defaultOutputDirectory(),fetchImpl=fetch,
  timeoutMs=Number(process.env.RELAY_IMAGES_TIMEOUT_MS)||limits.timeoutMs,approval=process.env.RELAY_IMAGES_APPROVAL||'elicitation',
  token=process.env.RELAY_IMAGES_BEARER,write=line=>process.stdout.write(line),makePreview=preview}={}){
  const base=relayBase(relayUrl||undefined);
  if(!['elicitation','permission'].includes(approval))throw new ImageToolError('RELAY_IMAGES_APPROVAL must be elicitation or permission.','invalid_configuration');
  const active=new Map(),waiting=new Map();
  let clientCapabilities={},nextId=1;
  const send=message=>write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
  const request=(method,params,signal)=>new Promise((resolve,reject)=>{
    const id='relay-images-'+nextId++;
    const abort=()=>{waiting.delete(id);reject(new ImageToolError('Cancelled.','cancelled'));};
    if(signal?.aborted)return abort();
    signal?.addEventListener('abort',abort,{once:true});
    waiting.set(id,{resolve:value=>{signal?.removeEventListener('abort',abort);resolve(value);},
      reject:error=>{signal?.removeEventListener('abort',abort);reject(error);}});
    send({id,method,params});
  });

  async function approve(name,args,references,signal){
    if(approval==='permission')return;  // Claude Code's own per-tool prompt is the gate.
    if(!clientCapabilities.elicitation)throw new ImageToolError('This client cannot show the image confirmation prompt, so nothing was generated. '
      +'Set RELAY_IMAGES_APPROVAL=permission to rely on Claude Code\'s tool permission prompt instead.','approval_unavailable');
    const summary=args.prompt.length>300?args.prompt.slice(0,300)+'…':args.prompt;
    const refs=references.length?`\nReference images sent to OpenAI: ${references.map(item=>item.name).join(', ')}`:'';
    const result=await request('elicitation/create',{mode:'form',
      message:`Generate 1 image with native Codex (gpt-image-2)?\n${billingNotice}\nPrompt: ${summary}${refs}`,
      requestedSchema:{type:'object',properties:{confirm:{type:'boolean',title:'Generate this image',default:false}},required:['confirm']}},signal);
    if(result?.action!=='accept'||result?.content?.confirm!==true)
      throw new ImageToolError('The user did not approve this image. Nothing was generated or charged.','not_approved');
  }

  async function callTool(name,args,{signal,progressToken}={}){
    if(!tools.some(tool=>tool.name===name))throw new ImageToolError('Unknown tool: '+name,'unknown_tool');
    checkArguments(name,args);
    const references=[];
    if(name==='edit_image')for(const file of args.reference_paths)references.push(await readReference(file));
    await approve(name,args,references,signal);
    const body={model:'gpt-image-2',prompt:args.prompt,n:1,...(args.background?{background:args.background}:{}),
      ...(references.length?{images:references.map(({image_url})=>({image_url}))}:{})};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new ImageToolError('timeout','timeout')),timeoutMs);
    const forward=()=>controller.abort(new ImageToolError('cancelled','cancelled'));
    signal?.addEventListener('abort',forward,{once:true});
    let ticks=0;const progress=progressToken===undefined?null:setInterval(()=>send({method:'notifications/progress',
      params:{progressToken,progress:++ticks,message:'Generating with native Codex…'}}),limits.progressMs);
    let response,payload;
    try{
      // Exactly one request; relay closes the native job when this aborts.
      response=await fetchImpl(base+(references.length?'/v1/images/edits':'/v1/images/generations'),{method:'POST',
        headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:controller.signal});
      payload=await response.json().catch(()=>null);
    }catch(error){
      const reason=controller.signal.reason;
      if(reason?.code==='timeout')throw new ImageToolError(`No image after ${Math.round(timeoutMs/60000)} minutes; the request was stopped. No retry was attempted.`,'timeout');
      if(reason?.code==='cancelled'||signal?.aborted)throw new ImageToolError('The image request was cancelled.','cancelled');
      throw new ImageToolError('The local relay is not reachable at '+base+'. Start the relay, then try again. No fallback was attempted.','relay_unreachable');
    }finally{clearTimeout(timer);clearInterval(progress);signal?.removeEventListener('abort',forward);}
    if(!response.ok)throw describeRelayError(response.status,payload);
    const encoded=payload?.data?.[0]?.b64_json;
    if(payload?.data?.length!==1||typeof encoded!=='string'||encoded.length>Math.ceil(limits.resultBytes/3)*4)
      throw new ImageToolError('The relay returned no usable image.','invalid_result');
    const bytes=Buffer.from(encoded,'base64');
    if(!bytes.subarray(0,8).equals(PNG))throw new ImageToolError('The relay result is not a PNG image.','invalid_result');
    const file=await saveImage(bytes,outputDirectory,args.filename);
    const shown=await makePreview(bytes);
    return {content:[
      {type:'text',text:`Saved full-resolution PNG (${shown.width}x${shown.height}, ${Math.round(bytes.length/1024)} KB): ${file}\n`
        +`The image below is a smaller preview. ${billingNotice}`},
      {type:'image',data:shown.data,mimeType:shown.mimeType}],
      structuredContent:{path:file,width:shown.width,height:shown.height,bytes:bytes.length,model:'gpt-image-2'}};
  }

  async function handle(message){
    if(message.method===undefined&&message.id!==undefined){  // response to our elicitation
      const pending=waiting.get(message.id);if(!pending)return;waiting.delete(message.id);
      if(message.error)pending.reject(new ImageToolError('The confirmation prompt failed, so nothing was generated.','not_approved'));
      else pending.resolve(message.result);return;
    }
    if(message.method==='notifications/cancelled'){active.get(message.params?.requestId)?.abort();return;}
    if(message.id===undefined)return;
    const reply=result=>send({id:message.id,result}),fail=(code,text)=>send({id:message.id,error:{code,message:text}});
    if(message.method==='initialize'){
      clientCapabilities=message.params?.capabilities??{};
      return reply({protocolVersion:message.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},
        serverInfo:{name:serverName,version:serverVersion},
        instructions:'Native Codex image generation via the local relay. '+billingNotice+' Each image needs the user\'s confirmation.'});
    }
    if(message.method==='ping')return reply({});
    if(message.method==='tools/list')return reply({tools});
    if(message.method!=='tools/call')return fail(-32601,'Method not found');
    const controller=new AbortController();active.set(message.id,controller);
    try{reply(await callTool(message.params?.name,message.params?.arguments??{},{signal:controller.signal,progressToken:message.params?._meta?.progressToken}));}
    catch(error){
      const known=error instanceof ImageToolError;
      reply({isError:true,content:[{type:'text',text:known?error.message:'The image tool failed unexpectedly. No retry or fallback was attempted.'}],
        structuredContent:{code:known?error.code:'internal_error'}});
    }finally{active.delete(message.id);}
  }
  const close=()=>{for(const controller of active.values())controller.abort();for(const pending of waiting.values())pending.reject(new ImageToolError('Closed.','cancelled'));};
  return {handle,callTool,close,base,outputDirectory};
}

export function run(){
  let server;
  try{server=createImageServer();}
  catch(error){process.stderr.write('relay_images: '+error.message+'\n');process.exitCode=1;return;}
  const lines=readline.createInterface({input:process.stdin});
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{return;}
    server.handle(message).catch(()=>{});
  });
  lines.on('close',()=>{server.close();});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run();
