import { describe, expect, it } from 'vitest';

import { babyRevealConfirmation } from './baby_reveal_confirmation';

describe('baby reveal confirmation', () => {
  it('names the pink and blue actions explicitly', () => {
    expect(babyRevealConfirmation('c_baby_reveal_pink')).toMatchObject({
      color: 'PINK',
      title: 'FIRE PINK BABY REVEAL?',
      confirmLabel: 'FIRE PINK',
    });
    expect(babyRevealConfirmation('c_baby_reveal_blue')).toMatchObject({
      color: 'BLUE',
      title: 'FIRE BLUE BABY REVEAL?',
      confirmLabel: 'FIRE BLUE',
    });
  });

  it('does not invent a reveal for any other cue', () => {
    expect(babyRevealConfirmation('c_party_start')).toBeNull();
    expect(babyRevealConfirmation('')).toBeNull();
  });
});
