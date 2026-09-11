// Deliberately enumerate the maintained root tests. Ignored runtime directories
// may contain release snapshots or third-party fixtures; never execute those.
import {readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=readdirSync(root).filter(name=>name.endsWith('.test.mjs')).sort();
if(!files.length)throw new Error('No maintained relay tests found.');
const child=spawn(process.execPath,['--test',...files],{cwd:root,windowsHide:true,stdio:'inherit'});
child.once('error',()=>{console.error('Unable to launch the test runner.');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code ?? 1;});
