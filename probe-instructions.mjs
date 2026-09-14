import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildSessionInput} from './bridge-core.mjs';
import {MAX_INSTRUCTIONS_CHARS} from './instruction-budget.mjs';

const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const base=args.get('--url')??'http://127.0.0.1:4144/v1',model=args.get('--model')??'gpt-6-astra';
const health=async()=>await(await fetch(base.replace(/\/v1\/?$/,'')+'/health')).json();
const post=body=>fetch(base+'/responses',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({model,reasoning:{effort:'low'},...body}),signal:AbortSignal.timeout(180000)});
const message=text=>({role:'developer',content:[{type:'input_text',text}]});
const words=Array.from({length:4},()=>randomUUID().slice(0,8));
const catalog='<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `C:/probe-skills`\n### Available skills\n'
  +'- synthetic-only: '+ 'unused reference '.repeat(1500)+' (file: r0/example/SKILL.md)\n'
  +'### How to use skills\nThis is a transport test, not a request to read files. The third codeword is '+words[2]+'.\n</skills_instructions>';
const input=[message('The first codeword is '+words[0]+'.'),...Array.from({length:44},()=>message(catalog))];
input.splice(22,0,message('The second codeword is '+words[1]+'.'));
input.push(message('The fourth codeword is '+words[3]+'.'));
input.push({role:'user',content:'Call instruction_check with the four required codewords in order, comma separated. After the tool succeeds, reply with its returned completion marker only.'});
const tools=[{type:'function',name:'instruction_check',description:'Check the required codewords.',parameters:{type:'object',
  properties:{codewords:{type:'string'}},required:['codewords'],additionalProperties:false}}];
const original=buildSessionInput({input},process.cwd(),{maxSerializedTextTokens:872000,countTokens:()=>100});
assert.ok(original.contextStats.originalSystemChars>MAX_INSTRUCTIONS_CHARS);
assert.equal(original.contextStats.deduplicatedSkillCatalogs,43);

// Fail locally before spending an SDK session, with a proper terminal SSE error.
const before=await health();assert.equal(before.reliability.maxInstructionsChars,MAX_INSTRUCTIONS_CHARS);
const invalid=await post({stream:true,instructions:'X'.repeat(MAX_INSTRUCTIONS_CHARS),input:'Reply only OK.'});
const events=await invalid.text();assert.match(events,/event: response.failed/);assert.match(events,/"code":"invalid_prompt"/);
assert.match(events,/No unique instruction was truncated/);
const after=await health();assert.equal(after.sdk.sessionsCreatedThisWorker,before.sdk.sessionsCreatedThisWorker);
const initial=await post({stream:false,input,tools});const body=await initial.json();
assert.ok(initial.ok,body.error?.message??'Initial request failed');
const call=body.output?.find(item=>item.type==='function_call'&&item.name==='instruction_check');
assert.ok(call,'The oversized repeated catalog request must reach the outer tool');
assert.equal(JSON.parse(call.arguments).codewords,words.join(','));
const marker='INSTRUCTIONS_TOOL_CONTINUATION_OK';
const continuation=await post({stream:false,previous_response_id:body.id,input:[{type:'function_call_output',call_id:call.call_id,output:marker}]});
const completed=await continuation.json();assert.ok(continuation.ok,completed.error?.message??'Continuation failed');
const final=completed.output?.filter(x=>x.type==='message').flatMap(x=>x.content??[]).map(x=>x.text??'').join('');
assert.equal(final,marker);
console.log(JSON.stringify({ok:true,model,originalSystemChars:original.contextStats.originalSystemChars,
  retainedSystemChars:original.systemContent.length,deduplicatedSkillCatalogs:43,uniqueGuardAllocatedSessions:0,
  preservedCodewords:4,outerToolContinuation:true,finalMarker:final},null,2));
