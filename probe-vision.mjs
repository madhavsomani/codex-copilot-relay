import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const base = args.get('--url') ?? 'http://127.0.0.1:4144/v1';
const model = args.get('--model') ?? 'gpt-6-astra';

// Deliberately synthetic screenshots: the answer exists only in image pixels.
const digits = ['01110100011001110101110011000101110', '00100011000010000100001000010001110',
  '01110100010000100010001000100011111', '11110000010000101110000010000111110',
  '00010001100101010010111110001000010', '11111100001000011110000010000111110',
  '01110100001000011110100011000101110', '11111000010001000100010000100001000',
  '01110100011000101110100011000101110', '01110100011000101111000010000101110'];
function png(code) {
  const width = 640, height = 160, scale = 12;
  const raw = Buffer.alloc(height * (width * 3 + 1), 255);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  for (let n = 0; n < code.length; n++) for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
    if (digits[Number(code[n])][y * 5 + x] !== '1') continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const at = (38 + y * scale + dy) * (width * 3 + 1) + 1 + (60 + n * 84 + x * scale + dx) * 3;
      raw.fill(0, at, at + 3);
    }
  }
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, payload, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const request = async body => {
  const response = await fetch(base + '/responses', { method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({model, stream:false, ...body}), signal:AbortSignal.timeout(120000) });
  const data = await response.json();
  assert.equal(response.status, 200, data.error?.message);
  return data;
};
const text = body => ((body.output ?? []).filter(x => x.type === 'message').at(-1)?.content ?? []).map(x => x.text ?? '').join('').trim();
const code = () => String(randomInt(100000, 1000000));
const directCode = code();
const direct = await request({ input:[{type:'message',role:'user',content:[{type:'input_text',text:'Read the six digits in this image. Reply with only those six digits.'},{type:'input_image',image_url:png(directCode)}]}] });
assert.equal(text(direct), directCode, 'Initial image must reach the model');
console.log(JSON.stringify({stage:'initial_image',ok:true}));
const tool = {type:'function',name:'relay_screenshot',description:'Return a synthetic screenshot for this test.',parameters:{type:'object',properties:{step:{type:'integer'},previous:{type:'string'}},required:['step','previous'],additionalProperties:false}};
let response = await request({ tools:[tool],input:'Call relay_screenshot with step 1 and previous START. Read the six digits in the returned screenshot. Call it again with step 2 and previous equal to the digits you just read. After the second screenshot reply with only its six digits. Never guess unreadable digits.' });
let previous = 'START';
for (let step = 1; step <= 2; step++) {
  const call = response.output?.find(x => x.type === 'function_call');
  assert.ok(call, 'Expected screenshot tool call at step ' + step + '; got: ' + text(response));
  const parameters = JSON.parse(call.arguments);
  assert.equal(parameters.step, step); assert.equal(parameters.previous, previous, 'Tool continuation must see the previous screenshot');
  previous = code();
  response = await request({ previous_response_id:response.id,input:[{type:'function_call_output',call_id:call.call_id,output:[{type:'input_text',text:'Read the screenshot pixels.'},{type:'input_image',image_url:png(previous)}]}] });
}
assert.equal(text(response), previous, 'Newest screenshot must replace the previous image');
console.log(JSON.stringify({ok:true,model,initialImage:true,consecutiveToolImages:2}));
