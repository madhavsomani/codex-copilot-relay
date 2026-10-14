// Finite opt-in acceptance: two Copilot requests, synthetic images only.
// No production port/config changes, user screenshots or provider fallback.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {startSdkGateway} from './server.mjs';
import {ClaudeRequestHandler} from './request-handler.mjs';
import {historyFingerprint} from './protocol.mjs';

if(process.argv.length!==3||process.argv[2]!=='--live')throw new Error('Use --live to authorize exactly two synthetic-image Copilot requests (Copilot usage applies).');
const root=fileURLToPath(new URL('../runtime/',import.meta.url));mkdirSync(root,{recursive:true});
const workspace=mkdtempSync(path.join(root,'claude-native-image-proof-'));
const token=randomBytes(32).toString('hex'),codes=[0,1].map(()=>randomBytes(4).toString('hex').toUpperCase());
const images=await Promise.all(codes.map(async(code,i)=>({type:'image',source:{type:'base64',media_type:'image/png',data:(await sharp(Buffer.from(
  `<svg width="480" height="160"><rect width="480" height="160" fill="${i?'#e7efff':'#fff0e5'}"/><text x="24" y="104" font-family="Arial" font-weight="bold" font-size="64" fill="#000000">${code}</text></svg>`)).png().toBuffer()).toString('base64')}})));
let expected,wireChecks=0,gateway;const responses=[];
const handler=new ClaudeRequestHandler(wire=>{assert.equal(historyFingerprint(wire.messages),historyFingerprint(expected));wireChecks++;});
try{
  gateway=await startSdkGateway({token,port:0,workingDirectory:workspace,runtimeDirectory:path.join(workspace,'metering'),requestHandler:handler});
  const model=gateway.models.find(m=>m.id==='claude-opus-5.5'&&m.policy?.state!=='disabled');assert.ok(model,'The explicit Opus model must be entitled; no alternate model');
  let messages=[{role:'user',content:[{type:'text',text:'Read the uppercase code printed in each image, in image order. Return only those codes.'},...images]}];
  for(let i=0;i<2;i++){
    expected=messages;
    const body={model:'claude-opus-5-5',max_tokens:2048,stream:false,thinking:{type:'adaptive'},output_config:{effort:'low'},messages};
    const response=await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/messages`,{method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json','anthropic-version':'2023-06-01','x-claude-code-session-id':'synthetic-native-proof'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const reply=await response.json();assert.equal(response.status,200,reply.error?.message);
    assert.equal(reply.stop_reason,'end_turn');
    const text=reply.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
    for(const code of codes)assert.ok(text.includes(code),'Model must actually read each random image code');
    const signed=reply.content.filter(b=>b.type==='thinking'||b.type==='redacted_thinking').length;
    responses.push({imageOccurrences:i?3:2,signedBlocks:signed,codeReadingVerified:true});
    if(i===0){
      // Simple image reading may produce no thinking. Record that fact rather
      // than induce costly reasoning or pretend a signature was exercised.
      messages=[...messages,{role:'assistant',content:reply.content},{role:'user',content:[
        {type:'text',text:'Read the code in this repeated image. Then repeat both original image codes in their original order.'},images[0]]}];
    }
  }
  assert.equal(gateway.ledger.state.received,2);assert.equal(gateway.ledger.state.completed,2);assert.equal(gateway.ledger.state.failed,0);
  const credits=gateway.ledger.state.usage.reduce((n,row)=>n+(row.totalNanoAiu??0)/1e9,0);
  const report={ok:true,provider:'github-copilot-sdk',model:'claude-opus-5.5',responses,wireChecks,received:2,
    aiCredits:credits,usage:gateway.ledger.state.usage,advertisedVision:model.capabilities?.limits?.vision,
    nativeImagesUnchanged:true,signedReplayVerified:responses[0].signedBlocks>0,openaiCalls:0,productionConfigChanged:false,workspace};
  writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  writeFileSync(path.join(workspace,'report.json'),JSON.stringify({ok:false,error:error.message,responses,wireChecks,
    usage:gateway?.ledger.state.usage,requests:gateway?.ledger.state.recent},null,2));
  console.error(error.message+'\nEvidence: '+workspace);process.exitCode=1;
}finally{await gateway?.close();}
