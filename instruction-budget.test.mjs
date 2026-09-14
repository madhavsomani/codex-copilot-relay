import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSessionInput,assertSerializedContextWithinLimit,classifyResponseFailureCode} from './bridge-core.mjs';
import {buildBoundedInstructions} from './instruction-budget.mjs';

const LIMIT=1_048_576;
const catalog=(name='repeated',size=180_000)=>'<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `C:/skills`\n### Available skills\n- '+name+': '+ 'reference '.repeat(Math.ceil(size/10))+' (file: r0/example/SKILL.md)\n### How to use skills\nRead the current skill. Preserve approvals.\n</skills_instructions>';
const message=(text,role='developer')=>({role,content:[{type:'input_text',text}]});
const tokenBudget={maxSerializedTextTokens:872_000,countTokens:()=>100,useHistoryCompaction:false};

test('duplicate complete skill catalogs cannot overflow the provider instructions field',()=>{
  const repeated=catalog(), input=Array.from({length:7},()=>message(repeated));
  input.splice(3,0,message('Never change a production record without approval.'));
  input.push(message('Return the latest user marker.', 'user'));
  const body={input},original=JSON.stringify(body);
  const result=buildSessionInput(body,process.cwd(),tokenBudget);
  assert.ok(result.systemContent.length<=LIMIT,'instructions must fit independently of tokens');
  assert.ok(result.systemContent.includes('Never change a production record without approval.'));
  assert.equal(result.systemContent.split(repeated).length-1,1);
  assert.ok(result.systemContent.lastIndexOf(repeated)>result.systemContent.indexOf('Never change'));
  assert.equal(result.contextStats.deduplicatedSkillCatalogs,6);
  assert.ok(result.contextStats.originalSystemChars>LIMIT);
  assert.equal(JSON.stringify(body),original);
  assert.ok(result.prompt.includes('latest user marker'));
});
test('unique instructions over the field cap fail even with abundant token capacity',()=>{
  assert.throws(()=>buildSessionInput({instructions:'X'.repeat(LIMIT),input:'hello'},process.cwd(),tokenBudget),
    error=>error.code==='instructions_too_long'&&error.statusCode===400&&error.param==='instructions');
});
test('independent final guard includes exact boundary and conservative UTF-16 length',()=>{
  for(const content of ['x'.repeat(LIMIT),'😀'.repeat(LIMIT/2)]) {
    assert.doesNotThrow(()=>assertSerializedContextWithinLimit({systemContent:content,prompt:''},[],tokenBudget));
    assert.throws(()=>assertSerializedContextWithinLimit({systemContent:content+'x',prompt:''},[],tokenBudget),{code:'instructions_too_long'});
  }
});
test('upstream instructions-length validation is an invalid prompt, not a server failure',()=>{
  assert.equal(classifyResponseFailureCode('too much unique instruction text','instructions_too_long'),'invalid_prompt');
  assert.equal(classifyResponseFailureCode("CAPIError: 400 Invalid 'instructions': string too long. Expected maximum length 1048576",'bridge_error'),'invalid_prompt');
  assert.equal(classifyResponseFailureCode('Connection is closed.','bridge_error'),'server_error');
});
test('differing snapshots and intervening policies retain their exact text and order',()=>{
  const a=catalog('older'),b=catalog('changed');
  const entries=[a,'Require approval for writes.',b,a,'Never publish without approval.',a,a,a,a];
  const result=buildBoundedInstructions('BRIDGE RULES',entries);
  assert.equal(result.systemContent.split(a).length-1,1);
  for(const text of ['BRIDGE RULES',entries[1],b,entries[4]])assert.ok(result.systemContent.includes(text));
  assert.ok(result.systemContent.indexOf(entries[1])<result.systemContent.indexOf(b));
  assert.ok(result.systemContent.indexOf(b)<result.systemContent.indexOf(entries[4]));
  assert.ok(result.systemContent.indexOf(entries[4])<result.systemContent.indexOf(a));
});
test('small requests keep their original system field byte-for-byte',()=>{
  const c=catalog('small',500),entries=[c,c,'Keep all rules.'];
  const expected=['bridge',...entries.map((text,index)=>`\n--- Outer developer instruction ${index+1} ---\n${text}`)].join('\n');
  const result=buildBoundedInstructions('bridge',entries);
  assert.equal(result.systemContent,expected);assert.equal(result.stats.deduplicatedSkillCatalogs,0);
});
test('quoted, nested, partial, sibling-bearing and arbitrary repeated instructions are untouched',()=>{
  const c=catalog('intact',1000);
  const variants=['```xml\n'+c+'\n```',c+'\n<permissions>Keep this</permissions>',c.replace('</skills_instructions>',''),
    c.replace('### Available skills','<skills_instructions>\n### Available skills'), 'Arbitrary rule '.repeat(100)];
  const entries=[...variants,...variants,...Array(7).fill(catalog())];
  const result=buildBoundedInstructions('bridge',entries);
  for(let index=0;index<variants.length*2;index++)assert.ok(result.systemContent.includes(
    `\n--- Outer developer instruction ${index+1} ---\n${entries[index]}`));
  assert.equal(result.stats.deduplicatedSkillCatalogs,6);
});
test('system, root and developer catalogs are never merged across authority groups',()=>{
  const c=catalog(),entries=Array(8).fill(c);
  const result=buildBoundedInstructions('bridge',entries,['root','system','developer','developer','developer','developer','developer','developer']);
  assert.equal(result.systemContent.split(c).length-1,3);
  assert.equal(result.stats.deduplicatedSkillCatalogs,5);
});
test('dedup cannot hide oversized unique system constraints',()=>{
  const c=catalog('repeat',2000),unique='UNIQUE_RULE '.repeat(100000);
  assert.throws(()=>buildBoundedInstructions('bridge',[c,c,unique]),{code:'instructions_too_long'});
});
test('catalogs carried in user and tool output never affect system deduplication',()=>{
  const c=catalog('data',1000);
  const result=buildSessionInput({input:[message(c,'user'),{type:'function_call_output',call_id:'a',output:c}]},process.cwd(),tokenBudget);
  assert.ok(!result.systemContent.includes(c));assert.equal(result.contextStats.deduplicatedSkillCatalogs,0);
  assert.ok(result.prompt.includes('data:'));assert.ok(result.prompt.includes('function_call_output'));
});
test('exact CRLF catalog duplicates are recognized without newline normalization',()=>{
  const c=catalog().replaceAll('\n','\r\n');
  const result=buildBoundedInstructions('bridge',Array(7).fill(c));
  assert.ok(result.systemContent.includes(c));assert.equal(result.stats.deduplicatedSkillCatalogs,6);
});
test('repeated image-resize notices stay at every original instruction position',()=>{
  const notice='<image_resize_notice>Image 1 was resized from 1440x2728 to 1081x2048 pixels.</image_resize_notice>';
  const entries=[...Array(170).fill(notice),...Array(7).fill(catalog())];
  const result=buildBoundedInstructions('bridge',entries);
  assert.equal(result.systemContent.split(notice).length-1,170);
  for(let index=0;index<170;index++)assert.ok(result.systemContent.includes(
    `\n--- Outer developer instruction ${index+1} ---\n${notice}`));
});
test('a single unique oversized catalog is explicitly rejected, never truncated',()=>{
  const unique=catalog('unique',LIMIT+1);
  assert.throws(()=>buildBoundedInstructions('bridge',[unique]),error=>error.code==='instructions_too_long'
    &&error.instructionChars>LIMIT&&/No unique instruction was truncated/.test(error.message));
});
