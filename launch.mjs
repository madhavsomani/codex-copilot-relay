import {pathToFileURL} from 'node:url';

export function selectClient(args){
  const [client,...rest]=args;
  if(!['codex','claude','claude-desktop','gateway'].includes(client))throw new Error('Select gateway, codex, claude or claude-desktop. Run node launch.mjs --help.');
  return {client,args:rest};
}

export async function launch(args=process.argv.slice(2)){
  if(args.length===1&&['--help','-h'].includes(args[0])){
    console.log('Combined service: node launch.mjs gateway [--port 4265] [--open] [--check]\nOne listener: Codex /v1, Claude /claude, read-only /dashboard. See docs/UNIFIED-GATEWAY.md.');
    console.log('Copilot Relay: stock clients and opt-in desktop attachment\n\n  node launch.mjs codex [--port 4141] [--model gpt-6.1-sol] [--effort high] [--setup-port 0] [--open-setup | --no-setup] -- [Codex arguments]\n  node launch.mjs claude [--port 4246] [--no-setup] -- [--model claude-opus-5-5] [--effort high] [Claude arguments]\n  node launch.mjs claude-desktop [--port 4261] [--setup-port 0] [--open-setup | --no-setup] [--check]\n\nEach mode can expose its own credential-free read-only observer. Uses your own signed-in, entitled Copilot account. No client patches, automatic saved config/auth edits, provider fallback, or guaranteed native parity. Desktop attachment needs the app\'s supported third-party inference form; see docs/CLAUDE-DESKTOP.md.\nInstall dependencies and authenticate the official Copilot CLI first. See docs/PORTABLE-LAUNCH.md.');
    return 0;
  }
  const selected=selectClient(args);
  const module=await import(selected.client==='gateway'?'./unified-launch.mjs':selected.client==='codex'?'./codex-gateway/launch.mjs':
    selected.client==='claude'?'./claude-gateway/launch.mjs':'./claude-gateway/desktop-launch.mjs');
  return await module.launch(selected.args);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  launch().then(code=>{process.exitCode=code;}).catch(error=>{
    // Child diagnostics must not render raw inherited environment or credentials.
    console.error(error?.publicMessage??'Client launch failed. Check the local diagnostics and setup guide; no provider fallback was attempted.');
    process.exitCode=1;
  });
}
