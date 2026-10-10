// Deterministic stdio MCP proof tool. Used only by the opt-in local probe.
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
lines.on('line',line=>{
  const msg=JSON.parse(line);if(msg.id==null)return;
  if(msg.method==='initialize')return reply(msg.id,{protocolVersion:msg.params.protocolVersion,
    capabilities:{tools:{}},serverInfo:{name:'relay-proof-fixture',version:'1.0.0'}});
  if(msg.method==='tools/list')return reply(msg.id,{tools:[{name:'echo',description:'Returns deterministic local MCP proof.',
    inputSchema:{type:'object',properties:{marker:{type:'string'}},required:['marker']}}]});
  if(msg.method==='tools/call')return reply(msg.id,{content:[{type:'text',text:'MCP_PROOF:'+msg.params.arguments.marker}]});
  if(msg.method==='ping')return reply(msg.id,{});
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Unknown method'}})+'\n');
});
