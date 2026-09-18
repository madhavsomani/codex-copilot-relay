import test from 'node:test';
import assert from 'node:assert/strict';
import {callReasoning} from './call-reasoning.mjs';

test('reasoning reports session selection, not requested effort or current settings', () => {
  const result=callReasoning({requestedReasoningEffort:'low',selectedReasoningEffort:'high',reasoningSource:'continuation'});
  assert.equal(result.requested,'low');assert.equal(result.selected,'high');assert.equal(result.changed,true);
  assert.match(result.note,/existing SDK session/);
  assert.equal(callReasoning({requestedReasoningEffort:'high'}).selected,null);
  assert.equal(callReasoning({}).selected,null);
  assert.equal(callReasoning({selectedReasoningEffort:'<script>'}).selected,null);
});

test('legacy effort is recovered only from an intact initial or continuation replay', () => {
  const legacy={input:{reasoning:{effort:'ultra'}},copilotReplays:[{phase:'initial',reasoningEffort:'xhigh',modelRouting:{reasoningCapped:true}},{phase:'premature_completion_retry'}]};
  const result=callReasoning(legacy);
  assert.equal(result.selected,'xhigh');assert.equal(result.capped,true);assert.equal(result.source,'retained_replay');
  assert.equal(callReasoning({input:{reasoning:{effort:'low'}},copilotReplays:[{truncated:true,preview:'reasoningEffort:high'}]}).selected,null);
  assert.equal(callReasoning({selectedReasoningEffort:'none',requestedReasoningEffort:'none'}).selected,'none');
});
