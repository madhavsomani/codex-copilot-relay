import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomInt,createHash} from 'node:crypto';
import sharp from 'sharp';

const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const base=args.get('--url')||'http://127.0.0.1:4144/v1';
const model=args.get('--model')||'gpt-6-astra';
const directory=path.resolve(args.get('--artifacts')||'runtime/vision-parity-'+Date.now());
await fs.mkdir(directory,{recursive:true});
const images=[];
for(let i=0;i<3;i++) {
  const code=String(randomInt(100000,1000000));
  const svg=Buffer.from(`<svg width="960" height="360"><rect width="960" height="360" fill="#f3f4f6"/><rect x="24" y="24" width="912" height="312" rx="12" fill="white"/><text x="70" y="85" font-size="28" font-family="Arial" fill="#344054">SCREENSHOT VERIFICATION</text><text x="70" y="250" font-size="112" font-family="Arial" font-weight="bold" fill="#101828">${code}</text></svg>`);
  const bytes=await sharp(svg).png().toBuffer();await fs.writeFile(path.join(directory,`screenshot-${i+1}.png`),bytes);
  images.push({code,image:{type:'input_image',image_url:'data:image/png;base64,'+bytes.toString('base64')},sha256:createHash('sha256').update(bytes).digest('hex')});
}
const request=async body=>{const response=await fetch(base+'/responses',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({model,stream:false,reasoning:{effort:'xhigh'},...body}),signal:AbortSignal.timeout(120000)});
  const result=await response.json();assert.equal(response.status,200,result.error?.message);return result;};
const text=result=>(result.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).map(item=>item.text||'').join('').trim();
const results=[];
for(const [index,image] of images.entries()) {
  const response=await request({input:[{role:'user',content:[{type:'input_text',text:'Read the six-digit code. Return only the digits.'},image.image]}]});
  results.push({path:'direct',index,expected:image.code,actual:text(response),ok:text(response)===image.code,sha256:image.sha256});
}
const tool={type:'function',name:'screenshot',description:'Get the next screenshot.',parameters:{type:'object',properties:{},additionalProperties:false}};
let response=await request({tools:[tool],input:'Call screenshot three times, one at a time. After each screenshot, state the six-digit code you actually see as CODE:digits. Then request the next. Stop after reading the third. Do not guess.'});
for(const [index,image] of images.entries()) {
  const call=response.output?.find(item=>item.type==='function_call');assert.ok(call,'Expected screenshot call '+index);
  response=await request({previous_response_id:response.id,input:[{type:'function_call_output',call_id:call.call_id,
    output:[{type:'input_text',text:'Here is the current screenshot. Read its six-digit code.'},image.image]}]});
  const answer=text(response);results.push({path:'tool',index,expected:image.code,actual:answer,
    ok:answer.includes(image.code),sha256:image.sha256});
}
// Exercise two image inputs through the one-slot provider's packed overview.
const packed=await request({input:[{role:'user',content:[{type:'input_text',text:'Read the code from each image in order. Return only the two codes separated by a comma.'},images[0].image,images[1].image]}]});
results.push({path:'packed-two-images',expected:images.slice(0,2).map(x=>x.code),actual:text(packed),ok:images.slice(0,2).every(x=>text(packed).includes(x.code))});
const report={model,ok:results.every(x=>x.ok),results,artifacts:directory};
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
