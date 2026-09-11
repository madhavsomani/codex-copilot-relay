// Metadata only: no inference and no credentials/account identifiers in output.
import {CopilotClient} from '@github/copilot-sdk';
const client = new CopilotClient({mode:'copilot-cli',useLoggedInUser:true,logLevel:'error'});
const timer = setTimeout(() => process.exit(2), 20000);
try {
  await client.start();
  const auth = await client.getAuthStatus();
  const models = auth.isAuthenticated ? (await client.listModels()).map(m=>m.id).filter(id=>/^gpt-[a-z0-9.-]+$/.test(id)) : [];
  console.log(JSON.stringify({authenticated:auth.isAuthenticated === true,models}));
} catch {console.log(JSON.stringify({authenticated:false,models:[],unavailable:true}));}
finally {await client.stop().catch(()=>{});clearTimeout(timer);}
