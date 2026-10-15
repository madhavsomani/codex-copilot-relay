import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {sdkToolName} from './claude-gateway/protocol.mjs';
import {MessageSink} from './claude-gateway/stream.mjs';
import {Ledger} from './claude-gateway/ledger.mjs';
import {estimateTokens} from './claude-gateway/server.mjs';

test('SDK tool names depend only on the client name, never on catalog position',()=>{
  const read={name:'Read'},long={name:'mcp__'+'x'.repeat(100)};
  assert.equal(sdkToolName(read,0),'client_Read');assert.equal(sdkToolName(read,57),'client_Read');
  assert.equal(sdkToolName(long,0),sdkToolName(long,9));assert.ok(sdkToolName(long,0).length<=64);
  assert.notEqual(sdkToolName({name:'mcp__relay_images__edit_image'},23),sdkToolName({name:'mcp__relay_images__generate_image'},24));
  assert.doesNotMatch(sdkToolName({name:'mcp__relay_images__generate_image'},24),/\d/);
});

function fakeResponse(){
  const response=new EventEmitter();Object.assign(response,{headersSent:false,status:null,headers:null,written:[],ended:false,
    writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;},
    write(chunk){if(!this.headersSent)this.writeHead(200,{});this.written.push(String(chunk));},end(){this.ended=true;}});
  return response;
}
test('pings wait for the answer so a fast upstream error keeps its HTTP status and retry headers',async()=>{
  const response=fakeResponse(),sink=new MessageSink(response,{stream:true,model:'m'},()=>{},5,60000);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(response.headersSent,false,'no ping before the answer starts');
  sink.fail(Object.assign(new Error('rate limited'),{statusCode:429,type:'rate_limit_error',retryAfter:'7'}));
  assert.equal(response.status,429);assert.equal(response.headers['retry-after'],'7');
});
test('after the grace period pings start, so a slow first token never looks dead',async()=>{
  const response=fakeResponse(),sink=new MessageSink(response,{stream:true,model:'m'},()=>{},5,20);
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(response.status,200);assert.ok(response.written.some(chunk=>chunk.includes('event: ping')));
  sink.fail(new Error('x'));
});

test('token estimate skips deferred tool schemas and reuses per-message counts',()=>{
  const big='word '.repeat(5000);
  const input={system:'sys',prompt:'[USER]\n'+big+'\n\n[ASSISTANT]\nok'};
  const loaded={name:'A',input_schema:{type:'object',description:big}};
  const base=estimateTokens(input,{tools:[]},{});
  assert.ok(estimateTokens(input,{tools:[loaded]},{})>base+3000);
  assert.equal(estimateTokens(input,{tools:[{...loaded,defer_loading:true}]},{}),base,'deferred schemas are not counted');
  const started=performance.now();for(let i=0;i<50;i++)estimateTokens(input,{tools:[]},{});
  assert.ok(performance.now()-started<500,'cached counts make repeated estimates cheap');
});

test('a ledger near its size guard trims old rows and never throws into the request path',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-ledger-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ledger=new Ledger(path.join(dir,'ledger.json'));
  ledger.state.recent=Array.from({length:1000},(_,i)=>({id:'r'+i,status:'completed',pad:'x'.repeat(5000)}));
  assert.doesNotThrow(()=>ledger.save());
  assert.ok(fs.statSync(path.join(dir,'ledger.json')).size<=4*1024*1024);
  assert.ok(ledger.state.recent.length<1000);assert.equal(ledger.state.recent.at(-1).id,'r999','newest rows kept');
  // An unwritable path is recorded, not thrown.
  const broken=new Ledger(null);broken.file=path.join(dir,'missing','\0bad');assert.doesNotThrow(()=>broken.save());assert.ok(broken.saveError);
});
