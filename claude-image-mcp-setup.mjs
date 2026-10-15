// Register the relay_images MCP adapter in a Claude desktop profile.
// Adds one entry, preserves every other MCP server and setting, and keeps a
// receipt so restore removes only what this script added.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {serverName} from './claude-image-mcp.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function object(text){const value=JSON.parse(text??'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object.');return value;}
function replace(file,before,after){
  for(let p=path.resolve(file);path.dirname(p)!==p;p=path.dirname(p))
    if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw new Error('Refusing linked configuration paths.');
  if(read(file)!==before)throw new Error('Configuration changed; no overwrite.');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.relay-'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,after,{flag:'wx',mode:0o600});if(read(file)!==before)throw new Error('Configuration changed; no overwrite.');fs.renameSync(tmp,file);}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export function imagePaths({env=process.env,profile='third-party',repository=root}={}){
  const home=env.USERPROFILE||env.HOME||os.homedir();
  const config=profile==='third-party'?path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Claude-3p','claude_desktop_config.json')
    :profile==='standard'?path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'Claude','claude_desktop_config.json')
    :(()=>{throw new Error('Unknown Desktop profile.');})();
  return {config,receipt:path.join(repository,'runtime','claude-image-mcp-setup.json'),repository};
}
// Absolute node and script paths; no credentials, tokens or endpoints in the entry.
export function imageDefinition({node=process.execPath,repository=root}={}){
  return {command:node,args:[path.join(repository,'claude-image-mcp.mjs')]};
}
export function imageSetupStatus(paths=imagePaths(),definition=imageDefinition({repository:paths.repository})){
  try{
    const entry=object(read(paths.config)).mcpServers?.[serverName];
    const receipt=read(paths.receipt)?object(read(paths.receipt)):null;
    return {configuration:entry?(same(entry,definition)?'configured':'different-configuration'):'not-configured',
      receipt:receipt?.state??'none',reload:'Restart Claude desktop to load MCP changes.',
      billing:'Native images use the separate OpenAI/ChatGPT allowance, not Copilot credits.',liveGeneration:'unverified'};
  }catch{return {configuration:'unreadable'};}
}
export function applyImageSetup(paths=imagePaths(),definition=imageDefinition({repository:paths.repository})){
  const saved=read(paths.receipt),before=read(paths.config),config=object(before);
  if(config.mcpServers!==undefined&&(!config.mcpServers||typeof config.mcpServers!=='object'||Array.isArray(config.mcpServers)))
    throw new Error('Invalid existing MCP configuration.');
  const entry=config.mcpServers?.[serverName];
  if(saved&&object(saved).state==='applied'){
    if(same(entry,definition))return {state:'already-applied'};
    throw new Error('Existing relay_images entry changed; inspect or restore first.');
  }
  if(entry!==undefined)throw new Error('An MCP server named relay_images already exists; no overwrite.');
  const receipt={version:1,state:'prepared',configPath:path.resolve(paths.config),configExisted:before!==null,
    serversExisted:config.mcpServers!==undefined,definition,at:new Date().toISOString()};
  replace(paths.receipt,saved,JSON.stringify(receipt,null,2)+'\n');
  config.mcpServers={...config.mcpServers,[serverName]:definition};
  replace(paths.config,before,JSON.stringify(config,null,2)+'\n');
  replace(paths.receipt,read(paths.receipt),JSON.stringify({...receipt,state:'applied'},null,2)+'\n');
  return {state:'applied',reload:'Restart Claude desktop yourself when convenient; running sessions keep their current tools.'};
}
export function restoreImageSetup(paths=imagePaths()){
  const saved=read(paths.receipt);if(!saved)return {state:'not-installed'};
  const receipt=object(saved);if(receipt.state==='restored')return {state:'already-restored'};
  if(receipt.configPath!==path.resolve(paths.config))throw new Error('Setup ownership mismatch; no changes.');
  const before=read(paths.config),config=object(before),entry=config.mcpServers?.[serverName];
  if(entry!==undefined){
    if(!same(entry,receipt.definition))throw new Error('Restore refused to preserve your changes.');
    delete config.mcpServers[serverName];
    if(!receipt.serversExisted&&!Object.keys(config.mcpServers).length)delete config.mcpServers;
    replace(paths.config,before,JSON.stringify(config,null,2)+'\n');
    if(!receipt.configExisted&&!Object.keys(config).length)fs.unlinkSync(paths.config);
  }
  replace(paths.receipt,saved,JSON.stringify({...receipt,state:'restored'},null,2)+'\n');
  return {state:'restored'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const command=process.argv[2]??'status',option=process.argv[3];
    if(process.argv.length>4||!['status','apply','restore'].includes(command)||option!==undefined&&!/^--profile=(standard|third-party)$/.test(option))
      throw new Error('Use status, apply or restore, optionally --profile=standard or --profile=third-party (default).');
    const paths=imagePaths({profile:option?.split('=')[1]??'third-party'});
    console.log(JSON.stringify(command==='apply'?applyImageSetup(paths):command==='restore'?restoreImageSetup(paths):imageSetupStatus(paths)));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
