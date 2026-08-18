import { describe, expect, it } from 'vitest';

import {
  beginTimelinePriorityFeedback,
  settleTimelinePriorityFeedback,
  timelinePriorityFeedbackText,
} from './timeline_priority_feedback';

describe('Timeline priority feedback', () => {
  it('stays absent when no Live Touch handoff is needed', () => {
    expect(beginTimelinePriorityFeedback(1, 'SAVE PLAN', false, null)).toBeNull();
  });

  it('names the owner and operation through preempting and success', () => {
    const started = beginTimelinePriorityFeedback(7, 'SAVE PLAN', true, 'touch_owner');
    expect(started).not.toBeNull();
    expect(timelinePriorityFeedbackText(started!)).toBe(
      "PREEMPTING LIVE TOUCH 'touch_owner' — SAVE PLAN",
    );
    const settled = settleTimelinePriorityFeedback(started, 7, true);
    expect(settled?.phase).toBe('succeeded');
    expect(timelinePriorityFeedbackText(settled!)).toBe(
      "TIMELINE TOOK PRIORITY — LIVE TOUCH 'touch_owner' DISARMED · SAVE PLAN",
    );
  });

  it('surfaces a failed handoff without claiming success', () => {
    const started = beginTimelinePriorityFeedback(3, 'FIRE CUE', true, null);
    const failed = settleTimelinePriorityFeedback(started, 3, false, 'release was not confirmed');
    expect(failed?.phase).toBe('failed');
    expect(timelinePriorityFeedbackText(failed!)).toBe(
      'TIMELINE PRIORITY FAILED — FIRE CUE · release was not confirmed',
    );
  });

  it('ignores a stale completion after a newer concurrent attempt owns the banner', () => {
    const newer = beginTimelinePriorityFeedback(12, 'ACTIVATE PLAN', true, 'touch_owner');
    expect(settleTimelinePriorityFeedback(newer, 11, true)).toBe(newer);
    expect(settleTimelinePriorityFeedback(newer, 12, true)?.phase).toBe('succeeded');
  });

  it('fails loudly on invalid attempt metadata', () => {
    expect(() => beginTimelinePriorityFeedback(0, 'SAVE', true, null)).toThrow(/positive integer/);
    expect(() => beginTimelinePriorityFeedback(1, '  ', true, null)).toThrow(/operation is required/);
  });
});
