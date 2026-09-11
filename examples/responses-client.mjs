// Run from a shell with RELAY_OPENAI_LOCAL_TOKEN inherited from the optional
// hybrid launcher. This file never needs the upstream OpenAI API key.
const base=process.env.BRIDGE_BASE_URL || 'http://127.0.0.1:4144/v1';
const useNative=process.argv.includes('--native-code');
if(useNative&&!process.env.RELAY_OPENAI_LOCAL_TOKEN)throw new Error('Enable hybrid mode first; this option uses paid OpenAI API execution.');
const response=await fetch(base+'/responses',{method:'POST',headers:{'content-type':'application/json',
  ...(process.env.RELAY_OPENAI_LOCAL_TOKEN?{'x-relay-openai-token':process.env.RELAY_OPENAI_LOCAL_TOKEN}:{})},
  body:JSON.stringify({model:(useNative?'openai/':'')+(process.env.CLIENT_MODEL || 'gpt-6-astra'),stream:false,
    input:useNative?'Use Python to compute 123 * 456.':'Reply with RELAY_OK.',
    ...(useNative?{tools:[{type:'code_interpreter',container:{type:'auto'}}]}:{})})});
console.log('Backend:',response.headers.get('x-relay-backend') || 'github-copilot-sdk');
const result=await response.json();if(!response.ok)throw new Error(result.error?.message || 'Request failed');
console.log(JSON.stringify(result.output,null,2));
// For client-defined function tools, execute function_call items under your
// own permissions, then send function_call_output with previous_response_id.
