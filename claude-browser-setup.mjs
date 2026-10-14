import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const browserPackage='@playwright/mcp@0.0.83',browserServerName='relay_browser';
export const browserSkill=fs.readFileSync(new URL('./docs/relay-browser-research.SKILL.md',import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
function object(text){const value=JSON.parse(text??'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object.');return value;}
function ordinary(file){for(let p=path.resolve(file);;p=path.dirname(p)){
  if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw new Error('Refusing linked configuration paths.');
  if(path.dirname(p)===p)break;
}}
function replace(file,before,after){
  ordinary(file);if(read(file)!==before)throw new Error('Configuration changed; no overwrite.');
  fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.relay-'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,after,{flag:'wx',mode:0o600});if(read(file)!==before)throw new Error('Configuration changed; no overwrite.');fs.renameSync(tmp,file);}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export function setupPaths({root=path.dirname(fileURLToPath(import.meta.url)),env=process.env,platform=process.platform,profile}={}){
  if(profile!==undefined&&!['standard','third-party'].includes(profile))throw new Error('Unknown Desktop profile.');
  if(profile==='third-party'&&platform!=='win32')throw new Error('The third-party profile path is currently verified on Windows only.');
  const home=env.USERPROFILE||env.HOME||os.homedir();
  const desktop=platform==='win32'?path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'Claude'):
    platform==='darwin'?path.join(home,'Library','Application Support','Claude'):path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'Claude');
  const candidates={standard:path.join(desktop,'claude_desktop_config.json')};
  if(platform==='win32')candidates['third-party']=path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Claude-3p','claude_desktop_config.json');
  const receipt=path.join(root,'runtime','claude-browser-setup.json');
  // Follow only a previously selected, known profile. Never accept arbitrary
  // journal paths or change profile because another app directory appeared.
  if(profile===undefined&&read(receipt)!==null){
    const saved=object(read(receipt));profile=Object.keys(candidates).find(key=>path.resolve(candidates[key])===saved.configPath);
    if(!profile)throw new Error('Saved Desktop profile path is unknown; inspect the setup receipt.');
  }
  return {config:candidates[profile??'standard'],skill:path.join(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'skills','relay-browser-research','SKILL.md'),receipt};
}
// The extension lives in one browser's profile. Playwright looks in Chrome
// unless a channel is chosen, so Edge users must select msedge explicitly.
export const browserChannels=Object.freeze(['chrome','msedge']);
export function browserDefinition(platform=process.platform,browser){
  if(browser!==undefined&&!browserChannels.includes(browser))throw new Error('Unknown browser; use chrome or msedge.');
  // Constant arguments only. No browser approval-bypass token or policy override.
  const args=['--yes',browserPackage,'--extension','--no-webmcp',...(browser?['--browser',browser]:[])];
  return platform==='win32'?{command:'cmd',args:['/d','/c','npx',...args]}:{command:'npx',args};
}
// Every definition this setup could have written: the default or a selected channel.
const owned=entry=>[undefined,...browserChannels].some(browser=>same(entry,browserDefinition(process.platform,browser)));
const channel=entry=>browserChannels.find(browser=>same(entry,browserDefinition(process.platform,browser)))??(owned(entry)?'chrome':undefined);
export function browserSetupStatus(paths=setupPaths()){
  try{const entry=object(read(paths.config)).mcpServers?.[browserServerName];return {
    configuration:entry?(owned(entry)?'configured':'different-configuration'):'not-configured',browser:channel(entry)??null,
    desktopProfile:path.basename(path.dirname(paths.config))==='Claude-3p'?'third-party':'standard',
    researchSkill:read(paths.skill)===browserSkill?'configured':'not-configured',browserConnection:'unverified',guiVerification:'unverified',
    searchMode:'browser-based; no hosted search adapter',package:browserPackage,automaticFallback:false};}
  catch{return {configuration:'unreadable',browserConnection:'unverified',guiVerification:'unverified',automaticFallback:false};}
}
export function applyBrowserSetup(paths=setupPaths(),{browser}={}){
  for(const file of Object.values(paths))ordinary(file);const saved=read(paths.receipt);
  // Start/resume keeps a previously selected channel; an explicit choice wins.
  const prior=saved?object(saved).definition:undefined;
  const desired=browser!==undefined?browserDefinition(process.platform,browser):owned(prior)?prior:browserDefinition();
  if(saved){const old=object(saved);if(old.state!=='restored'){
    if(old.configPath!==path.resolve(paths.config)||old.skillPath!==path.resolve(paths.skill))throw new Error('Setup paths changed; review the prior receipt first.');
    if(old.state==='applied'&&same(object(read(paths.config)).mcpServers?.[browserServerName],desired)&&read(paths.skill)===browserSkill)return {state:'already-applied'};
    throw new Error('Existing setup changed or is incomplete; inspect/restore before reapplying.');
  }}
  const before=read(paths.config),config=object(before),skill=read(paths.skill);
  if(config.mcpServers!==undefined&&(!config.mcpServers||typeof config.mcpServers!=='object'||Array.isArray(config.mcpServers)))throw new Error('Invalid existing MCP configuration.');
  const old=saved?object(saved):null,entry=config.mcpServers?.[browserServerName];
  const resuming=old?.version===1&&old.state==='restored'&&old.configPath===path.resolve(paths.config)
    &&old.skillPath===path.resolve(paths.skill)&&same(old.definition,desired)&&old.skillHash===hash(browserSkill);
  // Desktop may save its in-memory MCP settings again after Stop. Resume only
  // exact prior opt-in components, and treat retained components as preexisting
  // so a later Restore removes only the additions made by this invocation.
  if(entry!==undefined&&(!resuming||!same(entry,desired))
    ||skill!==null&&(!resuming||skill!==browserSkill))throw new Error('Existing browser entry or skill; no overwrite.');
  const receipt={version:1,state:'prepared',configPath:path.resolve(paths.config),skillPath:path.resolve(paths.skill),configExisted:before!==null,
    serversExisted:config.mcpServers!==undefined,entryExisted:entry!==undefined,skillExisted:skill!==null,
    definition:desired,skillHash:hash(browserSkill),at:new Date().toISOString()};
  // Recovery journal stores only our additions, never unrelated credentials.
  replace(paths.receipt,saved,JSON.stringify(receipt,null,2)+'\n');
  if(entry===undefined){config.mcpServers={...config.mcpServers,[browserServerName]:receipt.definition};replace(paths.config,before,JSON.stringify(config,null,2)+'\n');}
  if(skill===null)replace(paths.skill,null,browserSkill);
  replace(paths.receipt,read(paths.receipt),JSON.stringify({...receipt,state:'applied'},null,2)+'\n');
  return {state:'applied',browserConnection:'approval-required',guiVerification:'unverified'};
}
export function restoreBrowserSetup(paths=setupPaths()){
  for(const file of Object.values(paths))ordinary(file);const saved=read(paths.receipt);if(!saved)return {state:'not-installed'};
  const receipt=object(saved);if(receipt.state==='restored')return {state:'already-restored'};
  if(receipt.version!==1||receipt.configPath!==path.resolve(paths.config)||receipt.skillPath!==path.resolve(paths.skill)||!owned(receipt.definition)||receipt.skillHash!==hash(browserSkill))throw new Error('Setup ownership mismatch; no changes.');
  const before=read(paths.config),config=object(before),entry=config.mcpServers?.[browserServerName],skill=read(paths.skill);
  if(entry!==undefined&&!same(entry,receipt.definition)||skill!==null&&hash(skill)!==receipt.skillHash)throw new Error('Restore refused to preserve your changes.');
  if(entry!==undefined&&!receipt.entryExisted){delete config.mcpServers[browserServerName];if(!receipt.serversExisted&&Object.keys(config.mcpServers).length===0)delete config.mcpServers;
    replace(paths.config,before,JSON.stringify(config,null,2)+'\n');if(!receipt.configExisted&&Object.keys(config).length===0)fs.unlinkSync(paths.config);}
  if(skill!==null&&!receipt.skillExisted){if(read(paths.skill)!==skill)throw new Error('Skill changed during restore.');fs.unlinkSync(paths.skill);}
  replace(paths.receipt,saved,JSON.stringify({...receipt,state:'restored'},null,2)+'\n');return {state:'restored'};
}
// Switch the owned entry to the browser that has the Playwright extension.
// Only an unchanged applied entry is rewritten; Desktop must be restarted.
export function selectBrowser(browser,paths=setupPaths()){
  for(const file of Object.values(paths))ordinary(file);const saved=read(paths.receipt);
  if(!saved)throw new Error('Apply the browser setup first.');
  const receipt=object(saved),definition=browserDefinition(process.platform,browser);
  if(receipt.state!=='applied'||!owned(receipt.definition))throw new Error('Browser setup is not applied by this relay; no changes.');
  const before=read(paths.config),config=object(before),entry=config.mcpServers?.[browserServerName];
  if(same(entry,definition))return {state:'already-selected',browser};
  if(!same(entry,receipt.definition))throw new Error('Browser entry changed; no overwrite.');
  replace(paths.receipt,saved,JSON.stringify({...receipt,definition},null,2)+'\n');
  config.mcpServers[browserServerName]=definition;replace(paths.config,before,JSON.stringify(config,null,2)+'\n');
  return {state:'selected',browser,restartRequired:true};
}
export function resumeBrowserSetup(paths=setupPaths()){
  const saved=read(paths.receipt);if(!saved)return {state:'not-opted-in'};
  const receipt=object(saved);
  if(receipt.configPath!==path.resolve(paths.config)||receipt.skillPath!==path.resolve(paths.skill))throw new Error('Setup paths changed; review the prior receipt first.');
  return applyBrowserSetup(paths);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const command=process.argv[2]??'status',option=process.argv[3];
    if(command==='browser'){
      if(process.argv.length!==4||!browserChannels.includes(option))throw new Error('Use: browser chrome|msedge');
      console.log(JSON.stringify(selectBrowser(option,setupPaths())));
    }else{
    if(process.argv.length>4||!['status','apply','restore','resume'].includes(command)||option!==undefined&&!/^--profile=(standard|third-party)$/.test(option))throw new Error('Use status, apply, restore, resume or browser chrome|msedge, optionally --profile=standard or --profile=third-party.');
    const paths=setupPaths({profile:option?.split('=')[1]});
    console.log(JSON.stringify(command==='resume'?resumeBrowserSetup(paths):command==='apply'?applyBrowserSetup(paths):command==='restore'?restoreBrowserSetup(paths):browserSetupStatus(paths)));}}
  catch(error){console.error(error.message);process.exitCode=1;}
}
