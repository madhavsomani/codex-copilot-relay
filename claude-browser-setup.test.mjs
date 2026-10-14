import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyBrowserSetup,restoreBrowserSetup,resumeBrowserSetup,selectBrowser,browserSetupStatus,browserDefinition,browserSkill,setupPaths} from './claude-browser-setup.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-browser-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {config:path.join(root,'config.json'),skill:path.join(root,'skill.md'),receipt:path.join(root,'receipt.json')};}
test('browser setup preserves connectors, credentials, permissions and later settings',t=>{
  const p=fixture(t),original={preferences:{browser:false},mcpServers:{other:{env:{TOKEN:'PRIVATE'}}},model:'explicit'};
  fs.writeFileSync(p.config,JSON.stringify(original));assert.equal(browserSetupStatus(p).configuration,'not-configured');
  assert.equal(applyBrowserSetup(p).state,'applied');assert.equal(applyBrowserSetup(p).state,'already-applied');
  const cfg=JSON.parse(fs.readFileSync(p.config));assert.deepEqual(cfg.mcpServers.other,original.mcpServers.other);assert.equal(cfg.model,'explicit');
  assert.doesNotMatch(fs.readFileSync(p.receipt,'utf8'),/PRIVATE/);cfg.newPreference=42;fs.writeFileSync(p.config,JSON.stringify(cfg));
  restoreBrowserSetup(p);assert.deepEqual(JSON.parse(fs.readFileSync(p.config)),{...original,newPreference:42});assert.ok(!fs.existsSync(p.skill));
});
test('fresh setup restores and paths support overrides without inventing proof',t=>{
  const p=fixture(t);applyBrowserSetup(p);assert.equal(browserSetupStatus(p).guiVerification,'unverified');
  assert.equal(browserSetupStatus(p).browserConnection,'unverified');restoreBrowserSetup(p);assert.ok(!fs.existsSync(p.config));
  assert.equal(restoreBrowserSetup(p).state,'already-restored');assert.equal(applyBrowserSetup(p).state,'applied');
  const paths=setupPaths({root:'/relay',platform:'linux',env:{HOME:'/person',CLAUDE_CONFIG_DIR:'/custom'}});
  assert.equal(paths.skill,path.join('/custom','skills','relay-browser-research','SKILL.md'));
  assert.ok(!JSON.stringify(browserDefinition()).includes('EXTENSION_TOKEN'));assert.match(browserSkill,/not native Anthropic search/);
});
test('conflicts and changed owned entries fail closed',t=>{
  const p=fixture(t);fs.writeFileSync(p.skill,'user skill');assert.throws(()=>applyBrowserSetup(p),/no overwrite/);fs.unlinkSync(p.skill);
  applyBrowserSetup(p);const cfg=JSON.parse(fs.readFileSync(p.config));cfg.mcpServers.relay_browser.args.push('user-edit');fs.writeFileSync(p.config,JSON.stringify(cfg));
  assert.throws(()=>restoreBrowserSetup(p),/preserve your changes/);assert.equal(fs.readFileSync(p.skill,'utf8'),browserSkill);
});
test('prepared journal permits recovery after interrupted setup',t=>{
  const p=fixture(t);applyBrowserSetup(p);const receipt=JSON.parse(fs.readFileSync(p.receipt));receipt.state='prepared';fs.writeFileSync(p.receipt,JSON.stringify(receipt));
  fs.unlinkSync(p.skill);assert.equal(restoreBrowserSetup(p).state,'restored');assert.ok(!fs.existsSync(p.config));
});
test('Start resumes only a prior opt-in; a fresh install is read-only',t=>{
  const p=fixture(t);assert.equal(resumeBrowserSetup(p).state,'not-opted-in');assert.ok(!fs.existsSync(p.config));
  applyBrowserSetup(p);restoreBrowserSetup(p);assert.equal(resumeBrowserSetup(p).state,'applied');
});

test('resume repairs a missing owned skill when Desktop retained the identical browser entry',t=>{
  const p=fixture(t);applyBrowserSetup(p);restoreBrowserSetup(p);
  const baseline={preferences:{keep:true},mcpServers:{relay_browser:browserDefinition()}};
  fs.writeFileSync(p.config,JSON.stringify(baseline));
  assert.equal(resumeBrowserSetup(p).state,'applied');
  assert.equal(fs.readFileSync(p.skill,'utf8'),browserSkill);
  restoreBrowserSetup(p);
  assert.deepEqual(JSON.parse(fs.readFileSync(p.config)),baseline);
  assert.ok(!fs.existsSync(p.skill));
});

test('resume never adopts a changed browser entry or a changed skill',t=>{
  const p=fixture(t);applyBrowserSetup(p);restoreBrowserSetup(p);
  fs.writeFileSync(p.config,JSON.stringify({mcpServers:{relay_browser:{command:'user-edited'}}}));
  assert.throws(()=>resumeBrowserSetup(p),/no overwrite/);
  assert.ok(!fs.existsSync(p.skill));
  fs.writeFileSync(p.config,JSON.stringify({mcpServers:{relay_browser:browserDefinition()}}));
  fs.writeFileSync(p.skill,'user-edited');
  assert.throws(()=>resumeBrowserSetup(p),/no overwrite/);
  assert.equal(fs.readFileSync(p.skill,'utf8'),'user-edited');
});
test('third-party Desktop profile selection is explicit and survives lifecycle restore/resume',t=>{
  const p=fixture(t),root=path.dirname(p.config),env={USERPROFILE:root,APPDATA:path.join(root,'Roaming'),LOCALAPPDATA:path.join(root,'Local')};
  const options={root,env,platform:'win32'};
  const standard=setupPaths(options),third=setupPaths({...options,profile:'third-party'});
  assert.equal(third.config,path.join(env.LOCALAPPDATA,'Claude-3p','claude_desktop_config.json'));
  assert.notEqual(standard.config,third.config);applyBrowserSetup(third);
  assert.equal(setupPaths(options).config,third.config);
  restoreBrowserSetup(setupPaths(options));assert.equal(resumeBrowserSetup(setupPaths(options)).state,'applied');
  assert.ok(!fs.existsSync(standard.config));
  assert.throws(()=>setupPaths({...options,profile:'unknown'}),/profile/);
});
test('selecting Edge rewrites only the owned entry and survives restore/resume',t=>{
  const p=fixture(t);fs.writeFileSync(p.config,JSON.stringify({mcpServers:{other:{command:'keep'}}}));
  assert.throws(()=>browserDefinition(process.platform,'firefox'),/Unknown browser/);
  applyBrowserSetup(p);assert.equal(browserSetupStatus(p).browser,'chrome');
  assert.equal(selectBrowser('msedge',p).state,'selected');assert.equal(selectBrowser('msedge',p).state,'already-selected');
  const cfg=JSON.parse(fs.readFileSync(p.config));assert.deepEqual(cfg.mcpServers.relay_browser.args.slice(-2),['--browser','msedge']);
  assert.deepEqual(cfg.mcpServers.other,{command:'keep'});assert.equal(browserSetupStatus(p).configuration,'configured');
  assert.equal(applyBrowserSetup(p).state,'already-applied');
  restoreBrowserSetup(p);assert.deepEqual(JSON.parse(fs.readFileSync(p.config)),{mcpServers:{other:{command:'keep'}}});
  assert.equal(resumeBrowserSetup(p).state,'applied');assert.equal(browserSetupStatus(p).browser,'msedge');
  cfg.mcpServers.relay_browser.args.push('user-edit');fs.writeFileSync(p.config,JSON.stringify(cfg));
  assert.throws(()=>selectBrowser('chrome',p),/no overwrite/);
});
