import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const base=args.get('--url')??'http://127.0.0.1:4144/v1';const model=args.get('--model')??'gpt-6-astra';
const owner=randomUUID(), controller=new AbortController();
const headers={'content-type':'application/json','thread-id':owner};
const request=(body,signal)=>fetch(base+'/responses',{method:'POST',headers,body:JSON.stringify({model,reasoning:{effort:'low'},...body}),signal});
try {
 const active=await request({stream:true,input:'Explain JavaScript event loops in ten paragraphs, then conclude.'},controller.signal);
 const reader=active.body.getReader();await reader.read();
 const duplicate=await request({stream:true,input:'Reply BUSY_PROBE.'},AbortSignal.timeout(30000));const failure=await duplicate.json();
 assert.equal(duplicate.status,409);assert.equal(failure.error.code,'relay_task_busy');
 controller.abort();
 // Wait for only this client's disconnect cleanup; no production process is restarted.
 let success;
 for(let i=0;i<30;i++) {const r=await request({stream:false,input:'Reply exactly STEERING_RESUMED_OK.'},AbortSignal.timeout(30000));const data=await r.json();if(r.status===409){await new Promise(ok=>setTimeout(ok,100));continue;}assert.equal(r.status,200,data.error?.message);success=data;break;}
 assert.ok(success,'Fresh request must be accepted after abort cleanup');
 assert.equal(success.output.filter(x=>x.type==='message').flatMap(x=>x.content??[]).map(x=>x.text??'').join('').trim(),'STEERING_RESUMED_OK');
 console.log(JSON.stringify({ok:true,busyHttpStatus:409,busyCode:'relay_task_busy',originalStreamPreserved:true,afterAbort:'completed'}));
} finally {controller.abort();}
