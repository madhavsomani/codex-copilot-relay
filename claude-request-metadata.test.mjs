import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {ClaudeRequestHandler} from './claude-gateway/request-handler.mjs';

test('SDK model discovery passes unchanged without an inference session binding', async t => {
  const observed=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    observed.push({method:req.method,url:req.url,marker:req.headers['x-fixture'],body});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({data:[{id:'fixture-model'}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handler=new ClaudeRequestHandler(()=>assert.fail('Catalog must not be mapped as inference'));
  for(const [method,route] of [['GET','/models'],['GET','/models?api-version=fixture'],['POST','/models/session']]){
    const response=await handler.sendRequest(new Request(`http://127.0.0.1:${server.address().port}${route}`,{
      method,headers:{'x-fixture':'unchanged'},...(method==='POST'?{body:'{"fixture":"unchanged"}'}:{})}),{signal:new AbortController().signal});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{data:[{id:'fixture-model'}]});
  }
  assert.deepEqual(observed.map(r=>r.url),['/models','/models?api-version=fixture','/models/session']);
  assert.deepEqual(observed.map(r=>r.method),['GET','GET','POST']);
  assert.ok(observed.every(r=>r.marker==='unchanged'));
  assert.equal(observed[2].body,'{"fixture":"unchanged"}');
  assert.equal(handler.plans.size,0);
});

test('metadata exception never permits unbound inference, arbitrary routes or released sessions',async()=>{
  const handler=new ClaudeRequestHandler();
  for(const [method,route] of [['POST','/models'],['POST','/v1/messages'],['GET','/responses'],['GET','/models/other'],['GET','/models/session']]){
    await assert.rejects(handler.sendRequest(new Request(`http://127.0.0.1:1${route}`,{method}),
      {signal:new AbortController().signal}),/no native request binding/);
  }
  handler.release('released');
  await assert.rejects(handler.sendRequest(new Request('http://127.0.0.1:1/models'),
    {sessionId:'released',signal:new AbortController().signal}),/released/);
});
