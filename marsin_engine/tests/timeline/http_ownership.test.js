import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isReadOnlyTimelineBodyRequest,
  isTimelineAuthorityMutation,
} from '../../lib/timeline/http_ownership.js';

test('POST /timeline/overview remains ownerless and cannot preempt Live Touch', () => {
  assert.equal(isReadOnlyTimelineBodyRequest('POST', '/timeline/overview'), true);
  assert.equal(isTimelineAuthorityMutation('POST', '/timeline/overview'), false);
  assert.equal(isTimelineAuthorityMutation('GET', '/timeline/overview'), false);
});

test('classifies every operator Timeline mutation that must outrank Live Touch', () => {
  for (const [method, url] of [
    ['PUT', '/party-config'],
    ['POST', '/timeline/plans'],
    ['PUT', '/timeline/plans/playa_default'],
    ['DELETE', '/timeline/plans/playa_default'],
    ['POST', '/timeline/plan/activate'],
    ['POST', '/timeline/autopilot'],
    ['POST', '/timeline/resume'],
    ['POST', '/timeline/takeover'],
    ['POST', '/timeline/travel'],
    ['POST', '/timeline/program/end'],
    ['POST', '/timeline/program/enable'],
    ['POST', '/timeline/program/dismiss'],
    ['POST', '/timeline/cues/c_sunset/fire'],
  ]) {
    assert.equal(isTimelineAuthorityMutation(method, url), true, `${method} ${url}`);
  }
});

test('does not grant priority to reads, preview, activity, near-miss, or unrelated writes', () => {
  for (const [method, url] of [
    ['GET', '/party-config'],
    ['GET', '/timeline/state'],
    ['GET', '/timeline/plans'],
    ['GET', '/timeline/plans/playa_default'],
    ['GET', '/timeline/resolve?cueId=c_sunset'],
    ['POST', '/timeline/overview'],
    ['POST', '/timeline/activity'],
    ['POST', '/timeline/plans/playa_default'],
    ['PUT', '/timeline/plans/name/extra'],
    ['POST', '/timeline/cues/c_sunset'],
    ['POST', '/timeline/cues/c_sunset/fire/extra'],
    ['PUT', '/section-brightness'],
  ]) {
    assert.equal(isTimelineAuthorityMutation(method, url), false, `${method} ${url}`);
  }
});

test('rejects malformed classifier inputs without guessing intent', () => {
  assert.equal(isTimelineAuthorityMutation(null, '/timeline/plans'), false);
  assert.equal(isTimelineAuthorityMutation('POST', null), false);
  assert.equal(isTimelineAuthorityMutation('', ''), false);
});
