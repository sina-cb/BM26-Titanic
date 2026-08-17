// Destructive-confirm copy for the two manual Baby cues in the Titanic show
// plan. This is keyed on CUE ids (`c_baby_reveal_pink` / `c_baby_reveal_blue`),
// not on playlist names, so the Baby playlist reorganisation does not touch it —
// but the copy has to stay TRUE to what the cue now does. Those cues open on the
// outcome-blind `baby_tease` playlist and only swap to `baby_girl` / `baby_boy`
// at the sequence's second step; the old wording promised a "90-second tease and
// 2-second blackout", which belonged to a single all-in-one pattern that no
// longer exists.
//
// The ceremonial reveal — the one with the human button, the blackout stage and
// the white flash — is the SPECIAL EVENTS tab's `baby_reveal` show. This
// timeline path is the scheduled/manual alternative, and the dialog says so.
export interface BabyRevealConfirmation {
  color: 'PINK' | 'BLUE';
  title: string;
  body: string;
  confirmLabel: string;
}

export function babyRevealConfirmation(cueId: string): BabyRevealConfirmation | null {
  let color: BabyRevealConfirmation['color'];
  if (cueId === 'c_baby_reveal_pink') color = 'PINK';
  else if (cueId === 'c_baby_reveal_blue') color = 'BLUE';
  else return null;
  return {
    color,
    title: `FIRE ${color} BABY REVEAL?`,
    body: `This immediately starts the outcome-blind BABY TEASE at time zero. The ${color} answer takes over later in this cue's sequence. For the ceremonial reveal on a human button, use the SPECIAL EVENTS tab instead.`,
    confirmLabel: `FIRE ${color}`,
  };
}
