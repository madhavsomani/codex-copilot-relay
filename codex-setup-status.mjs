// Dependency-free, read-only Unix onboarding. This checks a narrow user-file
// routing grammar, not Codex's effective CLI/profile/managed configuration.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

const configByteLimit=1024*1024;
const scope={configurationScope:'user-file-only',effectiveConfigurationVerified:false};
const unknown=configCheck=>({configured:false,checkFailed:true,configCheck});

export function resolvePortableCodexConfig(env=process.env,home=os.homedir()){
  const userHome=env.HOME?.trim()||home;
  const customHome=Boolean(env.CODEX_HOME?.trim());
  let selected=customHome?env.CODEX_HOME.trim():path.join(userHome,'.codex');
  if(selected==='~')selected=userHome;
  else if(selected.startsWith('~/'))selected=path.join(userHome,selected.slice(2));
  if(!path.isAbsolute(selected))throw new Error('Invalid Codex home');
  return {config:path.join(selected,'config.toml'),customHome};
}

function simpleString(value){
  if(/^'[^'\r\n]*'$/.test(value))return value.slice(1,-1);
  if(!/^"(?:[^"\\\r\n]|\\.)*"$/.test(value))throw new Error('Unsupported string');
  return JSON.parse(value);
}
function keyPath(value){
  const keys=[];let rest=value.trim();
  while(rest){
    const token=/^([A-Za-z0-9_-]+|'[^']*'|"(?:[^"\\]|\\.)*")/.exec(rest)?.[1];
    if(!token)throw new Error('Unsupported key');
    keys.push(token[0]==="'"||token[0]==='"'?simpleString(token):token);
    rest=rest.slice(token.length).trim();
    if(!rest)break;
    if(rest[0]!=='.')throw new Error('Unsupported key');
    rest=rest.slice(1).trim();if(!rest)throw new Error('Incomplete key');
  }
  if(!keys.length)throw new Error('Empty key');
  return keys;
}
function scanLine(value){
  let quote=null,equal=-1,end=value.length;
  for(let i=0;i<value.length;i++){
    const char=value[i];
    if(quote){
      if(quote==='"'&&char==='\\'){i++;continue;}
      if(char===quote)quote=null;
    }else{
      if(char==='#'){end=i;break;}
      if(char==='"'||char==="'"){
        if(value.slice(i,i+3)===char.repeat(3))throw new Error('Multiline string is not inspected');
        quote=char;
      }else if(char==='='&&equal<0)equal=i;
    }
  }
  if(quote)throw new Error('Incomplete string');
  return {line:value.slice(0,end).trim(),equal};
}

export function inspectPortableRouting(text,port){
  if(!Number.isInteger(port)||port<1024||port>65535)return unknown('invalid-port');
  if(Buffer.byteLength(text)>configByteLimit)return unknown('too-large');
  try{
    let table=[];const headers=new Set(),values=new Map();
    for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
      const {line,equal}=scanLine(raw);if(!line)continue;
      if(line.startsWith('[')){
        const array=line.startsWith('[[');
        const match=(array?/^\[\[(.+)\]\]$/:/^\[(.+)\]$/).exec(line);
        if(!match)throw new Error('Unsupported table');
        table=keyPath(match[1]);const id=JSON.stringify(table);
        if(['model_provider','profile'].includes(table[0]))throw new Error('Invalid routing table');
        if(array&&table[0]==='model_providers')throw new Error('Provider array is not inspected');
        if(!array){if(headers.has(id))throw new Error('Duplicate table');headers.add(id);}
        continue;
      }
      if(equal<0)throw new Error('Multiline or unsupported assignment');
      const keys=[...table,...keyPath(raw.slice(0,equal))];
      const root=keys.length===1&&['model_provider','profile'].includes(keys[0]);
      const provider=keys[0]==='model_providers'&&keys[1]==='github_copilot_bridge';
      if(keys[0]==='profile'||keys[0]==='model_provider'&&!root
        ||keys.length===1&&keys[0]==='model_providers'||provider&&keys.length<=2)
        throw new Error('Profile or inline routing is not inspected');
      if(!root&&!(provider&&keys.length===3&&['base_url','wire_api'].includes(keys[2])))continue;
      const id=JSON.stringify(keys);if(values.has(id))throw new Error('Duplicate routing key');
      // Slice the comment-free line with its original leading-space offset.
      const value=scanLine(raw.slice(equal+1)).line;
      values.set(id,simpleString(value));
    }
    const get=keys=>values.get(JSON.stringify(keys));
    const selected=get(['model_provider']);
    const base=get(['model_providers','github_copilot_bridge','base_url']);
    const wire=get(['model_providers','github_copilot_bridge','wire_api']);
    let local=false;
    try{const url=new URL(base);local=url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)
      &&url.port===String(port)&&['/v1','/v1/'].includes(url.pathname)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}
    const configured=selected==='github_copilot_bridge'&&local&&(wire===undefined||wire==='responses');
    return {configured,configCheck:configured?'matched':'not-routed'};
  }catch{return unknown('ambiguous');}
}

async function inspectConfig(config,port){
  let file;
  try{
    // Do not follow symlinks into a credential file or block on FIFOs/devices.
    if((await fs.lstat(config)).isSymbolicLink())return {...unknown('unavailable'),configExists:true};
    file=await fs.open(config,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    const before=await file.stat();
    if(!before.isFile())return {...unknown('unavailable'),configExists:true};
    if(before.size>configByteLimit)return {...unknown('too-large'),configExists:true};
    const buffer=Buffer.alloc(configByteLimit+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length>configByteLimit)return {...unknown('too-large'),configExists:true};
    const after=await file.stat();
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
      return {...unknown('changed-during-read'),configExists:true};
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));
    return {...inspectPortableRouting(text,port),configExists:true};
  }catch(error){return error.code==='ENOENT'?{configured:false,configExists:false,configCheck:'missing'}
    :{...unknown('unavailable'),configExists:true};}
  finally{await file?.close();}
}

export async function inspectCodexCli({env=process.env,executable=env.CODEX_EXECUTABLE||'codex',
  arguments:args=['--version'],timeoutMs=8000}={}){
  return new Promise(resolve=>{
    const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let text='',bytes=0,rejected=false;
    const timer=setTimeout(()=>{rejected=true;child.kill();},timeoutMs);
    child.stdout.on('data',value=>{bytes+=value.length;if(bytes>4096){rejected=true;child.kill();}else text+=value;});
    child.stderr.resume();
    child.once('error',error=>{clearTimeout(timer);resolve(error.code==='ENOENT'?{installed:false}:{checkFailed:true});});
    child.once('close',code=>{clearTimeout(timer);
      const version=/^codex-cli (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s*$/.exec(text)?.[1];
      resolve(!rejected&&code===0&&version?{installed:true,version}:{checkFailed:true});
    });
  });
}

export async function inspectPortableInstallation({port,env=process.env,probe=inspectCodexCli}={}){
  const client=await probe({env}).catch(()=>({checkFailed:true}));
  const base={installed:client.installed===true,...(client.version?{version:client.version}:{}),
    ...scope,backup:'not-managed',customHome:Boolean(env.CODEX_HOME?.trim())};
  let selected;
  try{selected=resolvePortableCodexConfig(env);}catch{return {...base,...unknown('invalid-home')};}
  const config=await inspectConfig(selected.config,port);
  return {...base,...config,...(client.checkFailed?{checkFailed:true}:{})};
}
