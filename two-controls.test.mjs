import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderUnifiedSetupPage} from './unified-setup.mjs';
test('Windows two-control lifecycle, local-key and shortcut fixtures',{skip:process.platform!=='win32'},()=>{
  const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  const result=spawnSync('powershell.exe',['-NoProfile','-File',fileURLToPath(new URL('./two-controls.test.ps1',import.meta.url))],{env,encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/TWO_CONTROLS_.*_OK/);
});
test('managed connection page reports real setup/restoration boundaries',()=>{
  const html=renderUnifiedSetupPage(4144,{managedDesktop:true});
  assert.match(html,/Start Relay manages/);assert.match(html,/persistent local key/);
  assert.match(html,/Stop &amp; Restore/);assert.match(html,/Claude retains its saved Gateway profile/);
  assert.doesNotMatch(html,/Each launch generates new local keys|codex-key|Desktop TOML migration is not automatic/);
});
