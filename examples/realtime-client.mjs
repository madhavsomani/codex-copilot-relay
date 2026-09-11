// Transport smoke example, not a microphone app. Opening an upstream voice
// session uses your configured OpenAI Platform account. Do not run unknowingly.
import WebSocket from 'ws';
if(!process.env.RELAY_OPENAI_LOCAL_TOKEN||!process.env.RELAY_REALTIME_MODEL)
  throw new Error('Set RELAY_OPENAI_LOCAL_TOKEN and an available RELAY_REALTIME_MODEL first.');
const base=process.env.BRIDGE_BASE_URL || 'http://127.0.0.1:4144/v1';
const url=base.replace(/^http/,'ws')+'/realtime?model='+encodeURIComponent(process.env.RELAY_REALTIME_MODEL);
const ws=new WebSocket(url,{headers:{'x-relay-openai-token':process.env.RELAY_OPENAI_LOCAL_TOKEN}});
const timeout=setTimeout(()=>ws.close(),30_000);
ws.on('message',data=>{
  const event=JSON.parse(data.toString());
  console.log('Event:',event.type); // Never print credentials or audio payloads.
  if(event.type==='session.created'||event.type==='error')ws.close();
});
ws.on('error',()=>{console.error('Realtime connection failed; check /health and account access.');process.exitCode=1;});
ws.on('close',()=>clearTimeout(timeout));
// Implement microphone/audio playback and the public Realtime event protocol
// in your own client; the relay forwards text and binary frames unchanged.
