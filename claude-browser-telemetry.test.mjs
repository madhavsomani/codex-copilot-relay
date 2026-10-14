import test from 'node:test';
import assert from 'node:assert/strict';
import {observeBrowserCatalog,observeBrowserSignal,browserTelemetry} from './claude-gateway/browser-telemetry.mjs';
test('browser offered, invoked and returned are distinct nonsecret observations',()=>{
  const row={at:'2026-10-10T12:00:00Z'};observeBrowserCatalog(row,[{name:'mcp__relay_browser__browser_navigate',description:'PRIVATE'}]);
  assert.equal(browserTelemetry([row]).results,0);assert.equal(browserTelemetry([row]).offered,true);
  observeBrowserSignal(row,'tool_requested',{name:'mcp__relay_browser__browser_navigate'});
  observeBrowserSignal(row,'tool_resolved',{name:'mcp__relay_browser__browser_navigate',isError:true});
  observeBrowserSignal(row,'tool_resolved',{name:'mcp__relay_browser__browser_take_screenshot'});
  observeBrowserSignal(row,'tool_resolved',{name:'private_tool'});
  const view=browserTelemetry([row]);assert.equal(view.results,1);assert.equal(view.errors,1);assert.equal(view.requests,1);
  assert.doesNotMatch(JSON.stringify(view),/PRIVATE|private_tool|navigate/);
});
