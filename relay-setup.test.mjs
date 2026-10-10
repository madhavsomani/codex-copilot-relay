import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Windows first-frame guide reports two client workflows without exposing credentials',{skip:process.platform!=='win32'},()=>{
  const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  const result=spawnSync('powershell.exe',['-NoProfile','-File',fileURLToPath(new URL('./relay-setup.test.ps1',import.meta.url))],{env,encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/SETUP_GUIDE_.*_OK/);
});
