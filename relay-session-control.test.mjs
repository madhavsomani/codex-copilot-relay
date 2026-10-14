import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SessionLease,createSessionControl} from './relay-session-control.mjs';
import {UsageReceipts,UsageOwners} from './usage-receipts.mjs';

test('receipt identities and ownership are bounded, and late usage stays on its original row',()=>{
  const gate=new UsageReceipts(4),owners=new UsageOwners(2),one={},two={};
  owners.bind({apiCallId:'one'},one);owners.bind({apiCallId:'two'},two);
  assert.equal(owners.get({apiCallId:'one'},two),one);
  assert.equal(gate.accept({apiCallId:'one',model:'test'},{id:'event-1'}),true);
  assert.equal(gate.accept({apiCallId:'one',model:'test'},{id:'event-2'}),false);
  assert.equal(gate.accept({model:'test'},{id:'event-2'}),false);
  for(let i=0;i<12;i++)gate.accept({apiCallId:'call-'+i});
  assert.ok(gate.seen.size<=4);assert.doesNotMatch(JSON.stringify([...gate.seen]),/call-|event-/);
});

test('local cancellation targets exactly one waiting revision and cannot cancel resumed or rebuilding work',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relay-cancel-'));
  try{
    const lease=new SessionLease('claude-code');lease.set('waiting-for-tools',46800000);
    let rebuilding=false,cancelled=0;
    const entry=()=>({view:lease.view(),canCancel:()=>!rebuilding,cancel:()=>{cancelled++;lease.set('cancelled',0);}});
    const control=createSessionControl({directory,instanceId:'instance',entries:()=>[entry()]});
    const command=()=>({instanceId:'instance',id:lease.id,revision:lease.revision});
    const write=value=>fs.writeFileSync(path.join(directory,'relay-session-cancel.json'),JSON.stringify(value));
    write({...command(),instanceId:'stale'});await control.check();assert.equal(cancelled,0);
    const stale=command();lease.set('streaming',900000);lease.set('waiting-for-tools',46800000);
    write(stale);assert.equal(await control.check(),'refused');assert.equal(cancelled,0);
    rebuilding=true;write(command());assert.equal(await control.check(),'refused');assert.equal(cancelled,0);
    rebuilding=false;write(command());assert.equal(await control.check(),'cancelled');assert.equal(cancelled,1);
    assert.equal(fs.existsSync(path.join(directory,'relay-session-cancel.json')),false);
  }finally{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});}
});

test('local session cancellation refuses malformed or linked commands without deleting targets',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'relay-cancel-'));
  try{
    const file=path.join(directory,'relay-session-cancel.json'),target=path.join(directory,'keep.json');
    const control=createSessionControl({directory,instanceId:'one',entries:()=>assert.fail('must not inspect entries')});
    fs.writeFileSync(file,'{');await control.check();assert.equal(fs.readFileSync(file,'utf8'),'{');fs.unlinkSync(file);
    fs.writeFileSync(target,'keep');fs.linkSync(target,file);await control.check();
    assert.equal(fs.readFileSync(target,'utf8'),'keep');assert.equal(fs.existsSync(file),true);
  }finally{assert.equal(path.dirname(directory),os.tmpdir());fs.rmSync(directory,{recursive:true,force:true});}
});
