// Metadata only: no inference and no credentials/account identifiers in output.
import {CopilotClient} from '@github/copilot-sdk';
const client = new CopilotClient({mode:'copilot-cli',useLoggedInUser:true,logLevel:'error'});
const timer = setTimeout(() => process.exit(2), 20000);
try {
  await client.start();
  const auth = await client.getAuthStatus();
  const catalog = auth.isAuthenticated ? await client.listModels() : [];
  const accessible = catalog.filter(model=>model.policy?.state!=='disabled').map(model=>model.id);
  const models=accessible.filter(id=>/^gpt-[a-z0-9.-]+$/.test(id));
  const claudeModels=accessible.filter(id=>/^claude-[a-z0-9.-]+$/.test(id)).map(id=>id.replaceAll('.','-'));
  const modelDetails=process.argv.includes('--model-metadata')
    ? (await import('./codex-gateway/model-catalog.mjs')).selectSdkGptModelDetails(catalog):null;
  console.log(JSON.stringify({authenticated:auth.isAuthenticated === true,models,claudeModels,
    ...(modelDetails?{modelDetails}:{})}));
} catch {console.log(JSON.stringify({authenticated:false,models:[],unavailable:true}));}
finally {await client.stop().catch(()=>{});clearTimeout(timer);}
