import {readFileSync,statSync,readdirSync,existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec=promisify(execFile),maxSettingsBytes=1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const routingKey=key=>/^ANTHROPIC_/.test(key)||/^CLAUDE_CODE_(?:USE_|OAUTH_|PROVIDER_|GATEWAY_|EXTRA_BODY$|ENABLE_GATEWAY_MODEL_DISCOVERY$|DISABLE_EXPERIMENTAL_BETAS$)/.test(key);
function conflict(source,key){
  // Never include values, parser snippets, file contents or credential-helper commands.
  throw new Error(`Claude gateway routing conflict in ${source}: ${key}. Claude launch refused. Use a separate configuration without this override; ask your administrator about managed policy. Nothing was changed.`);
}
export function validateClientSettings(settings,source='supplied settings',managed=false){
  if(!object(settings))throw new Error(`Invalid ${source}: expected a JSON settings object.`);
  if(settings.env!==undefined&&!object(settings.env))throw new Error(`Invalid ${source}: env must be an object.`);
  for(const key of Object.keys(settings.env??{}))if(routingKey(key.toUpperCase()))conflict(source,key);
  for(const key of ['apiKeyHelper','fallbackModel','modelOverrides','forceLoginMethod','forceLoginOrgUUID','forceLoginGatewayUrl','policyHelper'])
    if(settings[key]!==undefined)conflict(source,key);
  if(settings.wslInheritsWindowsSettings===true)conflict(source,'wslInheritsWindowsSettings (policy inspection unavailable)');
  if(managed)for(const key of ['model','modelPicker'])if(settings[key]!==undefined)conflict(source,key);
  return settings;
}
function parse(text,source){
  if(Buffer.byteLength(text)>maxSettingsBytes)throw new Error(`${source} exceeds the 1 MiB settings admission limit.`);
  let settings;try{settings=JSON.parse(text);}catch{throw new Error(`Invalid JSON in ${source}; content is not printed.`);}
  return settings;
}
function read(file,source,optional=true){
  try{
    const stat=statSync(file);
    if(!stat.isFile())throw new Error(`${source} must be a regular JSON file.`);
    if(stat.size>maxSettingsBytes)throw new Error(`${source} exceeds the 1 MiB settings admission limit.`);
    return parse(readFileSync(file,'utf8'),source);
  }catch(error){
    if(optional&&error.code==='ENOENT')return undefined;
    if(error.code)throw new Error(`Cannot read ${source}; startup refused without changing it.`);
    throw error;
  }
}
export function parseClientArguments(args,{cwd=process.cwd()}={}){
  const forwarded=[];let settings={},scopes=['user','project','local'];
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--fallback-model'||arg.startsWith('--fallback-model='))conflict('client arguments','--fallback-model');
    if(arg==='--settings'||arg.startsWith('--settings=')){
      const value=arg==='--settings'?args[++i]:arg.slice(11);
      if(!value)throw new Error('--settings requires JSON or a settings file path.');
      settings=validateClientSettings(value.trim().startsWith('{')?parse(value,'supplied settings'):read(path.resolve(cwd,value),'supplied settings file',false));
      continue;
    }
    if(arg==='--setting-sources'||arg.startsWith('--setting-sources=')){
      const value=arg==='--setting-sources'?args[++i]:arg.slice('--setting-sources='.length);
      if(value===undefined)throw new Error('--setting-sources requires user,project,local or an empty string.');
      scopes=value===''?[]:value.split(',');
      if(scopes.some(scope=>!['user','project','local'].includes(scope)))throw new Error('Invalid --setting-sources; expected user,project,local or an empty string.');
      forwarded.push('--setting-sources',value);continue;
    }
    forwarded.push(arg);
  }
  return {settings,forwarded,scopes};
}

// Capture, don't log, registry JSON. No helper/policy command from settings runs.
// Both registry views are inspected conservatively; stock Claude still applies
// its own policy precedence. This never edits registry or bypasses policy.
export async function readWindowsPolicies(){
  const script=`$ErrorActionPreference='Stop'; $rows=@(); foreach($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)){foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view); $key=$null; try{$key=$base.OpenSubKey('SOFTWARE\\Policies\\ClaudeCode'); if($key){$value=$key.GetValue('Settings',$null); if($null -ne $value){$rows+=@{source=('Windows '+$hive+' '+$view+' policy');json=[string]$value}}}}finally{if($key){$key.Dispose()};$base.Dispose()}}}; ConvertTo-Json -InputObject @($rows) -Compress`;
  try{
    const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:4*maxSettingsBytes});
    const rows=JSON.parse(stdout.trim());
    if(!Array.isArray(rows))throw new Error();
    return rows.map(row=>({source:row.source,settings:parse(row.json,'Windows managed policy')}));
  }catch{throw new Error('Cannot inspect Windows Claude managed policy; startup refused. No policy values are printed or changed.');}
}
export async function preflightClientSettings(args,{cwd=process.cwd(),env=process.env,platform=process.platform,
  managedDirectory=platform==='win32'?path.join(env.ProgramFiles||'C:\\Program Files','ClaudeCode'):
    platform==='darwin'?'/Library/Application Support/ClaudeCode':'/etc/claude-code',
  registryReader=readWindowsPolicies}={}){
  const parsed=parseClientArguments(args,{cwd});
  if(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)conflict('launcher environment','CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST');
  const config=path.resolve(cwd,env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'));
  const files=[];
  if(parsed.scopes.includes('user'))files.push([path.join(config,'settings.json'),'user settings',false]);
  if(parsed.scopes.includes('project'))files.push([path.join(cwd,'.claude','settings.json'),'project settings',false]);
  if(parsed.scopes.includes('local')){
    files.push([path.join(cwd,'.claude','settings.local.json'),'local settings',false]);
    // Stock v2.1.211+ also reads the repository-root local settings alongside a
    // legacy starting-directory file. A .git file covers linked worktrees too.
    let ancestor=path.resolve(cwd);
    while(!existsSync(path.join(ancestor,'.git'))&&path.dirname(ancestor)!==ancestor)ancestor=path.dirname(ancestor);
    if(existsSync(path.join(ancestor,'.git')))files.push([path.join(ancestor,'.claude','settings.local.json'),'repository local settings',false]);
  }
  // Managed policy is inspected even when user/project sources are disabled.
  files.push([path.join(config,'remote-settings.json'),'cached server-managed settings',true],
    [path.join(managedDirectory,'managed-settings.json'),'system managed settings',true]);
  const dropins=path.join(managedDirectory,'managed-settings.d');let entries=[];
  try{entries=readdirSync(dropins).filter(name=>!name.startsWith('.')&&name.endsWith('.json')).sort();}
  catch(error){if(error.code!=='ENOENT')throw new Error('Cannot inspect managed settings drop-ins; startup refused.');}
  for(const name of entries)files.push([path.join(dropins,name),'managed settings drop-in',true]);
  const seen=new Set();
  for(const [file,source,managed] of files){
    if(seen.has(file))continue;seen.add(file);
    const settings=read(file,source);if(settings!==undefined)validateClientSettings(settings,source,managed);
  }
  if(platform==='win32')for(const row of await registryReader())validateClientSettings(row.settings,row.source,true);
  if(platform==='darwin'){
    // MDM policy is not ordinary JSON. Refuse detected profiles rather than
    // enabling a host override or pretending to resolve their effective policy.
    for(const directory of ['/Library/Managed Preferences',path.join('/Library/Managed Preferences',os.userInfo().username)])
      if(existsSync(path.join(directory,'com.anthropic.claudecode.plist')))conflict('macOS managed profile','policy inspection unavailable');
  }
  return parsed;
}
