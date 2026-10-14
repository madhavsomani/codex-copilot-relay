import test from 'node:test';
import assert from 'node:assert/strict';
import {DASHBOARD_HTML} from './dashboard.mjs';
import {renderUnifiedSetupPage} from './unified-setup.mjs';

test('main dashboard exposes an open Claude guide without requiring connection-center navigation',()=>{
  assert.ok(/<details[^>]+id="claude-setup-guide"[^>]+open/.test(DASHBOARD_HTML));
  assert.ok(DASHBOARD_HTML.includes('href="#claude-setup-guide"'));
  for(const text of ['Configure Third-Party Inference','Static API key','Bearer','Allow Code','MCP tool search','models','Stop &amp; Restore'])
    assert.ok(DASHBOARD_HTML.includes(text),text);
  assert.ok(DASHBOARD_HTML.includes('key stays in your terminal'));
  assert.ok(/in-flight request.*lost/.test(DASHBOARD_HTML));
  assert.ok(DASHBOARD_HTML.includes('10 seconds'));
  assert.ok(!/<input[^>]*(password|api.?key)/i.test(DASHBOARD_HTML));
});

test('managed connection center repeats the guide with its actual port and persistent-key instructions',()=>{
  const html=renderUnifiedSetupPage(4546,{managedDesktop:true});
  assert.ok(html.includes('id="claude-setup-guide"'));
  assert.ok(html.includes('http://127.0.0.1:4546/claude'));
  assert.ok(!/http:\/\/127\.0\.0\.1:4144\/claude|paste the session key/.test(html));
  assert.ok(html.includes('persistent local key'));
  assert.ok(html.includes('Save &amp; Restart'));
  assert.ok(!renderUnifiedSetupPage(4546).includes('id="claude-setup-guide"'));
});
