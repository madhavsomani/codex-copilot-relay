import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {BROWSER_HTML,BROWSER_SCRIPT} from './dashboard-browser.mjs';
import {DASHBOARD_HTML} from './dashboard.mjs';
test('browser setup is read-only, safe text and distinguishes configured from proven',()=>{
  const nodes=new Map();const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
  const context=vm.createContext({document});vm.runInContext(BROWSER_SCRIPT,context);context.renderBrowserSetup({});
  assert.match(nodes.get('browser-config-status').textContent,/unavailable/);assert.match(nodes.get('browser-tool-status').textContent,/not observed/);
  context.renderBrowserSetup({browserSetup:{configuration:'configured',researchSkill:'configured'},claude:{models:['claude-haiku-4-5'],browser:{offered:true,results:2,errors:1}}});
  assert.match(nodes.get('browser-result-status').textContent,/2 successful \/ 1 errors/);assert.match(nodes.get('claude-family-models').textContent,/haiku: claude-haiku-4-5/);
  assert.doesNotMatch(BROWSER_SCRIPT,/innerHTML|method:.*POST/);assert.match(BROWSER_HTML,/not Anthropic hosted search/);
  assert.match(DASHBOARD_HTML,/id="claude-browser-guide"/);
});
