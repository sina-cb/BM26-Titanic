import { describe, expect, it } from 'vitest';

import { WORKSPACE_KNOWN_SET_RULE } from './workspace_known_set_policy';
import { WORKSPACE_KNOWN_SET_RULE as DECK_RULE } from './deck/deck_workspace_layout';
import { WORKSPACE_KNOWN_SET_RULE as MIXER_RULE } from './mixer/mixer_workspace_layout';

// docs/64 §10 convergence duty: "the known-set new-id policy table (§2.3
// here, §2.3 there) must read as one rule." This is the regression guard —
// if a future edit ever forks the deck's or the mixer's re-export into its
// own local string (reintroducing the two-paraphrases-that-can-drift
// problem this constant exists to kill), this test catches it immediately,
// on the strongest possible assertion: not merely equal text, but the SAME
// object reference.
describe('workspace known-set rule (docs/64 §10 convergence)', () => {
  it('is a non-empty statement', () => {
    expect(typeof WORKSPACE_KNOWN_SET_RULE).toBe('string');
    expect(WORKSPACE_KNOWN_SET_RULE.length).toBeGreaterThan(0);
  });

  it('the deck and mixer workspace-layout modules re-export the IDENTICAL constant', () => {
    expect(DECK_RULE).toBe(WORKSPACE_KNOWN_SET_RULE);
    expect(MIXER_RULE).toBe(WORKSPACE_KNOWN_SET_RULE);
    expect(DECK_RULE).toBe(MIXER_RULE);
  });
});
