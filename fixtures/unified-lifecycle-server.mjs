// Scripted child for lifecycle tests only. Never a production provider.
import http from 'node:http';
import fs from 'node:fs';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const server=http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({
  ok:true,sdk:{ok:true},version,unified:true,claude:{sdkState:'ready'}}));});
server.listen(Number(process.env.BRIDGE_PORT),'127.0.0.1',()=>{
  process.send({type:'relay_console',text:'[Claude Code] completed fixture',skipped:0});
  process.send({type:'initialized'});
});
const stop=()=>{server.closeAllConnections();server.close(()=>process.exit(0));};
process.on('message',message=>{if(message?.type==='shutdown')stop();});process.on('disconnect',stop);
