// This IPC channel is inherited only by the owning launcher. No HTTP shutdown
// endpoint, arbitrary commands, or browser credentials are added to the relay.
let loaded=false,stopping=false;
const stop=()=>{stopping=true;if(loaded)process.emit('SIGTERM');};
process.on('message',message=>{if(message?.type==='shutdown')stop();});
process.on('disconnect',stop);
try{
  await import('../server.mjs');
  loaded=true;
  if(stopping)stop();
  else if(process.connected)process.send({type:'initialized'});
}catch{
  // Upstream errors may contain authentication data. Report only a fixed code.
  if(process.connected)process.send({type:'startup_failed'});
  process.exitCode=1;
  process.disconnect?.();
}
