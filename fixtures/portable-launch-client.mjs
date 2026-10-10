import fs from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli 0.147.0');process.exit(0);}
const catalogArgument=args.find(value=>value.startsWith('model_catalog_json='));
const catalogPath=catalogArgument?JSON.parse(catalogArgument.slice('model_catalog_json='.length)):null;
const catalog=catalogPath?JSON.parse(fs.readFileSync(catalogPath,'utf8')):null;
fs.writeFileSync(process.env.PORTABLE_FIXTURE_CLIENT_RESULT,JSON.stringify({args,
  catalogModels:catalog?.models.map(value=>({id:value.slug,context:value.context_window})),
  localKeyPresent:typeof process.env.CODEX_COPILOT_BRIDGE_KEY==='string'&&process.env.CODEX_COPILOT_BRIDGE_KEY.length===64,
  inheritedBridgePort:process.env.BRIDGE_PORT??null,alternateProviderEnabled:process.env.RELAY_OPENAI_ENABLED??null}));
if(process.env.PORTABLE_FIXTURE_CLIENT_WAIT==='1')setInterval(()=>{},1000);
else process.exit(Number(process.env.PORTABLE_FIXTURE_CLIENT_EXIT??0));
