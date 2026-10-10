import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
for(const shell of ['powershell.exe','pwsh.exe'])test(`${shell} combined recovery refuses uncertain owners and archives only stopped receipts`,{skip:process.platform!=='win32'},async t=>{
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  try{
    const {stdout}=await promisify(execFile)(shell,['-NoProfile','-File',
      fileURLToPath(new URL('./unified-recovery.test.ps1',import.meta.url))],{env:environment,windowsHide:true,timeout:20000,maxBuffer:16384});
    assert.match(stdout,/UNIFIED_STOPPED_OWNERS_ARCHIVED_HISTORY_PRESERVED_OK/);
  }catch(error){if(shell==='pwsh.exe'&&error.code==='ENOENT'){t.skip('PowerShell 7 not installed');return;}throw error;}
});
